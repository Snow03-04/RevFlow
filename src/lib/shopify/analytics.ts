import "server-only";
import { serverEnv } from "@/lib/env";

/**
 * Online-store SESSIONS for a date range, via Shopify's ShopifyQL analytics.
 * Shopify's session metric already excludes bots, so this is human sessions.
 *
 * Requires the app to have the `read_reports` scope AND Level-2 Protected
 * Customer Data access (both granted in the Partner Dashboard + on reconnect).
 * Returns `null` when analytics access isn't granted (caller falls back to an
 * estimate), so the dashboard never breaks over a missing permission.
 *
 * @param from,to  yyyy-mm-dd (inclusive)
 */
export async function fetchShopifySessions(
  shop: string,
  token: string,
  from: string,
  to: string,
): Promise<number | null> {
  const shopifyql = `FROM sessions SHOW sum(sessions) SINCE ${from} UNTIL ${to}`;
  const query = `query Sessions($q: String!) {
    shopifyqlQuery(query: $q) {
      __typename
      parseErrors
      tableData { rowData }
    }
  }`;

  try {
    const res = await fetch(
      `https://${shop}/admin/api/${serverEnv.shopify.apiVersion}/graphql.json`,
      {
        method: "POST",
        headers: {
          "X-Shopify-Access-Token": token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query, variables: { q: shopifyql } }),
        cache: "no-store",
      },
    );
    if (!res.ok) return null;
    const json = await res.json();
    // Access denied / GraphQL errors → let the caller use the estimate.
    if (json.errors) return null;
    const rows: unknown = json?.data?.shopifyqlQuery?.tableData?.rowData;
    const raw = Array.isArray(rows) ? (rows[0] as unknown[])?.[0] : undefined;
    const n = raw == null ? NaN : Number(raw);
    return Number.isFinite(n) ? Math.round(n) : null;
  } catch {
    return null;
  }
}
