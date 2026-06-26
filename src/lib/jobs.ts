import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/types/database";
import { decryptToken } from "@/lib/crypto";
import {
  syncShopifyOrders,
  syncShopifyProducts,
  type ShopifyCtx,
} from "@/lib/shopify/sync";
import { syncMetaCampaigns } from "@/lib/meta/sync";
import { recomputeDailyMetrics } from "@/lib/metrics";
import { lastNDays, todayYmd } from "@/lib/date";
import { withSyncLog } from "@/lib/sync-log";

type DB = SupabaseClient<Database>;

/**
 * Sync one Shopify connection end-to-end: products, recent orders, then
 * recompute the affected daily P&L. Marks the connection healthy or records
 * the error. `sinceDays` controls how far back to pull orders.
 */
export async function syncShopifyConnection(
  supabase: DB,
  conn: Tables<"shopify_connections">,
  opts: { sinceDays?: number } = {},
): Promise<void> {
  const sinceDays = opts.sinceDays ?? 2;
  const token = decryptToken(conn.access_token);
  const ctx: ShopifyCtx = {
    supabase,
    userId: conn.user_id,
    shop: conn.shop_domain,
    token,
  };

  try {
    await withSyncLog(
      supabase,
      { userId: conn.user_id, source: "shopify", jobType: "products" },
      async () => ({ records: await syncShopifyProducts(ctx) }),
    );

    const sinceISO = new Date(
      Date.now() - sinceDays * 24 * 60 * 60 * 1000,
    ).toISOString();

    await withSyncLog(
      supabase,
      { userId: conn.user_id, source: "shopify", jobType: "orders" },
      async () => ({ records: await syncShopifyOrders(ctx, sinceISO) }),
    );

    // Recompute the window we just touched (a little wider for safety).
    const { data: settings } = await supabase
      .from("settings")
      .select("timezone")
      .eq("user_id", conn.user_id)
      .single();
    const tz = settings?.timezone ?? "UTC";
    await recomputeDailyMetrics(
      supabase,
      conn.user_id,
      lastNDays(Math.max(sinceDays + 1, 3), tz),
    );

    await supabase
      .from("shopify_connections")
      .update({
        last_synced_at: new Date().toISOString(),
        last_sync_error: null,
        status: "active",
      })
      .eq("id", conn.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase
      .from("shopify_connections")
      .update({ last_sync_error: message.slice(0, 1000), status: "error" })
      .eq("id", conn.id);
    throw err;
  }
}

/** Full historical Shopify import used right after a fresh connection. */
export async function initialShopifyImport(
  supabase: DB,
  conn: Tables<"shopify_connections">,
): Promise<void> {
  await syncShopifyConnection(supabase, conn, { sinceDays: 60 });
}

/**
 * Sync one Meta ad account: campaign insights for the trailing window, then
 * recompute the affected daily metrics (so ROAS/MER/profit pick up the spend).
 */
export async function syncMetaConnection(
  supabase: DB,
  conn: Tables<"meta_connections">,
  opts: { sinceDays?: number } = {},
): Promise<void> {
  const sinceDays = opts.sinceDays ?? 3;
  const token = decryptToken(conn.access_token);

  const { data: settings } = await supabase
    .from("settings")
    .select("timezone")
    .eq("user_id", conn.user_id)
    .single();
  const tz = settings?.timezone ?? "UTC";
  const range = lastNDays(sinceDays, tz);

  try {
    await withSyncLog(
      supabase,
      { userId: conn.user_id, source: "meta", jobType: "campaigns" },
      async () => ({
        records: await syncMetaCampaigns(
          {
            supabase,
            userId: conn.user_id,
            connectionId: conn.id,
            adAccountId: conn.ad_account_id,
            token,
          },
          range,
        ),
      }),
    );

    await recomputeDailyMetrics(supabase, conn.user_id, range);

    await supabase
      .from("meta_connections")
      .update({
        last_synced_at: new Date().toISOString(),
        last_sync_error: null,
        status: "active",
      })
      .eq("id", conn.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase
      .from("meta_connections")
      .update({ last_sync_error: message.slice(0, 1000), status: "error" })
      .eq("id", conn.id);
    throw err;
  }
}

/** Full historical Meta import used right after a fresh connection. */
export async function initialMetaImport(
  supabase: DB,
  conn: Tables<"meta_connections">,
): Promise<void> {
  await syncMetaConnection(supabase, conn, { sinceDays: 60 });
}

export { todayYmd };
