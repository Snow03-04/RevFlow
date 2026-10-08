import { z } from "zod";
import type { Tables } from "@/types/database";
import { calcPnlDay, type PnlFees } from "./pnl";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Indica uma data válida.");

/** Reporting preferences only; never used for authorisation or source ownership. */
export const storeHistorySchema = z.object({
  version: z.literal(1),
  periods: z.array(z.object({
    id: z.string().uuid(),
    name: z.string().trim().min(1, "Indica o nome de cada marca.").max(80),
    from: date.nullable(),
  })).min(1).max(40),
}).superRefine(({ periods }, ctx) => {
  if (new Set(periods.map((p) => p.id)).size !== periods.length) {
    ctx.addIssue({ code: "custom", message: "Cada período deve ter uma identidade única." });
  }
  periods.forEach((period, index) => {
    if (index > 0 && (!period.from || (periods[index - 1].from && period.from <= periods[index - 1].from!))) {
      ctx.addIssue({ code: "custom", path: ["periods", index, "from"], message: "Ordena as marcas da mais antiga para a mais recente, com datas de início diferentes e crescentes." });
    }
  });
});

export type StoreHistory = z.infer<typeof storeHistorySchema>;
export type LifetimeStore = { id: string; shop_name: string | null; shop_domain: string; status: string; last_synced_at: string | null };
export type LifetimeMetric = Pick<Tables<"daily_metrics">, "date" | "shopify_connection_id" | "gross_revenue" |
  "shipping_revenue" | "refunds" | "product_cost" | "payment_fees" | "payment_adjustment" | "ad_spend_meta" | "ad_spend_google" | "orders_count" | "units_sold">;

export function historyKey(storeId: string) { return `finance_history_${storeId}`; }

export function readStoreHistory(metadata: Record<string, unknown>, storeId: string): StoreHistory | null {
  const result = storeHistorySchema.safeParse(metadata[historyKey(storeId)]);
  return result.success ? result.data : null;
}

export interface LifetimeTotals {
  revenue: number; refunds: number; cogs: number; adSpend: number; agencyFee: number;
  paymentFee: number; profit: number; orders: number; units: number; googleEstimate: number;
  margin: number | null; roas: number | null; firstDate: string | null; lastDate: string | null;
}
export interface LifetimeRow extends LifetimeTotals {
  key: string; storeId: string; name: string; domain: string; from: string | null; to: string | null;
  confirmed: boolean;
}

function emptyTotals(): LifetimeTotals {
  return { revenue: 0, refunds: 0, cogs: 0, adSpend: 0, agencyFee: 0, paymentFee: 0, profit: 0,
    orders: 0, units: 0, googleEstimate: 0, margin: null, roas: null, firstDate: null, lastDate: null };
}

const additive = ["revenue", "refunds", "cogs", "adSpend", "agencyFee", "paymentFee", "profit", "orders", "units", "googleEstimate"] as const;
function ratios(row: LifetimeTotals) {
  const net = row.revenue - row.refunds;
  row.margin = net === 0 ? null : row.profit / net;
  row.roas = row.adSpend === 0 ? null : net / row.adSpend;
}
function coverage(row: LifetimeTotals, date: string) {
  row.firstDate = !row.firstDate || date < row.firstDate ? date : row.firstDate;
  row.lastDate = !row.lastDate || date > row.lastDate ? date : row.lastDate;
}

/** Each store/day belongs to exactly one brand, including the boundary day.
 * Refunds in daily_metrics retain the original order's day, hence its brand.
 * Aggregate ratios use combined amounts, never an average of store ratios. */
export function buildLifetimeReport({ stores, histories, metrics, rates, feesForDate, today, estimates = [] }: {
  stores: LifetimeStore[]; histories: Map<string, StoreHistory>; metrics: LifetimeMetric[];
  rates: Map<string, number>; feesForDate: (date: string) => PnlFees; today: string;
  estimates?: { storeId: string; date: string; amount: number }[];
}) {
  const rows: LifetimeRow[] = [];
  const byStore = new Map<string, LifetimeRow[]>();
  for (const store of stores) {
    const history = histories.get(store.id);
    const periods = history?.periods ?? [];
    const make = (key: string, name: string, from: string | null, to: string | null, confirmed: boolean): LifetimeRow => ({
      ...emptyTotals(), key: `${store.id}:${key}`, storeId: store.id, name, domain: store.shop_domain, from, to, confirmed,
    });
    const storeRows: LifetimeRow[] = [];
    if (!periods.length || periods[0].from != null) {
      storeRows.push(make("unassigned", `${store.shop_name || store.shop_domain} · por atribuir`, null, periods[0]?.from ?? null, false));
    }
    periods.forEach((period, index) => storeRows.push(make(period.id, period.name, period.from, periods[index + 1]?.from ?? null, true)));
    rows.push(...storeRows);
    byStore.set(store.id, storeRows);
  }
  const target = (storeId: string | null, date: string) => (byStore.get(storeId ?? "") ?? []).find((row) =>
    (!row.from || date >= row.from) && (!row.to || date < row.to));
  let unassignedDays = 0;
  for (const metric of metrics) {
    if (metric.date > today) continue;
    const row = target(metric.shopify_connection_id, metric.date);
    if (!row) { unassignedDays++; continue; }
    const rate = rates.get(row.storeId);
    if (rate == null || !Number.isFinite(rate) || rate <= 0) throw new Error("Não foi possível converter a moeda de uma loja.");
    const input = { paymentFees: metric.payment_fees == null ? undefined : Number(metric.payment_fees) * rate,
      paymentAdjustment: Number(metric.payment_adjustment ?? 0) * rate, grossRevenue: (Number(metric.gross_revenue) + Number(metric.shipping_revenue)) * rate,
      refunds: Number(metric.refunds) * rate, cogs: Number(metric.product_cost) * rate,
      adspendFb: Number(metric.ad_spend_meta) * rate, adspendGoogle: Number(metric.ad_spend_google) * rate,
      orders: Number(metric.orders_count) };
    const calc = calcPnlDay(input, feesForDate(metric.date));
    row.revenue += input.grossRevenue; row.refunds += input.refunds; row.cogs += input.cogs;
    row.adSpend += input.adspendFb + input.adspendGoogle;
    row.agencyFee += calc.agencyFeeFb + calc.agencyFeeGoogle; row.paymentFee += calc.paymentFee;
    row.profit += calc.profit; row.orders += input.orders; row.units += Number(metric.units_sold);
    coverage(row, metric.date);
  }
  for (const estimate of estimates) {
    if (estimate.date > today) continue;
    const row = target(estimate.storeId, estimate.date);
    if (!row) continue;
    const fee = estimate.amount * feesForDate(estimate.date).feeGoogle;
    row.adSpend += estimate.amount; row.googleEstimate += estimate.amount;
    row.agencyFee += fee; row.profit -= estimate.amount + fee;
    coverage(row, estimate.date);
  }
  const total = emptyTotals();
  for (const row of rows) {
    ratios(row);
    for (const field of additive) total[field] += row[field];
    if (row.firstDate) coverage(total, row.firstDate);
    if (row.lastDate) coverage(total, row.lastDate);
  }
  ratios(total);
  return { rows, total, unassignedDays };
}

export function lifetimeFees(settings: Tables<"pnl_settings">, overrides: Tables<"pnl_month_overrides">[]) {
  const byMonth = new Map(overrides.map((row) => [`${row.year}-${String(row.month).padStart(2, "0")}`, row]));
  return (date: string): PnlFees => {
    const override = byMonth.get(date.slice(0, 7));
    return { feeFb: Number(override?.agency_fee_fb ?? settings.agency_fee_fb),
      feeGoogle: Number(override?.agency_fee_google ?? settings.agency_fee_google),
      txFee: Number(override?.transaction_fee ?? settings.transaction_fee), paymentPct: Number(settings.payment_fee_pct) };
  };
}
