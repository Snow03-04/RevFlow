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
import { getStoreCurrency } from "@/lib/queries";
import { getCurrentRate } from "@/lib/fx";
import { lastNDays, todayYmd } from "@/lib/date";
import { withSyncLog } from "@/lib/sync-log";

type DB = SupabaseClient<Database>;

/** Best-effort human-readable message from any thrown value (Error, Postgrest
 *  error object, Meta error, etc.) — avoids storing useless "[object Object]". */
function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object") {
    const o = err as Record<string, unknown>;
    const m = o.message ?? o.error_description ?? o.details ?? o.hint;
    if (typeof m === "string" && m) return m;
    try {
      return JSON.stringify(o);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

/**
 * Sync one Shopify connection end-to-end: products, recent orders, then
 * recompute the affected daily P&L. Marks the connection healthy or records
 * the error. `sinceDays` controls how far back to pull orders.
 */
export async function syncShopifyConnection(
  supabase: DB,
  conn: Tables<"shopify_connections">,
  opts: { sinceDays?: number; skipProducts?: boolean } = {},
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
    // Product sync is the slow part (whole catalogue + per-item costs); the
    // routine "sync now" skips it and a dedicated button refreshes products.
    if (!opts.skipProducts) {
      await withSyncLog(
        supabase,
        { userId: conn.user_id, source: "shopify", jobType: "products" },
        async () => ({ records: await syncShopifyProducts(ctx) }),
      );
    }

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
    const message = errMessage(err);
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

  // Normalise Meta amounts (ad-account currency) to the store's base currency.
  const storeCurrency = await getStoreCurrency(supabase, conn.user_id);
  const adCurrency = conn.account_currency;
  const fxToStore =
    storeCurrency &&
    adCurrency &&
    storeCurrency.toUpperCase() !== adCurrency.toUpperCase()
      ? await getCurrentRate(adCurrency, storeCurrency)
      : 1;

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
            fxToStore,
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
    const message = errMessage(err);
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

/**
 * Sync every active Meta connection for a user (live ad spend). Used by the
 * ROAS import + dashboard refresh so campaign spend is up to date on demand.
 * Best-effort: a failing connection is recorded but doesn't abort the others.
 */
export async function syncMetaForUser(
  supabase: DB,
  userId: string,
  sinceDays = 31,
): Promise<void> {
  const { data: meta } = await supabase
    .from("meta_connections")
    .select("*")
    .eq("user_id", userId)
    .in("status", ["active", "error"]); // retry errored connections so they heal
  for (const conn of meta ?? []) {
    try {
      await syncMetaConnection(supabase, conn, { sinceDays });
    } catch {
      /* error already recorded on the connection row */
    }
  }
}

/**
 * Refresh the Shopify product catalogue (+ costs) for a user, without touching
 * orders. Backs the dedicated "Sincronizar produtos" button on the Custos page.
 */
export async function syncShopifyProductsForUser(
  supabase: DB,
  userId: string,
): Promise<number> {
  const { data: conns } = await supabase
    .from("shopify_connections")
    .select("*")
    .eq("user_id", userId)
    .in("status", ["active", "error"]);

  let total = 0;
  for (const conn of conns ?? []) {
    const token = decryptToken(conn.access_token);
    total +=
      (await withSyncLog<number>(
        supabase,
        { userId, source: "shopify", jobType: "products" },
        async () => {
          const records = await syncShopifyProducts({
            supabase,
            userId,
            shop: conn.shop_domain,
            token,
          });
          return { records, result: records };
        },
      )) ?? 0;
    await supabase
      .from("shopify_connections")
      .update({ last_synced_at: new Date().toISOString() })
      .eq("id", conn.id);
  }
  return total;
}

export { todayYmd };
