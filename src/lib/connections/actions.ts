"use server";

import { revalidatePath } from "next/cache";
import { refreshRecentData } from "@/lib/sync/recent";
import { invalidateSyncedViews } from "@/lib/sync/invalidate";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import {
  syncShopifyProductsForUser,
  initialShopifyImport,
  initialGoogleImport,
  autoMapAdAccountsToSoleStore,
  reimportShopifyOrdersForUser,
} from "@/lib/jobs";
import { getStoreCurrency } from "@/lib/queries";
import { recomputeDailyMetrics } from "@/lib/metrics";
import { projectPnlMonth } from "@/lib/trackers/pnl-import";
import { projectRoasMonth } from "@/lib/trackers/roas-import";
import { lastNDays } from "@/lib/date";
import {
  normalizeShopDomain,
  exchangeClientCredentials,
} from "@/lib/shopify/oauth";
import { registerShopifyWebhooks } from "@/lib/shopify/webhooks";
import { shopifyGet } from "@/lib/shopify/client";
import { encryptToken } from "@/lib/crypto";

export interface ActionResult {
  ok?: boolean;
  error?: string;
}

/** Manual sync shares the same pipeline as automatic HTTP refreshes. */
export async function syncNowAction(): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const result = await refreshRecentData(await createClient(), user.id, true);
  invalidateSyncedViews();
  return result;
}

/**
 * Repair pulled-too-few-orders months: re-import EVERY order created in the last
 * ~6 months (by created_at, not updated_at) for all of the user's stores, then
 * recompute so revenue/profit reflect the orders that were previously missing.
 * Heavier than a normal sync — the page that calls it raises its maxDuration.
 */
export async function reimportOrdersAction(): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const supabase = await createClient();

  // ~6 months back covers the recent months a merchant is likely reviewing while
  // staying inside the serverless time budget. Older history can be widened later.
  const DAYS = 190;
  try {
    await reimportShopifyOrdersForUser(supabase, user.id, DAYS, {
      includeAds: true,
    });
  } catch (e) {
    return {
      ok: false,
      error:
        e instanceof Error ? e.message : "Falha ao re-importar encomendas.",
    };
  }

  // Refresh both trackers after a historical repair and report partial failures.
  const projectionErrors: string[] = [];
  const now = new Date();
  for (let i = 0; i <= 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    try {
      await projectPnlMonth(
        supabase,
        user.id,
        d.getFullYear(),
        d.getMonth() + 1,
      );
      await projectRoasMonth(
        supabase,
        user.id,
        d.getFullYear(),
        d.getMonth() + 1,
      );
    } catch (error) {
      projectionErrors.push(
        error instanceof Error ? error.message : "Falha a atualizar as folhas.",
      );
    }
  }

  revalidatePath("/dashboard");
  revalidatePath("/pnl");
  revalidatePath("/connections");
  revalidatePath("/roas");
  revalidatePath("/cogs-audit");
  revalidatePath("/supplier");
  if (projectionErrors.length)
    return {
      ok: false,
      error: `Encomendas importadas, mas a atualização das folhas ficou incompleta: ${projectionErrors.join(" · ")}`,
    };
  return { ok: true };
}

/** Retained for assistant tools; refreshes all connected sources consistently. */
export async function refreshMetaSpendAction(force = false): Promise<ActionResult & { synced?: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const result = await refreshRecentData(await createClient(), user.id, force);
  invalidateSyncedViews();
  return result;
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
  if (!user)
    return { ok: false, error: "Sessão expirada. Faz login outra vez." };

  const shop = normalizeShopDomain(String(formData.get("shop") ?? ""));
  const clientId = String(formData.get("client_id") ?? "").trim();
  const secret = String(formData.get("token") ?? "").trim();
  if (!shop)
    return {
      ok: false,
      error: "Domínio de loja inválido (ex.: a-tua-loja.myshopify.com).",
    };
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
    return {
      ok: false,
      error: error?.message ?? "Não foi possível guardar a ligação.",
    };
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
    await recomputeDailyMetrics(
      supabase,
      user.id,
      lastNDays(90, settings?.timezone ?? "UTC"),
    );
  } catch {
    /* best-effort */
  }

  revalidatePath("/connections");
  revalidatePath("/dashboard");
  revalidatePath("/ads");
  return { ok: true };
}
