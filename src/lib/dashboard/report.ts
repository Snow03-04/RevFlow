import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/types/database";
import type { DateRange, MetricsSummary } from "@/types";
import { eachDay } from "@/lib/date";
import { summarize } from "@/lib/metrics";
import { metricsRows, scaleRow, type DailyPoint } from "@/lib/queries";
import { getGoogleSpendEstimates, includeGoogleEstimate, googleEstimateTotal, type GoogleSpendEstimate } from "@/lib/google/spend-estimates";
import type { NamedStore } from "@/lib/google/store-labels";
import { participationRates } from "./store-participation";
import { round2 } from "@/lib/profit";

type Row = Tables<"daily_metrics">;

export type StoreParticipationReport = {
  storeId: string;
  percentage: number;
  expensePercentage: number;
  adSpendPercentage: number;
  current: MetricsSummary;
  previous: MetricsSummary;
  total: MetricsSummary;
  series: DailyPoint[];
  googleEstimatedAmount: number;
};

/** Revenue, counts and performance ratios describe the whole business.
 * Only profit and expenses describe the user's participation. */
function personalExpenses(total: MetricsSummary, personal: MetricsSummary): MetricsSummary {
  return { ...total, profit: personal.profit, adSpend: personal.adSpend,
    adSpendMeta: personal.adSpendMeta, adSpendGoogle: personal.adSpendGoogle,
    productCost: personal.productCost, shippingCost: personal.shippingCost,
    euOrderFees: personal.euOrderFees,
    paymentFees: personal.paymentFees, paymentAdjustment: personal.paymentAdjustment };
}

export function buildParticipationReport({ rows, estimates, rates, percentages, expensePercentages = new Map(), adSpendPercentages = new Map(), current, previous, chart, storeId }: {
  rows: Row[]; estimates: GoogleSpendEstimate[]; rates: Map<string, number>; percentages: Map<string, number>;
  expensePercentages?: Map<string, number>; adSpendPercentages?: Map<string, number>;
  current: DateRange; previous: DateRange; chart: DateRange; storeId?: string;
}) {
  const selectedRows = rows.filter((row) => !storeId || row.shopify_connection_id === storeId);
  const totalRows = selectedRows.map((row) => scaleRow(row, rates.get(row.shopify_connection_id ?? "") ?? 1));
  const profitShares = participationRates(new Map(), percentages, storeId);
  const expenseShares = participationRates(new Map(), expensePercentages, storeId);
  const adShares = participationRates(new Map(), adSpendPercentages, storeId);
  const expenseShare = (id: string) => expenseShares.get(id) ?? profitShares.get(id) ?? 1;
  const adShare = (id: string) => adShares.get(id) ?? expenseShare(id);
  const personalRows = totalRows.map((row) => {
    const id = row.shopify_connection_id ?? "";
    const personal = scaleRow(row, expenseShare(id));
    const profitShare = profitShares.get(id) ?? 1;
    const ads = adShare(id);
    // General manual entries are personal amounts from outside the stores.
    // Their primary-store attribution must not subject them to that store's %.
    const manual = Number(row.manual_adjustment ?? 0) * (rates.get(id) ?? 1);
    return { ...personal, ad_spend: row.ad_spend * ads, ad_spend_meta: row.ad_spend_meta * ads,
      ad_spend_google: row.ad_spend_google * ads, profit: row.profit * profitShare + manual * (1 - profitShare) };
  });
  const totalEstimates = estimates.filter((row) => !storeId || row.storeId === storeId);
  const personalEstimates = totalEstimates.map((row) => ({ ...row, amount: row.amount * adShare(row.storeId) }));
  const profitEstimates = totalEstimates.map((row) => ({ ...row, amount: row.amount * (profitShares.get(row.storeId) ?? 1) }));
  const personalSummary = (rows: Row[], range: DateRange) => includeGoogleEstimate(
    summarize(rows), googleEstimateTotal(personalEstimates, range), googleEstimateTotal(profitEstimates, range));
  const inRange = (date: string, range: DateRange) => date >= range.from && date <= range.to;
  const summary = (range: DateRange) => {
    const total = includeGoogleEstimate(summarize(totalRows.filter((row) => inRange(row.date, range))), googleEstimateTotal(totalEstimates, range));
    const personal = personalSummary(personalRows.filter((row) => inRange(row.date, range)), range);
    return { total, personal: personalExpenses(total, personal) };
  };
  const cur = summary(current), prev = summary(previous);
  const totalByDate = new Map<string, Row[]>(), personalByDate = new Map<string, Row[]>();
  totalRows.forEach((row, index) => {
    totalByDate.set(row.date, [...(totalByDate.get(row.date) ?? []), row]);
    personalByDate.set(row.date, [...(personalByDate.get(row.date) ?? []), personalRows[index]]);
  });
  const series: DailyPoint[] = eachDay(chart).map((date) => {
    const range = { from: date, to: date };
    const total = includeGoogleEstimate(summarize(totalByDate.get(date) ?? []), googleEstimateTotal(totalEstimates, range));
    const personal = personalSummary(personalByDate.get(date) ?? [], range);
    return { date, revenue: total.revenue, orders: total.ordersCount, roas: total.roas,
      profit: personal.profit, adSpend: personal.adSpend };
  });
  return { comparison: { current: cur.personal, previous: prev.personal }, series,
    totalCurrent: cur.total, googleEstimatedAmount: round2(googleEstimateTotal(personalEstimates, current)) };
}

export async function getParticipationReport(db: SupabaseClient<Database>, userId: string, options: {
  stores: NamedStore[]; rates: Map<string, number>; percentages: Map<string, number>;
  expensePercentages?: Map<string, number>; adSpendPercentages?: Map<string, number>;
  current: DateRange; previous: DateRange; chart: DateRange; storeId?: string;
  includeStores?: boolean;
}) {
  const { current, previous, chart, storeId } = options;
  const range = { from: [current.from, previous.from, chart.from].sort()[0], to: [current.to, previous.to, chart.to].sort().at(-1)! };
  // Both layouts share one read. The overview always includes every owned store,
  // while the original dashboard keeps its selected store and 100% semantics.
  const readStoreId = options.includeStores ? undefined : storeId;
  const [rows, estimates] = await Promise.all([
    metricsRows(db, userId, range, readStoreId),
    getGoogleSpendEstimates(db, userId, options.stores, range, options.rates, readStoreId),
  ]);
  const report = buildParticipationReport({ ...options, rows, estimates });
  return { ...report, overview: options.includeStores ? buildStoreOverview({ ...options, rows, estimates }) : undefined };
}

/** Split the same evidence by store; do not reprice orders or query each store. */
export function buildStoreOverview(options: Parameters<typeof buildParticipationReport>[0] & { stores: NamedStore[] }) {
  const ownedIds = new Set(options.stores.map((store) => store.id));
  const rows = options.rows.filter((row) => ownedIds.has(row.shopify_connection_id ?? ""));
  const estimates = options.estimates.filter((row) => ownedIds.has(row.storeId));
  const combined = buildParticipationReport({ ...options, rows, estimates, storeId: undefined, chart: options.current });
  const stores: StoreParticipationReport[] = options.stores.map((store) => {
    const report = buildParticipationReport({ ...options, storeId: undefined, chart: options.current,
      rows: rows.filter((row) => row.shopify_connection_id === store.id),
      estimates: estimates.filter((row) => row.storeId === store.id) });
    const percentage = options.percentages.get(store.id) ?? 100;
    const expensePercentage = options.expensePercentages?.get(store.id) ?? percentage;
    return { storeId: store.id, percentage, expensePercentage, adSpendPercentage: options.adSpendPercentages?.get(store.id) ?? expensePercentage,
      current: report.comparison.current, previous: report.comparison.previous,
      total: report.totalCurrent, series: report.series, googleEstimatedAmount: report.googleEstimatedAmount };
  });
  return { stores, current: combined.comparison.current, total: combined.totalCurrent };
}
