import "server-only";
import { decryptToken } from "@/lib/crypto";
import { exchangeClientCredentials } from "@/lib/shopify/oauth";

/** The fields of a shopify_connections row needed to obtain a usable token. */
export interface ShopifyConnAuth {
  shop_domain: string;
  access_token: string;
  auth_type?: string | null;
  client_id?: string | null;
}

// Cache exchanged tokens per (client_id@shop) within a warm instance, so a burst
// of syncs/webhooks doesn't hit the token endpoint every time. Refreshed a
// minute before expiry.
const tokenCache = new Map<string, { token: string; exp: number }>();

/**
 * Resolve a usable Admin API access token for a Shopify connection.
 *   - `client_credentials`: exchange the stored API key + (encrypted) secret for
 *     a fresh short-lived shpat_ (cached until it nears expiry).
 *   - legacy `token`: the stored access_token IS the shpat_ — just decrypt it.
 */
export async function resolveShopifyToken(conn: ShopifyConnAuth): Promise<string> {
  if (conn.auth_type === "client_credentials" && conn.client_id) {
    const key = `${conn.client_id}@${conn.shop_domain}`;
    const cached = tokenCache.get(key);
    if (cached && cached.exp > Date.now() + 60_000) return cached.token;

    const secret = decryptToken(conn.access_token);
    const { token, expiresIn } = await exchangeClientCredentials(
      conn.shop_domain,
      conn.client_id,
      secret,
    );
    tokenCache.set(key, { token, exp: Date.now() + expiresIn * 1000 });
    return token;
  }
  return decryptToken(conn.access_token);
}
