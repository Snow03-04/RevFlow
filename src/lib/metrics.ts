import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables, TablesInsert } from "@/types/database";
import type { DateRange, MetricsSummary } from "@/types";
import {
  computeProfit,
  lineItemCost,
  tieredCost,
  round2,
  round4,
  type CostTier,
} from "@/lib/profit";
import { ymdInTz, zonedRangeUtc, eachDay } from "@/lib/date";
import { resolveFx } from "@/lib/fx";

type DB = SupabaseClient<Database>;

interface DayAccumulator {
  grossRevenue: number;
  shippingRevenue: number;
  discounts: number;
  refunds: number;
  productCost: number;
  ordersTotalValue: number;
  ordersCount: number;
  unitsSold: number;
  adSpend: number; // total (Meta + Google)
  adSpendMeta: number;
  adSpendGoogle: number;
  purchaseValue: number;
  adClicks: number;
}

function emptyDay(): DayAccumulator {
  return {
    grossRevenue: 0,
    shippingRevenue: 0,
    discounts: 0,
    refunds: 0,
    productCost: 0,
    ordersTotalValue: 0,
    ordersCount: 0,
    unitsSold: 0,
    adSpend: 0,
    adSpendMeta: 0,
    adSpendGoogle: 0,
    purchaseValue: 0,
    adClicks: 0,
  };
}

/**
 * Recompute and upsert `daily_metrics` rows for a user across a date range.
 *
 * Pulls raw orders + line items + Meta campaigns, buckets them into local days
 * (merchant timezone), applies the profit model, and writes one row per day.
 *
 * Works with either the authenticated server client (RLS) or the admin client
 * (cron). The caller is responsible for passing the correct `userId`.
 */
export async function recomputeDailyMetrics(
  supabase: DB,
  userId: string,
  range: DateRange,
  opts?: { settings?: Tables<"settings"> | null },
): Promise<number> {
  // 1. Cost settings. Reuse the caller's already-loaded settings when provided
  //    (the dashboard passes them in) to avoid a duplicate `select *` per load;
  //    otherwise load them here (cron, webhooks, actions).
  const settings =
    opts && "settings" in opts
      ? opts.settings
      : (
          await supabase
            .from("settings")
            .select("*")
            .eq("user_id", userId)
            .single()
        ).data;

  const timezone = settings?.timezone ?? "UTC";
  const fallbackCostPct = Number(settings?.default_product_cost_pct ?? 30);
  const profitSettings = {
    payment_fee_pct: Number(settings?.payment_fee_pct ?? 2.9),
    payment_fee_fixed: Number(settings?.payment_fee_fixed ?? 0.3),
    default_shipping_cost: Number(settings?.default_shipping_cost ?? 0),
  };

  const { startUtc, endUtc } = zonedRangeUtc(range, timezone);
  const displayCurrency = settings?.currency ?? "USD";

  // 2. Independent reads in ONE round-trip instead of one-by-one: the orders in
  //    the window, the (small) manual cost table, the store's currency, and both
  //    campaign tables. None depend on each other, so awaiting them together cuts
  //    the recompute's latency. (Line items + per-variant costs still follow,
  //    since they need the order ids / sold variants.)
  const [storesRes, metaConnRes, googleConnRes, manualRes, curRes, campRes, gRes] =
    await Promise.all([
      supabase.from("shopify_connections").select("id").eq("user_id", userId),
      supabase
        .from("meta_connections")
        .select("id, shopify_connection_id")
        .eq("user_id", userId),
      supabase
        .from("google_connections")
        .select("id, shopify_connection_id")
        .eq("user_id", userId),
      supabase
        .from("product_costs")
        .select("shopify_product_id, cost, effective_from, currency")
        .eq("user_id", userId),
      supabase
        .from("orders")
        .select("currency")
        .eq("user_id", userId)
        .not("currency", "is", null)
        .order("processed_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("campaigns")
        .select("date, spend, purchase_value, clicks, meta_connection_id")
        .eq("user_id", userId)
        .gte("date", range.from)
        .lte("date", range.to),
      supabase
        .from("google_campaigns")
        .select("date, spend, purchase_value, clicks, google_connection_id")
        .eq("user_id", userId)
        .gte("date", range.from)
        .lte("date", range.to),
    ]);
  if (campRes.error) throw campRes.error;
  if (gRes.error) throw gRes.error;
  const manualCosts = manualRes.data;
  const campaigns = campRes.data;
  const googleCampaigns = gRes.data;

  // Which store each ad account is mapped to (null/undefined = unmapped → its
  // spend is not attributed to any store until assigned on the Connections page).
  const metaStoreOf = new Map<string, string | null>();
  for (const m of metaConnRes.data ?? [])
    metaStoreOf.set(m.id, m.shopify_connection_id);
  const googleStoreOf = new Map<string, string | null>();
  for (const g of googleConnRes.data ?? [])
    googleStoreOf.set(g.id, g.shopify_connection_id);
  const storeIds = (storesRes.data ?? []).map((s) => s.id);

  // Quantity-tiered COGS + collections (migration 0020). These tables may not
  // exist yet on older databases, so degrade gracefully to "no tiers" instead
  // of breaking the whole recompute.
  async function safeRows<T>(
    run: () => PromiseLike<{ data: T[] | null; error: unknown }>,
  ): Promise<T[]> {
    try {
      const { data, error } = await run();
      return error ? [] : (data ?? []);
    } catch {
      return [];
    }
  }
  const [tiersRaw, colsRaw, colProdRaw, colTiersRaw, manualEntriesRaw] =
    await Promise.all([
    safeRows<{
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
    safeRows<{ id: string; base_unit_cost: number; currency: string | null }>(() =>
      supabase
        .from("cogs_collections")
        .select("id, base_unit_cost, currency")
        .eq("user_id", userId),
    ),
    safeRows<{ collection_id: string; shopify_product_id: string }>(() =>
      supabase
        .from("cogs_collection_products")
        .select("collection_id, shopify_product_id")
        .eq("user_id", userId),
    ),
    safeRows<{
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
    // Manual per-day profit/expense adjustments (migration 0022). May not exist
    // on older DBs — safeRows degrades to "no adjustments".
    safeRows<{
      date: string;
      kind: string;
      amount: number;
      currency: string | null;
    }>(() =>
      supabase
        .from("manual_entries")
        .select("date, kind, amount, currency")
        .eq("user_id", userId)
        .gte("date", range.from)
        .lte("date", range.to),
    ),
  ]);

  // Ad spend grouped by the store each account is mapped to (unmapped → dropped).
  type CampRow = {
    date: string;
    spend: number;
    purchase_value: number;
    clicks: number;
  };
  const metaByStore = new Map<string, CampRow[]>();
  for (const c of campaigns ?? []) {
    const s = c.meta_connection_id ? metaStoreOf.get(c.meta_connection_id) : null;
    if (!s) continue;
    const arr = metaByStore.get(s);
    if (arr) arr.push(c);
    else metaByStore.set(s, [c]);
  }
  const googleByStore = new Map<string, CampRow[]>();
  for (const c of googleCampaigns ?? []) {
    const s = c.google_connection_id
      ? googleStoreOf.get(c.google_connection_id)
      : null;
    if (!s) continue;
    const arr = googleByStore.get(s);
    if (arr) arr.push(c);
    else googleByStore.set(s, [c]);
  }

  // Effective-dated manual COGS may be stored in the DISPLAY currency
  // (currency != null) and must be converted to the store's base currency to
  // line up with everything else. Resolve the base→display rate once (cached 12h).
  const storeCurrency = curRes.data?.currency ?? null;
  const storeToDisplay = await resolveFx(storeCurrency, displayCurrency, {
    storeCurrency,
    displayCurrency,
    override: settings?.fx_rate_override,
  });

  // productId -> dated costs (ascending by effective_from), each in base currency.
  const manualByProduct = new Map<string, { from: string; costBase: number }[]>();
  for (const m of manualCosts ?? []) {
    const costBase =
      m.currency == null || storeToDisplay <= 0
        ? Number(m.cost)
        : Number(m.cost) / storeToDisplay;
    const list = manualByProduct.get(m.shopify_product_id) ?? [];
    list.push({ from: m.effective_from, costBase });
    manualByProduct.set(m.shopify_product_id, list);
  }
  for (const list of manualByProduct.values())
    list.sort((a, b) => a.from.localeCompare(b.from));

  // Convert a tier/collection amount (stored in display currency unless
  // currency == null) to the store's base currency, like the manual costs above.
  const toBase = (amount: number, currency: string | null): number =>
    currency == null || storeToDisplay <= 0 ? amount : amount / storeToDisplay;

  // Net manual adjustment per day (base currency): profit adds, expense subtracts.
  const manualByDay = new Map<string, number>();
  for (const e of manualEntriesRaw) {
    const base = toBase(Number(e.amount), e.currency);
    const signed = e.kind === "expense" ? -base : base;
    manualByDay.set(e.date, (manualByDay.get(e.date) ?? 0) + signed);
  }

  // The per-order fixed fee + shipping cost are entered in the DISPLAY currency
  // but the profit math runs in the store's base currency — convert them so a
  // €0.30 fee is €0.30, not 0.30 of the base unit (e.g. 0.30 HUF ≈ nothing).
  const profitSettingsBase = {
    payment_fee_pct: profitSettings.payment_fee_pct, // a %, currency-independent
    payment_fee_fixed: toBase(profitSettings.payment_fee_fixed, displayCurrency),
    default_shipping_cost: toBase(profitSettings.default_shipping_cost, displayCurrency),
  };

  // Per-product quantity tiers (base currency).
  const productTiers = new Map<string, CostTier[]>();
  for (const t of tiersRaw) {
    const list = productTiers.get(t.shopify_product_id) ?? [];
    list.push({ minQty: t.min_qty, total: toBase(Number(t.total_cost), t.currency) });
    productTiers.set(t.shopify_product_id, list);
  }

  // Collections: product -> collection, and collection -> { base unit, tiers }.
  const collectionByProduct = new Map<string, string>();
  for (const cp of colProdRaw)
    collectionByProduct.set(cp.shopify_product_id, cp.collection_id);
  const collectionInfo = new Map<string, { baseUnit: number; tiers: CostTier[] }>();
  for (const c of colsRaw)
    collectionInfo.set(c.id, {
      baseUnit: toBase(Number(c.base_unit_cost), c.currency),
      tiers: [],
    });
  for (const t of colTiersRaw) {
    const info = collectionInfo.get(t.collection_id);
    if (info)
      info.tiers.push({
        minQty: t.min_qty,
        total: toBase(Number(t.total_cost), t.currency),
      });
  }

  /** Manual cost (base currency) in effect for a product on a given local day. */
  function manualCostFor(productId: string, ymd: string): number | undefined {
    const list = manualByProduct.get(productId);
    if (!list) return undefined;
    let chosen: number | undefined;
    for (const e of list) {
      if (e.from <= ymd) chosen = e.costBase;
      else break; // sorted ascending
    }
    return chosen;
  }

  // Per-store recompute: one row per (store, day). Orders / line items / COGS are
  // scoped to the store; ad spend comes from the accounts mapped to that store.
  // "All stores" is the SUM of these rows on read — no aggregate row is stored.
  const rows: TablesInsert<"daily_metrics">[] = [];

  for (const storeId of storeIds) {
    // The per-user/day manual adjustment isn't store-scoped; attribute it to the
    // FIRST store only so the "all stores" sum counts it exactly once.
    const isPrimaryStore = storeId === storeIds[0];

    const { data: storeOrders, error: soErr } = await supabase
      .from("orders")
      .select(
        "id, processed_at, subtotal_price, total_price, total_shipping, total_discounts, total_refunded, test, cancelled_at",
      )
      .eq("user_id", userId)
      .eq("shopify_connection_id", storeId)
      .gte("processed_at", startUtc)
      .lt("processed_at", endUtc);
    if (soErr) throw soErr;

    const orderRows = (storeOrders ?? []).filter(
      (o) => !o.test && !o.cancelled_at,
    );
    const orderIds = orderRows.map((o) => o.id);
    const orderDay = new Map<string, string>(); // order.id -> local ymd
    for (const o of orderRows)
      orderDay.set(o.id, ymdInTz(new Date(o.processed_at), timezone));

    // Line items for those orders (chunked to stay within URL limits).
    const lineItems: {
      order_id: string;
      shopify_variant_id: string | null;
      shopify_product_id: string | null;
      quantity: number;
      price: number;
      unit_cost: number | null;
    }[] = [];
    for (let i = 0; i < orderIds.length; i += 200) {
      const chunk = orderIds.slice(i, i + 200);
      const { data, error } = await supabase
        .from("order_line_items")
        .select(
          "order_id, shopify_variant_id, shopify_product_id, quantity, price, unit_cost",
        )
        .in("order_id", chunk);
      if (error) throw error;
      if (data) lineItems.push(...data);
    }

    // Shopify per-variant costs — only the variants actually sold in this window.
    const soldVariantIds = [
      ...new Set(
        lineItems
          .map((li) => li.shopify_variant_id)
          .filter((v): v is string => !!v),
      ),
    ];
    const costByVariant = new Map<string, number>();
    for (let i = 0; i < soldVariantIds.length; i += 300) {
      const chunk = soldVariantIds.slice(i, i + 300);
      const { data, error } = await supabase
        .from("products")
        .select("shopify_variant_id, cost")
        .eq("user_id", userId)
        .in("shopify_variant_id", chunk)
        .not("cost", "is", null);
      if (error) throw error;
      for (const p of data ?? [])
        if (p.cost != null)
          costByVariant.set(p.shopify_variant_id, Number(p.cost));
    }

    // Bucket everything by local day for THIS store.
    const days = new Map<string, DayAccumulator>();
    for (const ymd of eachDay(range)) days.set(ymd, emptyDay());

    for (const o of orderRows) {
      const day = days.get(orderDay.get(o.id)!);
      if (!day) continue;
      day.grossRevenue += Number(o.subtotal_price);
      day.shippingRevenue += Number(o.total_shipping);
      day.discounts += Number(o.total_discounts);
      day.refunds += Number(o.total_refunded);
      day.ordersTotalValue += Number(o.total_price);
      day.ordersCount += 1;
    }

    // Group line items by order so bundle pricing can see the whole order.
    const itemsByOrder = new Map<string, typeof lineItems>();
    for (const li of lineItems) {
      const arr = itemsByOrder.get(li.order_id);
      if (arr) arr.push(li);
      else itemsByOrder.set(li.order_id, [li]);
    }

    for (const [oid, items] of itemsByOrder) {
      const ymd = orderDay.get(oid);
      if (!ymd) continue;
      const day = days.get(ymd);
      if (!day) continue;

      const collectionQty = new Map<string, number>(); // collectionId -> units this order
      const tieredProdQty = new Map<string, { qty: number; unit: number }>();
      let orderCost = 0;

      for (const li of items) {
        const qty = Number(li.quantity);
        day.unitsSold += qty;
        const pid = li.shopify_product_id ?? undefined;

        // A collection member? Defer — priced once on the combined quantity.
        const cid = pid ? collectionByProduct.get(pid) : undefined;
        if (cid) {
          collectionQty.set(cid, (collectionQty.get(cid) ?? 0) + qty);
          continue;
        }

        // Manual COGS (effective on the order's day) first, then Shopify variant
        // cost, then snapshot, then %.
        const manualCost = pid ? manualCostFor(pid, ymd) : undefined;
        const variantCost = li.shopify_variant_id
          ? costByVariant.get(li.shopify_variant_id)
          : undefined;

        // Has quantity tiers? Accumulate and price on the total below.
        const tiers = pid ? productTiers.get(pid) : undefined;
        if (tiers && tiers.length > 0 && pid) {
          const unit =
            manualCost ??
            variantCost ??
            (li.unit_cost != null
              ? Number(li.unit_cost)
              : Number(li.price) * (fallbackCostPct / 100));
          const agg = tieredProdQty.get(pid);
          if (agg) agg.qty += qty;
          else tieredProdQty.set(pid, { qty, unit });
          continue;
        }

        orderCost += lineItemCost(
          qty,
          Number(li.price),
          manualCost ?? variantCost ?? li.unit_cost,
          fallbackCostPct,
        );
      }

      // Tiered single products, priced on their per-order quantity.
      for (const [pid, { qty, unit }] of tieredProdQty)
        orderCost += tieredCost(qty, unit, productTiers.get(pid)!);
      // Collections, priced on the combined quantity across their products.
      for (const [cid, qty] of collectionQty) {
        const info = collectionInfo.get(cid);
        if (info) orderCost += tieredCost(qty, info.baseUnit, info.tiers);
      }

      day.productCost += orderCost;
    }

    // Ad spend from the accounts mapped to THIS store.
    for (const c of metaByStore.get(storeId) ?? []) {
      const day = days.get(c.date);
      if (!day) continue;
      day.adSpend += Number(c.spend);
      day.adSpendMeta += Number(c.spend);
      day.purchaseValue += Number(c.purchase_value);
      day.adClicks += Number(c.clicks);
    }
    for (const c of googleByStore.get(storeId) ?? []) {
      const day = days.get(c.date);
      if (!day) continue;
      day.adSpend += Number(c.spend);
      day.adSpendGoogle += Number(c.spend);
      day.purchaseValue += Number(c.purchase_value);
      day.adClicks += Number(c.clicks);
    }

    // Compute this store's row for each day.
    for (const [date, acc] of days) {
      const p = computeProfit(
        {
          grossRevenue: acc.grossRevenue,
          shippingRevenue: acc.shippingRevenue,
          refunds: acc.refunds,
          productCost: acc.productCost,
          ordersTotalValue: acc.ordersTotalValue,
          ordersCount: acc.ordersCount,
          adSpend: acc.adSpend,
        },
        profitSettingsBase,
      );

      // Manual per-day profit/expense adjustment — only on the primary store.
      const manualNet = isPrimaryStore ? manualByDay.get(date) ?? 0 : 0;
      const profit = round2(p.profit + manualNet);
      const profitMargin = p.revenue > 0 ? round4(profit / p.revenue) : 0;

      // ROAS = real (net revenue ÷ ad spend), not Meta's attributed value.
      const roas = acc.adSpend > 0 ? p.revenue / acc.adSpend : 0;
      const mer = acc.adSpend > 0 ? p.revenue / acc.adSpend : 0;
      const aov = acc.ordersCount > 0 ? p.revenue / acc.ordersCount : 0;
      const cac = acc.ordersCount > 0 ? acc.adSpend / acc.ordersCount : 0;
      const conversionRate =
        acc.adClicks > 0 ? acc.ordersCount / acc.adClicks : 0;

      rows.push({
        user_id: userId,
        shopify_connection_id: storeId,
        date,
        gross_revenue: round2(acc.grossRevenue),
        refunds: round2(acc.refunds),
        discounts: round2(acc.discounts),
        shipping_revenue: round2(acc.shippingRevenue),
        revenue: p.revenue,
        product_cost: p.productCost,
        shipping_cost: p.shippingCost,
        payment_fees: p.paymentFees,
        ad_spend: p.adSpend,
        ad_spend_meta: round2(acc.adSpendMeta),
        ad_spend_google: round2(acc.adSpendGoogle),
        profit,
        profit_margin: profitMargin,
        manual_adjustment: round2(manualNet),
        roas: round4(roas),
        mer: round4(mer),
        cac: round2(cac),
        orders_count: acc.ordersCount,
        units_sold: acc.unitsSold,
        ad_clicks: acc.adClicks,
        aov: round2(aov),
        conversion_rate: round4(conversionRate),
      });
    }
  }

  if (rows.length > 0) {
    const { error } = await supabase
      .from("daily_metrics")
      .upsert(rows, { onConflict: "user_id,shopify_connection_id,date" });
    if (error) {
      // `manual_adjustment` (migration 0022) may not exist yet — retry without
      // it so profit (which already folds the adjustment in) still persists.
      const code = (error as { code?: string }).code;
      const missingCol =
        code === "42703" || /manual_adjustment/.test(error.message ?? "");
      if (!missingCol) throw error;
      const stripped = rows.map(({ manual_adjustment: _drop, ...r }) => r);
      const { error: e2 } = await supabase
        .from("daily_metrics")
        .upsert(stripped, { onConflict: "user_id,shopify_connection_id,date" });
      if (e2) throw e2;
    }
  }

  return rows.length;
}

/** Sum a set of daily_metrics rows into a single summary. */
export function summarize(
  rows: Database["public"]["Tables"]["daily_metrics"]["Row"][],
): MetricsSummary {
  const acc = rows.reduce(
    (a, r) => {
      a.revenue += Number(r.revenue);
      a.grossRevenue += Number(r.gross_revenue);
      a.refunds += Number(r.refunds);
      a.adSpend += Number(r.ad_spend);
      a.adSpendMeta += Number(r.ad_spend_meta);
      a.adSpendGoogle += Number(r.ad_spend_google);
      a.productCost += Number(r.product_cost);
      a.shippingCost += Number(r.shipping_cost);
      a.paymentFees += Number(r.payment_fees);
      a.profit += Number(r.profit);
      a.ordersCount += Number(r.orders_count);
      a.unitsSold += Number(r.units_sold);
      a.adClicks += Number(r.ad_clicks);
      a.conversionValue += Number(r.roas) * Number(r.ad_spend);
      return a;
    },
    {
      revenue: 0,
      grossRevenue: 0,
      refunds: 0,
      adSpend: 0,
      adSpendMeta: 0,
      adSpendGoogle: 0,
      productCost: 0,
      shippingCost: 0,
      paymentFees: 0,
      profit: 0,
      ordersCount: 0,
      unitsSold: 0,
      adClicks: 0,
      conversionValue: 0,
    },
  );

  const profitMargin = acc.revenue > 0 ? acc.profit / acc.revenue : 0;
  // ROAS = REAL return: actual (net) revenue ÷ ad spend, not Meta's attributed
  // value (which under-counts). This makes ROAS the true blended return.
  const roas = acc.adSpend > 0 ? acc.revenue / acc.adSpend : 0;
  const mer = acc.adSpend > 0 ? acc.revenue / acc.adSpend : 0;
  const aov = acc.ordersCount > 0 ? acc.revenue / acc.ordersCount : 0;
  const conversionRate = acc.adClicks > 0 ? acc.ordersCount / acc.adClicks : 0;

  return {
    revenue: round2(acc.revenue),
    grossRevenue: round2(acc.grossRevenue),
    refunds: round2(acc.refunds),
    adSpend: round2(acc.adSpend),
    adSpendMeta: round2(acc.adSpendMeta),
    adSpendGoogle: round2(acc.adSpendGoogle),
    productCost: round2(acc.productCost),
    shippingCost: round2(acc.shippingCost),
    paymentFees: round2(acc.paymentFees),
    profit: round2(acc.profit),
    profitMargin: round4(profitMargin),
    roas: round4(roas),
    mer: round4(mer),
    ordersCount: acc.ordersCount,
    unitsSold: acc.unitsSold,
    aov: round2(aov),
    conversionRate: round4(conversionRate),
    conversionValue: round2(acc.conversionValue),
  };
}
