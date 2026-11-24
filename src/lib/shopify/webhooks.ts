import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/types/database";
import { shopifyGet, shopifyPost } from "@/lib/shopify/client";
import { clientEnv } from "@/lib/env";

/** Topics the shared OAuth app subscribes to, so the dashboard stays live between imports. */
export const WEBHOOK_TOPICS = [
  "orders/create",
  "orders/updated",
  "orders/cancelled",
  "refunds/create",
  "app/uninstalled",
] as const;

/** Topics a store's own custom app subscribes to: a new sale and its
 * cancellation. Every delivery is a function invocation, so the list is kept to
 * what makes an order appear at once.
 *
 * The receiver also handles `orders/updated` and `orders/paid` (a post-purchase
 * upsell arrives as an update seconds after the order). They are not subscribed
 * here because an order is updated many times in its life — every fulfilment,
 * tag or note — which multiplies invocations several times over. The import
 * books those changes. Add `"orders/updated"` to this list to have upsells
 * raise the live amount immediately. */
export const CUSTOM_APP_TOPICS = [
  "orders/create",
  "orders/cancelled",
  "app/uninstalled",
] as const;

/** Where Shopify delivers webhooks, or null when this is not the deployed app:
 * a local address would subscribe a real store to a machine nobody can reach. */
export function webhookAddress(appUrl: string = clientEnv.appUrl): string | null {
  try {
    const url = new URL(appUrl);
    const local = /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(url.hostname) || url.hostname.endsWith(".local");
    return url.protocol === "https:" && !local ? `${url.origin}/api/shopify/webhooks` : null;
  } catch {
    return null;
  }
}

/**
 * Register all webhook topics for a shop and return the ids now subscribed to
 * this app's address (best-effort). Topics that already exist are kept as they
 * are — Shopify answers 422 to a second subscription, without an id.
 */
export async function registerShopifyWebhooks(
  shop: string,
  token: string,
  topics: readonly string[] = WEBHOOK_TOPICS,
): Promise<number[]> {
  const address = webhookAddress();
  if (!address) return [];
  const subscribed = new Map<string, number>();
  try {
    const { data } = await shopifyGet<{ webhooks?: { id: number; topic: string; address: string }[] }>(
      shop, token, "webhooks", { address, limit: 250 });
    for (const hook of data.webhooks ?? []) if (hook.address === address) subscribed.set(hook.topic, hook.id);
  } catch {
    // Without the list, creation below still reports what could be added.
  }

  for (const topic of topics) {
    if (subscribed.has(topic)) continue;
    try {
      const res = await shopifyPost<{ webhook?: { id: number } }>(
        shop,
        token,
        "webhooks",
        { webhook: { topic, address, format: "json" } },
      );
      if (res.webhook?.id) subscribed.set(topic, res.webhook.id);
    } catch {
      // Non-fatal: a failed registration shouldn't block the connection.
    }
  }
  return topics.flatMap((topic) => subscribed.get(topic) ?? []);
}

// One attempt per store and hour in a warm instance: a store whose app may not
// subscribe must not repeat the same refused requests on every refresh.
const attempted = new Map<string, number>();

/** Subscribe a custom-app store that has no webhooks yet. Its deliveries are
 * signed with that app's own secret, which the receiver verifies per store.
 * Never fails a refresh: the scheduled import keeps the store up to date. */
export async function ensureShopifyWebhooks(
  db: SupabaseClient<Database>,
  conn: Pick<Tables<"shopify_connections">, "id" | "user_id" | "shop_domain" | "auth_type" | "webhook_ids">,
  token: string,
): Promise<void> {
  try {
    if (conn.auth_type !== "client_credentials" || !webhookAddress()) return;
    if (Array.isArray(conn.webhook_ids) && conn.webhook_ids.length >= CUSTOM_APP_TOPICS.length) return;
    if (Date.now() - (attempted.get(conn.id) ?? 0) < 60 * 60_000) return;
    attempted.set(conn.id, Date.now());
    const ids = await registerShopifyWebhooks(conn.shop_domain, token, CUSTOM_APP_TOPICS);
    if (!ids.length) return;
    await db.from("shopify_connections").update({ webhook_ids: ids }).eq("id", conn.id).eq("user_id", conn.user_id);
  } catch {
    // Best-effort by design.
  }
}
