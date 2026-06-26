"use server";

import { revalidatePath } from "next/cache";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import {
  syncShopifyConnection,
  syncMetaConnection,
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
 * Manually re-sync every connection owned by the current user.
 * A manual click does a thorough 60-day refresh (re-pulls + recomputes), so it
 * also reconciles historical data after currency fixes or removed ad accounts.
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
      .eq("status", "active");
    for (const conn of shopify ?? []) {
      await syncShopifyConnection(supabase, conn, { sinceDays: SINCE_DAYS });
    }

    const { data: meta } = await supabase
      .from("meta_connections")
      .select("*")
      .eq("user_id", user.id)
      .eq("status", "active");
    for (const conn of meta ?? []) {
      await syncMetaConnection(supabase, conn, { sinceDays: SINCE_DAYS });
    }

    revalidatePath("/dashboard");
    revalidatePath("/connections");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Sync failed." };
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
