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

/** A handed-over account keeps every stored day with the store that holds it.
 * A day never stored follows the nearest earlier stored day, so new days go to
 * the latest holder and the previous store's script can no longer rebook them. */
export function scriptAccountTimeline(rows: { campaign_id: string; date: string }[], ownedStores: Set<string>) {
  const held = new Map<string, string | null>(), stores = new Set<string>();
  for (const row of rows) {
    // Script IDs survive deletion of a Shopify connection. Those historical IDs
    // must not block the account when its store is connected again with a new ID.
    const parsed = parseScriptCampaignId(row.campaign_id);
    if (!parsed || !ownedStores.has(parsed.storeId)) continue;
    stores.add(parsed.storeId);
    const holder = held.get(row.date);
    // Two stores on one day is unresolved history: neither may overwrite it.
    held.set(row.date, holder === undefined || holder === parsed.storeId ? parsed.storeId : null);
  }
  const dates = [...held.keys()].sort();
  const owner = (date: string): string | null => {
    if (held.has(date)) return held.get(date)!;
    let nearest = dates[0];
    for (const stored of dates) { if (stored > date) break; nearest = stored; }
    return nearest ? held.get(nearest)! : null;
  };
  /** An unknown account accepts any store; a store holding no day cannot claim another's account. */
  return { stores, owner, accepts: (store: string, date: string) => !stores.size || owner(date) === store };
}

export async function scriptAccountDays(db: SupabaseClient<Database>, userId: string, customerId: string) {
  const rows = await selectAllByUser<{ campaign_id: string; date: string }>(db, "google_campaigns", "campaign_id,date", userId,
    (q) => q.like("campaign_id", `%:${customerId.replace(/\D/g, "")}:%`));
  const stores = await selectAllByUser<{ id: string }>(db, "shopify_connections", "id", userId);
  return scriptAccountTimeline(rows, new Set(stores.map((store) => store.id)));
}

export async function scriptAccountStores(db: SupabaseClient<Database>, userId: string, customerId: string) {
  return (await scriptAccountDays(db, userId, customerId)).stores;
}
