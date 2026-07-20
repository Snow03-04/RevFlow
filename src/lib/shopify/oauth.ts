import "server-only";
import crypto from "node:crypto";
import { serverEnv, clientEnv } from "@/lib/env";
import { safeEqual } from "@/lib/crypto";

const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

/** Normalise user input ("my-store", "https://my-store.myshopify.com/") to a domain. */
export function normalizeShopDomain(input: string): string | null {
  let shop = input.trim().toLowerCase();
  shop = shop.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!shop.includes(".")) shop = `${shop}.myshopify.com`;
  if (!SHOP_RE.test(shop)) return null;
  return shop;
}

export function buildInstallUrl(shop: string, state: string): string {
  const redirectUri = `${clientEnv.appUrl}/api/shopify/callback`;
  const params = new URLSearchParams({
    client_id: serverEnv.shopify.apiKey,
    scope: serverEnv.shopify.scopes,
    redirect_uri: redirectUri,
    state,
    "grant_options[]": "", // offline (permanent) token
  });
  return `https://${shop}/admin/oauth/authorize?${params.toString()}`;
}

/**
 * Verify the HMAC on the OAuth callback query string.
 * Shopify signs all params except `hmac` / `signature`, sorted by key.
 */
export function verifyOAuthHmac(searchParams: URLSearchParams): boolean {
  const hmac = searchParams.get("hmac");
  if (!hmac) return false;

  const message = [...searchParams.entries()]
    .filter(([k]) => k !== "hmac" && k !== "signature")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  const digest = crypto
    .createHmac("sha256", serverEnv.shopify.apiSecret)
    .update(message)
    .digest("hex");

  return safeEqual(digest, hmac);
}

/** Verify the HMAC header on an incoming webhook against the raw body. */
export function verifyWebhookHmac(rawBody: string, hmacHeader: string): boolean {
  const digest = crypto
    .createHmac("sha256", serverEnv.shopify.apiSecret)
    .update(rawBody, "utf8")
    .digest("base64");
  return safeEqual(digest, hmacHeader);
}

export interface TokenResponse {
  access_token: string;
  scope: string;
}

export async function exchangeCodeForToken(
  shop: string,
  code: string,
): Promise<TokenResponse> {
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: serverEnv.shopify.apiKey,
      client_secret: serverEnv.shopify.apiSecret,
      code,
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Shopify token exchange failed: ${res.status}`);
  }
  return (await res.json()) as TokenResponse;
}

export interface ClientCredentialsToken {
  token: string; // a short-lived shpat_ (~24h)
  expiresIn: number; // seconds
}

/**
 * Exchange a custom app's API key + API secret for a short-lived Admin API
 * access token via the OAuth `client_credentials` grant. The SECRET goes in the
 * body (never a header); the returned shpat_ is what authenticates API calls.
 * No redirect / merchant approval — works per store without app distribution.
 */
export async function exchangeClientCredentials(
  shop: string,
  clientId: string,
  clientSecret: string,
): Promise<ClientCredentialsToken> {
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
    }),
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `Shopify client_credentials exchange failed (${res.status}): ${text}`,
    );
  }
  const json = JSON.parse(text) as { access_token?: string; expires_in?: number };
  if (!json.access_token) {
    throw new Error("Shopify client_credentials: no access_token returned");
  }
  return { token: json.access_token, expiresIn: json.expires_in ?? 82800 };
}
