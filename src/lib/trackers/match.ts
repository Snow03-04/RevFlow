import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { getStoreCurrency } from "@/lib/queries";
import { getCurrentRate } from "@/lib/fx";
import { round2 } from "@/lib/profit";

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

/**
 * Build a matcher that maps a campaign name to a Shopify product by title
 * (campaigns are usually named after the product they advertise). Returns the
 * product's price + cost in the STORE currency; the caller applies FX.
 */
export function buildProductMatcher(
  products: { title: string | null; price: number; cost: number | null }[],
) {
  const byTitle = new Map<string, ProductMatch>();
  for (const p of products) {
    const t = (p.title ?? "").toLowerCase().trim();
    if (!t) continue;
    const cog = p.cost != null ? Number(p.cost) : 0;
    const prev = byTitle.get(t);
    if (!prev || (cog > 0 && prev.cog === 0)) {
      byTitle.set(t, { price: Number(p.price), cog });
    }
  }
  const titles = [...byTitle.keys()].sort((a, b) => b.length - a.length);
  return (campaignName: string): ProductMatch | null => {
    const name = campaignName.toLowerCase();
    for (const t of titles) {
      if (t.length >= 4 && name.includes(t)) return byTitle.get(t) ?? null;
    }
    return null;
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
 * store's base currency. One entry per product (price = its cheapest variant).
 */
export async function fetchMatcherProducts(
  supabase: DB,
  userId: string,
): Promise<{ title: string | null; price: number; cost: number | null }[]> {
  const [{ data: products }, { data: manual }] = await Promise.all([
    supabase
      .from("products")
      .select("shopify_product_id, title, price, cost")
      .eq("user_id", userId),
    supabase
      .from("product_costs")
      .select("shopify_product_id, cost")
      .eq("user_id", userId),
  ]);

  const manualByProduct = new Map(
    (manual ?? []).map((m) => [m.shopify_product_id, Number(m.cost)]),
  );

  return (products ?? []).map((p) => {
    const manualCost = p.shopify_product_id
      ? manualByProduct.get(p.shopify_product_id)
      : undefined;
    return {
      title: p.title,
      price: Number(p.price),
      cost: manualCost ?? (p.cost != null ? Number(p.cost) : null),
    };
  });
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

  const [{ data: entries }, products] = await Promise.all([
    supabase.from("roas_entries").select("*").eq("user_id", userId),
    fetchMatcherProducts(supabase, userId),
  ]);
  if (!entries || entries.length === 0) return 0;

  const match = buildProductMatcher(products);
  const updated = [];
  for (const e of entries) {
    const m = match(e.campaign_name);
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
