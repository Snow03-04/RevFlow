"use server";

import { revalidatePath } from "next/cache";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import {
  syncShopifyConnection,
  syncMetaConnection,
  syncShopifyProductsForUser,
  syncMetaForUser,
  refreshCampaignLinks,
  initialShopifyImport,
} from "@/lib/jobs";
import { normalizeShopDomain } from "@/lib/shopify/oauth";
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

  const SINCE_DAYS = 60;

  try {
    const { data: shopify } = await supabase
      .from("shopify_connections")
      .select("*")
      .eq("user_id", user.id)
      .in("status", ["active", "error"]);
    for (const conn of shopify ?? []) {
      await syncShopifyConnection(supabase, conn, {
        sinceDays: SINCE_DAYS,
        skipProducts: true,
      });
    }

    const { data: meta } = await supabase
      .from("meta_connections")
      .select("*")
      .eq("user_id", user.id)
      .in("status", ["active", "error"]);
    for (const conn of meta ?? []) {
      await syncMetaConnection(supabase, conn, { sinceDays: SINCE_DAYS });
    }
    // Refresh campaign → product links (throttled internally).
    await refreshCampaignLinks(supabase, user.id);

    revalidatePath("/dashboard");
    revalidatePath("/connections");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Sync failed." };
  }
}

/**
 * Lightweight, on-demand refresh of just the Meta ad spend (last 7 days). Used
 * by the dashboard to keep "Ad Spend" near real-time. When `force` is false a
 * 60s throttle coalesces rapid re-mounts; `force` (used on dashboard open and
 * manual click) always pulls fresh. Surfaces the connection's own sync error so
 * a failing Meta token is visible instead of silently stale.
 */
export async function refreshMetaSpendAction(
  force = false,
): Promise<ActionResult & { synced?: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const supabase = await createClient();

  const { data: meta } = await supabase
    .from("meta_connections")
    .select("id, last_synced_at")
    .eq("user_id", user.id)
    .in("status", ["active", "error"]);

  if (!meta || meta.length === 0) return { ok: true, synced: false };

  if (!force) {
    const THROTTLE_MS = 60 * 1000;
    const mostRecent = meta.reduce((acc, m) => {
      const t = m.last_synced_at ? new Date(m.last_synced_at).getTime() : 0;
      return Math.max(acc, t);
    }, 0);
    if (Date.now() - mostRecent < THROTTLE_MS) {
      return { ok: true, synced: false };
    }
  }

  await syncMetaForUser(supabase, user.id, 7);

  // Surface a per-connection error (syncMetaForUser swallows them so one bad
  // account doesn't block the others, but the user should still see it).
  const { data: after } = await supabase
    .from("meta_connections")
    .select("last_sync_error")
    .eq("user_id", user.id)
    .eq("status", "error")
    .limit(1);
  const connError = after?.[0]?.last_sync_error;
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
  const token = String(formData.get("token") ?? "").trim();
  if (!shop) return { ok: false, error: "Domínio de loja inválido (ex.: a-tua-loja.myshopify.com)." };
  if (!token) return { ok: false, error: "Cola o Admin API access token." };

  // Verify the token works before storing it.
  try {
    await shopifyGet(shop, token, "shop");
  } catch {
    return {
      ok: false,
      error:
        "Token inválido ou sem permissões. Confirma os scopes (orders, products, inventory) no custom app.",
    };
  }

  const supabase = await createClient();

  // Best-effort webhook registration (needs a public HTTPS URL to succeed).
  let webhookIds: number[] = [];
  try {
    webhookIds = await registerShopifyWebhooks(shop, token);
  } catch {
    /* non-fatal on localhost */
  }

  const { data: conn, error } = await supabase
    .from("shopify_connections")
    .upsert(
      {
        user_id: user.id,
        shop_domain: shop,
        access_token: encryptToken(token),
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
