import "server-only";
import { serverEnv } from "@/lib/env";

export const COLLECTION_PRODUCTS_QUERY = `query CampaignCollectionProducts($handle: String!, $after: String) {
  collectionByHandle(handle: $handle) {
    products(first: 250, after: $after) {
      nodes { id handle }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

/** Read current, explicit collection membership, including products with no ad tracking. */
export type CollectionProduct = { id: string; handle: string };

export async function fetchCollectionProducts(shop: string, token: string, handle: string): Promise<CollectionProduct[] | null> {
  const items = new Map<string, CollectionProduct>();
  let after: string | null = null;
  const signal = AbortSignal.timeout(12000);
  try {
    do {
      const response: Response = await fetch(`https://${shop}/admin/api/${serverEnv.shopify.apiVersion}/graphql.json`, {
        method: "POST", headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
        body: JSON.stringify({ query: COLLECTION_PRODUCTS_QUERY, variables: { handle, after } }),
        cache: "no-store", signal,
      });
      if (!response.ok) return null;
      const json: { errors?: unknown[]; data?: { collectionByHandle?: { products: { nodes: { id: string; handle: string }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } } } = await response.json();
      const products = json.data?.collectionByHandle?.products;
      if (json.errors?.length || !products) return null;
      for (const node of products.nodes) {
        const id = String(node.id).split("/").pop()!;
        items.set(id, { id, handle: (node.handle ?? "").toLowerCase() });
      }
      const next = products.pageInfo.hasNextPage ? products.pageInfo.endCursor : null;
      if (products.pageInfo.hasNextPage && (!next || next === after)) return null;
      after = next;
    } while (after);
    return [...items.values()];
  } catch { return null; }
}

/** Compatibility for collection reports that only need product IDs. */
export async function fetchCollectionProductIds(shop: string, token: string, handle: string): Promise<string[] | null> {
  const products = await fetchCollectionProducts(shop, token, handle);
  return products?.map((p) => p.id) ?? null;
}
