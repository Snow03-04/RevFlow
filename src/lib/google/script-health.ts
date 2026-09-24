import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/types/database";
import type { DateRange } from "@/types";
import { selectAllByUser } from "@/lib/supabase/paginate";
import { googleSpendStore, type NamedStore } from "./store-labels";
import { storeLabel } from "@/lib/utils";

export type GoogleScriptWarning = {
  storeId: string;
  storeName: string;
  lastReport: string;
  reason: "stale" | "billing";
};

/** Freshness of known script imports, not proof that every historical day is covered.
 * Zero-cost paid snapshots count as received; gross-only snapshots never prove
 * a zero paid expense. Stores without script history are left alone.
 */
export async function getGoogleScriptWarnings(
  db: SupabaseClient<Database>, userId: string, stores: NamedStore[],
  range: DateRange, today: string, storeId?: string,
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
    if (owner && entry.date > (manualDates.get(owner) ?? "")) manualDates.set(owner, entry.date);
  }
  const selectedStores = stores.filter((store) => !storeId || store.id === storeId);
  const results = await Promise.all(selectedStores.map(async (store): Promise<GoogleScriptWarning | null> => {
    const latest = (prefix: string) => db.from("google_campaigns").select("date")
      .eq("user_id", userId).is("google_connection_id", null)
      .like("campaign_id", `${prefix}:${store.id}:%`).lte("date", until)
      .order("date", { ascending: false }).limit(1).maybeSingle();
    const [report, paid] = await Promise.all([latest("script%"), latest("script")]);
    if (report.error) throw report.error;
    if (paid.error) throw paid.error;
    // Manual-only bookkeeping has no automatic schedule to monitor.
    if (!report.data) return null;
    const lastPaid = [paid.data?.date ?? "", manualDates.get(store.id) ?? ""].sort().at(-1)!;
    const lastReport = [report.data.date, lastPaid].sort().at(-1)!;
    const reason = lastReport < until ? "stale" : lastPaid < until ? "billing" : null;
    return reason ? { storeId: store.id, storeName: storeLabel(store.shop_name, store.shop_domain), lastReport, reason } : null;
  }));
  return results.filter((result): result is GoogleScriptWarning => result !== null);
}
