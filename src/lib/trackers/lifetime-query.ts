import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/types/database";
import { selectAllByUser } from "@/lib/supabase/paginate";
import { getStoreFxRates } from "@/lib/queries";
import { getGoogleSpendEstimates } from "@/lib/google/spend-estimates";
import { todayYmd } from "@/lib/date";
import { getPnlSettings } from "./queries";
import { buildLifetimeReport, lifetimeFees, readStoreHistory, type LifetimeMetric, type LifetimeStore, type StoreHistory } from "./lifetime";

export async function getLifetimeData(db: SupabaseClient<Database>, userId: string, metadata: Record<string, unknown>, storeId?: string) {
  const [allStores, allMetrics, overrides, pnl, settings] = await Promise.all([
    selectAllByUser<LifetimeStore>(db, "shopify_connections", "id,shop_name,shop_domain,status,last_synced_at", userId),
    selectAllByUser<LifetimeMetric>(db, "daily_metrics", "date,shopify_connection_id,gross_revenue,shipping_revenue,refunds,product_cost,ad_spend_meta,ad_spend_google,orders_count,units_sold", userId, (q) => q.order("date")),
    selectAllByUser<Tables<"pnl_month_overrides">>(db, "pnl_month_overrides", "*", userId),
    getPnlSettings(db, userId),
    db.from("settings").select("currency,fx_rate_override,timezone").eq("user_id", userId).maybeSingle(),
  ]);
  if (settings.error) throw settings.error;
  const timezone = settings.data?.timezone ?? "UTC";
  const today = todayYmd(timezone);
  const stores = allStores.filter((store) => !storeId || store.id === storeId);
  const metrics = allMetrics.filter((row) => row.date <= today && (!storeId || row.shopify_connection_id === storeId));
  const currency = ({ "€": "EUR", "$": "USD", "£": "GBP" } as Record<string, string>)[pnl.currency] ?? pnl.currency;
  const rates = await getStoreFxRates(db, userId, currency, settings.data?.fx_rate_override, true, settings.data?.currency);
  const histories = new Map<string, StoreHistory>();
  for (const store of stores) {
    const history = readStoreHistory(metadata, store.id);
    if (history) histories.set(store.id, history);
  }
  // Date range deliberately has no base-year or trailing-90-day restriction.
  const estimates = await getGoogleSpendEstimates(db, userId, allStores, { from: "1900-01-01", to: today }, rates, storeId);
  const report = buildLifetimeReport({ stores, histories, metrics, rates, feesForDate: lifetimeFees(pnl, overrides), today, estimates });
  return { ...report, stores, histories: Object.fromEntries(histories), currency, timezone, today,
    invalidStore: !!storeId && !stores.length };
}
