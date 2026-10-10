import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { selectAllByUser } from "@/lib/supabase/paginate";
import { parseScriptCampaignId } from "./script-campaigns";

/** Keep account identity in the expense, so several accounts can fund one store. */
export function googleExpenseAccount(label: string | null): string | null {
  return label?.match(/ · conta (\d+) · /)?.[1] ?? null;
}

export async function scriptAccountStores(db: SupabaseClient<Database>, userId: string, customerId: string) {
  const rows = await selectAllByUser<{ campaign_id: string }>(db, "google_campaigns", "campaign_id", userId,
    (q) => q.like("campaign_id", `%:${customerId.replace(/\D/g, "")}:%`));
  // Script IDs survive deletion of a Shopify connection. Those historical IDs
  // must not block the account when its store is connected again with a new ID.
  const stores = await selectAllByUser<{ id: string }>(db, "shopify_connections", "id", userId);
  const ownedStores = new Set(stores.map((store) => store.id));
  return new Set(rows.flatMap((r) => {
    const parsed = parseScriptCampaignId(r.campaign_id);
    return parsed && ownedStores.has(parsed.storeId) ? [parsed.storeId] : [];
  }));
}
