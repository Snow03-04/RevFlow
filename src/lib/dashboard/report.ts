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

/** Revenue, counts and performance ratios describe the whole business.
 * Only profit and expenses describe the user's participation. */
function personalExpenses(total: MetricsSummary, personal: MetricsSummary): MetricsSummary {
  return { ...total, profit: personal.profit, adSpend: personal.adSpend,
    adSpendMeta: personal.adSpendMeta, adSpendGoogle: personal.adSpendGoogle,
    productCost: personal.productCost, shippingCost: personal.shippingCost,
    paymentFees: personal.paymentFees, paymentAdjustment: personal.paymentAdjustment };
}

export function buildParticipationReport({ rows, estimates, rates, percentages, current, previous, chart, storeId }: {
  rows: Row[]; estimates: GoogleSpendEstimate[]; rates: Map<string, number>; percentages: Map<string, number>;
  current: DateRange; previous: DateRange; chart: DateRange; storeId?: string;
}) {
  const selectedRows = rows.filter((row) => !storeId || row.shopify_connection_id === storeId);
  const totalRows = selectedRows.map((row) => scaleRow(row, rates.get(row.shopify_connection_id ?? "") ?? 1));
  const personalRates = participationRates(rates, percentages, storeId);
  const shares = participationRates(new Map(), percentages, storeId);
  const personalRows = selectedRows.map((row) => {
    const id = row.shopify_connection_id ?? "";
    const personal = scaleRow(row, personalRates.get(id) ?? 1);
    // General manual entries are personal amounts from outside the stores.
    // Their primary-store attribution must not subject them to that store's %.
    const manual = Number(row.manual_adjustment ?? 0) * (rates.get(id) ?? 1);
    return { ...personal, profit: personal.profit + manual * (1 - (shares.get(id) ?? 1)) };
  });
  const totalEstimates = estimates.filter((row) => !storeId || row.storeId === storeId);
  const personalEstimates = totalEstimates.map((row) => ({ ...row, amount: row.amount * (shares.get(row.storeId) ?? 1) }));
  const inRange = (date: string, range: DateRange) => date >= range.from && date <= range.to;
  const summary = (range: DateRange) => {
    const total = includeGoogleEstimate(summarize(totalRows.filter((row) => inRange(row.date, range))), googleEstimateTotal(totalEstimates, range));
    const personal = includeGoogleEstimate(summarize(personalRows.filter((row) => inRange(row.date, range))), googleEstimateTotal(personalEstimates, range));
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
    const personal = includeGoogleEstimate(summarize(personalByDate.get(date) ?? []), googleEstimateTotal(personalEstimates, range));
    return { date, revenue: total.revenue, orders: total.ordersCount, roas: total.roas,
      profit: personal.profit, adSpend: personal.adSpend };
  });
  return { comparison: { current: cur.personal, previous: prev.personal }, series,
    totalCurrent: cur.total, googleEstimatedAmount: round2(googleEstimateTotal(personalEstimates, current)) };
}

export async function getParticipationReport(db: SupabaseClient<Database>, userId: string, options: {
  stores: NamedStore[]; rates: Map<string, number>; percentages: Map<string, number>;
  current: DateRange; previous: DateRange; chart: DateRange; storeId?: string;
}) {
  const { current, previous, chart, storeId } = options;
  const range = { from: [current.from, previous.from, chart.from].sort()[0], to: [current.to, previous.to, chart.to].sort().at(-1)! };
  const [rows, estimates] = await Promise.all([
    metricsRows(db, userId, range, storeId),
    getGoogleSpendEstimates(db, userId, options.stores, range, options.rates, storeId),
  ]);
  return buildParticipationReport({ ...options, rows, estimates });
}
