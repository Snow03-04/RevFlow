import "server-only";
import { isPaidOrder } from "@/lib/shopify/paid-orders";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { ymdInTz, zonedRangeUtc } from "@/lib/date";
import { costOrder, type OrderCostLine } from "@/lib/cogs/order-cost";
import { loadCostData, supplierOrderKey } from "@/lib/cogs/data";
import { selectAllByUser, selectAllIn } from "@/lib/supabase/paginate";
import { round2 } from "@/lib/profit";
import type { Tables } from "@/types/database";
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
  const [
    { data: settings, error: settingsError },
    { data: stores, error: storesError },
    costData,
  ] = await Promise.all([
    supabase.from("settings").select("*").eq("user_id", user.id).single(),
    supabase
      .from("shopify_connections")
      .select("id,shop_name,shop_domain")
      .eq("user_id", user.id)
      .order("created_at"),
    loadCostData(supabase, user.id),
  ]);
  if (settingsError) throw settingsError;
  if (storesError) throw storesError;
  const store = stores?.find((s) => s.id === storeId) ?? stores?.[0];
  if (!store) return null;
  const tz = settings?.timezone ?? "UTC";
  const { startUtc, endUtc } = zonedRangeUtc(range, tz);
  const [allOrders, metrics] = await Promise.all([
    selectAllByUser<Tables<"orders">>(
      supabase,
      "orders",
      "id,order_number,processed_at,subtotal_price,total_shipping,total_refunded,test,cancelled_at,financial_status",
      user.id,
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
      user.id,
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
    user.id,
    "order_id",
    orders.map((o) => o.id),
  );
  const cfg = await costData.forStore(store.id, items, settings);
  const byOrder = new Map<string, typeof items>();
  for (const li of items)
    byOrder.set(li.order_id, [...(byOrder.get(li.order_id) ?? []), li]);
  const perDay = new Map<string, number>();
  const out: AuditOrder[] = orders.map((o) => {
    const date = ymdInTz(new Date(o.processed_at), tz);
    const priced = costOrder(byOrder.get(o.id) ?? [], date, {
      ...cfg,
      supplierCost: costData.supplierByOrder.get(
        supplierOrderKey(store.id, o.order_number),
      ),
    });
    perDay.set(date, (perDay.get(date) ?? 0) + priced.cost);
    return {
      orderNumber: o.order_number ?? "",
      date,
      revenue: round2(
        (Number(o.subtotal_price) +
          Number(o.total_shipping) -
          Number(o.total_refunded)) *
          cfg.storeToDisplay,
      ),
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
    totalRevenue: round2(out.reduce((a, o) => a + o.revenue, 0)),
    storedTotal,
    reconciles,
  };
}
