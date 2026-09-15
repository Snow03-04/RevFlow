import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/types/database";
import type { DateRange } from "@/types";
import { selectAllByUser } from "@/lib/supabase/paginate";
import { fetchTrackerOrderSales } from "./sales";
import { buildResolver, fetchCampaignTargetMap, fetchMatcherProducts, trackerFxByMetaConnection } from "./match";
import { allocateMetaPnl, metaCampaignKey } from "./meta-pnl";

type DB = SupabaseClient<Database>;
type CampaignRow = Pick<Tables<"campaigns">, "campaign_id" | "meta_connection_id" | "campaign_name" | "date" | "spend" | "purchases" | "purchase_value">;

export interface MetaPnlOption {
  key: string;
  name: string;
  storeId: string | null;
  storeName: string;
  accountName: string;
  campaignId: string;
}

export async function getMetaPnlCatalog(db: DB, userId: string, year: number) {
  const [rows, connections, stores] = await Promise.all([
    selectAllByUser<CampaignRow>(db, "campaigns",
      "campaign_id,meta_connection_id,campaign_name,date,spend,purchases,purchase_value", userId,
      (q) => q.gte("date", `${year}-01-01`).lte("date", `${year}-12-31`).order("date")),
    selectAllByUser<Pick<Tables<"meta_connections">, "id" | "ad_account_name" | "shopify_connection_id">>(
      db, "meta_connections", "id,ad_account_name,shopify_connection_id", userId),
    selectAllByUser<{ id: string; shop_name: string | null; shop_domain: string }>(
      db, "shopify_connections", "id,shop_name,shop_domain", userId),
  ]);
  const byConnection = new Map(connections.map((c) => [c.id, c]));
  const byStore = new Map(stores.map((s) => [s.id, s]));
  const options = new Map<string, MetaPnlOption>();
  for (const row of rows) {
    const conn = byConnection.get(row.meta_connection_id ?? "");
    const store = byStore.get(conn?.shopify_connection_id ?? "");
    const key = metaCampaignKey(row.meta_connection_id, row.campaign_id);
    options.set(key, {
      key, name: row.campaign_name || row.campaign_id, campaignId: row.campaign_id,
      storeId: store?.id ?? null,
      storeName: store?.shop_name || store?.shop_domain || "Sem loja associada",
      accountName: conn?.ad_account_name || "Meta",
    });
  }
  return {
    rows,
    options: [...options.values()].sort((a, b) =>
      a.storeName.localeCompare(b.storeName) || a.name.localeCompare(b.name) || a.key.localeCompare(b.key)),
  };
}

/** Read-only projection: never reads/writes the editable consolidated pnl_days. */
export async function getMetaPnlDays(
  db: DB,
  userId: string,
  rows: CampaignRow[],
  range: DateRange,
  currency: string,
) {
  const inRange = rows.filter((r) => r.date >= range.from && r.date <= range.to);
  if (!inRange.length) return [];
  const { data: settings, error } = await db.from("settings").select("timezone").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  const [fx, products, targets, orders] = await Promise.all([
    trackerFxByMetaConnection(db, userId, currency),
    fetchMatcherProducts(db, userId),
    fetchCampaignTargetMap(db, userId),
    fetchTrackerOrderSales(db, userId, range, settings?.timezone ?? "UTC"),
  ]);
  const resolvers = new Map<string, ReturnType<typeof buildResolver>>();
  return allocateMetaPnl(inRange.map((r) => {
    const storeId = fx.stores.get(r.meta_connection_id ?? "") ?? null;
    if (storeId && !resolvers.has(storeId)) resolvers.set(storeId, buildResolver(products, targets, storeId));
    return {
      key: metaCampaignKey(r.meta_connection_id, r.campaign_id),
      date: r.date, name: r.campaign_name || r.campaign_id, storeId,
      target: storeId ? resolvers.get(storeId)!(r.campaign_id, r.campaign_name ?? "") : null,
      rate: fx.rates.get(r.meta_connection_id ?? "") ?? fx.fallback,
      spend: Number(r.spend), purchases: Number(r.purchases), purchaseValue: Number(r.purchase_value),
    };
  }), orders);
}
