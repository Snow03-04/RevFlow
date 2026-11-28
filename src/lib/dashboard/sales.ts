import type { Tables } from "@/types/database";
import type { SalesDay } from "@/lib/shopify/sales-report";
type Row = Tables<"daily_metrics">;

/** Revenue is Shopify total sales; settlements, costs and profit keep their own accounting. */
export function applySales(rows: Row[], sales: SalesDay[]): Row[] {
  if (!sales.length) return rows;
  const pending = new Map(sales.map(day => [`${day.storeId}:${day.date}`, day]));
  const known = new Set(pending.keys());
  const result = rows.map(row => {
    const key = `${row.shopify_connection_id}:${row.date}`;
    const day = pending.get(key);
    pending.delete(key);
    return day ? { ...row, revenue: day.revenue, orders_count: day.orders }
      : known.has(key) ? { ...row, revenue: 0, orders_count: 0 } : row;
  });
  for (const day of pending.values()) {
    const key = `${day.storeId}:${day.date}`;
    const row: Row = {
      id: key, user_id: "", shopify_connection_id: day.storeId, date: day.date,
      revenue: 0, gross_revenue: 0, refunds: 0, discounts: 0, shipping_revenue: 0,
      product_cost: 0, eu_order_fees: 0, shipping_cost: 0, payment_fees: 0, payment_adjustment: 0,
      payment_orders_actual: 0, payment_orders_estimated: 0, supplier_orders_priced: null, supplier_orders_unpriced: null,
      ad_spend: 0, ad_spend_meta: 0, ad_spend_google: 0, profit: 0, profit_margin: 0, roas: 0, mer: 0, cac: 0,
      orders_count: 0, units_sold: 0, ad_clicks: 0, aov: 0, conversion_rate: 0, manual_adjustment: 0, created_at: "", updated_at: "",
    };
    result.push({ ...row, revenue: day.revenue, orders_count: day.orders });
  }
  return result;
}
