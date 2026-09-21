import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/types/database";
import { selectAllByUser } from "@/lib/supabase/paginate";
import { decryptToken } from "@/lib/crypto";
import { graphPaginate } from "./client";
import { metaCampaignKey } from "@/lib/trackers/meta-pnl";
import type { MetaPnlOption } from "@/lib/trackers/meta-pnl-query";

const cache = new Map<string, { expires: number; options: MetaPnlOption[] }>();

/** Insights do not contain campaign status. Read current campaign metadata separately. */
export async function getCurrentMetaCampaigns(db: SupabaseClient<Database>, userId: string, storeId?: string) {
  const connections = await selectAllByUser<Tables<"meta_connections">>(db, "meta_connections", "*", userId,
    (q) => q.in("status", ["active", "error"]));
  const unavailable: string[] = [];
  const results = await Promise.all(connections.filter((c) => !storeId || storeId === "all" || c.shopify_connection_id === storeId).map(async (connection) => {
    const key = `${userId}:${connection.id}:${connection.updated_at}`;
    const cached = cache.get(key);
    if (cached && cached.expires > Date.now()) return cached.options;
    try {
      const options: MetaPnlOption[] = [];
      for await (const page of graphPaginate<{ id: string; name: string; effective_status?: string; status?: string }>(`${connection.ad_account_id}/campaigns`, {
        fields: "id,name,effective_status,status", limit: "250", access_token: decryptToken(connection.access_token),
      }, { signal: AbortSignal.timeout(12000) })) {
        for (const campaign of page) options.push({ key: metaCampaignKey(connection.id, campaign.id), campaignId: campaign.id,
          name: campaign.name, status: campaign.effective_status ?? campaign.status ?? null,
          storeId: connection.shopify_connection_id, storeName: "", accountName: connection.ad_account_name ?? "Meta" });
      }
      if (cache.size >= 200) cache.clear();
      cache.set(key, { expires: Date.now() + 120_000, options });
      return options;
    } catch (error) {
      const code = error instanceof Error ? /Meta Graph error (\d+)/.exec(error.message)?.[1] ?? error.name : "unknown";
      console.warn("General sheet: Meta campaign status unavailable", { connectionId: connection.id, code });
      unavailable.push(connection.ad_account_name ?? connection.ad_account_id);
      return [];
    }
  }));
  return { options: results.flat(), unavailable };
}
