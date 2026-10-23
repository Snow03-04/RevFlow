import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/types/database";

/** One policy for metrics and campaign reports, resolved within the owned store. */
export async function loadPaymentPolicy(db: SupabaseClient<Database>, userId: string,
  fallback: Pick<Tables<"settings">, "currency" | "payment_fee_pct" | "payment_fee_fixed"> | null) {
  const [settings, overrides, stores] = await Promise.all([
    db.from("pnl_settings").select("*").eq("user_id", userId).maybeSingle(),
    db.from("pnl_month_overrides").select("year,month,transaction_fee").eq("user_id", userId),
    db.from("shopify_connections").select("id,payment_fee_mode,payment_fee_pct,payment_fee_fixed,payment_fee_currency").eq("user_id", userId),
  ]);
  if (settings.error) throw settings.error;
  if (overrides.error) throw overrides.error;
  if (stores.error) throw stores.error;
  const pnl = settings.data;
  const currency = ({ "€": "EUR", "$": "USD", "£": "GBP" } as Record<string, string>)[pnl?.currency ?? ""]
    ?? pnl?.currency ?? fallback?.currency ?? "EUR";
  const paymentPct = Number(pnl?.payment_fee_pct ?? Number(fallback?.payment_fee_pct ?? 2.5) / 100);
  const fixed = Number(pnl?.transaction_fee ?? fallback?.payment_fee_fixed ?? 0.3);
  const byMonth = new Map((overrides.data ?? []).map((r) =>
    [`${r.year}-${String(r.month).padStart(2, "0")}`, r.transaction_fee]));
  const inherited = { currency, paymentPct, actual: false,
    fixedForDate: (date: string) => Number(byMonth.get(date.slice(0, 7)) ?? fixed) };
  const byStore = new Map((stores.data ?? []).map(store => [store.id, store]));
  return { ...inherited, forStore: (storeId: string | null) => {
    const store = storeId ? byStore.get(storeId) : undefined;
    if (!store || !store.payment_fee_mode || store.payment_fee_mode === "inherit") return inherited;
    return { currency: store.payment_fee_currency ?? currency,
      paymentPct: Number(store.payment_fee_pct ?? paymentPct), actual: store.payment_fee_mode === "shopify",
      fixedForDate: () => Number(store.payment_fee_fixed ?? fixed) };
  } };
}
