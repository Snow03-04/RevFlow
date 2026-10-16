import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/types/database";
import { selectAllByUser } from "@/lib/supabase/paginate";
import { resolveShopifyToken } from "@/lib/shopify/auth";
import { fetchCollectionProductIds } from "@/lib/shopify/collection-products";
import { fetchCollectionProducts, type CollectionProduct } from "@/lib/shopify/collection-products";

const cache = new Map<string, { expires: number; ids: string[] }>();
const landingCache = new Map<string, { expires: number; products: CollectionProduct[] }>();

/** Handles come from Shopify itself, including products not yet in our catalogue. */
export async function getCollectionLandingProducts(db: SupabaseClient<Database>, userId: string,
  scopes: { storeId: string; handle: string }[]) {
  const result = new Map<string, CollectionProduct[] | null>();
  const pending = [...new Map(scopes.map((scope) => [`${scope.storeId}:${scope.handle}`, scope]))]
    .filter(([key]) => {
      const hit = landingCache.get(`${userId}:${key}`);
      if (hit && hit.expires > Date.now()) { result.set(key, hit.products); return false; }
      return true;
    });
  if (!pending.length) return result;
  const stores = await selectAllByUser<Tables<"shopify_connections">>(db, "shopify_connections", "*", userId,
    (q) => q.in("id", [...new Set(pending.map(([, scope]) => scope.storeId))]));
  const tokens = new Map<string, Promise<string>>();
  let next = 0;
  const worker = async () => {
    while (next < pending.length) {
      const [key, scope] = pending[next++];
      const store = stores.find((s) => s.id === scope.storeId);
      let products: CollectionProduct[] | null = null;
      if (store) try {
        if (!tokens.has(store.id)) tokens.set(store.id, resolveShopifyToken(store));
        products = await fetchCollectionProducts(store.shop_domain, await tokens.get(store.id)!, scope.handle);
      } catch { /* Report unavailable rather than silently changing sales to zero. */ }
      result.set(key, products);
      if (products !== null) {
        if (landingCache.size >= 500) landingCache.clear();
        landingCache.set(`${userId}:${key}`, { expires: Date.now() + 300_000, products });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, pending.length) }, worker));
  return result;
}

export async function getCollectionMemberships(db: SupabaseClient<Database>, userId: string,
  scopes: { storeId: string; handle: string }[], stores?: Tables<"shopify_connections">[]) {
  if (!scopes.length) return new Map<string, string[] | null>();
  const connections = stores ?? await selectAllByUser<Tables<"shopify_connections">>(db, "shopify_connections", "*", userId);
  const tokens = new Map<string, Promise<string>>();
  const unique = new Map(scopes.map((scope) => [`${scope.storeId}:${scope.handle}`, scope]));
  return new Map(await Promise.all([...unique].map(async ([key, scope]): Promise<[string, string[] | null]> => {
    const cacheKey = `${userId}:${key}`;
    const cached = cache.get(cacheKey);
    if (cached && cached.expires > Date.now()) return [key, cached.ids];
    const store = connections.find((connection) => connection.id === scope.storeId);
    if (!store) return [key, null];
    try {
      if (!tokens.has(store.id)) tokens.set(store.id, resolveShopifyToken(store));
      const ids = await fetchCollectionProductIds(store.shop_domain, await tokens.get(store.id)!, scope.handle);
      if (ids != null) {
        if (cache.size >= 500) cache.clear();
        cache.set(cacheKey, { expires: Date.now() + 300_000, ids });
      }
      return [key, ids];
    } catch { return [key, null]; }
  })));
}
