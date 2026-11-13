import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/types/database";
import type { DateRange } from "@/types";
import { getStoreCurrency, getStoreFxRates } from "@/lib/queries";
import { resolveFx } from "@/lib/fx";
import { round2 } from "@/lib/profit";
import { selectAllByUser } from "@/lib/supabase/paginate";
import { getGoogleSpendEstimates, type GoogleSpendEstimate } from "@/lib/google/spend-estimates";
import type { NamedStore } from "@/lib/google/store-labels";
import { fullShares, type StoreShares } from "@/lib/dashboard/store-participation";
import { calcPnlDay, type PnlFees, type PnlSheetDay, type PnlReportDay } from "./pnl";

type PnlMetric = Pick<Tables<"daily_metrics">, "date" | "shopify_connection_id" | "gross_revenue" |
  "shipping_revenue" | "refunds" | "product_cost" | "payment_fees" | "payment_adjustment" | "ad_spend_meta" | "ad_spend_google" | "orders_count"> & { eu_order_fees?: number };

function readPnlMetrics(db: SupabaseClient<Database>, userId: string, range: DateRange, storeId?: string) {
  return selectAllByUser<PnlMetric>(db, "daily_metrics",
    "date,shopify_connection_id,gross_revenue,shipping_revenue,refunds,product_cost,eu_order_fees,payment_fees,payment_adjustment,ad_spend_meta,ad_spend_google,orders_count",
    userId, (q) => {
      q = q.gte("date", range.from).lte("date", range.to);
      return storeId ? q.eq("shopify_connection_id", storeId) : q;
    });
}

function emptyDay(date: string): PnlSheetDay {
  return {
    year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)), day: Number(date.slice(8, 10)),
    gross_revenue: 0, refunds: 0, cogs: 0, adspend_fb: 0, adspend_google: 0, orders: 0, notes: null,
  };
}

/** Same conversion and daily rounding for the consolidated and store sheets. */
export function projectPnlDays(metrics: PnlMetric[], rates: Map<string, number>): PnlSheetDay[] {
  const days = new Map<string, PnlSheetDay>();
  for (const metric of metrics) {
    const rate = rates.get(metric.shopify_connection_id ?? "") ?? 1;
    const row = days.get(metric.date) ?? emptyDay(metric.date);
    row.gross_revenue += (Number(metric.gross_revenue) + Number(metric.shipping_revenue)) * rate;
    row.refunds += Number(metric.refunds) * rate;
    row.cogs += Number(metric.product_cost) * rate;
    row.eu_order_fees = (row.eu_order_fees ?? 0) + Number(metric.eu_order_fees ?? 0) * rate;
    if (metric.payment_fees != null) row.payment_fees = (row.payment_fees ?? 0) + Number(metric.payment_fees) * rate;
    if (metric.payment_adjustment != null) row.payment_adjustment = (row.payment_adjustment ?? 0) + Number(metric.payment_adjustment) * rate;
    row.adspend_fb += Number(metric.ad_spend_meta) * rate;
    row.adspend_google += Number(metric.ad_spend_google) * rate;
    row.orders += Number(metric.orders_count);
    days.set(metric.date, row);
  }
  return [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, row]) => ({ ...row,
    ...(row.payment_fees == null ? {} : { payment_fees: round2(row.payment_fees) }),
    ...(row.payment_adjustment == null ? {} : { payment_adjustment: round2(row.payment_adjustment) }),
    gross_revenue: round2(row.gross_revenue), refunds: round2(row.refunds), cogs: round2(row.cogs),
    eu_order_fees: round2(row.eu_order_fees ?? 0),
    adspend_fb: round2(row.adspend_fb), adspend_google: round2(row.adspend_google),
  }));
}

/** Store views read store-owned metrics; they never save into consolidated pnl_days. */
export async function getStorePnlDays(db: SupabaseClient<Database>, userId: string,
  range: DateRange, storeId: string, currency: string): Promise<PnlSheetDay[]> {
  return getAutomaticPnlDays(db, userId, range, currency, storeId);
}

/** Both the total and the store filter read the same imported metrics. */
export async function getAutomaticPnlDays(db: SupabaseClient<Database>, userId: string,
  range: DateRange, currency: string, storeId?: string): Promise<PnlSheetDay[]> {
  if (storeId) {
    const { data: store, error } = await db.from("shopify_connections").select("id")
      .eq("user_id", userId).eq("id", storeId).maybeSingle();
    if (error) throw error;
    if (!store) throw new Error("Esta loja não está disponível nesta conta.");
  }
  const [metrics, nativeCurrency, settings] = await Promise.all([
    readPnlMetrics(db, userId, range, storeId),
    storeId ? getStoreCurrency(db, userId, storeId) : Promise.resolve(null),
    db.from("settings").select("currency,fx_rate_override,fx_override_currency").eq("user_id", userId).maybeSingle(),
  ]);
  if (settings.error) throw settings.error;
  const iso = ({ "€": "EUR", "$": "USD", "£": "GBP" } as Record<string, string>)[currency] ?? currency;
  if (!storeId) {
    const rates = await getStoreFxRates(db, userId, iso, settings.data?.fx_rate_override, true, settings.data?.currency ?? iso);
    return projectPnlDays(metrics, rates);
  }
  const rate = await resolveFx(nativeCurrency ?? iso, iso, { required: true, storeCurrency: nativeCurrency,
    displayCurrency: settings.data?.currency ?? iso, overrideCurrency: settings.data?.fx_override_currency, override: settings.data?.fx_rate_override });
  return projectPnlDays(metrics, new Map([[storeId, rate]]));
}

/** Read-only. Calculate each store's net profit at full cost before applying ownership. */
export function projectParticipationDays(metrics: PnlMetric[], estimates: GoogleSpendEstimate[], rates: Map<string, number>,
  shares: Map<string, StoreShares>, feesByMonth: PnlFees[]) {
  const days = new Map<string, PnlReportDay>();
  const googleEstimates: Record<string, number> = {};
  function add(storeId: string, date: string, metric?: PnlMetric, estimate = 0) {
    const share = shares.get(storeId) ?? fullShares;
    const fx = rates.get(storeId) ?? 1;
    const row: PnlReportDay = days.get(date) ?? emptyDay(date);
    const grossRevenue = (Number(metric?.gross_revenue ?? 0) + Number(metric?.shipping_revenue ?? 0)) * fx;
    const refunds = Number(metric?.refunds ?? 0) * fx;
    const cogs = Number(metric?.product_cost ?? 0) * fx;
    const euOrderFees = Number(metric?.eu_order_fees ?? 0) * fx;
    const adspendFb = Number(metric?.ad_spend_meta ?? 0) * fx;
    const bookedGoogle = Number(metric?.ad_spend_google ?? 0) * fx;
    const paymentAdjustment = Number(metric?.payment_adjustment ?? 0) * fx;
    const orders = Number(metric?.orders_count ?? 0);
    const calc = calcPnlDay({ grossRevenue, refunds, cogs, euOrderFees, orders, paymentAdjustment, adspendFb,
      adspendGoogle: bookedGoogle + estimate,
      paymentFees: metric?.payment_fees == null ? undefined : Number(metric.payment_fees) * fx }, feesByMonth[row.month - 1]);
    row.orders += orders;
    row.gross_revenue += grossRevenue * share.revenue;
    row.refunds += refunds * share.revenue;
    row.cogs += cogs * share.expenses;
    row.eu_order_fees = (row.eu_order_fees ?? 0) + euOrderFees * share.expenses;
    row.payment_fees = (row.payment_fees ?? 0) + calc.paymentFee * share.expenses;
    row.payment_adjustment = (row.payment_adjustment ?? 0) + paymentAdjustment * share.expenses;
    row.adspend_fb += adspendFb * share.ads;
    row.adspend_google += bookedGoogle * share.ads;
    const p = row.participation ??= { profit: 0, agencyFeeFb: 0, agencyFeeGoogle: 0, ratioProfit: 0, ratioSpend: 0, ratioCogs: 0 };
    p.profit += calc.profit * share.profit;
    p.agencyFeeFb += calc.agencyFeeFb * share.expenses;
    p.agencyFeeGoogle += calc.agencyFeeGoogle * share.expenses;
    p.ratioProfit += calc.profit * (share.personalRatios ? share.profit : 1);
    p.ratioSpend += calc.ratioSpend * (share.personalRatios ? share.ads : 1);
    p.ratioCogs += calc.ratioCogs * (share.personalRatios ? share.expenses : 1);
    days.set(date, row);
    if (estimate) googleEstimates[date] = (googleEstimates[date] ?? 0) + estimate * share.ads;
  }
  for (const metric of metrics) add(metric.shopify_connection_id ?? "", metric.date, metric);
  // Estimates arrive in the sheet currency and can exist on a day with no booked metrics.
  for (const estimate of estimates) add(estimate.storeId, estimate.date, undefined, estimate.amount);
  return { days: [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, row]) => row), googleEstimates };
}

export async function getPnlSheetReport(db: SupabaseClient<Database>, userId: string, range: DateRange, currency: string,
  stores: NamedStore[], shares: Map<string, StoreShares>, feesByMonth: PnlFees[], storeId?: string): Promise<{
    days: PnlReportDay[]; googleEstimates: Record<string, number>;
  }> {
  const { data: settings, error } = await db.from("settings").select("currency,fx_rate_override").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  const iso = ({ "€": "EUR", "$": "USD", "£": "GBP" } as Record<string, string>)[currency] ?? currency;
  const [metrics, rates] = await Promise.all([readPnlMetrics(db, userId, range, storeId),
    getStoreFxRates(db, userId, iso, settings?.fx_rate_override, true, settings?.currency ?? iso)]);
  const estimates = await getGoogleSpendEstimates(db, userId, stores, range, rates, storeId);
  if (!storeId && [...shares.values()].some((s) => s.profit !== 1 || s.expenses !== 1 || s.ads !== 1))
    return projectParticipationDays(metrics, estimates, rates, shares, feesByMonth);
  const googleEstimates: Record<string, number> = {};
  for (const row of estimates) googleEstimates[row.date] = round2((googleEstimates[row.date] ?? 0) + row.amount);
  return { days: projectPnlDays(metrics, rates), googleEstimates };
}
