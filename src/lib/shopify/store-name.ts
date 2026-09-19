import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/types/database";
import { shopifyGet } from "./client";
import { selectAllByUser } from "@/lib/supabase/paginate";
import { googleLabelStore, renamedGoogleLabel, type NamedStore } from "@/lib/google/store-labels";

/** Refresh names without orphaning the existing label-based Google expenses. */
export async function syncStoreName(db: SupabaseClient<Database>, conn: Tables<"shopify_connections">, token: string) {
  const { data } = await shopifyGet<{ shop?: { name?: string } }>(conn.shop_domain, token, "shop", { fields: "name" });
  const name = data.shop?.name?.trim();
  if (!name || name === conn.shop_name) return;
  const [stores, entries] = await Promise.all([
    selectAllByUser<NamedStore>(db, "shopify_connections", "id,shop_name,shop_domain", conn.user_id),
    selectAllByUser<{ id: string; label: string | null }>(db, "manual_entries", "id,label", conn.user_id),
  ]);
  // Change labels first. On failure the old store name remains and the next sync
  // retries; the script's store ID and token stay valid through every rename.
  for (const entry of entries) {
    if (!entry.label || googleLabelStore(entry.label, stores) !== conn.id) continue;
    const label = renamedGoogleLabel(entry.label, conn, name);
    if (label === entry.label) continue;
    const { error } = await db.from("manual_entries").update({ label }).eq("id", entry.id).eq("user_id", conn.user_id);
    if (error) throw error;
  }
  const { error } = await db.from("shopify_connections").update({ shop_name: name }).eq("id", conn.id).eq("user_id", conn.user_id);
  if (error) throw error;
}
