import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/types/database";
import type { DateRange, MetricsSummary } from "@/types";
import type { DailyPoint } from "@/lib/queries";
import { selectAllByUser } from "@/lib/supabase/paginate";
import { parseScriptCampaignId } from "./script-campaigns";
import { googleSpendStore, type NamedStore } from "./store-labels";
import { round2, round4 } from "@/lib/profit";

export type GoogleSpendEstimate = { storeId: string; date: string; amount: number };

/** Read-only dashboard estimates. Never book unconfirmed gross cost as paid.
 * Existing account expenses, paid script snapshots (including zero), and OAuth
 * imports take precedence, so the same spend cannot be counted twice.
 */
export async function getGoogleSpendEstimates(
  db: SupabaseClient<Database>, userId: string, stores: NamedStore[],
  range: DateRange, rates: Map<string, number>, storeId?: string,
): Promise<GoogleSpendEstimate[]> {
  if (!stores.length) return [];
  const [campaigns, entries, connections] = await Promise.all([
    selectAllByUser<Tables<"google_campaigns">>(db, "google_campaigns", "campaign_id,date,spend,gross_spend,updated_at,google_connection_id", userId,
      (q) => q.gte("date", range.from).lte("date", range.to)),
    selectAllByUser<Pick<Tables<"manual_entries">, "date" | "label">>(db, "manual_entries", "date,label", userId,
      (q) => q.eq("kind", "expense").gte("date", range.from).lte("date", range.to)),
    selectAllByUser<Pick<Tables<"google_connections">, "id" | "shopify_connection_id">>(db, "google_connections", "id,shopify_connection_id", userId),
  ]);
  const selected = new Set(stores.filter((store) => !storeId || store.id === storeId).map((store) => store.id));
  const bookedStoreDays = new Set<string>();
  for (const entry of entries) {
    const owner = googleSpendStore(entry.label, stores);
    if (owner) bookedStoreDays.add(`${owner}:${entry.date}`);
  }
  const connectionStores = new Map(connections.map((connection) => [connection.id, connection.shopify_connection_id]));
  const paidAccounts = new Set<string>();
  const gross = new Map<string, { storeId: string; date: string; accountDay: string; amount: number; updated: string }>();
  for (const row of campaigns) {
    const oauthStore = connectionStores.get(row.google_connection_id ?? "");
    if (oauthStore) bookedStoreDays.add(`${oauthStore}:${row.date}`);
    const parsed = parseScriptCampaignId(row.campaign_id);
    if (!parsed || !selected.has(parsed.storeId)) continue;
    const accountDay = `${parsed.storeId}:${parsed.customerId}:${row.date}`;
    if (!parsed.grossOnly) { paidAccounts.add(accountDay); continue; }
    const amount = Number(row.gross_spend);
    if (row.gross_spend == null || !Number.isFinite(amount) || amount < 0) continue;
    const key = `${accountDay}:${parsed.campaignId}`;
    const previous = gross.get(key);
    if (!previous || row.updated_at >= previous.updated) gross.set(key, {
      storeId: parsed.storeId, date: row.date, accountDay, amount, updated: row.updated_at,
    });
  }
  const days = new Map<string, GoogleSpendEstimate>();
  for (const row of gross.values()) {
    const key = `${row.storeId}:${row.date}`;
    if (bookedStoreDays.has(key) || paidAccounts.has(row.accountDay)) continue;
    const day = days.get(key) ?? { storeId: row.storeId, date: row.date, amount: 0 };
    day.amount += row.amount * (rates.get(row.storeId) ?? 1);
    days.set(key, day);
  }
  return [...days.values()].map((day) => ({ ...day, amount: round2(day.amount) }));
}

export function googleEstimateTotal(estimates: GoogleSpendEstimate[], range: DateRange): number {
  return round2(estimates.filter((row) => row.date >= range.from && row.date <= range.to).reduce((sum, row) => sum + row.amount, 0));
}

export function includeGoogleEstimate(summary: MetricsSummary, amount: number): MetricsSummary {
  if (!amount) return summary;
  const adSpend = round2(summary.adSpend + amount);
  const profit = round2(summary.profit - amount);
  return { ...summary, adSpend, adSpendGoogle: round2(summary.adSpendGoogle + amount), profit,
    profitMargin: summary.revenue > 0 ? round4(profit / summary.revenue) : 0,
    roas: adSpend > 0 ? summary.revenue / adSpend : 0,
    mer: adSpend > 0 ? summary.revenue / adSpend : 0 };
}

export function includeGoogleEstimatesInSeries(series: DailyPoint[], estimates: GoogleSpendEstimate[]): DailyPoint[] {
  const byDate = new Map<string, number>();
  for (const row of estimates) byDate.set(row.date, (byDate.get(row.date) ?? 0) + row.amount);
  return series.map((point) => {
    const amount = byDate.get(point.date) ?? 0;
    if (!amount) return point;
    const adSpend = round2(point.adSpend + amount);
    return { ...point, adSpend, profit: round2(point.profit - amount), roas: adSpend > 0 ? point.revenue / adSpend : 0 };
  });
}
