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
  return new Set(rows.flatMap((r) => {
    const parsed = parseScriptCampaignId(r.campaign_id);
    return parsed ? [parsed.storeId] : [];
  }));
}
