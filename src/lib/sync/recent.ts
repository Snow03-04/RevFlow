import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { syncShopifyConnection, syncMetaConnection, syncGoogleConnection, refreshCampaignLinks } from "@/lib/jobs";
import { recomputeDailyMetrics } from "@/lib/metrics";
import { lastNDays } from "@/lib/date";
import { currentPnlMonth, projectPnlMonth } from "@/lib/trackers/pnl-import";
import { currentRoasMonth, projectRoasMonth } from "@/lib/trackers/roas-import";

export type RefreshResult = { ok: boolean; error?: string; synced?: boolean; completedAt?: string };
const WINDOW_DAYS = 3;
const inFlight = new Map<string, Promise<RefreshResult>>();

/** Check EACH source: a freshly synced store must not throttle a stale ad account. */
export function needsSync(connection: { status: string; last_synced_at: string | null }, now = Date.now()) {
  const last = connection.last_synced_at ? Date.parse(connection.last_synced_at) : NaN;
  return connection.status === "error" || !Number.isFinite(last) || last > now || now - last >= 60_000;
}

/** Shared by the HTTP refresh and manual actions; all queries remain scoped by user/RLS. */
export async function refreshRecentData(db: SupabaseClient<Database>, userId: string, force = false): Promise<RefreshResult> {
  const pending = inFlight.get(userId);
  if (pending) return pending;
  const request = runRecentRefresh(db, userId, force);
  inFlight.set(userId, request);
  try { return await request; }
  finally { inFlight.delete(userId); }
}

async function runRecentRefresh(db: SupabaseClient<Database>, userId: string, force: boolean): Promise<RefreshResult> {
  const results = await Promise.all([
    db.from("shopify_connections").select("*").eq("user_id", userId).in("status", ["active", "error"]),
    db.from("meta_connections").select("*").eq("user_id", userId).in("status", ["active", "error"]),
    db.from("google_connections").select("*").eq("user_id", userId).in("status", ["active", "error"]),
  ]);
  const errors = results.flatMap((result) => result.error ? [result.error.message] : []);
  if (results.every((result) => !result.data?.length)) {
    return errors.length ? { ok: false, error: errors.join(" · ") } : { ok: true, synced: false, completedAt: new Date().toISOString() };
  }

  let synced = false;
  async function run(label: string, task: () => Promise<void>) {
    try { await task(); synced = true; }
    catch (error) { errors.push(`${label}: ${error instanceof Error ? error.message : "falha ao atualizar"}`); }
  }
  // Keep the tuple types when passing each provider's connection to its sync.
  await Promise.all([
    ...(results[0].data ?? []).filter((c) => force || needsSync(c)).map((c) => run("Shopify", () => syncShopifyConnection(db, c, { sinceDays: WINDOW_DAYS, skipProducts: true, skipRecompute: true }))),
    ...(results[1].data ?? []).filter((c) => force || needsSync(c)).map((c) => run("Meta", () => syncMetaConnection(db, c, { sinceDays: WINDOW_DAYS, skipRecompute: true }))),
    ...(results[2].data ?? []).filter((c) => force || needsSync(c)).map((c) => run("Google", () => syncGoogleConnection(db, c, { sinceDays: WINDOW_DAYS, skipRecompute: true }))),
  ]);

  if (force && results[1].data?.length) {
    await run("Associação de campanhas Meta", async () => { await refreshCampaignLinks(db, userId); });
  }

  // Always repair the rollup, even when imports were throttled: a prior request
  // could have saved connection timestamps but failed before recomputing totals.
  try {
    const { data: settings, error } = await db.from("settings").select("*").eq("user_id", userId).single();
    if (error) throw error;
    await recomputeDailyMetrics(db, userId, lastNDays(WINDOW_DAYS + 1, settings?.timezone ?? "UTC"), { settings });
    await Promise.all([
      (async () => {
        try {
          const target = await currentPnlMonth(db, userId);
          if (target) await projectPnlMonth(db, userId, target.year, target.month);
        } catch (error) { errors.push(`P&L: ${error instanceof Error ? error.message : "falha ao atualizar"}`); }
      })(),
      (async () => {
        try {
          const { data, error } = await db.from("roas_settings").select("user_id").eq("user_id", userId).maybeSingle();
          if (error) throw error;
          if (data) {
            const target = await currentRoasMonth(db, userId);
            await projectRoasMonth(db, userId, target.year, target.month);
          }
        } catch (error) { errors.push(`ROAS: ${error instanceof Error ? error.message : "falha ao atualizar"}`); }
      })(),
    ]);
  } catch (error) {
    errors.push(`Totais: ${error instanceof Error ? error.message : "não foi possível recalcular"}`);
  }

  return errors.length
    ? { ok: false, synced, error: errors.join(" · ") }
    : { ok: true, synced, completedAt: new Date().toISOString() };
}
