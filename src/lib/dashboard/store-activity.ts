import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { selectAllIn } from "@/lib/supabase/paginate";

/** Live business activity, independent of connection status and report filters.
 * Use source orders so recent activity does not wait for a metrics recompute. */
export async function getDashboardStoreActivity(
  db: SupabaseClient<Database>, userId: string, storeIds: string[], now = new Date(),
): Promise<Map<string, "active" | "inactive">> {
  const since = new Date(now.getTime() - 72 * 60 * 60 * 1000).toISOString();
  const rows = await selectAllIn<{ shopify_connection_id: string }>(db, "orders", "shopify_connection_id",
    userId, "shopify_connection_id", storeIds, (query) => query
      .gte("processed_at", since).lte("processed_at", now.toISOString())
      .eq("test", false).is("cancelled_at", null));
  const activeIds = new Set(rows.map((row) => row.shopify_connection_id));
  return new Map(storeIds.map((id) => [id, activeIds.has(id) ? "active" : "inactive"]));
}
