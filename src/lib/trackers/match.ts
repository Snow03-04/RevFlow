import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { getStoreCurrency } from "@/lib/queries";
import { getCurrentRate } from "@/lib/fx";
import { round2 } from "@/lib/profit";
import { selectAllByUser } from "@/lib/supabase/paginate";

type DB = SupabaseClient<Database>;

const SYMBOL_TO_ISO: Record<string, string> = {
  "€": "EUR",
  $: "USD",
  "£": "GBP",
};

export interface ProductMatch {
  price: number;
  cog: number;
}

export interface MatchProduct {
  productId: string;
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
export function buildProductMatcher(
  products: { title: string | null; price: number; cost: number | null }[],
) {
  const items = products
    .map((p) => ({
      tokens: new Set(tokenize(p.title ?? "")),
      price: Number(p.price),
      cog: p.cost != null ? Number(p.cost) : 0,
    }))
    .filter((it) => it.tokens.size > 0);

  return (campaignName: string): ProductMatch | null => {
    const camp = new Set(tokenize(campaignName));
    if (camp.size === 0) return null;

    let best: { price: number; cog: number } | null = null;
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
        best = { price: it.price, cog: it.cog };
        bestKey = key;
      }
    }
    return best;
  };
}

/**
 * Estimate units sold ≈ attributed revenue ÷ unit price, so a single order of
 * several units counts correctly. Falls back to the purchase count when the
 * product price isn't known. (Revenue + price are both in the store currency.)
 */
export function estimateUnits(
  purchaseValue: number | null | undefined,
  unitPrice: number | undefined,
  purchases: number | null | undefined,
): number {
  const pv = Number(purchaseValue ?? 0);
  if (unitPrice && unitPrice > 0 && pv > 0) {
    return Math.round(pv / unitPrice);
  }
  return Number(purchases ?? 0);
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
  const [products, lineItems, { data: manual }] = await Promise.all([
    selectAllByUser<{
      shopify_product_id: string;
      handle: string | null;
      title: string | null;
      price: number;
      cost: number | null;
    }>(supabase, "products", "shopify_product_id, handle, title, price, cost", userId),
    // Sold products may not be in the catalogue (dropshipping tools etc.); pull
    // their title/price from line items so they can still be matched + costed.
    selectAllByUser<{
      shopify_product_id: string | null;
      title: string | null;
      price: number;
    }>(supabase, "order_line_items", "shopify_product_id, title, price", userId),
    supabase
      .from("product_costs")
      .select("shopify_product_id, cost")
      .eq("user_id", userId),
  ]);

  const byProduct = new Map<string, MatchProduct>();

  for (const p of products ?? []) {
    if (!p.shopify_product_id) continue;
    const ex = byProduct.get(p.shopify_product_id);
    if (!ex) {
      // Keep the FIRST variant's price + first non-null cost, so the ROAS Price
      // matches what the Custos page shows for the same product.
      byProduct.set(p.shopify_product_id, {
        productId: p.shopify_product_id,
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
        handle: null,
        title: li.title,
        price: Number(li.price),
        cost: null,
      });
    } else if (!ex.title && li.title) {
      ex.title = li.title;
    }
  }

  // Manual COGS (Custos page) wins over the Shopify cost.
  for (const m of manual ?? []) {
    const ex = byProduct.get(m.shopify_product_id);
    if (ex) ex.cost = Number(m.cost);
    else
      byProduct.set(m.shopify_product_id, {
        productId: m.shopify_product_id,
        handle: null,
        title: null,
        price: 0,
        cost: Number(m.cost),
      });
  }

  return [...byProduct.values()];
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
      byHandle.set(h, { price: p.price, cog: p.cost != null ? Number(p.cost) : 0 });
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

/** Resolve the FX multiplier from the store currency to a tracker's currency. */
export async function trackerFx(
  supabase: DB,
  userId: string,
  trackerCurrencySymbol: string | null | undefined,
): Promise<number> {
  const targetIso = SYMBOL_TO_ISO[trackerCurrencySymbol ?? "€"] ?? "EUR";
  const store = await getStoreCurrency(supabase, userId);
  return store && store.toUpperCase() !== targetIso
    ? await getCurrentRate(store, targetIso)
    : 1;
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
  const fx = await trackerFx(supabase, userId, settings?.currency);

  const [{ data: entries }, products, handleMap, { data: camps }] =
    await Promise.all([
      supabase.from("roas_entries").select("*").eq("user_id", userId),
      fetchMatcherProducts(supabase, userId),
      fetchCampaignHandleMap(supabase, userId),
      supabase
        .from("campaigns")
        .select("campaign_id, campaign_name")
        .eq("user_id", userId),
    ]);
  if (!entries || entries.length === 0) return 0;

  // ROAS rows only store the campaign name; map it back to an id for handle use.
  const idByName = new Map<string, string>();
  for (const c of camps ?? []) {
    if (c.campaign_name && !idByName.has(c.campaign_name)) {
      idByName.set(c.campaign_name, c.campaign_id);
    }
  }

  const resolve = buildResolver(products, handleMap);
  const updated = [];
  for (const e of entries) {
    const m = resolve(idByName.get(e.campaign_name), e.campaign_name);
    if (!m || m.cog <= 0) continue;
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
