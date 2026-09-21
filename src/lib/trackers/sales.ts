import "server-only";
import { isPaidOrder } from "@/lib/shopify/paid-orders";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { loadCostData, supplierOrderKey } from "@/lib/cogs/data";
import { selectAllByUser, selectAllIn } from "@/lib/supabase/paginate";
import { ymdInTz, zonedRangeUtc } from "@/lib/date";
import {
  allocateOrderCost,
  costOrder,
  type CostLineItem,
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
  financial_status: string | null;
  landing_site: string | null;
  subtotal_price: number;
  total_shipping: number;
  total_refunded: number;
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

/** Order-level facts shared by ROAS and campaign P&L. Amounts are store-base. */
export interface TrackerOrderSales {
  id: string;
  storeId: string | null;
  date: string;
  landingSite?: string | null;
  collectionHandle: string | null;
  grossRevenue: number;
  refunds: number;
  cost: number;
  sheetCost: boolean;
  items: {
    productId: string | null;
    units: number;
    revenue: number;
    /** Before refunds, for distributing order revenue, refunds and fixed fees. */
    weight: number;
    cost: number;
  }[];
}

export async function fetchTrackerOrderSales(
  supabase: DB,
  userId: string,
  range: DateRange,
  timezone: string,
  channel: "meta" | "google" | "all" = "meta",
): Promise<TrackerOrderSales[]> {
  const { startUtc, endUtc } = zonedRangeUtc(range, timezone);
  const where = (q: any) =>
    q.gte("processed_at", startUtc).lt("processed_at", endUtc);

  let orders: OrderRow[];
  try {
    orders = await selectAllByUser<OrderRow>(
      supabase,
      "orders",
      "id, order_number, shopify_connection_id, processed_at, test, cancelled_at, financial_status, landing_site, subtotal_price, total_shipping, total_refunded",
      userId,
      where,
    );
  } catch {
    // Migration 0021 (landing_site) not applied yet — degrade to no Google
    // filtering and no collection attribution, so products still work.
    const base = await selectAllByUser<Omit<OrderRow, "landing_site">>(
      supabase,
      "orders",
      "id, order_number, shopify_connection_id, processed_at, test, cancelled_at, financial_status, subtotal_price, total_shipping, total_refunded",
      userId,
      where,
    );
    orders = base.map((o) => ({ ...o, landing_site: null }));
  }

  const valid = orders.filter(
    (o) => isPaidOrder(o) && (channel === "all" || (channel === "google" ? isGooglePaidOrder(o.landing_site) : !isGooglePaidOrder(o.landing_site))),
  );
  if (valid.length === 0) return [];

  const orderIds = valid.map((o) => o.id);
  const lineItems = await selectAllIn<LineRow>(
    supabase,
    "order_line_items",
    "order_id,shopify_product_id,shopify_variant_id,title,quantity,current_quantity,price,unit_cost,total_discount",
    userId,
    "order_id",
    orderIds,
  );

  const itemsByOrder = new Map<string, LineRow[]>();
  for (const li of lineItems) {
    const arr = itemsByOrder.get(li.order_id);
    if (arr) arr.push(li);
    else itemsByOrder.set(li.order_id, [li]);
  }

  const [{ data: settings, error: settingsError }, costData] =
    await Promise.all([
      supabase.from("settings").select("*").eq("user_id", userId).maybeSingle(),
      loadCostData(supabase, userId),
    ]);
  if (settingsError) throw settingsError;
  const cfgByStore = new Map();
  for (const storeId of new Set(valid.map((o) => o.shopify_connection_id))) {
    const ids = new Set(
      valid.filter((o) => o.shopify_connection_id === storeId).map((o) => o.id),
    );
    cfgByStore.set(
      storeId,
      await costData.forStore(
        storeId,
        lineItems.filter((li) => ids.has(li.order_id)),
        settings,
      ),
    );
  }
  const supplierByOrder = costData.supplierByOrder;

  return valid.map((o) => {
    const items = itemsByOrder.get(o.id) ?? [];
    const date = ymdInTz(new Date(o.processed_at), timezone);
    const storeId = o.shopify_connection_id;
    const num = (o.order_number ?? "").replace(/\D/g, "");
    const priced = costOrder(items, date, {
      ...cfgByStore.get(storeId),
      supplierCost: storeId && num
        ? supplierByOrder.get(supplierOrderKey(storeId, num)) : undefined,
    });
    const allocated = allocateOrderCost(items, priced);
    const landing = landingTargetFromUrl(o.landing_site);
    return {
      id: o.id, storeId, date,
      landingSite: o.landing_site,
      collectionHandle: landing?.kind === "collection" ? landing.handle : null,
      grossRevenue: Number(o.subtotal_price ?? 0) + Number(o.total_shipping ?? 0),
      refunds: Number(o.total_refunded ?? 0),
      cost: priced.cost,
      sheetCost: priced.source === "sheet",
      items: items.map((li, index) => ({
        productId: li.shopify_product_id,
        units: Math.max(0, Number(li.current_quantity ?? li.quantity)),
        revenue: lineNetRevenue(li),
        weight: Math.max(0, Number(li.price) * Number(li.quantity) - Number(li.total_discount ?? 0)),
        cost: allocated[index],
      })),
    };
  });
}

export async function fetchTrackerSales(
  supabase: DB,
  userId: string,
  range: DateRange,
  timezone: string,
): Promise<Map<string, TargetSales>> {
  const orders = await fetchTrackerOrderSales(supabase, userId, range, timezone);
  const acc = new Map<string, Bucket>();
  const bucket = (key: string): Bucket => {
    let b = acc.get(key);
    if (!b) {
      b = { units: 0, revenue: 0, cost: 0, orderSet: new Set<string>() };
      acc.set(key, b);
    }
    return b;
  };

  for (const o of orders) {
    // ---- per PRODUCT ----
    let orderUnits = 0;
    let orderRevenue = 0;
    for (const li of o.items) {
      const qty = li.units;
      if (qty <= 0 && li.cost === 0) continue;
      const net = li.revenue;
      orderUnits += qty;
      orderRevenue += net;
      if (!li.productId) continue;
      const b = bucket(productSalesKey(li.productId, o.date));
      b.units += qty;
      b.revenue += net;
      b.cost += li.cost;
      b.orderSet.add(o.id);
    }

    // ---- per COLLECTION landing page ----
    // The whole order counts: the customer arrived on the collection the ad was
    // pointing at, so everything that basket ended up holding was driven by it.
    if (o.collectionHandle) {
      // A store-scoped bucket plus a store-agnostic one; a Set so an order with
      // no store id (legacy rows) isn't counted into the same key twice.
      const keys = new Set([
        collectionSalesKey(o.storeId, o.collectionHandle, o.date),
        collectionSalesKey(null, o.collectionHandle, o.date),
      ]);
      for (const key of keys) {
        const b = bucket(key);
        b.units += orderUnits;
        b.revenue += orderRevenue;
        b.cost += o.cost;
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

/** Prorate the original discount after partial refunds/order edits. */
export function lineNetRevenue(li: {
  price: number;
  quantity: number;
  current_quantity: number | null;
  total_discount: number | null;
}): number {
  const qty = Math.max(0, Number(li.current_quantity ?? li.quantity));
  const original = Number(li.quantity);
  return Math.max(
    0,
    Number(li.price) * qty -
      (original > 0 ? (Number(li.total_discount ?? 0) * qty) / original : 0),
  );
}
