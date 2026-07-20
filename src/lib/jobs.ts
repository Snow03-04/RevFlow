import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/types/database";
import { decryptToken } from "@/lib/crypto";
import {
  syncShopifyOrders,
  syncShopifyProducts,
  type ShopifyCtx,
} from "@/lib/shopify/sync";
import { shopifyGet } from "@/lib/shopify/client";
import { resolveShopifyToken } from "@/lib/shopify/auth";
import { syncMetaCampaigns } from "@/lib/meta/sync";
import { syncGoogleCampaigns, seedMockGoogleCampaigns } from "@/lib/google/sync";
import { refreshAccessToken } from "@/lib/google/oauth";
import { isGoogleConfigured } from "@/lib/env";
import { fetchCampaignHandles } from "@/lib/meta/links";
import { recomputeDailyMetrics } from "@/lib/metrics";
import { getStoreCurrency } from "@/lib/queries";
import { resolveFx } from "@/lib/fx";
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
  opts: { sinceDays?: number; skipProducts?: boolean; skipRecompute?: boolean } = {},
): Promise<void> {
  const sinceDays = opts.sinceDays ?? 2;
  const token = await resolveShopifyToken(conn);
  const ctx: ShopifyCtx = {
    supabase,
    userId: conn.user_id,
    connectionId: conn.id,
    shop: conn.shop_domain,
    token,
  };

  try {
    // One-time: capture the store's real Shopify name for display (best-effort;
    // silently ignored if the shop_name column isn't there yet). Skipped once
    // set, so it costs one extra call only on the first sync.
    if (!conn.shop_name) {
      try {
        const { data } = await shopifyGet<{ shop?: { name?: string } }>(
          conn.shop_domain,
          token,
          "shop",
        );
        const name = data.shop?.name?.trim();
        if (name) {
          await supabase
            .from("shopify_connections")
            .update({ shop_name: name })
            .eq("id", conn.id);
        }
      } catch {
        /* non-fatal — the label falls back to the domain */
      }
    }

    // Product sync is the slow part (whole catalogue + per-item costs); the
    // routine "sync now" skips it and a dedicated button refreshes products.
    if (!opts.skipProducts) {
      try {
        await withSyncLog(
          supabase,
          { userId: conn.user_id, source: "shopify", jobType: "products" },
          async () => ({ records: await syncShopifyProducts(ctx) }),
        );
      } catch (err) {
        // `read_products` often needs a separate merchant approval that the
        // client_credentials grant can't perform. If it isn't granted, skip the
        // catalogue and still sync ORDERS — COGS just falls back to the default
        // cost %. Only permission errors are swallowed; real errors re-throw.
        const msg = errMessage(err);
        if (!/\b403\b|merchant approval|read_products|access scope/i.test(msg)) {
          throw err;
        }
      }
    }

    const sinceISO = new Date(
      Date.now() - sinceDays * 24 * 60 * 60 * 1000,
    ).toISOString();

    await withSyncLog(
      supabase,
      { userId: conn.user_id, source: "shopify", jobType: "orders" },
      async () => ({ records: await syncShopifyOrders(ctx, sinceISO) }),
    );

    // Recompute the window we just touched (a little wider for safety). Callers
    // that sync several sources at once can skip this and recompute ONCE at the
    // end — important on serverless, where a double recompute can blow the limit.
    if (!opts.skipRecompute) {
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
    }

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
  opts: { sinceDays?: number; skipRecompute?: boolean } = {},
): Promise<void> {
  const sinceDays = opts.sinceDays ?? 3;
  const token = decryptToken(conn.access_token);

  const { data: settings } = await supabase
    .from("settings")
    .select("*")
    .eq("user_id", conn.user_id)
    .single();
  const tz = settings?.timezone ?? "UTC";
  const range = lastNDays(sinceDays, tz);

  try {
    // Normalise Meta amounts (ad-account currency) to the store's base currency.
    // Honour the merchant's pinned FX so ad spend matches the same rate the
    // dashboard uses at display time. resolveFx (required) THROWS if the pair
    // differs and no rate is available, so we abort (and record the error)
    // rather than store spend at rate 1 — which permanently corrupts the day.
    const storeCurrency = await getStoreCurrency(supabase, conn.user_id);
    const adCurrency = conn.account_currency;
    const fxToStore = await resolveFx(adCurrency, storeCurrency, {
      storeCurrency,
      displayCurrency: settings?.currency,
      override: settings?.fx_rate_override,
      required: true,
    });

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

    // Skippable so a multi-source refresh recomputes once at the end.
    if (!opts.skipRecompute) {
      await recomputeDailyMetrics(supabase, conn.user_id, range);
    }

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
 * Sync one Google Ads account (MOCK data for now), then recompute the affected
 * daily metrics so cross-platform ad spend / ROAS pick it up. Mirrors
 * syncMetaConnection; swap syncGoogleCampaigns' body for real API calls later.
 */
export async function syncGoogleConnection(
  supabase: DB,
  conn: Tables<"google_connections">,
  opts: { sinceDays?: number } = {},
): Promise<void> {
  const sinceDays = opts.sinceDays ?? 3;

  const { data: settings } = await supabase
    .from("settings")
    .select("*")
    .eq("user_id", conn.user_id)
    .single();
  const tz = settings?.timezone ?? "UTC";
  const range = lastNDays(sinceDays, tz);

  // Normalise Google amounts (ad-account currency) to the store's base currency,
  // honouring the merchant's pinned FX (best-effort — a demo/mock account should
  // still seed even if the rate isn't resolvable, so `required` is false here).
  const storeCurrency = await getStoreCurrency(supabase, conn.user_id);
  const adCurrency = conn.account_currency;
  const fxToStore = await resolveFx(adCurrency, storeCurrency, {
    storeCurrency,
    displayCurrency: settings?.currency,
    override: settings?.fx_rate_override,
  });

  // A demo connection stores the literal token "mock"; a real one stores an
  // (encrypted) refresh token. Real syncs need a fresh access token per run.
  const stored = decryptToken(conn.access_token);
  const useMock = stored === "mock" || !isGoogleConfigured();

  try {
    await withSyncLog(
      supabase,
      { userId: conn.user_id, source: "google", jobType: "campaigns" },
      async () => {
        const base = {
          supabase,
          userId: conn.user_id,
          connectionId: conn.id,
          customerId: conn.customer_id,
          loginCustomerId: conn.login_customer_id,
          fxToStore,
        };
        const records = useMock
          ? await seedMockGoogleCampaigns({ ...base, accessToken: "" }, range)
          : await syncGoogleCampaigns(
              { ...base, accessToken: await refreshAccessToken(stored) },
              range,
            );
        return { records };
      },
    );

    await recomputeDailyMetrics(supabase, conn.user_id, range);

    await supabase
      .from("google_connections")
      .update({
        last_synced_at: new Date().toISOString(),
        last_sync_error: null,
        status: "active",
      })
      .eq("id", conn.id);
  } catch (err) {
    const message = errMessage(err);
    await supabase
      .from("google_connections")
      .update({ last_sync_error: message.slice(0, 1000), status: "error" })
      .eq("id", conn.id);
    throw err;
  }
}

/** Full historical Google import used right after a fresh (mock) connection. */
export async function initialGoogleImport(
  supabase: DB,
  conn: Tables<"google_connections">,
): Promise<void> {
  await syncGoogleConnection(supabase, conn, { sinceDays: 90 });
}

/** Sync every active Google connection for a user (mock spend). Best-effort. */
export async function syncGoogleForUser(
  supabase: DB,
  userId: string,
  sinceDays = 31,
): Promise<void> {
  const { data: google } = await supabase
    .from("google_connections")
    .select("*")
    .eq("user_id", userId)
    .in("status", ["active", "error"]);
  for (const conn of google ?? []) {
    try {
      await syncGoogleConnection(supabase, conn, { sinceDays });
    } catch {
      /* error already recorded on the connection row */
    }
  }
}

/**
 * Sync recent Shopify ORDERS for a user (skips the slow product catalogue), so
 * sales counts are fresh. Used by the ROAS import before reading Shopify sales.
 * Best-effort per connection.
 */
export async function syncShopifyOrdersForUser(
  supabase: DB,
  userId: string,
  sinceDays = 2,
): Promise<void> {
  const { data: conns } = await supabase
    .from("shopify_connections")
    .select("*")
    .eq("user_id", userId)
    .in("status", ["active", "error"]);
  for (const conn of conns ?? []) {
    try {
      await syncShopifyConnection(supabase, conn, { sinceDays, skipProducts: true });
    } catch {
      /* error recorded on the connection row */
    }
  }
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
 * Refresh the campaign -> product-handle map by reading each Meta campaign's ad
 * destination URLs. Throttled to once per hour (handles rarely change) unless
 * `force`, so it never weighs on the frequent spend syncs.
 */
export async function refreshCampaignLinks(
  supabase: DB,
  userId: string,
  opts: { force?: boolean } = {},
): Promise<number> {
  // Probe the table (also detects "migration 0011 not applied yet").
  const { data: recent, error: probeErr } = await supabase
    .from("campaign_links")
    .select("updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (probeErr) return 0; // table missing — fall back to name matching
  if (!opts.force) {
    const last = recent?.updated_at ? new Date(recent.updated_at).getTime() : 0;
    if (last && Date.now() - last < 60 * 60 * 1000) return 0;
  }

  const { data: conns } = await supabase
    .from("meta_connections")
    .select("*")
    .eq("user_id", userId)
    .in("status", ["active", "error"]);

  let total = 0;
  for (const conn of conns ?? []) {
    try {
      const token = decryptToken(conn.access_token);
      const handles = await fetchCampaignHandles(conn.ad_account_id, token);
      if (handles.size === 0) continue;
      const rows = [...handles].map(([campaign_id, product_handle]) => ({
        user_id: userId,
        campaign_id,
        product_handle,
      }));
      const { error } = await supabase
        .from("campaign_links")
        .upsert(rows, { onConflict: "user_id,campaign_id" });
      if (!error) total += rows.length;
    } catch {
      /* non-fatal: fall back to name matching */
    }
  }
  return total;
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
    const token = await resolveShopifyToken(conn);
    total +=
      (await withSyncLog<number>(
        supabase,
        { userId, source: "shopify", jobType: "products" },
        async () => {
          const records = await syncShopifyProducts({
            supabase,
            userId,
            connectionId: conn.id,
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

/**
 * When a user has exactly ONE Shopify store, attach any still-unmapped ad
 * accounts (Meta + Google) to it, so their spend is attributed to that store out
 * of the box. Multi-store users assign each account manually on the Connections
 * page. Safe to call after connecting either a store or an ad account.
 */
export async function autoMapAdAccountsToSoleStore(
  supabase: DB,
  userId: string,
): Promise<void> {
  const { data: stores } = await supabase
    .from("shopify_connections")
    .select("id")
    .eq("user_id", userId);
  if ((stores?.length ?? 0) !== 1) return;
  const storeId = stores![0].id;
  await Promise.all([
    supabase
      .from("meta_connections")
      .update({ shopify_connection_id: storeId })
      .eq("user_id", userId)
      .is("shopify_connection_id", null),
    supabase
      .from("google_connections")
      .update({ shopify_connection_id: storeId })
      .eq("user_id", userId)
      .is("shopify_connection_id", null),
  ]);
}

export { todayYmd };
