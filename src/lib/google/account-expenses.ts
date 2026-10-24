import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { selectAllByUser } from "@/lib/supabase/paginate";
import { parseScriptCampaignId } from "./script-campaigns";
import { googleSpendStore, type NamedStore } from "./store-labels";

/** Keep account identity in the expense, so several accounts can fund one store. */
export function googleExpenseAccount(label: string | null): string | null {
  return label?.match(/ · conta (\d+) · /)?.[1] ?? null;
}

/** A script account total replaces the same account's OAuth campaign costs.
 * Legacy store totals cover all its accounts; credits alone replace nothing. */
export function googleExpenseCoverage(entries: { date: string; kind: string; label: string | null }[], stores: NamedStore[]) {
  const storeDays = new Set<string>(), accountDays = new Set<string>();
  for (const entry of entries) {
    if (entry.kind !== "expense") continue;
    const store = googleSpendStore(entry.label, stores);
    if (!store) continue;
    const account = googleExpenseAccount(entry.label);
    if (account) accountDays.add(`${store}:${account}:${entry.date}`);
    else storeDays.add(`${store}:${entry.date}`);
  }
  return { storeDays, accountDays, has: (store: string, account: string | null | undefined, date: string) =>
    storeDays.has(`${store}:${date}`) || !!account && accountDays.has(`${store}:${account.replace(/\D/g, "")}:${date}`) };
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
