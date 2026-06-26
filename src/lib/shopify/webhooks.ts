import "server-only";
import { shopifyPost } from "@/lib/shopify/client";
import { clientEnv } from "@/lib/env";

/** Topics we subscribe to so the dashboard stays live between cron runs. */
export const WEBHOOK_TOPICS = [
  "orders/create",
  "orders/updated",
  "orders/cancelled",
  "refunds/create",
  "app/uninstalled",
] as const;

/**
 * Register all webhook topics for a shop. Shopify returns 422 if a webhook
 * already exists for that topic+address — we treat that as success.
 * Returns the created webhook ids (best-effort).
 */
export async function registerShopifyWebhooks(
  shop: string,
  token: string,
): Promise<number[]> {
  const address = `${clientEnv.appUrl}/api/shopify/webhooks`;
  const ids: number[] = [];

  for (const topic of WEBHOOK_TOPICS) {
    try {
      const res = await shopifyPost<{ webhook?: { id: number } }>(
        shop,
        token,
        "webhooks",
        { webhook: { topic, address, format: "json" } },
      );
      if (res.webhook?.id) ids.push(res.webhook.id);
    } catch {
      // Non-fatal: a failed registration shouldn't block the connection.
    }
  }
  return ids;
}
