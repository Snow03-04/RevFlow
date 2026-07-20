"use server";

import { revalidatePath } from "next/cache";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import {
  syncShopifyConnection,
  syncMetaConnection,
  syncShopifyProductsForUser,
  refreshCampaignLinks,
  initialShopifyImport,
  initialGoogleImport,
  syncGoogleConnection,
  autoMapAdAccountsToSoleStore,
} from "@/lib/jobs";
import { getStoreCurrency } from "@/lib/queries";
import { recomputeDailyMetrics } from "@/lib/metrics";
import { lastNDays } from "@/lib/date";
import { normalizeShopDomain, exchangeClientCredentials } from "@/lib/shopify/oauth";
import { registerShopifyWebhooks } from "@/lib/shopify/webhooks";
import { shopifyGet } from "@/lib/shopify/client";
import { encryptToken } from "@/lib/crypto";

export interface ActionResult {
  ok?: boolean;
  error?: string;
}

/**
 * Manually re-sync every connection owned by the current user — fast path.
 * Refreshes orders (revenue) + Meta spend for a 60-day window and recomputes,
 * but SKIPS the product catalogue (slow). Use "Sincronizar produtos" on the
 * Custos page when the catalogue/costs change.
 */
export async function syncNowAction(): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const supabase = await createClient();

  // Keep the on-demand sync light enough to finish inside the serverless time
  // limit (Netlify free ≈ 10s). Each connection sync also RECOMPUTES sinceDays+1
  // days of metrics, so this window drives most of the cost — a small number is
  // what makes "Sync now" reliably succeed. Recent days are what matter day to
  // day; the full backfill happens at connect time and webhooks cover real time.
  const SINCE_DAYS = 3;

  const [{ data: shopify }, { data: meta }, { data: google }] = await Promise.all([
    supabase
      .from("shopify_connections")
      .select("*")
      .eq("user_id", user.id)
      .in("status", ["active", "error"]),
    supabase
      .from("meta_connections")
      .select("*")
      .eq("user_id", user.id)
      .in("status", ["active", "error"]),
    supabase
      .from("google_connections")
      .select("*")
      .eq("user_id", user.id)
      .in("status", ["active", "error"]),
  ]);

  // Per-connection isolation: one platform failing must not fail the whole sync,
  // and the real error is surfaced instead of a generic message.
  const errors: string[] = [];
  for (const conn of shopify ?? []) {
    try {
      await syncShopifyConnection(supabase, conn, {
        sinceDays: SINCE_DAYS,
        skipProducts: true,
      });
    } catch (e) {
      errors.push(`Shopify: ${e instanceof Error ? e.message : "erro"}`);
    }
  }
  for (const conn of meta ?? []) {
    try {
      await syncMetaConnection(supabase, conn, { sinceDays: SINCE_DAYS });
    } catch (e) {
      errors.push(`Meta: ${e instanceof Error ? e.message : "erro"}`);
    }
  }
  for (const conn of google ?? []) {
    try {
      await syncGoogleConnection(supabase, conn, { sinceDays: SINCE_DAYS });
    } catch (e) {
      errors.push(`Google: ${e instanceof Error ? e.message : "erro"}`);
    }
  }

  try {
    await refreshCampaignLinks(supabase, user.id);
  } catch {
    /* non-fatal */
  }

  revalidatePath("/dashboard");
  revalidatePath("/connections");

  return errors.length > 0
    ? { ok: false, error: errors.join(" · ") }
    : { ok: true };
}

/**
 * Fast, on-demand refresh for the dashboard: pulls recent Shopify ORDERS
 * (revenue, refunds) AND Meta ad SPEND for a short window, then recomputes so
 * every KPI (revenue, profit, ROAS…) is fresh — not just ad spend. Kept to a
 * 3-day window and skips the slow product catalogue so it stays quick. When
 * `force` is false a 60s throttle coalesces rapid re-mounts. Surfaces a
 * per-connection error so a failing token is visible instead of silently stale.
 */
export async function refreshMetaSpendAction(
  force = false,
): Promise<ActionResult & { synced?: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const supabase = await createClient();

  const [{ data: metaConns }, { data: shopConns }] = await Promise.all([
    supabase
      .from("meta_connections")
      .select("*")
      .eq("user_id", user.id)
      .in("status", ["active", "error"]),
    supabase
      .from("shopify_connections")
      .select("*")
      .eq("user_id", user.id)
      .in("status", ["active", "error"]),
  ]);

  const hasMeta = (metaConns?.length ?? 0) > 0;
  const hasShopify = (shopConns?.length ?? 0) > 0;
  if (!hasMeta && !hasShopify) return { ok: true, synced: false };

  if (!force) {
    const THROTTLE_MS = 60 * 1000;
    const mostRecent = [...(metaConns ?? []), ...(shopConns ?? [])].reduce(
      (acc, m) => {
        const t = m.last_synced_at ? new Date(m.last_synced_at).getTime() : 0;
        return Math.max(acc, t);
      },
      0,
    );
    if (Date.now() - mostRecent < THROTTLE_MS) {
      return { ok: true, synced: false };
    }
  }

  // Fetch orders (revenue) + Meta spend in PARALLEL, each skipping its own
  // recompute; then recompute ONCE. This is what keeps it inside the serverless
  // time limit — the previous sequential syncs + double recompute timed out in
  // prod. Per-connection errors are recorded on the row (surfaced below).
  const WINDOW = 2;
  await Promise.all([
    ...(shopConns ?? []).map((c) =>
      syncShopifyConnection(supabase, c, {
        sinceDays: WINDOW,
        skipProducts: true,
        skipRecompute: true,
      }).catch(() => {}),
    ),
    ...(metaConns ?? []).map((c) =>
      syncMetaConnection(supabase, c, {
        sinceDays: WINDOW,
        skipRecompute: true,
      }).catch(() => {}),
    ),
  ]);

  const { data: settings } = await supabase
    .from("settings")
    .select("timezone")
    .eq("user_id", user.id)
    .single();
  const tz = settings?.timezone ?? "UTC";
  await recomputeDailyMetrics(
    supabase,
    user.id,
    lastNDays(Math.max(WINDOW + 1, 3), tz),
  );

  // Surface a per-connection error (the syncs record them on the row; one bad
  // account doesn't block the others).
  const [{ data: mErr }, { data: sErr }] = await Promise.all([
    supabase
      .from("meta_connections")
      .select("last_sync_error")
      .eq("user_id", user.id)
      .eq("status", "error")
      .limit(1),
    supabase
      .from("shopify_connections")
      .select("last_sync_error")
      .eq("user_id", user.id)
      .eq("status", "error")
      .limit(1),
  ]);
  const connError = mErr?.[0]?.last_sync_error ?? sErr?.[0]?.last_sync_error;
  if (connError) return { ok: false, error: connError };

  revalidatePath("/dashboard");
  return { ok: true, synced: true };
}

/**
 * Refresh ONLY the Shopify product catalogue + costs (the slow part of a sync).
 * Backs the dedicated button on the Custos page so day-to-day syncs stay fast.
 */
export async function syncProductsAction(): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const supabase = await createClient();

  try {
    await syncShopifyProductsForUser(supabase, user.id);
    revalidatePath("/costs");
    revalidatePath("/products");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Sync failed.",
    };
  }
}

/**
 * Connect a Shopify store using an Admin API access token from a *custom app*
 * created in the store admin (Settings → Apps → Develop apps). This works on a
 * real store immediately, with no Partners OAuth / app review.
 */
export async function connectShopifyTokenAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sessão expirada. Faz login outra vez." };

  const shop = normalizeShopDomain(String(formData.get("shop") ?? ""));
  const clientId = String(formData.get("client_id") ?? "").trim();
  const secret = String(formData.get("token") ?? "").trim();
  if (!shop)
    return { ok: false, error: "Domínio de loja inválido (ex.: a-tua-loja.myshopify.com)." };
  if (!secret)
    return {
      ok: false,
      error: "Cola a API secret key (shpss_…) ou um Admin API token (shpat_…).",
    };

  // With a Client ID → the `client_credentials` grant (custom app): exchange the
  // API key + secret for a short-lived shpat_. Without one → the field is treated
  // as a direct Admin API token (shpat_).
  const useClientCredentials = clientId.length > 0;
  let verifyToken: string;
  try {
    verifyToken = useClientCredentials
      ? (await exchangeClientCredentials(shop, clientId, secret)).token
      : secret;
    // Read-only check that the resolved token actually works.
    await shopifyGet(shop, verifyToken, "shop");
  } catch (e) {
    return {
      ok: false,
      error: useClientCredentials
        ? `Não deu para autenticar com Client ID + secret. Confirma que são o par certo (mesmo separador "API credentials") e os scopes (orders, products, inventory). ${
            e instanceof Error ? e.message : ""
          }`.trim()
        : "Token inválido ou sem permissões. Confirma os scopes (orders, products, inventory) no custom app.",
    };
  }

  const supabase = await createClient();

  // Best-effort webhook registration. Skipped for client_credentials: those
  // webhooks are signed by the custom app's own secret, which the receiver
  // can't verify against the global app secret — the 15-min cron keeps it fresh.
  let webhookIds: number[] = [];
  if (!useClientCredentials) {
    try {
      webhookIds = await registerShopifyWebhooks(shop, verifyToken);
    } catch {
      /* non-fatal on localhost */
    }
  }

  const { data: conn, error } = await supabase
    .from("shopify_connections")
    .upsert(
      {
        user_id: user.id,
        shop_domain: shop,
        // client_credentials: store the SECRET (encrypted) + the API key; each
        // sync re-exchanges for a fresh shpat_. token mode: store the shpat_.
        access_token: encryptToken(secret),
        auth_type: useClientCredentials ? "client_credentials" : "token",
        client_id: useClientCredentials ? clientId : null,
        scope: "custom_app",
        status: "active",
        webhook_ids: webhookIds,
        last_sync_error: null,
      },
      { onConflict: "user_id,shop_domain" },
    )
    .select("*")
    .single();
  if (error || !conn) {
    return { ok: false, error: error?.message ?? "Não foi possível guardar a ligação." };
  }

  // Kick off the initial historical import.
  try {
    await initialShopifyImport(supabase, conn);
  } catch {
    /* cron will retry */
  }

  // If ad accounts were connected before this store, attach them to it now.
  try {
    await autoMapAdAccountsToSoleStore(supabase, user.id);
  } catch {
    /* best-effort */
  }

  revalidatePath("/connections");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function disconnectShopifyAction(
  connectionId: string,
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const supabase = await createClient();

  const { error } = await supabase
    .from("shopify_connections")
    .delete()
    .eq("id", connectionId)
    .eq("user_id", user.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/connections");
  return { ok: true };
}

export async function disconnectMetaAction(
  connectionId: string,
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const supabase = await createClient();

  const { error } = await supabase
    .from("meta_connections")
    .delete()
    .eq("id", connectionId)
    .eq("user_id", user.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/connections");
  return { ok: true };
}

/**
 * Map (or unmap) a Meta / Google ad account to a Shopify store, so its spend is
 * attributed to that store in the per-store dashboard. Recomputes the last 90
 * days so the change is reflected immediately. `storeId = null` detaches it.
 */
export async function setAdAccountStore(
  provider: "meta" | "google",
  connectionId: string,
  storeId: string | null,
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const supabase = await createClient();

  const table = provider === "meta" ? "meta_connections" : "google_connections";
  const { error } = await supabase
    .from(table)
    .update({ shopify_connection_id: storeId })
    .eq("id", connectionId)
    .eq("user_id", user.id);
  if (error) return { ok: false, error: error.message };

  // Reattribute recent metrics so the store views reflect the new mapping.
  try {
    const { data: settings } = await supabase
      .from("settings")
      .select("timezone")
      .eq("user_id", user.id)
      .single();
    await recomputeDailyMetrics(
      supabase,
      user.id,
      lastNDays(90, settings?.timezone ?? "UTC"),
    );
  } catch {
    /* best-effort — the next sync recomputes anyway */
  }

  revalidatePath("/connections");
  revalidatePath("/dashboard");
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Google Ads (mock — no real OAuth yet)                               */
/* ------------------------------------------------------------------ */

/**
 * Connect a Google Ads account using MOCK data. Creates a connection row and
 * seeds ~90 days of example campaigns, then recomputes so the dashboard shows
 * cross-platform spend/ROAS. Replace with real OAuth (`/api/google/*`) later.
 */
export async function connectGoogleMockAction(): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const supabase = await createClient();

  const storeCurrency = await getStoreCurrency(supabase, user.id);
  const { data: conn, error } = await supabase
    .from("google_connections")
    .upsert(
      {
        user_id: user.id,
        customer_id: "123-456-7890",
        customer_name: "Google Ads (demo)",
        account_currency: storeCurrency ?? "EUR",
        access_token: encryptToken("mock"),
        status: "active",
        last_sync_error: null,
      },
      { onConflict: "user_id,customer_id" },
    )
    .select("*")
    .single();
  if (error || !conn) {
    return { ok: false, error: error?.message ?? "Não foi possível ligar." };
  }

  // Attribute the account to the store before importing (no-op unless exactly
  // one store), so the import's recompute credits its spend to that store.
  try {
    await autoMapAdAccountsToSoleStore(supabase, user.id);
  } catch {
    /* best-effort */
  }

  try {
    await initialGoogleImport(supabase, conn);
  } catch {
    /* non-fatal: a manual re-sync will retry */
  }

  revalidatePath("/connections");
  revalidatePath("/dashboard");
  revalidatePath("/ads");
  return { ok: true };
}

export async function disconnectGoogleAction(
  connectionId: string,
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const supabase = await createClient();

  // Deleting the connection cascade-deletes its google_campaigns rows.
  const { error } = await supabase
    .from("google_connections")
    .delete()
    .eq("id", connectionId)
    .eq("user_id", user.id);
  if (error) return { ok: false, error: error.message };

  // Recompute so ad_spend_google zeroes out of the dashboard.
  try {
    const { data: settings } = await supabase
      .from("settings")
      .select("timezone")
      .eq("user_id", user.id)
      .single();
    await recomputeDailyMetrics(supabase, user.id, lastNDays(90, settings?.timezone ?? "UTC"));
  } catch {
    /* best-effort */
  }

  revalidatePath("/connections");
  revalidatePath("/dashboard");
  revalidatePath("/ads");
  return { ok: true };
}
