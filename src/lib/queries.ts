import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/types/database";
import type {
  DateRange,
  MetricsSummary,
  ProductPerformance,
  CampaignPerformance,
} from "@/types";
import { summarize } from "@/lib/metrics";
import { getCurrentRate } from "@/lib/fx";
import { lineItemCost, round2 } from "@/lib/profit";
import { selectAllByUser } from "@/lib/supabase/paginate";
import {
  comparisonRanges,
  lastNDays,
  zonedRangeUtc,
  type ComparisonPeriod,
} from "@/lib/date";

type DB = SupabaseClient<Database>;

export async function getSettings(
  supabase: DB,
  userId: string,
): Promise<Tables<"settings"> | null> {
  const { data } = await supabase
    .from("settings")
    .select("*")
    .eq("user_id", userId)
    .single();
  return data;
}

/** Detect the store's native currency from its synced orders (e.g. "CZK"). */
export async function getStoreCurrency(
  supabase: DB,
  userId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("orders")
    .select("currency")
    .eq("user_id", userId)
    .not("currency", "is", null)
    .order("processed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.currency ?? null;
}

/**
 * Resolve the FX multiplier (store currency → display currency) automatically.
 * Returns 1 when currencies match or the store currency is unknown.
 */
export async function resolveFxRate(
  supabase: DB,
  userId: string,
  displayCurrency: string,
): Promise<number> {
  const store = await getStoreCurrency(supabase, userId);
  if (!store || store.toUpperCase() === displayCurrency.toUpperCase()) return 1;
  return getCurrentRate(store, displayCurrency);
}

async function metricsRows(
  supabase: DB,
  userId: string,
  range: DateRange,
): Promise<Tables<"daily_metrics">[]> {
  const { data } = await supabase
    .from("daily_metrics")
    .select("*")
    .eq("user_id", userId)
    .gte("date", range.from)
    .lte("date", range.to)
    .order("date", { ascending: true });
  return data ?? [];
}

export interface PeriodComparison {
  current: MetricsSummary;
  previous: MetricsSummary;
}

/** Convert the monetary fields of a summary by an FX multiplier (ratios untouched). */
function scaleSummary(s: MetricsSummary, fx: number): MetricsSummary {
  if (fx === 1) return s;
  return {
    ...s,
    revenue: round2(s.revenue * fx),
    grossRevenue: round2(s.grossRevenue * fx),
    refunds: round2(s.refunds * fx),
    adSpend: round2(s.adSpend * fx),
    adSpendMeta: round2(s.adSpendMeta * fx),
    adSpendGoogle: round2(s.adSpendGoogle * fx),
    productCost: round2(s.productCost * fx),
    shippingCost: round2(s.shippingCost * fx),
    paymentFees: round2(s.paymentFees * fx),
    profit: round2(s.profit * fx),
    aov: round2(s.aov * fx),
    conversionValue: round2(s.conversionValue * fx),
  };
}

export async function getComparison(
  supabase: DB,
  userId: string,
  period: ComparisonPeriod,
  timezone: string,
  fxRate = 1,
): Promise<PeriodComparison> {
  const { current, previous } = comparisonRanges(period, timezone);
  return getRangeComparison(supabase, userId, current, previous, fxRate);
}

/** Summarise current + previous for arbitrary explicit ranges. */
export async function getRangeComparison(
  supabase: DB,
  userId: string,
  current: DateRange,
  previous: DateRange,
  fxRate = 1,
): Promise<PeriodComparison> {
  const [cur, prev] = await Promise.all([
    metricsRows(supabase, userId, current),
    metricsRows(supabase, userId, previous),
  ]);
  return {
    current: scaleSummary(summarize(cur), fxRate),
    previous: scaleSummary(summarize(prev), fxRate),
  };
}

export interface DailyPoint {
  date: string;
  revenue: number;
  adSpend: number;
  profit: number;
  roas: number;
  orders: number;
}

export async function getDailySeries(
  supabase: DB,
  userId: string,
  days: number,
  timezone: string,
  fxRate = 1,
): Promise<DailyPoint[]> {
  const rows = await metricsRows(supabase, userId, lastNDays(days, timezone));
  const byDate = new Map(rows.map((r) => [r.date, r]));
  // Fill gaps so the chart has a continuous axis.
  const range = lastNDays(days, timezone);
  const out: DailyPoint[] = [];
  const cursor = new Date(`${range.from}T00:00:00Z`);
  const end = new Date(`${range.to}T00:00:00Z`);
  while (cursor <= end) {
    const ymd = cursor.toISOString().slice(0, 10);
    const r = byDate.get(ymd);
    out.push({
      date: ymd,
      revenue: round2(Number(r?.revenue ?? 0) * fxRate),
      adSpend: round2(Number(r?.ad_spend ?? 0) * fxRate),
      profit: round2(Number(r?.profit ?? 0) * fxRate),
      // ROAS = real: net revenue ÷ ad spend (ratio, FX-invariant).
      roas:
        Number(r?.ad_spend ?? 0) > 0
          ? Number(r?.revenue ?? 0) / Number(r?.ad_spend ?? 0)
          : 0,
      orders: Number(r?.orders_count ?? 0),
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Products                                                            */
/* ------------------------------------------------------------------ */

export type ProductSort = "best" | "profit" | "worst";

export async function getProductPerformance(
  supabase: DB,
  userId: string,
  range: DateRange,
  sort: ProductSort,
  timezone: string,
  fallbackCostPct: number,
  fxRate = 1,
): Promise<ProductPerformance[]> {
  const { startUtc, endUtc } = zonedRangeUtc(range, timezone);

  // 1. Orders within the window.
  const { data: orderRows } = await supabase
    .from("orders")
    .select("id")
    .eq("user_id", userId)
    .gte("processed_at", startUtc)
    .lt("processed_at", endUtc);
  const orderIds = (orderRows ?? []).map((o) => o.id);

  // 2. Their line items (chunked to keep URLs short).
  const lines: {
    shopify_variant_id: string | null;
    shopify_product_id: string | null;
    title: string | null;
    sku: string | null;
    quantity: number;
    price: number;
    total_discount: number;
    unit_cost: number | null;
  }[] = [];
  for (let i = 0; i < orderIds.length; i += 200) {
    const chunk = orderIds.slice(i, i + 200);
    const { data } = await supabase
      .from("order_line_items")
      .select(
        "shopify_variant_id, shopify_product_id, title, sku, quantity, price, total_discount, unit_cost",
      )
      .in("order_id", chunk);
    if (data) lines.push(...data);
  }

  // Product images / titles / Shopify cost + manual per-product COGS.
  const [products, { data: manualCosts }] = await Promise.all([
    selectAllByUser<{
      shopify_variant_id: string;
      title: string | null;
      image_url: string | null;
      cost: number | null;
    }>(supabase, "products", "shopify_variant_id, title, image_url, cost", userId),
    supabase
      .from("product_costs")
      .select("shopify_product_id, cost")
      .eq("user_id", userId),
  ]);
  const productMeta = new Map(
    (products ?? []).map((p) => [
      p.shopify_variant_id,
      {
        title: p.title,
        image: p.image_url,
        cost: p.cost != null ? Number(p.cost) : null,
      },
    ]),
  );
  const costByProduct = new Map(
    (manualCosts ?? []).map((m) => [m.shopify_product_id, Number(m.cost)]),
  );

  const agg = new Map<string, ProductPerformance>();
  for (const li of lines ?? []) {
    const key = li.shopify_variant_id ?? `unknown:${li.title}`;
    const qty = Number(li.quantity);
    const revenue = qty * Number(li.price) - Number(li.total_discount);
    // Manual COGS first, then Shopify variant cost, then snapshot, then %.
    const manualCost = li.shopify_product_id
      ? costByProduct.get(li.shopify_product_id)
      : undefined;
    const variantCost = productMeta.get(key)?.cost;
    const cost = lineItemCost(
      qty,
      Number(li.price),
      manualCost ?? variantCost ?? li.unit_cost,
      fallbackCostPct,
    );
    const existing =
      agg.get(key) ??
      ({
        productId: li.shopify_product_id ?? "",
        variantId: li.shopify_variant_id ?? "",
        title: productMeta.get(key)?.title ?? li.title ?? "Unknown product",
        sku: li.sku ?? null,
        imageUrl: productMeta.get(key)?.image ?? null,
        unitsSold: 0,
        revenue: 0,
        cost: 0,
        profit: 0,
        margin: 0,
      } satisfies ProductPerformance);
    existing.unitsSold += qty;
    existing.revenue += revenue;
    existing.cost += cost;
    agg.set(key, existing);
  }

  const rows = [...agg.values()].map((p) => {
    const revenue = p.revenue;
    const cost = p.cost;
    const profit = revenue - cost;
    p.margin = revenue > 0 ? profit / revenue : 0; // ratio, FX-invariant
    p.revenue = round2(revenue * fxRate);
    p.cost = round2(cost * fxRate);
    p.profit = round2(profit * fxRate);
    return p;
  });

  rows.sort((a, b) => {
    if (sort === "best") return b.unitsSold - a.unitsSold;
    if (sort === "worst") return a.profit - b.profit;
    return b.profit - a.profit; // "profit"
  });

  return rows.slice(0, 200);
}

/* ------------------------------------------------------------------ */
/* Campaigns                                                           */
/* ------------------------------------------------------------------ */

export async function getCampaignPerformance(
  supabase: DB,
  userId: string,
  range: DateRange,
  search?: string,
  fxRate = 1,
  table: "campaigns" | "google_campaigns" = "campaigns",
): Promise<CampaignPerformance[]> {
  let query = supabase
    .from(table)
    .select(
      "campaign_id, campaign_name, spend, impressions, clicks, purchases, purchase_value",
    )
    .eq("user_id", userId)
    .gte("date", range.from)
    .lte("date", range.to);

  if (search && search.trim()) {
    query = query.ilike("campaign_name", `%${search.trim()}%`);
  }

  const { data } = await query;

  const agg = new Map<string, CampaignPerformance & { _imp: number }>();
  for (const c of data ?? []) {
    const key = c.campaign_id;
    const existing =
      agg.get(key) ??
      ({
        campaignId: key,
        name: c.campaign_name ?? key,
        spend: 0,
        impressions: 0,
        clicks: 0,
        ctr: 0,
        cpm: 0,
        cpc: 0,
        cpa: 0,
        purchases: 0,
        revenue: 0,
        profit: 0,
        roas: 0,
        _imp: 0,
      } as CampaignPerformance & { _imp: number });
    existing.spend += Number(c.spend);
    existing.impressions += Number(c.impressions);
    existing.clicks += Number(c.clicks);
    existing.purchases += Number(c.purchases);
    existing.revenue += Number(c.purchase_value);
    agg.set(key, existing);
  }

  const rows = [...agg.values()].map((c) => {
    const spend = c.spend;
    const revenue = c.revenue;
    // Ratios are FX-invariant; compute from raw amounts.
    c.ctr = c.impressions > 0 ? (c.clicks / c.impressions) * 100 : 0;
    c.roas = spend > 0 ? revenue / spend : 0;
    const cpm = c.impressions > 0 ? (spend / c.impressions) * 1000 : 0;
    const cpc = c.clicks > 0 ? spend / c.clicks : 0;
    const cpa = c.purchases > 0 ? spend / c.purchases : 0;
    // Monetary fields scaled to the display currency.
    c.spend = round2(spend * fxRate);
    c.revenue = round2(revenue * fxRate);
    c.cpm = round2(cpm * fxRate);
    c.cpc = round2(cpc * fxRate);
    c.cpa = round2(cpa * fxRate);
    c.profit = round2((revenue - spend) * fxRate); // ad contribution
    return c;
  });

  rows.sort((a, b) => b.spend - a.spend);
  return rows;
}

/* ------------------------------------------------------------------ */
/* Connections                                                         */
/* ------------------------------------------------------------------ */

export async function getConnections(supabase: DB, userId: string) {
  const [{ data: shopify }, { data: meta }, { data: google }] = await Promise.all([
    supabase
      .from("shopify_connections")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: true }),
    supabase
      .from("meta_connections")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: true }),
    supabase
      .from("google_connections")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: true }),
  ]);
  return { shopify: shopify ?? [], meta: meta ?? [], google: google ?? [] };
}

/* ------------------------------------------------------------------ */
/* COGS                                                                */
/* ------------------------------------------------------------------ */

export interface CogsProduct {
  productId: string;
  title: string;
  sku: string | null;
  imageUrl: string | null;
  price: number; // representative selling price in display currency
  cost: number | null; // current (latest effective) cost in display currency
  costSource: string;
  costHistory: { effectiveFrom: string; cost: number }[]; // dated costs, ascending, in display currency
  variantCount: number;
  sold: boolean; // has at least one order line item
}

/**
 * Products for the COGS editor — grouped by product (one row per product, not
 * per variant). Price/cost converted to the display currency.
 */
export async function getProductsForCogs(
  supabase: DB,
  userId: string,
  storeToDisplay: number,
): Promise<CogsProduct[]> {
  const [prods, soldLines, { data: manual }] = await Promise.all([
    selectAllByUser<{
      shopify_product_id: string;
      title: string | null;
      sku: string | null;
      price: number;
      cost: number | null;
      image_url: string | null;
    }>(
      supabase,
      "products",
      "shopify_product_id, title, sku, price, cost, image_url",
      userId,
    ),
    selectAllByUser<{
      shopify_product_id: string | null;
      title: string | null;
      sku: string | null;
      price: number;
    }>(
      supabase,
      "order_line_items",
      "shopify_product_id, title, sku, price",
      userId,
      (q) => q.not("shopify_product_id", "is", null),
    ),
    supabase
      .from("product_costs")
      .select("shopify_product_id, cost, effective_from, currency")
      .eq("user_id", userId),
  ]);

  // Effective-dated manual costs, ascending by date, converted to the display
  // currency. A cost stored in the display currency (currency != null) is shown
  // EXACTLY as entered; a legacy base-currency cost (currency == null) is scaled.
  const toDisplay = (cost: number, currency: string | null): number =>
    currency == null ? round2(cost * storeToDisplay) : round2(cost);
  const manualByProduct = new Map<
    string,
    { effectiveFrom: string; cost: number }[]
  >();
  for (const m of manual ?? []) {
    const list = manualByProduct.get(m.shopify_product_id) ?? [];
    list.push({
      effectiveFrom: m.effective_from,
      cost: toDisplay(Number(m.cost), m.currency),
    });
    manualByProduct.set(m.shopify_product_id, list);
  }
  for (const list of manualByProduct.values())
    list.sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));

  interface Agg {
    productId: string;
    title: string;
    sku: string | null;
    imageUrl: string | null;
    priceStore: number;
    shopifyCostStore: number | null;
    variantCount: number;
    sold: boolean;
  }
  const byProduct = new Map<string, Agg>();

  // From the synced catalog (image, variants, Shopify cost).
  for (const p of prods ?? []) {
    const id = p.shopify_product_id;
    const ex = byProduct.get(id);
    if (!ex) {
      byProduct.set(id, {
        productId: id,
        title: p.title ?? "Sem nome",
        sku: p.sku,
        imageUrl: p.image_url,
        priceStore: Number(p.price),
        shopifyCostStore: p.cost != null ? Number(p.cost) : null,
        variantCount: 1,
        sold: false,
      });
    } else {
      ex.variantCount += 1;
      if (ex.shopifyCostStore == null && p.cost != null) {
        ex.shopifyCostStore = Number(p.cost);
      }
    }
  }

  // From orders — include any sold product, even if not in the catalog.
  for (const li of soldLines ?? []) {
    const id = li.shopify_product_id as string;
    const ex = byProduct.get(id);
    if (!ex) {
      byProduct.set(id, {
        productId: id,
        title: li.title ?? "Produto vendido",
        sku: li.sku,
        imageUrl: null,
        priceStore: Number(li.price),
        shopifyCostStore: null,
        variantCount: 1,
        sold: true,
      });
    } else {
      ex.sold = true;
    }
  }

  const result = [...byProduct.values()].map((g) => {
    const history = manualByProduct.get(g.productId) ?? [];
    // Current cost = the most recent effective manual entry, shown exactly.
    const current = history.length > 0 ? history[history.length - 1] : null;
    const cost =
      current != null
        ? current.cost
        : g.shopifyCostStore == null
          ? null
          : round2(g.shopifyCostStore * storeToDisplay);
    return {
      productId: g.productId,
      title: g.title,
      sku: g.sku,
      imageUrl: g.imageUrl,
      price: round2(g.priceStore * storeToDisplay),
      cost,
      costSource: current != null ? "manual" : "shopify",
      costHistory: history,
      variantCount: g.variantCount,
      sold: g.sold,
    };
  });

  result.sort((a, b) => a.title.localeCompare(b.title));
  return result;
}
