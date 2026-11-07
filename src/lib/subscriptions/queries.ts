import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { selectAllByUser } from "@/lib/supabase/paginate";
import { todayYmd } from "@/lib/date";
import { storeLabel } from "@/lib/utils";
import { subscriptionAlerts, type StoreSubscription } from "./model";

export async function getSubscriptionData(db: SupabaseClient<Database>, userId: string) {
  const [rows, stores, settings] = await Promise.all([
    selectAllByUser<StoreSubscription>(db, "store_subscriptions", "*", userId),
    db.from("shopify_connections").select("id,shop_name,shop_domain").eq("user_id", userId).order("shop_name"),
    db.from("settings").select("timezone").eq("user_id", userId).maybeSingle(),
  ]);
  if (stores.error || settings.error) throw new Error("Não foi possível carregar as subscrições.");
  const options = (stores.data ?? []).map(s => ({ id: s.id, label: storeLabel(s.shop_name, s.shop_domain) }));
  const timezone = settings.data?.timezone || "Europe/Lisbon";
  const today = todayYmd(timezone);
  return { rows, stores: options, today, timezone, alerts: subscriptionAlerts(rows, new Map(options.map(s => [s.id, s.label])), today) };
}
