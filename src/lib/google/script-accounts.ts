import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { NamedStore } from "./store-labels";

/** Read one latest row per account, without downloading its campaign history. */
export async function getScriptAccounts(db: SupabaseClient<Database>, userId: string, store: NamedStore, until?: string) {
  const accounts: { customerId: string; lastReport: string }[] = [];
  for (;;) {
    let query = db.from("google_campaigns").select("campaign_id,date")
      .eq("user_id", userId).is("google_connection_id", null)
      .like("campaign_id", `script%:${store.id}:%`)
      .order("date", { ascending: false }).limit(1);
    if (until) query = query.lte("date", until);
    for (const account of accounts) query = query.not("campaign_id", "like", `%:${account.customerId}:%`);
    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    if (!data) return accounts;
    const parts = data.campaign_id.split(":");
    if (parts.length !== 4 || parts[1] !== store.id || !/^\d+$/.test(parts[2])) throw new Error("Identidade da conta Google inválida.");
    accounts.push({ customerId: parts[2], lastReport: data.date });
  }
}
