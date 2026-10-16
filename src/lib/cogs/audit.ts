import "server-only";
import { ORDER_EVIDENCE_COLUMNS } from "@/lib/shopify/order-evidence";
import { isPaidOrder } from "@/lib/shopify/paid-orders";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { ymdInTz, zonedRangeUtc } from "@/lib/date";
import { costOrder, type OrderCostLine } from "@/lib/cogs/order-cost";
import { loadCostData, supplierOrderKey } from "@/lib/cogs/data";
import { selectAllByUser, selectAllIn } from "@/lib/supabase/paginate";
import { round2 } from "@/lib/profit";
import { resolveFx } from "@/lib/fx";
import { getStoreCurrency } from "@/lib/queries";
import { loadPaymentSnapshots, paymentRates } from "@/lib/shopify/payments";
import { orderPaymentEffect } from "@/lib/shopify/payments-model";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/types/database";
import type { DateRange } from "@/types";

export interface AuditOrder {
  orderNumber: string;
  date: string;
  revenue: number; // display currency
  cost: number; // display currency — what the dashboard counted
  computedCost: number; // display currency, before any sheet override
  source: "sheet" | "computed";
  lines: (OrderCostLine & { lineCostDisplay: number })[];
}

export interface CogsAudit {
  storeName: string;
  currency: string;
  orders: AuditOrder[];
  totalCost: number;
  totalRevenue: number;
  /** Sum of product_cost stored in daily_metrics for the same window/store. */
  storedTotal: number;
  /** True when the per-order sum matches what the dashboard shows. */
  reconciles: boolean;
}

export async function getCogsAudit(
  range: DateRange,
  storeId?: string,
): Promise<CogsAudit | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const supabase = await createClient();
  return loadCogsAudit(supabase, user.id, range, storeId);
}

export async function loadCogsAudit(
  supabase: SupabaseClient<Database>,
  userId: string,
  range: DateRange,
  storeId?: string,
): Promise<CogsAudit | null> {
  const [
    { data: settings, error: settingsError },
    { data: stores, error: storesError },
  ] = await Promise.all([
    supabase.from("settings").select("*").eq("user_id", userId).single(),
    supabase
      .from("shopify_connections")
      .select("id,shop_name,shop_domain")
      .eq("user_id", userId)
      .order("created_at"),
  ]);
  if (settingsError) throw settingsError;
  if (storesError) throw storesError;
  const store = stores?.find((s) => s.id === storeId) ?? stores?.[0];
  if (!store) return null;
  const tz = settings?.timezone ?? "UTC";
  const { startUtc, endUtc } = zonedRangeUtc(range, tz);
  const [costData, snapshots] = await Promise.all([
    loadCostData(supabase, userId, store.id),
    loadPaymentSnapshots(supabase, userId, store.id, { startUtc, endUtc }),
  ]);
  const [allOrders, metrics] = await Promise.all([
    selectAllByUser<Tables<"orders">>(
      supabase,
      "orders",
      `id,shopify_order_id,currency,order_number,processed_at,subtotal_price,total_price,total_shipping,total_refunded,test,cancelled_at,financial_status,${ORDER_EVIDENCE_COLUMNS}`,
      userId,
      (q) =>
        q
          .eq("shopify_connection_id", store.id)
          .gte("processed_at", startUtc)
          .lt("processed_at", endUtc)
          .order("processed_at", { ascending: false }),
    ),
    selectAllByUser<Tables<"daily_metrics">>(
      supabase,
      "daily_metrics",
      "date,product_cost",
      userId,
      (q) =>
        q
          .eq("shopify_connection_id", store.id)
          .gte("date", range.from)
          .lte("date", range.to),
    ),
  ]);
  const orders = allOrders.filter(isPaidOrder);
  const items = await selectAllIn<Tables<"order_line_items">>(
    supabase,
    "order_line_items",
    "order_id,shopify_variant_id,shopify_product_id,title,quantity,current_quantity,price,unit_cost",
    userId,
    "order_id",
    orders.map((o) => o.id),
  );
  const cfg = await costData.forStore(store.id, items, settings);
  const displayCurrency = settings?.currency ?? "EUR";
  const baseCurrency = await getStoreCurrency(supabase, userId, store.id) ?? displayCurrency;
  const orderRates = new Map<string, number>();
  for (const currency of new Set(orders.map((o) => o.currency ?? baseCurrency))) {
    orderRates.set(currency, await resolveFx(currency, baseCurrency, { required: true,
      displayCurrency, override: settings?.fx_rate_override, overrideCurrency: settings?.fx_override_currency }));
  }
  const snapshot = snapshots.get(store.id);
  const paymentRate = await paymentRates(snapshot, displayCurrency, cfg.storeToDisplay);
  const byOrder = new Map<string, typeof items>();
  for (const li of items)
    byOrder.set(li.order_id, [...(byOrder.get(li.order_id) ?? []), li]);
  const perDay = new Map<string, number>();
  const revenueByDay = new Map<string, number>();
  const out: AuditOrder[] = orders.map((o) => {
    const date = ymdInTz(new Date(o.processed_at), tz);
    const rate = orderRates.get(o.currency ?? baseCurrency)!;
    const lines = (byOrder.get(o.id) ?? []).map((li) => ({ ...li,
      price: Number(li.price) * rate, unit_cost: li.unit_cost == null ? null : Number(li.unit_cost) * rate }));
    const priced = costOrder(lines, date, {
      ...cfg,
      supplierCost: costData.supplierByOrder.get(
        supplierOrderKey(store.id, o.order_number),
      ),
    });
    perDay.set(date, (perDay.get(date) ?? 0) + priced.cost);
    // Match daily_metrics: verified capture FX belongs to revenue; processing
    // fees and unrelated disputes do not. Orders without proof keep estimates.
    const payment = orderPaymentEffect(o, snapshot?.transactions ?? [], paymentRate, 0,
      rate, snapshot?.orders?.[o.shopify_order_id]);
    const revenue = (Number(o.subtotal_price) + Number(o.total_shipping) - Number(o.total_refunded)) * rate
      + payment.adjustment;
    revenueByDay.set(date, (revenueByDay.get(date) ?? 0) + revenue);
    return {
      orderNumber: o.order_number ?? "",
      date,
      revenue: round2(revenue * cfg.storeToDisplay),
      cost: round2(priced.cost * cfg.storeToDisplay),
      computedCost: round2(priced.computedCost * cfg.storeToDisplay),
      source: priced.source,
      lines: priced.lines.map((l) => ({
        ...l,
        lineCostDisplay: round2(l.lineCost * cfg.storeToDisplay),
      })),
    };
  });
  // Match the dashboard's daily rounding, then check each day independently:
  // opposite discrepancies must not cancel out into a false green result.
  const storedByDay = new Map(
    metrics.map((m) => [m.date, Number(m.product_cost)]),
  );
  const dates = new Set([...perDay.keys(), ...storedByDay.keys()]);
  const reconciles = [...dates].every(
    (d) =>
      Math.abs(round2(perDay.get(d) ?? 0) - (storedByDay.get(d) ?? 0)) < 0.011,
  );
  const totalCost = round2(
    [...perDay.values()].reduce(
      (a, b) => a + round2(round2(b) * cfg.storeToDisplay),
      0,
    ),
  );
  const storedTotal = round2(
    metrics.reduce(
      (a, m) => a + round2(Number(m.product_cost) * cfg.storeToDisplay),
      0,
    ),
  );
  return {
    storeName: store.shop_name ?? store.shop_domain,
    currency: settings?.currency ?? "EUR",
    orders: out,
    totalCost,
    totalRevenue: round2([...revenueByDay.values()].reduce(
      (total, revenue) => total + round2(round2(revenue) * cfg.storeToDisplay), 0)),
    storedTotal,
    reconciles,
  };
}
