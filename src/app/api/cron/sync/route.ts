import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeEqual } from "@/lib/crypto";
import { serverEnv } from "@/lib/env";
import { invalidateSyncedViews } from "@/lib/sync/invalidate";
import { planRefresh, refreshStepSchema, runRefreshStep } from "@/lib/sync/steps";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const interval = 15 * 60_000;
const workerRequest = z.object({
  userId: z.string().uuid(), slot: z.number().int().nonnegative(),
  step: z.union([z.literal("plan"), z.literal("finish"), refreshStepSchema]),
  failures: z.number().int().nonnegative().optional(),
});
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
const authorized = (request: NextRequest) => safeEqual(request.headers.get("authorization") ?? "", `Bearer ${serverEnv.cronSecret}`);

/** Queue each owner independently. The scheduler only waits for Netlify to accept the jobs. */
export async function GET(request: NextRequest) {
  if (!authorized(request)) return json({ ok: false }, 401);
  const db = createAdminClient();
  const owners = new Set<string>();
  const tables = ["shopify_connections", "meta_connections", "google_connections", "pnl_settings", "roas_settings"] as const;
  await Promise.all(tables.map(async table => {
    for (let start = 0; ; start += 1000) {
      const query = db.from(table).select("user_id").order("user_id");
      if (table === "shopify_connections" || table === "meta_connections" || table === "google_connections") {
        query.in("status", ["active", "error"]).order("id");
      }
      const { data, error } = await query.range(start, start + 999);
      if (error) throw error;
      for (const row of data) owners.add(row.user_id);
      if (data.length < 1000) break;
    }
  }));
  const slot = Math.floor(Date.now() / interval);
  const endpoint = new URL("/.netlify/functions/account-sync-background", process.env.URL || process.env.NEXT_PUBLIC_APP_URL);
  const deliveries = await Promise.allSettled([...owners].map(async userId => {
    const response = await fetch(endpoint, {
      method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${serverEnv.cronSecret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ userId, slot }),
    });
    if (response.status !== 202) throw new Error(`Background dispatch: HTTP ${response.status}`);
  }));
  const queued = deliveries.filter(result => result.status === "fulfilled").length;
  return json({ ok: queued === owners.size, owners: owners.size, queued, slot }, queued === owners.size ? 200 : 503);
}

/** Each HTTP invocation handles one import or projection within the background job. */
export async function POST(request: NextRequest) {
  if (!authorized(request)) return json({ ok: false }, 401);
  const parsed = workerRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ ok: false }, 400);
  const { userId, slot, step, failures = 0 } = parsed.data;
  const db = createAdminClient();
  const maintenance = slot % 4 === 0;
  const id = createHash("sha256").update(`revflow:scheduled:${userId}:${slot}`).digest("hex").slice(0, 32);
  if (step === "plan") {
    if (slot !== Math.floor(Date.now() / interval)) return json({ ok: true, stages: [] });
    const plan = await planRefresh(db, userId, maintenance);
    const { error } = await db.from("sync_logs").insert({ id, user_id: userId, source: "scheduler", job_type: "account_refresh", status: "running" });
    if (error?.code === "23505") return json({ ok: true, stages: [] });
    if (error) throw error;
    return json(plan);
  }
  if (step === "finish") {
    const { error } = await db.from("sync_logs").update({
      status: failures ? "partial" : "success", finished_at: new Date().toISOString(),
      error: failures ? `${failures} etapa(s) por atualizar. Consulta as ligações para ver o detalhe.` : null,
    }).eq("id", id).eq("user_id", userId).eq("status", "running");
    if (error) throw error;
    invalidateSyncedViews();
    return json({ ok: true });
  }
  return json(await runRefreshStep(db, userId, step, maintenance, maintenance));
}
