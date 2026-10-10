import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { resolveShopifyToken } from "./auth";
import { shopifyGet } from "./client";

const currencyCode = (value: string | null | undefined) => {
  const code = value?.trim().toUpperCase();
  return code && /^[A-Z]{3}$/.test(code) ? code : null;
};

/** Pin the reporting base before importing spend, including stores with no orders.
 * Existing bases (or legacy order currencies) must not be reinterpreted when a
 * merchant changes Shopify's current currency. Reads/writes stay owner-scoped.
 */
export async function ensureStoreReportingCurrency(
  db: SupabaseClient<Database>,
  userId: string,
  storeId: string,
  shopCurrency?: string | null,
): Promise<string> {
  const { data: store, error } = await db.from("shopify_connections")
    .select("*").eq("user_id", userId).eq("id", storeId).maybeSingle();
  if (error) throw error;
  if (!store) throw new Error("A loja associada à conta de anúncios não está disponível.");
  if (store.reporting_base_currency) return store.reporting_base_currency;

  const { data: order, error: orderError } = await db.from("orders").select("currency")
    .eq("user_id", userId).eq("shopify_connection_id", storeId)
    .not("currency", "is", null).order("processed_at", { ascending: false }).limit(1).maybeSingle();
  if (orderError) throw orderError;
  let currency = currencyCode(order?.currency);
  if (!currency) {
    // Shopify sync already fetched this metadata; Meta sync can initialize it
    // independently, even if both providers are refreshing concurrently.
    if (shopCurrency === undefined) {
      const token = await resolveShopifyToken(store);
      const { data } = await shopifyGet<{ shop?: { currency?: string } }>(
        store.shop_domain, token, "shop", { fields: "currency" },
      );
      shopCurrency = data.shop?.currency ?? null;
    }
    currency = currencyCode(shopCurrency);
  }
  if (!currency) throw new Error("Não foi possível identificar a moeda da loja no Shopify. Atualiza a ligação antes de importar os anúncios.");

  const { error: saveError } = await db.from("shopify_connections")
    .update({ reporting_base_currency: currency }).eq("user_id", userId).eq("id", storeId)
    .is("reporting_base_currency", null);
  if (saveError) throw saveError;
  // A simultaneous sync may have pinned it first. Always use the saved base.
  const { data: saved, error: readError } = await db.from("shopify_connections")
    .select("reporting_base_currency").eq("user_id", userId).eq("id", storeId).single();
  if (readError) throw readError;
  if (!saved?.reporting_base_currency) throw new Error("Não foi possível guardar a moeda da loja.");
  return saved.reporting_base_currency;
}
