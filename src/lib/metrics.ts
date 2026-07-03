import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { DateRange, MetricsSummary } from "@/types";
import { computeProfit, lineItemCost, round2, round4 } from "@/lib/profit";
import { ymdInTz, zonedRangeUtc, eachDay } from "@/lib/date";
import { getCurrentRate } from "@/lib/fx";
import { selectAllByUser } from "@/lib/supabase/paginate";

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
): Promise<number> {
  // 1. Load this user's cost settings.
  const { data: settings } = await supabase
    .from("settings")
    .select("*")
    .eq("user_id", userId)
    .single();

  const timezone = settings?.timezone ?? "UTC";
  const fallbackCostPct = Number(settings?.default_product_cost_pct ?? 30);
  const profitSettings = {
    payment_fee_pct: Number(settings?.payment_fee_pct ?? 2.9),
    payment_fee_fixed: Number(settings?.payment_fee_fixed ?? 0.3),
    default_shipping_cost: Number(settings?.default_shipping_cost ?? 0),
  };

  const { startUtc, endUtc } = zonedRangeUtc(range, timezone);

  // 2. Orders within the window (exclude test + cancelled).
  const { data: orders, error: ordersErr } = await supabase
    .from("orders")
    .select(
      "id, processed_at, subtotal_price, total_price, total_shipping, total_discounts, total_refunded, test, cancelled_at",
    )
    .eq("user_id", userId)
    .gte("processed_at", startUtc)
    .lt("processed_at", endUtc);
  if (ordersErr) throw ordersErr;

  const orderRows = (orders ?? []).filter((o) => !o.test && !o.cancelled_at);
  const orderIds = orderRows.map((o) => o.id);
  const orderDay = new Map<string, string>(); // order.id -> local ymd
  for (const o of orderRows) {
    orderDay.set(o.id, ymdInTz(new Date(o.processed_at), timezone));
  }

  // 3a. Cost lookups (manual per-product COGS takes priority, then Shopify
  //     per-variant cost, then the snapshot, then the % fallback).
  const [productCosts, { data: manualCosts }] = await Promise.all([
    selectAllByUser<{ shopify_variant_id: string; cost: number | null }>(
      supabase,
      "products",
      "shopify_variant_id, cost",
      userId,
      (q) => q.not("cost", "is", null),
    ),
    supabase
      .from("product_costs")
      .select("shopify_product_id, cost, effective_from, currency")
      .eq("user_id", userId),
  ]);
  const costByVariant = new Map(
    (productCosts ?? []).map((p) => [p.shopify_variant_id, Number(p.cost)]),
  );

  // Effective-dated manual COGS. Costs may be stored in the DISPLAY currency
  // (currency != null) and must be converted to the store's base currency to
  // line up with everything else. Resolve the base→display rate once.
  const displayCurrency = settings?.currency ?? "USD";
  const { data: curRow } = await supabase
    .from("orders")
    .select("currency")
    .eq("user_id", userId)
    .not("currency", "is", null)
    .order("processed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const storeCurrency = curRow?.currency ?? null;
  const storeToDisplay =
    storeCurrency && storeCurrency.toUpperCase() !== displayCurrency.toUpperCase()
      ? await getCurrentRate(storeCurrency, displayCurrency)
      : 1;

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

  // 3b. Line items for those orders (chunked to stay within URL limits).
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

  // 4. Meta + Google campaigns within the range (already date-bucketed).
  const [{ data: campaigns, error: campErr }, { data: googleCampaigns, error: gErr }] =
    await Promise.all([
      supabase
        .from("campaigns")
        .select("date, spend, purchase_value, clicks")
        .eq("user_id", userId)
        .gte("date", range.from)
        .lte("date", range.to),
      supabase
        .from("google_campaigns")
        .select("date, spend, purchase_value, clicks")
        .eq("user_id", userId)
        .gte("date", range.from)
        .lte("date", range.to),
    ]);
  if (campErr) throw campErr;
  if (gErr) throw gErr;

  // 5. Bucket everything by local day.
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

  for (const li of lineItems) {
    const oid = li.order_id;
    const ymd = orderDay.get(oid);
    if (!ymd) continue;
    const day = days.get(ymd);
    if (!day) continue;
    day.unitsSold += Number(li.quantity);
    // Manual COGS (effective on the order's day) first, then Shopify variant
    // cost, then snapshot, then %.
    const manualCost = li.shopify_product_id
      ? manualCostFor(li.shopify_product_id, ymd)
      : undefined;
    const variantCost = li.shopify_variant_id
      ? costByVariant.get(li.shopify_variant_id)
      : undefined;
    day.productCost += lineItemCost(
      Number(li.quantity),
      Number(li.price),
      manualCost ?? variantCost ?? li.unit_cost,
      fallbackCostPct,
    );
  }

  for (const c of campaigns ?? []) {
    const day = days.get(c.date);
    if (!day) continue;
    day.adSpend += Number(c.spend);
    day.adSpendMeta += Number(c.spend);
    day.purchaseValue += Number(c.purchase_value);
    day.adClicks += Number(c.clicks);
  }

  for (const c of googleCampaigns ?? []) {
    const day = days.get(c.date);
    if (!day) continue;
    day.adSpend += Number(c.spend);
    day.adSpendGoogle += Number(c.spend);
    day.purchaseValue += Number(c.purchase_value);
    day.adClicks += Number(c.clicks);
  }

  // 6. Compute + upsert.
  const rows = [];
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
      profitSettings,
    );

    // ROAS = real (net revenue ÷ ad spend), not Meta's attributed value.
    const roas = acc.adSpend > 0 ? p.revenue / acc.adSpend : 0;
    const mer = acc.adSpend > 0 ? p.revenue / acc.adSpend : 0;
    const aov = acc.ordersCount > 0 ? p.revenue / acc.ordersCount : 0;
    const cac = acc.ordersCount > 0 ? acc.adSpend / acc.ordersCount : 0;
    const conversionRate =
      acc.adClicks > 0 ? acc.ordersCount / acc.adClicks : 0;

    rows.push({
      user_id: userId,
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
      profit: p.profit,
      profit_margin: p.profitMargin,
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

  if (rows.length > 0) {
    const { error } = await supabase
      .from("daily_metrics")
      .upsert(rows, { onConflict: "user_id,date" });
    if (error) throw error;
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
