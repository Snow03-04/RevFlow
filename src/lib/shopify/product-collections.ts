import "server-only";
import { serverEnv } from "@/lib/env";

export const PRODUCT_COLLECTIONS_QUERY = `query AdvertisedProductCollections($id: ID!, $after: String) {
  product(id: $id) {
    collections(first: 250, after: $after) {
      nodes { handle title }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

/** Never choose an arbitrary collection when a product belongs to several. */
export async function fetchProductCollections(shop: string, token: string, productId: string): Promise<{ handle: string; title: string }[] | null> {
  const collections = new Map<string, { handle: string; title: string }>();
  const signal = AbortSignal.timeout(12000);
  let after: string | null = null;
  try {
    do {
      const response: Response = await fetch(`https://${shop}/admin/api/${serverEnv.shopify.apiVersion}/graphql.json`, {
        method: "POST", headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
        body: JSON.stringify({ query: PRODUCT_COLLECTIONS_QUERY, variables: { id: `gid://shopify/Product/${productId}`, after } }),
        cache: "no-store", signal,
      });
      if (!response.ok) return null;
      const json: { errors?: unknown[]; data?: { product?: { collections: { nodes: { handle: string; title: string }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } } } = await response.json();
      const page = json.data?.product?.collections;
      if (json.errors?.length || !page) return null;
      for (const collection of page.nodes) collections.set(collection.handle, collection);
      const next = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
      if (page.pageInfo.hasNextPage && (!next || next === after)) return null;
      after = next;
    } while (after);
    return [...collections.values()];
  } catch { return null; }
}
