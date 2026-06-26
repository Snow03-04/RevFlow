import "server-only";
import { serverEnv } from "@/lib/env";

/**
 * Thin wrapper around the Shopify Admin REST API with cursor pagination and
 * basic rate-limit backoff. The Admin API version is pinned via env.
 */

const BASE = (shop: string) =>
  `https://${shop}/admin/api/${serverEnv.shopify.apiVersion}`;

export interface ShopifyResponse<T> {
  data: T;
  nextPageInfo: string | null;
}

async function shopifyFetch(
  url: string,
  token: string,
  attempt = 0,
): Promise<Response> {
  const res = await fetch(url, {
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    cache: "no-store",
  });

  // 429 -> respect Retry-After and back off (max 4 tries).
  if (res.status === 429 && attempt < 4) {
    const retryAfter = Number(res.headers.get("Retry-After") ?? "2");
    await new Promise((r) => setTimeout(r, retryAfter * 1000));
    return shopifyFetch(url, token, attempt + 1);
  }
  return res;
}

/** Parse the `page_info` cursor out of Shopify's Link header (rel="next"). */
function parseNextPageInfo(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  const match = linkHeader
    .split(",")
    .find((part) => part.includes('rel="next"'));
  if (!match) return null;
  const urlMatch = match.match(/<([^>]+)>/);
  if (!urlMatch) return null;
  const pageInfo = new URL(urlMatch[1]).searchParams.get("page_info");
  return pageInfo;
}

/** GET a single page from a REST resource. */
export async function shopifyGet<T = any>(
  shop: string,
  token: string,
  resource: string,
  query: Record<string, string | number> = {},
): Promise<ShopifyResponse<T>> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) params.set(k, String(v));
  const url = `${BASE(shop)}/${resource}.json${params.toString() ? `?${params}` : ""}`;

  const res = await shopifyFetch(url, token);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Shopify GET ${resource} failed (${res.status}): ${body}`);
  }
  const data = (await res.json()) as T;
  return { data, nextPageInfo: parseNextPageInfo(res.headers.get("Link")) };
}

/**
 * Iterate every page of a list resource. When following `page_info` the
 * Shopify API forbids any other filter param, so we only carry `limit`.
 */
export async function* shopifyPaginate<T = any>(
  shop: string,
  token: string,
  resource: string,
  key: string,
  query: Record<string, string | number> = {},
): AsyncGenerator<T[]> {
  let pageInfo: string | null = null;
  let first = true;

  while (true) {
    const q: Record<string, string | number> = pageInfo
      ? { limit: query.limit ?? 250, page_info: pageInfo }
      : { limit: 250, ...query };

    const { data, nextPageInfo } = await shopifyGet<Record<string, T[]>>(
      shop,
      token,
      resource,
      q,
    );
    const items = (data?.[key] ?? []) as T[];
    if (items.length > 0 || first) yield items;
    first = false;

    if (!nextPageInfo) break;
    pageInfo = nextPageInfo;
  }
}

/** POST to the Admin API (used for webhook registration). */
export async function shopifyPost<T = any>(
  shop: string,
  token: string,
  resource: string,
  body: unknown,
): Promise<T> {
  const url = `${BASE(shop)}/${resource}.json`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok && res.status !== 422) {
    const text = await res.text();
    throw new Error(`Shopify POST ${resource} failed (${res.status}): ${text}`);
  }
  return (await res.json()) as T;
}
