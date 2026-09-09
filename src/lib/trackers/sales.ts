import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { getStoreFxRates } from "@/lib/queries";
import { selectAllByUser } from "@/lib/supabase/paginate";
import { ymdInTz, zonedRangeUtc } from "@/lib/date";
import {
  buildOrderCostConfig,
  costOrder,
  type CostLineItem,
  type OrderCostConfig,
  type OrderCostResult,
} from "@/lib/cogs/order-cost";
import { isGooglePaidOrder, landingTargetFromUrl } from "@/lib/trackers/match";
import type { DateRange } from "@/types";

type DB = SupabaseClient<Database>;

/**
 * Real Shopify sales AND the realised COGS behind them, bucketed by the thing a
 * Meta campaign can advertise — a PRODUCT, or a COLLECTION landing page.
 *
 * Two things live in one pass on purpose:
 *
 *  1. **Collections.** A campaign whose ads point at `/collections/<handle>`
 *     has no single product to match, so it used to show spend against zero
 *     sales. Attribution instead comes from the ORDER's `landing_site`: a
 *     customer who landed on that collection page and bought counts for the
 *     campaign, whatever they ended up putting in the basket.
 *
 *  2. **COGS that matches the dashboard.** The cost here is produced by the very
 *     same {@link costOrder} routine the daily-metrics recompute and the COGS
 *     audit use, so the supplier sheet's exact per-order cost, collection tiers,
 *     quantity tiers and dated manual costs ALL reach the ROAS tracker. Reading
 *     a flat per-product cost (as the tracker did) ignored every one of those and
 *     produced a margin that disagreed with the dashboard's.
 *
 * Amounts stay in each STORE's own base currency — the caller applies that
 * campaign's store FX (see trackerFxByMetaConnection). Only Google PAID orders
 * are excluded, exactly as before, so a Meta campaign is never credited with a
 * sale a Google Ads click drove.
 */
export interface TargetSales {
  orders: number;
  units: number;
  /** NET revenue (price×qty − discounts), in the store's base currency. */
  revenue: number;
  /** Realised COGS for those units, in the store's base currency. */
  cost: number;
}

/** Bucket key for a product's sales on a local day. */
export function productSalesKey(productId: string, ymd: string): string {
  return `product:${productId}:${ymd}`;
}

/**
 * Bucket key for a collection landing page's sales on a local day. Collection
 * handles are only unique WITHIN a store (two stores can each have
 * `/collections/all`), so the store scopes the key; `storeId: null` builds the
 * store-agnostic bucket used when a Meta account isn't mapped to a store.
 */
export function collectionSalesKey(
  storeId: string | null,
  handle: string,
  ymd: string,
): string {
  return `collection:${storeId ?? "*"}:${handle}:${ymd}`;
}

interface OrderRow {
  id: string;
  order_number: string | null;
  shopify_connection_id: string | null;
  processed_at: string;
  test: boolean;
  cancelled_at: string | null;
  landing_site: string | null;
}

type LineRow = CostLineItem & {
  order_id: string;
  total_discount: number | null;
};

interface Bucket {
  units: number;
  revenue: number;
  cost: number;
  orderSet: Set<string>;
}

const sum = (xs: Iterable<number>): number => {
  let t = 0;
  for (const x of xs) t += x;
  return t;
};

/**
 * Spread ONE order's final cost back over the products it contains.
 *
 * Lines priced as a group (a COGS collection covers several products at once)
 * are split by quantity. The result is then rescaled to the order's ACTUAL cost,
 * which is what makes the supplier sheet flow through: when the sheet sets the
 * price for the whole order, `priced.cost` is the sheet's number and the
 * per-product shares are stretched to sum to it.
 */
function costPerProduct(priced: OrderCostResult, items: LineRow[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const l of priced.lines) {
    if (l.members && l.members.length > 0) {
      const total = sum(l.members.map((m) => m.qty));
      if (total <= 0) continue;
      for (const m of l.members)
        out.set(
          m.productId,
          (out.get(m.productId) ?? 0) + (l.lineCost * m.qty) / total,
        );
    } else if (l.productId) {
      out.set(l.productId, (out.get(l.productId) ?? 0) + l.lineCost);
    }
  }

  if (priced.cost <= 0) return out;
  const attributed = sum(out.values());
  if (attributed > 0) {
    const k = priced.cost / attributed;
    if (Math.abs(k - 1) > 1e-9) for (const [p, v] of out) out.set(p, v * k);
    return out;
  }

  // Nothing could be attributed per line (e.g. a sheet-priced order whose lines
  // carry no product id) — spread the order cost by units so the cost still
  // lands somewhere rather than vanishing from the tracker.
  const qtyByProduct = new Map<string, number>();
  for (const li of items) {
    const qty = Number(li.current_quantity ?? li.quantity);
    if (qty <= 0 || !li.shopify_product_id) continue;
    qtyByProduct.set(
      li.shopify_product_id,
      (qtyByProduct.get(li.shopify_product_id) ?? 0) + qty,
    );
  }
  const units = sum(qtyByProduct.values());
  if (units <= 0) return out;
  for (const [p, q] of qtyByProduct) out.set(p, (priced.cost * q) / units);
  return out;
}

export async function fetchTrackerSales(
  supabase: DB,
  userId: string,
  range: DateRange,
  timezone: string,
): Promise<Map<string, TargetSales>> {
  const { startUtc, endUtc } = zonedRangeUtc(range, timezone);
  const where = (q: any) =>
    q.gte("processed_at", startUtc).lt("processed_at", endUtc);

  let orders: OrderRow[];
  try {
    orders = await selectAllByUser<OrderRow>(
      supabase,
      "orders",
      "id, order_number, shopify_connection_id, processed_at, test, cancelled_at, landing_site",
      userId,
      where,
    );
  } catch {
    // Migration 0021 (landing_site) not applied yet — degrade to no Google
    // filtering and no collection attribution, so products still work.
    const base = await selectAllByUser<Omit<OrderRow, "landing_site">>(
      supabase,
      "orders",
      "id, order_number, shopify_connection_id, processed_at, test, cancelled_at",
      userId,
      where,
    );
    orders = base.map((o) => ({ ...o, landing_site: null }));
  }

  const valid = orders.filter(
    (o) => !o.test && !o.cancelled_at && !isGooglePaidOrder(o.landing_site),
  );
  if (valid.length === 0) return new Map();

  const orderIds = valid.map((o) => o.id);
  const lineItems: LineRow[] = [];
  for (let i = 0; i < orderIds.length; i += 200) {
    const { data } = await supabase
      .from("order_line_items")
      .select(
        "order_id, shopify_product_id, shopify_variant_id, title, quantity, current_quantity, price, unit_cost, total_discount",
      )
      .in("order_id", orderIds.slice(i, i + 200));
    if (data) lineItems.push(...(data as unknown as LineRow[]));
  }
  if (lineItems.length === 0) return new Map();

  const itemsByOrder = new Map<string, LineRow[]>();
  for (const li of lineItems) {
    const arr = itemsByOrder.get(li.order_id);
    if (arr) arr.push(li);
    else itemsByOrder.set(li.order_id, [li]);
  }

  const cfgByStore = await buildStoreCostConfigs(supabase, userId, lineItems);
  const supplierByOrder = await fetchSupplierCosts(supabase, userId);

  const acc = new Map<string, Bucket>();
  const bucket = (key: string): Bucket => {
    let b = acc.get(key);
    if (!b) {
      b = { units: 0, revenue: 0, cost: 0, orderSet: new Set<string>() };
      acc.set(key, b);
    }
    return b;
  };

  for (const o of valid) {
    const items = itemsByOrder.get(o.id);
    if (!items || items.length === 0) continue;
    const ymd = ymdInTz(new Date(o.processed_at), timezone);
    const storeId = o.shopify_connection_id;
    const num = (o.order_number ?? "").replace(/\D/g, "");

    const cfg = cfgByStore.get(storeId ?? "") ?? cfgByStore.get("")!;
    const priced = costOrder(items, ymd, {
      ...cfg,
      supplierCost:
        storeId && num ? supplierByOrder.get(`${storeId}:${num}`) : undefined,
    });

    // ---- per PRODUCT ----
    const perProduct = costPerProduct(priced, items);
    let orderUnits = 0;
    let orderRevenue = 0;
    for (const li of items) {
      const qty = Number(li.current_quantity ?? li.quantity);
      if (qty <= 0) continue;
      const net = Number(li.price) * qty - Number(li.total_discount ?? 0);
      orderUnits += qty;
      orderRevenue += net;
      if (!li.shopify_product_id) continue;
      const b = bucket(productSalesKey(li.shopify_product_id, ymd));
      b.units += qty;
      b.revenue += net;
      b.orderSet.add(o.id);
    }
    for (const [productId, cost] of perProduct)
      bucket(productSalesKey(productId, ymd)).cost += cost;

    // ---- per COLLECTION landing page ----
    // The whole order counts: the customer arrived on the collection the ad was
    // pointing at, so everything that basket ended up holding was driven by it.
    const landing = landingTargetFromUrl(o.landing_site);
    if (landing?.kind === "collection") {
      // A store-scoped bucket plus a store-agnostic one; a Set so an order with
      // no store id (legacy rows) isn't counted into the same key twice.
      const keys = new Set([
        collectionSalesKey(storeId, landing.handle, ymd),
        collectionSalesKey(null, landing.handle, ymd),
      ]);
      for (const key of keys) {
        const b = bucket(key);
        b.units += orderUnits;
        b.revenue += orderRevenue;
        b.cost += priced.cost;
        b.orderSet.add(o.id);
      }
    }
  }

  const out = new Map<string, TargetSales>();
  for (const [k, b] of acc)
    out.set(k, {
      orders: b.orderSet.size,
      units: b.units,
      revenue: b.revenue,
      cost: b.cost,
    });
  return out;
}

/** Exact per-order supplier costs, keyed `${storeId}:${orderNumber}`. */
async function fetchSupplierCosts(
  supabase: DB,
  userId: string,
): Promise<Map<string, { cost: number; currency: string | null }>> {
  const out = new Map<string, { cost: number; currency: string | null }>();
  try {
    const { data, error } = await supabase
      .from("order_supplier_costs")
      .select("shopify_connection_id, order_number, cost, currency")
      .eq("user_id", userId);
    if (error) return out;
    for (const r of data ?? [])
      out.set(`${r.shopify_connection_id}:${r.order_number}`, {
        cost: Number(r.cost),
        currency: r.currency,
      });
  } catch {
    /* table missing (migration 0031/0032) — no sheet costs, computed only */
  }
  return out;
}

/**
 * One cost config per store — the display→base conversion inside it depends on
 * that store's own rate, so a single shared config would price a HUF store's
 * orders with a EUR store's rate. The `""` entry backs orders with no store id.
 */
type StoreCostConfig = Omit<OrderCostConfig, "supplierCost">;

async function buildStoreCostConfigs(
  supabase: DB,
  userId: string,
  lineItems: LineRow[],
): Promise<Map<string, StoreCostConfig>> {
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

  const { data: settings } = await supabase
    .from("settings")
    .select("currency, default_product_cost_pct, fx_rate_override")
    .eq("user_id", userId)
    .maybeSingle();
  const displayCurrency = settings?.currency ?? "EUR";
  const fallbackCostPct = Number(settings?.default_product_cost_pct ?? 30);

  const variantIds = [
    ...new Set(
      lineItems
        .map((li) => li.shopify_variant_id)
        .filter((v): v is string => !!v),
    ),
  ];
  const costByVariant = new Map<string, number>();
  for (let i = 0; i < variantIds.length; i += 300) {
    const { data } = await supabase
      .from("products")
      .select("shopify_variant_id, cost")
      .eq("user_id", userId)
      .in("shopify_variant_id", variantIds.slice(i, i + 300))
      .not("cost", "is", null);
    for (const p of data ?? [])
      if (p.cost != null) costByVariant.set(p.shopify_variant_id, Number(p.cost));
  }

  const [
    productCosts,
    tiers,
    collections,
    collectionProducts,
    collectionTiers,
    storeRates,
  ] = await Promise.all([
    safe<{
      shopify_product_id: string;
      cost: number;
      effective_from: string;
      currency: string | null;
    }>(() =>
      supabase
        .from("product_costs")
        .select("shopify_product_id, cost, effective_from, currency")
        .eq("user_id", userId),
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
        .eq("user_id", userId),
    ),
    safe<{ id: string; base_unit_cost: number; currency: string | null }>(() =>
      supabase
        .from("cogs_collections")
        .select("id, base_unit_cost, currency")
        .eq("user_id", userId),
    ),
    safe<{ collection_id: string; shopify_product_id: string }>(() =>
      supabase
        .from("cogs_collection_products")
        .select("collection_id, shopify_product_id")
        .eq("user_id", userId),
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
        .eq("user_id", userId),
    ),
    getStoreFxRates(
      supabase,
      userId,
      displayCurrency,
      settings?.fx_rate_override,
    ),
  ]);

  const raw = {
    productCosts,
    tiers,
    collections,
    collectionProducts,
    collectionTiers,
  };
  const build = (storeToDisplay: number): StoreCostConfig =>
    buildOrderCostConfig(raw, {
      storeToDisplay,
      fallbackCostPct,
      costByVariant,
    });

  const out = new Map<string, StoreCostConfig>();
  for (const [storeId, rate] of storeRates) out.set(storeId, build(rate));
  out.set("", build(1)); // orders predating multi-store: base == display
  return out;
}
