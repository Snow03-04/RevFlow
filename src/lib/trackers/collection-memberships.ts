import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/types/database";
import { selectAllByUser } from "@/lib/supabase/paginate";
import { resolveShopifyToken } from "@/lib/shopify/auth";
import { fetchCollectionProductIds } from "@/lib/shopify/collection-products";

const cache = new Map<string, { expires: number; ids: string[] }>();

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
