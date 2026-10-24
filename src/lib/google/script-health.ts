import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/types/database";
import type { DateRange } from "@/types";
import { selectAllByUser } from "@/lib/supabase/paginate";
import { googleSpendStore, type NamedStore } from "./store-labels";
import { storeLabel } from "@/lib/utils";
import { staleEmptyScriptAccounts } from "./script-campaigns";
import { getScriptAccounts } from "./script-accounts";
import { googleExpenseAccount } from "./account-expenses";
import { readGoogleAccountState } from "./account-monitoring";

export type GoogleScriptWarning = {
  storeId: string;
  storeName: string;
  customerId: string;
  lastReport: string;
  reason: "stale" | "billing";
};

/** Freshness of known script imports, not proof that every historical day is covered.
 * Zero-cost paid snapshots count as received; gross-only snapshots never prove
 * a zero paid expense. Stores without script history are left alone.
 */
export async function getGoogleScriptWarnings(
  db: SupabaseClient<Database>, userId: string, stores: NamedStore[],
  range: DateRange, today: string, storeId?: string, metadata: Record<string, unknown> = {},
): Promise<GoogleScriptWarning[]> {
  const until = range.to < today ? range.to : today;
  if (!stores.length || range.from > until) return [];
  const entries = await selectAllByUser<Pick<Tables<"manual_entries">, "date" | "label">>(
    db, "manual_entries", "date,label", userId,
    (q) => q.eq("kind", "expense").lte("date", until),
  );
  const manualDates = new Map<string, string>();
  for (const entry of entries) {
    const owner = googleSpendStore(entry.label, stores);
    const key = `${owner}:${googleExpenseAccount(entry.label) ?? "all"}`;
    if (owner && entry.date > (manualDates.get(key) ?? "")) manualDates.set(key, entry.date);
  }
  const selectedStores = stores.filter((store) => !storeId || store.id === storeId);
  const results = await Promise.all(selectedStores.map(async (store) => {
    const accounts = await getScriptAccounts(db, userId, store, until);
    return Promise.all(accounts.map(async (account): Promise<GoogleScriptWarning | null> => {
      const { customerId } = account;
      const paid = await db.from("google_campaigns").select("date")
        .eq("user_id", userId).is("google_connection_id", null)
        .like("campaign_id", `script:${store.id}:${customerId}:%`).lte("date", until)
        .order("date", { ascending: false }).limit(1).maybeSingle();
      if (paid.error) throw paid.error;
      const manualDate = [manualDates.get(`${store.id}:all`) ?? "", manualDates.get(`${store.id}:${customerId}`) ?? ""].sort().at(-1)!;
      const lastPaid = [paid.data?.date ?? "", manualDate].sort().at(-1)!;
      const lastReport = [account.lastReport, lastPaid].sort().at(-1)!;
      const active = readGoogleAccountState(metadata, store.id, customerId) === "active";
      // Suspension stops freshness prompts, never declares unknown cost to be zero.
      // Unconfirmed costs actually received inside the selected period still warn.
      let reason: GoogleScriptWarning["reason"] | null = active && lastReport < until ? "stale"
        : lastReport >= range.from && lastPaid < lastReport ? "billing" : null;
      if (!reason && lastReport >= range.from && paid.data?.date === lastReport && manualDate < lastReport) {
        const snapshots = await selectAllByUser<Tables<"google_campaigns">>(
          db, "google_campaigns", "campaign_id,date,spend,gross_spend,updated_at", userId,
          (q) => q.is("google_connection_id", null).like("campaign_id", `%:${store.id}:${customerId}:%`).eq("date", lastReport),
        );
        if (staleEmptyScriptAccounts(snapshots).size) reason = "billing";
      }
      return reason ? { storeId: store.id, storeName: storeLabel(store.shop_name, store.shop_domain), customerId, lastReport, reason } : null;
    }));
  }));
  return results.flat().filter((result): result is GoogleScriptWarning => result !== null);
}
