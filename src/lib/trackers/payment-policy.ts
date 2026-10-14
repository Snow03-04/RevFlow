import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/types/database";

/** One payment assumption for every store and report; cash ledgers keep actual fees. */
export async function loadPaymentPolicy(db: SupabaseClient<Database>, userId: string,
  fallback: Pick<Tables<"settings">, "currency" | "payment_fee_pct" | "payment_fee_fixed"> | null) {
  const [settings, overrides] = await Promise.all([
    db.from("pnl_settings").select("*").eq("user_id", userId).maybeSingle(),
    db.from("pnl_month_overrides").select("year,month,transaction_fee").eq("user_id", userId),
  ]);
  if (settings.error) throw settings.error;
  if (overrides.error) throw overrides.error;
  const pnl = settings.data;
  const currency = ({ "€": "EUR", "$": "USD", "£": "GBP" } as Record<string, string>)[pnl?.currency ?? ""]
    ?? pnl?.currency ?? fallback?.currency ?? "EUR";
  const paymentPct = Number(pnl?.payment_fee_pct ?? Number(fallback?.payment_fee_pct ?? 2.5) / 100);
  const fixed = Number(pnl?.transaction_fee ?? fallback?.payment_fee_fixed ?? 0.3);
  const byMonth = new Map((overrides.data ?? []).map((r) =>
    [`${r.year}-${String(r.month).padStart(2, "0")}`, r.transaction_fee]));
  return { currency, paymentPct, fixedForDate: (date: string) => Number(byMonth.get(date.slice(0, 7)) ?? fixed) };
}
