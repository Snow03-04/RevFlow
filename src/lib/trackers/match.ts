import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { getStoreCurrency, getStoreFxRates } from "@/lib/queries";
import { resolveFx } from "@/lib/fx";
import { round2 } from "@/lib/profit";
import { selectAllByUser } from "@/lib/supabase/paginate";
import { ymdInTz, zonedRangeUtc } from "@/lib/date";
import type { DateRange } from "@/types";

type DB = SupabaseClient<Database>;

const SYMBOL_TO_ISO: Record<string, string> = {
  "€": "EUR",
  $: "USD",
  "£": "GBP",
};

export interface ProductMatch {
  productId: string | null;
  price: number;
  cog: number;
  via: "handle" | "name"; // how the campaign was resolved to this product
  score: number; // match confidence — handle wins; among names, more shared words
}

// Handle matches (from the ad's destination URL) are authoritative, so they
// outrank any name match when two campaigns fight over the same product's sales.
const HANDLE_SCORE = 1000;

export interface MatchProduct {
  productId: string;
  storeId: string | null;
  handle: string | null;
  title: string | null;
  price: number;
  cost: number | null;
}

/** Strip accents + lowercase, so "Célima" matches "celima". */
function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** Significant words (>= 4 chars) — drops noise like "cbo", "the", "-", "|". */
function tokenize(s: string): string[] {
  return normalize(s)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4);
}

/**
 * Build a matcher that maps a campaign name to a Shopify product. Campaigns are
 * named after the product they advertise (e.g. "CBO - Lara | Pohodlné…"), so we
 * match on shared significant WORDS rather than the full title — picking the
 * product that shares the most words with the campaign name. Returns price + COG
 * in the STORE currency; the caller applies FX.
 */
export function buildProductMatcher(products: MatchProduct[]) {
  const items = products
    .map((p) => ({
      productId: p.productId,
      tokens: new Set(tokenize(p.title ?? "")),
      price: Number(p.price),
      cog: p.cost != null ? Number(p.cost) : 0,
    }))
    .filter((it) => it.tokens.size > 0);

  return (campaignName: string): ProductMatch | null => {
    const camp = new Set(tokenize(campaignName));
    if (camp.size === 0) return null;

    let best: ProductMatch | null = null;
    let bestKey: [number, number, number] = [0, 0, 0]; // [shared, hasCost, longest]
    for (const it of items) {
      let shared = 0;
      let longest = 0;
      for (const t of it.tokens) {
        if (camp.has(t)) {
          shared++;
          if (t.length > longest) longest = t.length;
        }
      }
      if (shared === 0) continue;
      const key: [number, number, number] = [shared, it.cog > 0 ? 1 : 0, longest];
      if (
        key[0] > bestKey[0] ||
        (key[0] === bestKey[0] && key[1] > bestKey[1]) ||
        (key[0] === bestKey[0] && key[1] === bestKey[1] && key[2] > bestKey[2])
      ) {
        best = {
          productId: it.productId,
          price: it.price,
          cog: it.cog,
          via: "name",
          score: key[0], // number of shared significant words
        };
        bestKey = key;
      }
    }
    return best;
  };
}

/**
 * Fetch the product catalogue with the **manual COGS** (from the Custos page)
 * taking priority over the Shopify per-variant cost. All amounts are in the
 * store's base currency. One entry per product (price/handle from its first
 * variant), including sold-only products pulled from line items.
 */
export async function fetchMatcherProducts(
  supabase: DB,
  userId: string,
): Promise<MatchProduct[]> {
  const [products, lineItems, { data: manual }, { data: mset }] =
    await Promise.all([
      fetchProductsWithHandle(supabase, userId),
      // Sold products may not be in the catalogue (dropshipping tools etc.);
      // pull their title/price from line items so they can still be matched +
      // costed, and embed the order so a sold-only product can still be
      // attributed to its store (same shape as getProductsForCogs).
      selectAllByUser<{
        shopify_product_id: string | null;
        title: string | null;
        price: number;
        orders: { shopify_connection_id: string | null } | null;
      }>(
        supabase,
        "order_line_items",
        "shopify_product_id, title, price, orders(shopify_connection_id)",
        userId,
        (q) => q.not("shopify_product_id", "is", null),
      ),
      supabase
        .from("product_costs")
        .select("shopify_product_id, cost, effective_from, currency")
        .eq("user_id", userId),
      supabase.from("settings").select("*").eq("user_id", userId).maybeSingle(),
    ]);

  // product -> store, from the catalogue or (for a sold-only product) its
  // order's store — same pattern as getProductsForCogs. Needed because manual
  // costs may be stored in the DISPLAY currency and must convert back to THAT
  // product's own store's base currency (what MatchProduct.cost is expected to
  // be in) — a single blended rate corrupted every product from whichever
  // store didn't happen to have the most recently synced order.
  const productStore = new Map<string, string | null>();
  for (const p of products ?? [])
    if (!productStore.has(p.shopify_product_id))
      productStore.set(p.shopify_product_id, p.shopify_connection_id);
  for (const li of lineItems ?? []) {
    const id = li.shopify_product_id as string;
    if (!productStore.get(id) && li.orders?.shopify_connection_id)
      productStore.set(id, li.orders.shopify_connection_id);
  }

  const displayCurrency = mset?.currency ?? "USD";
  const storeRates = await getStoreFxRates(
    supabase,
    userId,
    displayCurrency,
    mset?.fx_rate_override,
  );
  /** display→base multiplier for the store a product belongs to (1 if unknown). */
  const baseRateOf = (productId: string): number => {
    const storeToDisplay = storeRates.get(productStore.get(productId) ?? "");
    return storeToDisplay && storeToDisplay > 0 ? 1 / storeToDisplay : 1;
  };

  const byProduct = new Map<string, MatchProduct>();

  for (const p of products ?? []) {
    if (!p.shopify_product_id) continue;
    const ex = byProduct.get(p.shopify_product_id);
    if (!ex) {
      // Keep the FIRST variant's price + first non-null cost, so the ROAS Price
      // matches what the Custos page shows for the same product.
      byProduct.set(p.shopify_product_id, {
        productId: p.shopify_product_id,
        storeId: p.shopify_connection_id,
        handle: p.handle ?? null,
        title: p.title,
        price: Number(p.price),
        cost: p.cost != null ? Number(p.cost) : null,
      });
    } else {
      if (!ex.title && p.title) ex.title = p.title;
      if (!ex.handle && p.handle) ex.handle = p.handle;
      if (ex.cost == null && p.cost != null) ex.cost = Number(p.cost);
    }
  }

  for (const li of lineItems ?? []) {
    if (!li.shopify_product_id) continue;
    const ex = byProduct.get(li.shopify_product_id);
    if (!ex) {
      byProduct.set(li.shopify_product_id, {
        productId: li.shopify_product_id,
        storeId: productStore.get(li.shopify_product_id) ?? null,
        handle: null,
        title: li.title,
        price: Number(li.price),
        cost: null,
      });
    } else if (!ex.title && li.title) {
      ex.title = li.title;
    }
  }

  // Manual COGS (Custos page) wins over the Shopify cost. Pick the LATEST
  // effective-dated entry per product and normalise it to ITS OWN store's
  // base currency.
  const latestManual = new Map<string, { from: string; costBase: number }>();
  for (const m of manual ?? []) {
    const costBase =
      m.currency == null
        ? Number(m.cost)
        : round2(Number(m.cost) * baseRateOf(m.shopify_product_id));
    const cur = latestManual.get(m.shopify_product_id);
    if (!cur || m.effective_from > cur.from) {
      latestManual.set(m.shopify_product_id, {
        from: m.effective_from,
        costBase,
      });
    }
  }
  for (const [productId, { costBase }] of latestManual) {
    const ex = byProduct.get(productId);
    if (ex) ex.cost = costBase;
    else
      byProduct.set(productId, {
        productId,
        storeId: productStore.get(productId) ?? null,
        handle: null,
        title: null,
        price: 0,
        cost: costBase,
      });
  }

  return [...byProduct.values()];
}

/**
 * Load products with their handle, degrading gracefully if migration 0011
 * (the `handle` column) hasn't been applied yet — falls back to no handle so
 * matching still works by name until the migration is run.
 */
async function fetchProductsWithHandle(
  supabase: DB,
  userId: string,
): Promise<
  {
    shopify_product_id: string;
    shopify_connection_id: string | null;
    handle: string | null;
    title: string | null;
    price: number;
    cost: number | null;
  }[]
> {
  try {
    return await selectAllByUser(
      supabase,
      "products",
      "shopify_product_id, shopify_connection_id, handle, title, price, cost",
      userId,
    );
  } catch {
    const rows = await selectAllByUser<{
      shopify_product_id: string;
      shopify_connection_id: string | null;
      title: string | null;
      price: number;
      cost: number | null;
    }>(
      supabase,
      "products",
      "shopify_product_id, shopify_connection_id, title, price, cost",
      userId,
    );
    return rows.map((r) => ({ ...r, handle: null }));
  }
}

export interface DaySales {
  orders: number;
  units: number;
  revenue: number; // NET (price*qty − discounts), in store currency
}

/**
 * True if an order came from GOOGLE **PAID** (Google Ads) — and ONLY paid. Google
 * ORGANIC search is deliberately NOT matched, so those sales still count in the
 * tracker. Paid signals, in order:
 *   - Google Ads auto-tagging params in the landing URL (gclid/gbraid/wbraid, or
 *     the newer gad_source/gad_campaignid) — an unambiguous paid-click signal;
 *   - a manual Google source tag (`utm_source=google|adwords`) paired with a paid
 *     medium (`utm_medium` = cpc/ppc/paid).
 * A bare Google referrer (referring_site = google.com) is organic search and is
 * NOT excluded. An empty/unknown origin is treated as NOT paid — nothing is
 * dropped without evidence (Facebook / direct / organic / other traffic stays).
 */
export function isGooglePaidOrder(landingSite: string | null): boolean {
  const ls = (landingSite ?? "").toLowerCase();
  if (!ls) return false;
  // Google Ads auto-tagging click ids — present on essentially every paid click.
  if (/[?&](gclid|gbraid|wbraid|gad_source|gad_campaignid)=/.test(ls)) return true;
  const qi = ls.indexOf("?");
  if (qi === -1) return false;
  const params = new URLSearchParams(ls.slice(qi + 1));
  const src = params.get("utm_source") ?? "";
  const medium = params.get("utm_medium") ?? "";
  // Manual tagging: only paid when the source is Google AND the medium is paid.
  return /google|adwords/.test(src) && /cpc|ppc|paid/.test(medium);
}

interface OrderOriginRow {
  id: string;
  processed_at: string;
  test: boolean;
  cancelled_at: string | null;
  landing_site: string | null;
  referring_site: string | null;
}

/**
 * Real Shopify sales per product per local day: `${shopify_product_id}:${ymd}`
 * -> { orders, units, revenue }. Shopify is the source of truth for what
 * actually sold; revenue is NET of discount codes (what the merchant received).
 *
 * Only GOOGLE **PAID** (Google Ads) orders are EXCLUDED, so a Meta campaign is
 * never credited with sales that a Google Ads click drove. Everything else counts
 * — Facebook, direct, other traffic, AND Google ORGANIC search.
 */
export async function fetchShopifySalesByProductDay(
  supabase: DB,
  userId: string,
  range: DateRange,
  timezone: string,
): Promise<Map<string, DaySales>> {
  const { startUtc, endUtc } = zonedRangeUtc(range, timezone);
  const where = (q: any) =>
    q.gte("processed_at", startUtc).lt("processed_at", endUtc);

  let orders: OrderOriginRow[];
  try {
    orders = await selectAllByUser<OrderOriginRow>(
      supabase,
      "orders",
      "id, processed_at, test, cancelled_at, landing_site, referring_site",
      userId,
      where,
    );
  } catch {
    // Migration 0021 (landing_site/referring_site) not applied yet — degrade
    // gracefully to no Google filtering so the tracker still works.
    const base = await selectAllByUser<
      Omit<OrderOriginRow, "landing_site" | "referring_site">
    >(supabase, "orders", "id, processed_at, test, cancelled_at", userId, where);
    orders = base.map((o) => ({
      ...o,
      landing_site: null,
      referring_site: null,
    }));
  }

  const valid = orders.filter(
    (o) => !o.test && !o.cancelled_at && !isGooglePaidOrder(o.landing_site),
  );
  const dayByOrder = new Map(
    valid.map((o) => [o.id, ymdInTz(new Date(o.processed_at), timezone)]),
  );
  const orderIds = valid.map((o) => o.id);

  const acc = new Map<
    string,
    { units: number; revenue: number; orderSet: Set<string> }
  >();
  for (let i = 0; i < orderIds.length; i += 200) {
    const chunk = orderIds.slice(i, i + 200);
    const { data } = await supabase
      .from("order_line_items")
      .select(
        "order_id, shopify_product_id, quantity, current_quantity, price, total_discount",
      )
      .in("order_id", chunk);
    for (const li of data ?? []) {
      if (!li.shopify_product_id) continue;
      const ymd = dayByOrder.get(li.order_id);
      if (!ymd) continue;
      // Use the current quantity (after order edits/refunds); a removed colour
      // swap sits at 0 and must not inflate ROAS units/revenue.
      const qty = Number(li.current_quantity ?? li.quantity);
      if (qty <= 0) continue;
      const key = `${li.shopify_product_id}:${ymd}`;
      const e = acc.get(key) ?? { units: 0, revenue: 0, orderSet: new Set<string>() };
      e.units += qty;
      e.revenue += Number(li.price) * qty - Number(li.total_discount ?? 0);
      e.orderSet.add(li.order_id);
      acc.set(key, e);
    }
  }

  const out = new Map<string, DaySales>();
  for (const [k, v] of acc)
    out.set(k, { orders: v.orderSet.size, units: v.units, revenue: v.revenue });
  return out;
}

/** campaign_id -> product handle, resolved from ad destination URLs. */
export async function fetchCampaignHandleMap(
  supabase: DB,
  userId: string,
): Promise<Map<string, string>> {
  const { data } = await supabase
    .from("campaign_links")
    .select("campaign_id, product_handle")
    .eq("user_id", userId);
  const m = new Map<string, string>();
  for (const r of data ?? []) {
    if (r.product_handle) m.set(r.campaign_id, r.product_handle.toLowerCase());
  }
  return m;
}

/**
 * Resolve a campaign to a product using the most reliable signal available:
 *   1. the ad destination URL's product handle (campaign_links), then
 *   2. shared significant words in the campaign name (fallback).
 * Returns price + COG in the STORE currency; the caller applies FX.
 */
export function buildResolver(
  products: MatchProduct[],
  handleMap: Map<string, string>,
) {
  const byHandle = new Map<string, ProductMatch>();
  for (const p of products) {
    if (!p.handle) continue;
    const h = p.handle.toLowerCase();
    if (!byHandle.has(h)) {
      byHandle.set(h, {
        productId: p.productId,
        price: p.price,
        cog: p.cost != null ? Number(p.cost) : 0,
        via: "handle",
        score: HANDLE_SCORE,
      });
    }
  }
  const nameMatch = buildProductMatcher(products);

  return (
    campaignId: string | null | undefined,
    campaignName: string,
  ): ProductMatch | null => {
    if (campaignId) {
      const h = handleMap.get(campaignId);
      if (h) {
        const p = byHandle.get(h);
        if (p) return p;
      }
    }
    return nameMatch(campaignName);
  };
}

/** One campaign's stake in a product's real Shopify sales for a given day. */
export interface SalesClaimant {
  campaignId: string;
  metaPurchases: number;
  spend: number;
}

/**
 * Split a product's REAL Shopify sales for one day across EVERY campaign that
 * advertised it.
 *
 * The product's sales must still be counted exactly once — several campaigns
 * resolving to one product must never each report the full day's units, which
 * would invent sales that never happened. The previous rule achieved that by
 * giving 100% to a single "winning" campaign, which is right only while one
 * campaign owns a product: the moment a merchant scales HORIZONTALLY (duplicating
 * a campaign onto the same product), every duplicate showed real spend against
 * ZERO sales — a -100% margin and a bogus KILL suggestion — while the winner's
 * ROAS was inflated by sales the other campaigns' budgets had driven.
 *
 * Shares are proportional to each campaign's Meta-reported purchases (Meta's own
 * attribution is the only per-campaign signal there is), falling back to spend
 * when Meta reports no purchases for any of them, then to an even split. Integer
 * counts are handed out by LARGEST REMAINDER, so the parts always sum EXACTLY to
 * the real total — nothing is duplicated and nothing is lost.
 */
export function splitProductSales(
  claimants: SalesClaimant[],
  total: { orders: number; units: number },
): Map<string, { orders: number; units: number }> {
  const out = new Map<string, { orders: number; units: number }>();
  if (claimants.length === 0) return out;
  if (claimants.length === 1) {
    out.set(claimants[0].campaignId, {
      orders: total.orders,
      units: total.units,
    });
    return out;
  }

  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  let weights = claimants.map((c) => Math.max(0, c.metaPurchases));
  let weightTotal = sum(weights);
  if (weightTotal <= 0) {
    weights = claimants.map((c) => Math.max(0, c.spend));
    weightTotal = sum(weights);
  }
  if (weightTotal <= 0) {
    weights = claimants.map(() => 1);
    weightTotal = claimants.length;
  }

  /** Whole-number allocation whose parts sum exactly to `count`. */
  const allocate = (count: number): number[] => {
    const exact = weights.map((w) => (w / weightTotal) * count);
    const base = exact.map((x) => Math.floor(x));
    let left = count - sum(base);
    const byRemainder = exact
      .map((x, i) => ({ i, frac: x - Math.floor(x) }))
      .sort((a, b) => b.frac - a.frac);
    for (const { i } of byRemainder) {
      if (left <= 0) break;
      base[i] += 1;
      left -= 1;
    }
    return base;
  };

  const orders = allocate(total.orders);
  const units = allocate(total.units);
  claimants.forEach((c, i) =>
    out.set(c.campaignId, { orders: orders[i], units: units[i] }),
  );
  return out;
}

/** Resolve the FX multiplier from the store currency to a tracker's currency,
 *  honouring the merchant's pinned store↔display rate. */
export async function trackerFx(
  supabase: DB,
  userId: string,
  trackerCurrencySymbol: string | null | undefined,
): Promise<number> {
  const targetIso = SYMBOL_TO_ISO[trackerCurrencySymbol ?? "€"] ?? "EUR";
  const [store, { data: s }] = await Promise.all([
    getStoreCurrency(supabase, userId),
    supabase
      .from("settings")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);
  return resolveFx(store, targetIso, {
    storeCurrency: store,
    displayCurrency: s?.currency ?? targetIso,
    override: s?.fx_rate_override,
  });
}

/**
 * Per-Meta-connection FX multiplier (that connection's mapped store's base
 * currency → the tracker's currency). A single global rate (as {@link trackerFx}
 * computes) misconverts as soon as a merchant runs stores in different
 * currencies: e.g. spend synced into a HUF store's rows was shown divided by
 * the EUR↔HUF rate even though it was never multiplied by it, because the
 * single rate was resolved against whichever store had the most recent order
 * — not necessarily the store spend for a given campaign actually belongs to.
 * `campaigns.spend` is already in EACH campaign's own mapped store's currency
 * (see syncMetaConnection), so the conversion must be looked up per campaign,
 * keyed by `meta_connection_id`. Connections with no mapped store, or with no
 * Meta connections at all, fall back to the same whole-account guess
 * {@link trackerFx} uses.
 */
export async function trackerFxByMetaConnection(
  supabase: DB,
  userId: string,
  trackerCurrencySymbol: string | null | undefined,
): Promise<{ rates: Map<string, number>; fallback: number }> {
  const targetIso = SYMBOL_TO_ISO[trackerCurrencySymbol ?? "€"] ?? "EUR";
  const [{ data: metaConns }, { data: s }, fallback] = await Promise.all([
    supabase
      .from("meta_connections")
      .select("id, shopify_connection_id")
      .eq("user_id", userId),
    supabase.from("settings").select("*").eq("user_id", userId).maybeSingle(),
    trackerFx(supabase, userId, trackerCurrencySymbol),
  ]);

  const rates = new Map<string, number>();
  const rateByStore = new Map<string, number>();
  for (const conn of metaConns ?? []) {
    if (!conn.shopify_connection_id) continue;
    let rate = rateByStore.get(conn.shopify_connection_id);
    if (rate === undefined) {
      const store = await getStoreCurrency(
        supabase,
        userId,
        conn.shopify_connection_id,
      );
      rate = await resolveFx(store, targetIso, {
        storeCurrency: store,
        displayCurrency: s?.currency ?? targetIso,
        override: s?.fx_rate_override,
      });
      rateByStore.set(conn.shopify_connection_id, rate);
    }
    rates.set(conn.id, rate);
  }
  return { rates, fallback };
}

/**
 * Push the latest per-product COGS (Custos page) into every existing ROAS
 * entry whose campaign name matches a product. Lets cost edits flow into the
 * Daily ROAS tracker without a full re-import. Manual ROAS rows with no product
 * match are left untouched.
 */
export async function applyCogsToRoasEntries(
  supabase: DB,
  userId: string,
): Promise<number> {
  const { data: settings } = await supabase
    .from("roas_settings")
    .select("currency")
    .eq("user_id", userId)
    .maybeSingle();
  const { rates: fxByConn, fallback: fxFallback } =
    await trackerFxByMetaConnection(supabase, userId, settings?.currency);
  const fxFor = (metaConnectionId: string | null | undefined): number =>
    (metaConnectionId ? fxByConn.get(metaConnectionId) : undefined) ?? fxFallback;

  const [{ data: entries }, products, handleMap, { data: camps }] =
    await Promise.all([
      supabase.from("roas_entries").select("*").eq("user_id", userId),
      fetchMatcherProducts(supabase, userId),
      fetchCampaignHandleMap(supabase, userId),
      supabase
        .from("campaigns")
        .select("campaign_id, campaign_name, meta_connection_id")
        .eq("user_id", userId),
    ]);
  if (!entries || entries.length === 0) return 0;

  // ROAS rows only store the campaign name; map it back to an id (for handle
  // use) and to the Meta connection it belongs to (for the right FX rate —
  // a name can only resolve to one campaign here, so first-seen wins same as
  // the id lookup).
  const idByName = new Map<string, string>();
  const metaConnByName = new Map<string, string | null>();
  for (const c of camps ?? []) {
    if (c.campaign_name && !idByName.has(c.campaign_name)) {
      idByName.set(c.campaign_name, c.campaign_id);
      metaConnByName.set(c.campaign_name, c.meta_connection_id);
    }
  }

  const resolve = buildResolver(products, handleMap);
  const updated = [];
  for (const e of entries) {
    const m = resolve(idByName.get(e.campaign_name), e.campaign_name);
    if (!m || m.cog <= 0) continue;
    const fx = fxFor(metaConnByName.get(e.campaign_name));
    const newCog = round2(m.cog * fx);
    const newPrice =
      Number(e.price) > 0 ? Number(e.price) : round2(m.price * fx);
    if (newCog === Number(e.cog) && newPrice === Number(e.price)) continue;
    updated.push({ ...e, cog: newCog, price: newPrice });
  }

  if (updated.length > 0) {
    const { error } = await supabase
      .from("roas_entries")
      .upsert(updated, { onConflict: "id" });
    if (error) throw error;
  }
  return updated.length;
}
