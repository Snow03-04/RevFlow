import "server-only";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { ymdInTz } from "@/lib/date";
import { resolveFx } from "@/lib/fx";
import {
  buildOrderCostConfig,
  costOrder,
  type CostLineItem,
  type OrderCostLine,
} from "@/lib/cogs/order-cost";
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

/**
 * Per-order COGS breakdown for a window, priced with the SAME routine the
 * daily-metrics recompute uses. It also re-reads the stored daily_metrics total
 * and flags a mismatch, so the screen proves the dashboard's number rather than
 * just recomputing an independent one.
 */
export async function getCogsAudit(
  range: DateRange,
  storeId?: string,
): Promise<CogsAudit | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const supabase = await createClient();

  const { data: settings } = await supabase
    .from("settings")
    .select("currency, timezone, default_product_cost_pct, fx_rate_override")
    .eq("user_id", user.id)
    .single();
  const displayCurrency = settings?.currency ?? "EUR";
  const tz = settings?.timezone ?? "UTC";
  const fallbackCostPct = Number(settings?.default_product_cost_pct ?? 30);

  const { data: stores } = await supabase
    .from("shopify_connections")
    .select("id, shop_name, shop_domain")
    .eq("user_id", user.id)
    .order("created_at");
  if (!stores || stores.length === 0) return null;
  const store = stores.find((s) => s.id === storeId) ?? stores[0];

  // Orders in the window for this store.
  const { data: orderRows } = await supabase
    .from("orders")
    .select(
      "id, order_number, processed_at, subtotal_price, test, cancelled_at",
    )
    .eq("user_id", user.id)
    .eq("shopify_connection_id", store.id)
    .gte("processed_at", `${range.from}T00:00:00Z`)
    .lt("processed_at", `${range.to}T23:59:59Z`)
    .order("processed_at", { ascending: false });
  const orders = (orderRows ?? []).filter((o) => !o.test && !o.cancelled_at);
  if (orders.length === 0) {
    return {
      storeName: store.shop_name ?? store.shop_domain,
      currency: displayCurrency,
      orders: [],
      totalCost: 0,
      totalRevenue: 0,
      storedTotal: 0,
      reconciles: true,
    };
  }

  // This store's base→display rate (costs are stored in base currency).
  const { data: curRow } = await supabase
    .from("orders")
    .select("currency")
    .eq("user_id", user.id)
    .eq("shopify_connection_id", store.id)
    .not("currency", "is", null)
    .order("processed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const storeCurrency = curRow?.currency ?? null;
  const storeToDisplay = await resolveFx(storeCurrency, displayCurrency, {
    storeCurrency,
    displayCurrency,
    override: settings?.fx_rate_override,
  });

  const orderIds = orders.map((o) => o.id);
  const lineItems: (CostLineItem & { order_id: string })[] = [];
  for (let i = 0; i < orderIds.length; i += 200) {
    const { data } = await supabase
      .from("order_line_items")
      .select(
        "order_id, shopify_variant_id, shopify_product_id, title, quantity, current_quantity, price, unit_cost",
      )
      .in("order_id", orderIds.slice(i, i + 200));
    if (data) lineItems.push(...(data as typeof lineItems));
  }

  // Shopify per-variant costs for the variants actually sold here.
  const variantIds = [
    ...new Set(
      lineItems.map((li) => li.shopify_variant_id).filter((v): v is string => !!v),
    ),
  ];
  const costByVariant = new Map<string, number>();
  for (let i = 0; i < variantIds.length; i += 300) {
    const { data } = await supabase
      .from("products")
      .select("shopify_variant_id, cost")
      .eq("user_id", user.id)
      .in("shopify_variant_id", variantIds.slice(i, i + 300))
      .not("cost", "is", null);
    for (const p of data ?? [])
      if (p.cost != null) costByVariant.set(p.shopify_variant_id, Number(p.cost));
  }

  const safe = async <T>(
    run: () => PromiseLike<{ data: T[] | null; error: unknown }>,
  ): Promise<T[]> => {
    try {
      const { data, error } = await run();
      return error ? [] : (data ?? []);
    } catch {
      return [];
    }
  };

  const [productCosts, tiers, collections, collectionProducts, collectionTiers, supplierRows] =
    await Promise.all([
      safe<{
        shopify_product_id: string;
        cost: number;
        effective_from: string;
        currency: string | null;
      }>(() =>
        supabase
          .from("product_costs")
          .select("shopify_product_id, cost, effective_from, currency")
          .eq("user_id", user.id),
      ),
      safe<{
        shopify_product_id: string;
        min_qty: number;
        total_cost: number;
        currency: string | null;
      }>(() =>
        supabase
          .from("product_cost_tiers")
          .select("shopify_product_id, min_qty, total_cost, currency")
          .eq("user_id", user.id),
      ),
      safe<{ id: string; base_unit_cost: number; currency: string | null }>(() =>
        supabase
          .from("cogs_collections")
          .select("id, base_unit_cost, currency")
          .eq("user_id", user.id),
      ),
      safe<{ collection_id: string; shopify_product_id: string }>(() =>
        supabase
          .from("cogs_collection_products")
          .select("collection_id, shopify_product_id")
          .eq("user_id", user.id),
      ),
      safe<{
        collection_id: string;
        min_qty: number;
        total_cost: number;
        currency: string | null;
      }>(() =>
        supabase
          .from("cogs_collection_tiers")
          .select("collection_id, min_qty, total_cost, currency")
          .eq("user_id", user.id),
      ),
      safe<{ order_number: string; cost: number; currency: string | null }>(() =>
        supabase
          .from("order_supplier_costs")
          .select("order_number, cost, currency")
          .eq("user_id", user.id)
          .eq("shopify_connection_id", store.id),
      ),
    ]);

  const supplierByNum = new Map(
    supplierRows.map((r) => [
      r.order_number,
      { cost: Number(r.cost), currency: r.currency },
    ]),
  );

  const cfg = buildOrderCostConfig(
    { productCosts, tiers, collections, collectionProducts, collectionTiers },
    { storeToDisplay, fallbackCostPct, costByVariant },
  );

  const itemsByOrder = new Map<string, CostLineItem[]>();
  for (const li of lineItems) {
    const arr = itemsByOrder.get(li.order_id) ?? [];
    arr.push(li);
    itemsByOrder.set(li.order_id, arr);
  }

  const toDisplay = (base: number) => Math.round(base * storeToDisplay * 100) / 100;

  const out: AuditOrder[] = [];
  let totalCost = 0;
  let totalRevenue = 0;
  for (const o of orders) {
    const ymd = ymdInTz(new Date(o.processed_at), tz);
    const num = (o.order_number ?? "").replace(/\D/g, "");
    const priced = costOrder(itemsByOrder.get(o.id) ?? [], ymd, {
      ...cfg,
      supplierCost: supplierByNum.get(num),
    });
    const costDisplay = toDisplay(priced.cost);
    const revenueDisplay = toDisplay(Number(o.subtotal_price));
    totalCost += costDisplay;
    totalRevenue += revenueDisplay;
    out.push({
      orderNumber: num || (o.order_number ?? ""),
      date: ymd,
      revenue: revenueDisplay,
      cost: costDisplay,
      computedCost: toDisplay(priced.computedCost),
      source: priced.source,
      lines: priced.lines.map((l) => ({
        ...l,
        lineCostDisplay: toDisplay(l.lineCost),
      })),
    });
  }

  // Reconcile against what the dashboard actually stored for this window.
  const { data: dm } = await supabase
    .from("daily_metrics")
    .select("product_cost")
    .eq("user_id", user.id)
    .eq("shopify_connection_id", store.id)
    .gte("date", range.from)
    .lte("date", range.to);
  const storedBase = (dm ?? []).reduce((s, r) => s + Number(r.product_cost), 0);
  const storedTotal = toDisplay(storedBase);

  return {
    storeName: store.shop_name ?? store.shop_domain,
    currency: displayCurrency,
    orders: out,
    totalCost: Math.round(totalCost * 100) / 100,
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    storedTotal,
    reconciles: Math.abs(storedTotal - totalCost) <= Math.max(1, totalCost * 0.01),
  };
}
