import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { DateRange } from "@/types";
import { getStoreFxRates } from "@/lib/queries";
import { getGoogleSpendEstimates } from "@/lib/google/spend-estimates";
import type { NamedStore } from "@/lib/google/store-labels";
import { selectAllByUser } from "@/lib/supabase/paginate";
import { round2 } from "@/lib/profit";

/** Match the dashboard's unconfirmed Google costs without booking them as paid.
 * Keep this separate from pnl_days so live projection and edits cannot persist
 * an estimate. A paid import (including a credit-funded zero) takes precedence.
 */
export async function getPnlGoogleEstimates(db: SupabaseClient<Database>, userId: string, range: DateRange, currency: string): Promise<Record<string, number>> {
  const [stores, { data: settings, error }] = await Promise.all([
    selectAllByUser<NamedStore>(db, "shopify_connections", "id,shop_name,shop_domain", userId),
    db.from("settings").select("currency,fx_rate_override").eq("user_id", userId).maybeSingle(),
  ]);
  if (error) throw error;
  if (!stores.length) return {};
  const iso = ({ "€": "EUR", "$": "USD", "£": "GBP" } as Record<string, string>)[currency] ?? currency;
  const rates = await getStoreFxRates(db, userId, iso, settings?.fx_rate_override, true, settings?.currency);
  const estimates = await getGoogleSpendEstimates(db, userId, stores, range, rates);
  const byDate: Record<string, number> = {};
  for (const row of estimates) byDate[row.date] = round2((byDate[row.date] ?? 0) + row.amount);
  return byDate;
}
