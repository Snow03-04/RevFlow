import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { createAdminClient } from "@/lib/supabase/admin";
import { getConnections, getSettings } from "@/lib/queries";
import { decryptToken } from "@/lib/crypto";
import { resolveFx } from "@/lib/fx";
import { todayYmd, ymdInTz } from "@/lib/date";
import { readStoreParticipation } from "@/lib/dashboard/store-participation";
import { readMetaBudget } from "@/lib/meta/daily-budget";
import { readGoogleBudget } from "@/lib/google/read-budget";
import { readBudgetSnapshots, currentBudget } from "@/lib/google/budget-snapshots";
import { getScriptAccounts } from "@/lib/google/script-accounts";
import { readGoogleAccountState } from "@/lib/google/account-monitoring";
import { sumPacing, type PacingAccount, type PacingReport } from "./pacing";

type DB = SupabaseClient<Database>;
type Amounts = { budget: number | null; forecast?: number | null; firstDayExtra?: number | null; spent: number; currency: string; observedAt?: string };
const cache = new Map<string, { at: number; value: Amounts }>();
async function cached(key: string, read: () => Promise<Amounts>): Promise<Amounts> {
  const previous = cache.get(key);
  if (previous && Date.now() - previous.at < 60_000) return previous.value;
  const value = { ...await read(), observedAt: new Date().toISOString() };
  if (cache.size > 500) cache.clear();
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** Read-only. The caller supplies the verified signed-in user, never a query-string user id.
 * No financial rollups are changed; this bar uses gross spend and a planning estimate. */
export async function readAdSpendPacing(db: DB, userId: string, metadata: Record<string, unknown>): Promise<PacingReport> {
  const [settings, connections] = await Promise.all([getSettings(db, userId), getConnections(db, userId)]);
  const currency = settings?.currency ?? "EUR", timeZone = settings?.timezone ?? "UTC", day = todayYmd(timeZone);
  const stores = connections.shopify.filter(s => s.status === "active" || s.status === "error");
  const storeIds = new Set(stores.map(s => s.id));
  const connected = (c: { status: string }) => c.status === "active" || c.status === "error";
  const unknown = (storeId: string | null): PacingAccount => ({ storeId, spent: 0, forecast: null, firstDayExtra: 0, observedAt: "" });
  const fx = { displayCurrency: currency, override: settings?.fx_rate_override, overrideCurrency: settings?.fx_override_currency, required: true };
  // The existing hosted importer exposes only the current owner's observations.
  // On installations without that optional RPC, read the providers as before.
  const [observed, snapshotResult, histories] = await Promise.all([
    (db as SupabaseClient).rpc("revflow_connection_budgets").then(({ data }) => data as null | { connection_id: string; observed_at: string; budget: number | null; spent: number; currency: string }[]),
    readBudgetSnapshots(createAdminClient(), userId).catch(() => null),
    Promise.allSettled(stores.map(s => getScriptAccounts(db, userId, s))),
  ]);
  const observations = new Map((observed ?? []).filter(row => Date.parse(row.observed_at) <= Date.now() + 60_000
    && Date.now() - Date.parse(row.observed_at) < 40 * 60_000 && ymdInTz(new Date(row.observed_at), timeZone) === day).map(row => [row.connection_id, row]));
  async function converted(storeId: string | null, read: () => Promise<Amounts>, google: boolean): Promise<PacingAccount> {
    try {
      const value = await read();
      // Old Google reports do not prove which campaigns started today.
      const forecast = google ? value.forecast ?? (value.budget === 0 ? 0 : null) : value.budget;
      if (forecast == null || !Number.isFinite(value.spent) || value.spent < 0 || !Number.isFinite(forecast) || forecast < 0) return unknown(storeId);
      const rate = await resolveFx(value.currency, currency, fx);
      return { storeId, spent: value.spent * rate, forecast: forecast * rate,
        firstDayExtra: (value.firstDayExtra ?? 0) * rate, observedAt: value.observedAt ?? new Date().toISOString() };
    } catch { return unknown(storeId); }
  }
  const jobs: Promise<PacingAccount>[] = connections.meta.filter(connected).filter(c => !c.shopify_connection_id || storeIds.has(c.shopify_connection_id)).map(c =>
    converted(c.shopify_connection_id, async () => {
      const row = observations.get(c.id);
      if (row) return { ...row, observedAt: row.observed_at };
      if (!c.account_currency) throw new Error("Missing currency");
      return cached(`${userId}:meta:${c.id}:${c.updated_at}:${day}`, () => readMetaBudget(c.ad_account_id, decryptToken(c.access_token), c.account_currency!));
    }, false));
  const owners = new Map<string, { storeId: string; date: string }>();
  histories.forEach((result, i) => {
    if (result.status === "rejected") { jobs.push(Promise.resolve(unknown(stores[i].id))); return; }
    for (const account of result.value) if ((owners.get(account.customerId)?.date ?? "") < account.lastReport)
      owners.set(account.customerId, { storeId: stores[i].id, date: account.lastReport });
  });
  for (const [id, snapshot] of snapshotResult ?? []) if (snapshot && storeIds.has(snapshot.storeId) && (owners.get(id)?.date ?? "") <= snapshot.date)
    owners.set(id, { storeId: snapshot.storeId, date: snapshot.date });
  const oauth = new Map(connections.google.filter(connected).map(c => [c.customer_id.replace(/\D/g, ""), c]));
  for (const id of new Set([...owners.keys(), ...oauth.keys()])) {
    const connection = oauth.get(id), storeId = connection?.shopify_connection_id ?? owners.get(id)?.storeId ?? null;
    if (storeId && !storeIds.has(storeId)) continue;
    const snapshot = snapshotResult?.get(id);
    const fresh = snapshot && snapshot.storeId === storeId && currentBudget(snapshot) ? snapshot : null;
    if (!connection && storeId && readGoogleAccountState(metadata, storeId, id) !== "active") continue;
    jobs.push(converted(storeId, async () => {
      if (fresh && fresh.forecast !== undefined) return fresh;
      if (connection) return cached(`${userId}:google:${connection.id}:${connection.updated_at}:${day}`, () => readGoogleBudget(connection));
      if (fresh) return fresh;
      throw new Error("Missing current Google budget");
    }, true));
  }
  // A failed connection query must not masquerade as an account with no ads.
  if (connections.unavailableAdPlatforms.length) for (const id of stores.length ? stores.map(s => s.id) : [null]) jobs.push(Promise.resolve(unknown(id)));
  const accounts = await Promise.all(jobs);
  const shares = new Map(stores.map(store => {
    const p = readStoreParticipation(metadata, store.id);
    return [store.id, p.adSpendOverride ?? p.expenseOverride ?? p.percentage] as const;
  }));
  return { day, currency, timeZone, total: sumPacing(accounts, shares), full: sumPacing(accounts),
    stores: Object.fromEntries(stores.map(s => [s.id, sumPacing(accounts, new Map(), s.id)])) };
}
