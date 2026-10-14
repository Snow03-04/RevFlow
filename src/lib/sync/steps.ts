import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { syncShopifyConnection, syncMetaConnection, syncGoogleConnection } from "@/lib/jobs";
import { recomputeDailyMetrics } from "@/lib/metrics";
import { lastNDays } from "@/lib/date";
import { currentPnlMonth, projectPnlMonth } from "@/lib/trackers/pnl-import";
import { currentRoasMonth, projectRoasMonth } from "@/lib/trackers/roas-import";
import { needsSync } from "./recent";
import type { RefreshPlan, RefreshResult, RefreshStep, RefreshTask } from "./protocol";

type DB = SupabaseClient<Database>;
const WINDOW_DAYS = 3;
const inFlight = new Map<string, Promise<RefreshResult>>();
export const refreshStepSchema = z.union([
  z.object({ kind: z.enum(["shopify", "meta", "google", "metrics"]), id: z.string().uuid() }).strict(),
  z.object({ kind: z.enum(["pnl", "roas"]) }).strict(),
]);

function message(error: unknown) {
  // PostgREST throws plain objects, not Error instances.
  return error && typeof error === "object" && "message" in error && typeof error.message === "string"
    ? error.message : "Não foi possível concluir esta etapa. Tenta novamente.";
}

/** The plan contains only owned IDs and labels. No tokens or connection objects leave the server. */
export async function planRefresh(db: DB, userId: string, force: boolean): Promise<RefreshPlan> {
  const [shops, meta, google, pnl, roas] = await Promise.all([
    db.from("shopify_connections").select("id,shop_name,shop_domain,status,last_synced_at").eq("user_id", userId),
    db.from("meta_connections").select("id,ad_account_name,status,last_synced_at").eq("user_id", userId),
    db.from("google_connections").select("id,customer_id,status,last_synced_at").eq("user_id", userId),
    db.from("pnl_settings").select("user_id").eq("user_id", userId).maybeSingle(),
    db.from("roas_settings").select("user_id").eq("user_id", userId).maybeSingle(),
  ]);
  for (const result of [shops, meta, google, pnl, roas]) if (result.error) throw result.error;
  const due = (c: { status: string; last_synced_at: string | null }) =>
    ["active", "error"].includes(c.status) && (force || needsSync(c));
  const imports: RefreshTask[] = [
    ...(shops.data ?? []).filter(due).map(c => ({ step: { kind: "shopify" as const, id: c.id }, label: c.shop_name || c.shop_domain })),
    ...(meta.data ?? []).filter(due).map(c => ({ step: { kind: "meta" as const, id: c.id }, label: `Meta · ${c.ad_account_name || "Publicidade"}` })),
    ...(google.data ?? []).filter(due).map(c => ({ step: { kind: "google" as const, id: c.id }, label: `Google · ${c.customer_id}` })),
  ];
  return { ok: true, stages: [
    { kind: "imports", tasks: imports },
    // Repair totals even if a preceding request saved timestamps and then timed out.
    { kind: "totals", tasks: (shops.data ?? []).map(c => ({ step: { kind: "metrics", id: c.id }, label: `Totais · ${c.shop_name || c.shop_domain}` })) },
    { kind: "reports", tasks: [
      ...(pnl.data ? [{ step: { kind: "pnl" as const }, label: "P&L" }] : []),
      ...(roas.data ? [{ step: { kind: "roas" as const }, label: "ROAS" }] : []),
    ] },
  ] };
}

/** One store or report per HTTP request; duplicate requests share only that unit. */
export async function runRefreshStep(db: DB, userId: string, step: RefreshStep, force: boolean): Promise<RefreshResult> {
  const key = `${userId}:${step.kind}:${"id" in step ? step.id : ""}`;
  let pending = inFlight.get(key);
  if (!pending) {
    pending = executeStep(db, userId, step, force)
      .catch(error => ({ ok: false, error: message(error) }))
      .finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
  }
  return pending;
}

async function executeStep(db: DB, userId: string, step: RefreshStep, force: boolean): Promise<RefreshResult> {
  if (step.kind === "shopify" || step.kind === "meta" || step.kind === "google") {
    const table = `${step.kind}_connections` as const;
    const { data: conn, error } = await db.from(table).select("*").eq("user_id", userId).eq("id", step.id).maybeSingle();
    if (error) throw error;
    if (!conn || !["active", "error"].includes(conn.status)) throw new Error("Esta ligação já não está disponível.");
    if (!force && !needsSync(conn)) return { ok: true, synced: false };
    // Keep the existing payment, supplier and historical-date repairs intact.
    if ("shop_domain" in conn) await syncShopifyConnection(db, conn, { sinceDays: WINDOW_DAYS, skipProducts: true, skipRecompute: true, incremental: true });
    else if ("ad_account_id" in conn) await syncMetaConnection(db, conn, { sinceDays: WINDOW_DAYS, skipRecompute: true });
    else await syncGoogleConnection(db, conn, { sinceDays: WINDOW_DAYS, skipRecompute: true });
  } else if (step.kind === "metrics") {
    const [store, settings] = await Promise.all([
      db.from("shopify_connections").select("id").eq("user_id", userId).eq("id", step.id).maybeSingle(),
      db.from("settings").select("*").eq("user_id", userId).single(),
    ]);
    if (store.error) throw store.error;
    if (settings.error) throw settings.error;
    // recomputeDailyMetrics falls back to all stores for an invalid ID; never allow that here.
    if (!store.data) throw new Error("Esta loja já não está disponível.");
    await recomputeDailyMetrics(db, userId, lastNDays(WINDOW_DAYS + 1, settings.data?.timezone ?? "UTC"), {
      storeId: step.id, settings: settings.data,
    });
  } else if (step.kind === "pnl") {
    const target = await currentPnlMonth(db, userId);
    if (target) await projectPnlMonth(db, userId, target.year, target.month);
  } else {
    const { data, error } = await db.from("roas_settings").select("user_id").eq("user_id", userId).maybeSingle();
    if (error) throw error;
    if (data) {
      const target = await currentRoasMonth(db, userId);
      await projectRoasMonth(db, userId, target.year, target.month);
    }
  }
  return { ok: true, synced: true };
}
