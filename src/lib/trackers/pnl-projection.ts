import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/types/database";
import type { DateRange } from "@/types";
import { getStoreCurrency } from "@/lib/queries";
import { resolveFx } from "@/lib/fx";
import { round2 } from "@/lib/profit";
import { selectAllByUser } from "@/lib/supabase/paginate";
import type { PnlSheetDay } from "./pnl";

type PnlMetric = Pick<Tables<"daily_metrics">, "date" | "shopify_connection_id" | "gross_revenue" |
  "shipping_revenue" | "refunds" | "product_cost" | "payment_fees" | "payment_adjustment" | "ad_spend_meta" | "ad_spend_google" | "orders_count">;

/** Same conversion and daily rounding for the consolidated and store sheets. */
export function projectPnlDays(metrics: PnlMetric[], rates: Map<string, number>): PnlSheetDay[] {
  const days = new Map<string, PnlSheetDay>();
  for (const metric of metrics) {
    const rate = rates.get(metric.shopify_connection_id ?? "") ?? 1;
    const row = days.get(metric.date) ?? {
      year: Number(metric.date.slice(0, 4)), month: Number(metric.date.slice(5, 7)), day: Number(metric.date.slice(8, 10)),
      gross_revenue: 0, refunds: 0, cogs: 0, adspend_fb: 0, adspend_google: 0, orders: 0, notes: null,
    };
    row.gross_revenue += (Number(metric.gross_revenue) + Number(metric.shipping_revenue)) * rate;
    row.refunds += Number(metric.refunds) * rate;
    row.cogs += Number(metric.product_cost) * rate;
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
    adspend_fb: round2(row.adspend_fb), adspend_google: round2(row.adspend_google),
  }));
}

/** Store views read store-owned metrics; they never save into consolidated pnl_days. */
export async function getStorePnlDays(db: SupabaseClient<Database>, userId: string,
  range: DateRange, storeId: string, currency: string): Promise<PnlSheetDay[]> {
  const { data: store, error } = await db.from("shopify_connections").select("id")
    .eq("user_id", userId).eq("id", storeId).maybeSingle();
  if (error) throw error;
  if (!store) throw new Error("Esta loja não está disponível nesta conta.");
  const [metrics, nativeCurrency, settings] = await Promise.all([
    selectAllByUser<PnlMetric>(db, "daily_metrics",
      "date,shopify_connection_id,gross_revenue,shipping_revenue,refunds,product_cost,payment_fees,payment_adjustment,ad_spend_meta,ad_spend_google,orders_count",
      userId, (q) => q.eq("shopify_connection_id", storeId).gte("date", range.from).lte("date", range.to)),
    getStoreCurrency(db, userId, storeId),
    db.from("settings").select("currency,fx_rate_override,fx_override_currency").eq("user_id", userId).maybeSingle(),
  ]);
  if (settings.error) throw settings.error;
  const iso = ({ "€": "EUR", "$": "USD", "£": "GBP" } as Record<string, string>)[currency] ?? currency;
  const rate = await resolveFx(nativeCurrency ?? iso, iso, { required: true, storeCurrency: nativeCurrency,
    displayCurrency: settings.data?.currency ?? iso, overrideCurrency: settings.data?.fx_override_currency, override: settings.data?.fx_rate_override });
  return projectPnlDays(metrics, new Map([[storeId, rate]]));
}
