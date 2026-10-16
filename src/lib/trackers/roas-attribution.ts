import { isGooglePaidOrder, landingTargetFromUrl, splitProductSales, type MatchProduct, type ProductMatch } from "./match";
import type { TrackerOrderSales, TargetSales } from "./sales";
import type { CollectionProduct } from "@/lib/shopify/collection-products";

export type RoasCampaign = {
  key: string; campaignId: string; name: string; date: string; storeId: string | null;
  target: ProductMatch | null; purchases: number; spend: number;
};
export const roasCampaignDayKey = (key: string, date: string) => `${key}:${date}`;

function landingUrl(raw?: string | null) {
  try { return raw ? new URL(raw, "https://store.invalid") : null; } catch { return null; }
}

/** Exact campaign tags outrank inferred membership; never use substring name matches. */
function taggedCampaigns(url: URL | null, candidates: RoasCampaign[]) {
  if (!url) return [];
  for (const param of ["campaign_id", "utm_id", "utm_campaign", "campaign"]) {
    const value = url.searchParams.get(param)?.trim();
    if (!value || value.includes("{{")) continue;
    const ids = candidates.filter((c) => c.campaignId === value);
    if (ids.length) return ids;
    if (param === "utm_campaign") {
      const names = candidates.filter((c) => c.name.trim().toLowerCase() === value.toLowerCase());
      if (names.length) return names;
    }
  }
  return [];
}

/**
 * Whole baskets go to the tagged campaign, collection landing, or collection(s)
 * containing the landing product. Purchased product fallback applies only when
 * no landing attribution exists. Each line's revenue and COGS enter one pool.
 * Ambiguous campaigns share that pool using Meta purchases/spend, not duplicate
 * revenue. Membership is current Shopify membership, not a historical claim.
 */
export function attributeRoasSales(campaigns: RoasCampaign[], orders: TrackerOrderSales[], products: MatchProduct[],
  memberships: Map<string, CollectionProduct[] | null>): Map<string, TargetSales> {
  const result = new Map<string, TargetSales>();
  const pools = new Map<string, { candidates: RoasCampaign[]; orders: number; units: number; revenue: number; cost: number }>();
  const empty = (): TargetSales => ({ orders: 0, units: 0, revenue: 0, cost: 0 });
  for (const c of campaigns) if (c.target) result.set(roasCampaignDayKey(c.key, c.date), empty());
  const add = (candidates: RoasCampaign[], order: TrackerOrderSales, sale: TargetSales) => {
    if (!candidates.length) return;
    candidates = [...candidates].sort((a, b) => a.key.localeCompare(b.key));
    const key = JSON.stringify([order.storeId, order.date, candidates.map((c) => c.key)]);
    const pool = pools.get(key) ?? { candidates, ...empty() };
    pool.orders += sale.orders; pool.units += sale.units; pool.revenue += sale.revenue; pool.cost += sale.cost;
    pools.set(key, pool);
  };
  const seen = new Set<string>();
  for (const order of orders) {
    const id = `${order.storeId}:${order.id}`;
    if (seen.has(id) || isGooglePaidOrder(order.landingSite ?? null)) continue;
    seen.add(id);
    // Unmapped accounts cannot safely claim a collection from another store.
    const eligible = campaigns.filter((c) => c.date === order.date && c.spend > 0 &&
      (c.storeId === order.storeId || (!c.storeId && !!c.target?.productId)));
    if (!eligible.length) continue;
    const items = order.items.filter((li) => li.units > 0 || li.cost !== 0);
    const units = items.reduce((n, li) => n + li.units, 0);
    const whole = { orders: 1, units, revenue: items.reduce((n, li) => n + li.revenue, 0), cost: order.cost };
    const url = landingUrl(order.landingSite);
    let chosen = taggedCampaigns(url, eligible.filter((c) => c.storeId === order.storeId));
    const landing = landingTargetFromUrl(order.landingSite ?? null);
    let collection: string | null = order.collectionHandle;
    try { collection = url?.pathname.match(/\/collections\/([^/?#]+)/i)?.[1] ?? collection;
      collection = collection ? decodeURIComponent(collection).toLowerCase() : null; } catch { collection = null; }
    if (!chosen.length && collection)
      chosen = eligible.filter((c) => c.target?.collectionHandle === collection);
    if (!chosen.length && landing?.kind === "product") {
      const landingIds = new Set(products.filter((p) => p.storeId === order.storeId && p.handle?.toLowerCase() === landing.handle).map((p) => p.productId));
      const collections = eligible.filter((c) => c.target?.collectionHandle &&
        memberships.get(`${order.storeId}:${c.target.collectionHandle}`)?.some((p) => p.handle === landing.handle));
      // Preserve product-only economics; a collection competes with a directly
      // advertised product only when both could have driven this landing.
      if (collections.length) chosen = [...collections, ...eligible.filter((c) => c.target?.productId && landingIds.has(c.target.productId))];
    }
    if (chosen.length) { add(chosen, order, whole); continue; }
    for (const li of items) {
      if (!li.productId) continue;
      const candidates = eligible.filter((c) => c.target?.productId === li.productId);
      add(candidates, order, { orders: units > 0 ? li.units / units : 0, units: li.units, revenue: li.revenue, cost: li.cost });
    }
  }
  for (const pool of pools.values()) {
    const shares = splitProductSales(pool.candidates.map((c) => ({ campaignId: c.key, metaPurchases: c.purchases, spend: c.spend })),
      { orders: Math.round(pool.orders * 100), units: pool.units });
    for (const c of pool.candidates) {
      const share = shares.get(c.key)!;
      const key = roasCampaignDayKey(c.key, c.date);
      const sale = result.get(key) ?? empty();
      const fraction = pool.units > 0 ? share.units / pool.units : 0;
      sale.orders += share.orders / 100; sale.units += share.units;
      sale.revenue += pool.revenue * fraction; sale.cost += pool.cost * fraction;
      result.set(key, sale);
    }
  }
  return result;
}
