import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { syncShopifyConnection, syncMetaConnection, syncGoogleConnection } from "@/lib/jobs";
import { recomputeDailyMetrics } from "@/lib/metrics";
import { lastNDays } from "@/lib/date";
import { currentPnlMonth, projectPnlMonth } from "@/lib/trackers/pnl-import";
import { currentRoasMonth, projectRoasMonth } from "@/lib/trackers/roas-import";
import { AUTO_REFRESH_MS, type RefreshResult } from "./protocol";

export type { RefreshResult } from "./protocol";
const WINDOW_DAYS = 3;
type ProgressListener = (message: string) => void;
type PendingRefresh = { promise: Promise<RefreshResult>; listeners: Set<ProgressListener>; progress: string };
const inFlight = new Map<string, PendingRefresh>();

/** Check EACH source: a freshly synced store must not throttle a stale ad account. */
export function needsSync(connection: { status: string; last_synced_at: string | null }, now = Date.now()) {
  const last = connection.last_synced_at ? Date.parse(connection.last_synced_at) : NaN;
  return connection.status === "error" || !Number.isFinite(last) || last > now || now - last >= AUTO_REFRESH_MS;
}

/** Shared by the HTTP refresh and manual actions; all queries remain scoped by user/RLS. */
export async function refreshRecentData(db: SupabaseClient<Database>, userId: string, force = false, onProgress?: ProgressListener): Promise<RefreshResult> {
  let pending = inFlight.get(userId);
  if (!pending) {
    const listeners = new Set<ProgressListener>();
    const notify = (message: string) => {
      state.progress = message;
      for (const listener of listeners) {
        try { listener(message); } catch { /* A disconnected browser must not interrupt an import. */ }
      }
    };
    const state: PendingRefresh = {
      promise: Promise.resolve().then(() => runRecentRefresh(db, userId, force, notify)).finally(() => inFlight.delete(userId)),
      listeners,
      progress: "A verificar ligações…",
    };
    pending = state;
    inFlight.set(userId, state);
  }
  if (onProgress) {
    pending.listeners.add(onProgress);
    try { onProgress(pending.progress); } catch { /* Keep the shared job running. */ }
  }
  try { return await pending.promise; }
  finally { if (onProgress) pending.listeners.delete(onProgress); }
}

async function runRecentRefresh(db: SupabaseClient<Database>, userId: string, force: boolean, progress: ProgressListener): Promise<RefreshResult> {
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
  const now = Date.now();
  const due = (connection: { status: string; last_synced_at: string | null }) => force || needsSync(connection, now);
  const total = results.reduce((count, result) => count + (result.data ?? []).filter(due).length, 0);
  let completed = 0;
  if (total) progress(`A atualizar vendas, custos e publicidade (0/${total})…`);
  async function run(label: string, task: () => Promise<void>) {
    try { await task(); synced = true; }
    catch (error) { errors.push(`${label}: ${error instanceof Error ? error.message : "falha ao atualizar"}`); }
    finally { progress(`Ligações verificadas: ${++completed}/${total}. A concluir a sincronização…`); }
  }
  // Keep the tuple types when passing each provider's connection to its sync.
  await Promise.all([
    ...(results[0].data ?? []).filter(due).map((c) => run("Shopify", () => syncShopifyConnection(db, c, { sinceDays: WINDOW_DAYS, skipProducts: true, skipRecompute: true }))),
    ...(results[1].data ?? []).filter(due).map((c) => run("Meta", () => syncMetaConnection(db, c, { sinceDays: WINDOW_DAYS, skipRecompute: true }))),
    ...(results[2].data ?? []).filter(due).map((c) => run("Google", () => syncGoogleConnection(db, c, { sinceDays: WINDOW_DAYS, skipRecompute: true }))),
  ]);

  // Always repair the rollup, even when imports were throttled: a prior request
  // could have saved connection timestamps but failed before recomputing totals.
  try {
    progress("A recalcular os totais…");
    const { data: settings, error } = await db.from("settings").select("*").eq("user_id", userId).single();
    if (error) throw error;
    await recomputeDailyMetrics(db, userId, lastNDays(WINDOW_DAYS + 1, settings?.timezone ?? "UTC"), { settings });
    progress("A atualizar os relatórios…");
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
