import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/types/database";
import type { DateRange } from "@/types";
import { selectAllByUser } from "@/lib/supabase/paginate";
import { fetchTrackerOrderSales } from "./sales";
import { buildResolver, fetchCampaignTargetMap, fetchMatcherProducts, trackerFxByMetaConnection } from "./match";
import { allocateMetaPnl, metaCampaignKey, type MetaPnlTarget } from "./meta-pnl";
import { todayYmd } from "@/lib/date";
import { metaRoasRange, checkMetaRoas, type MetaRoasFact, type MetaRoasCheck, type MetaRoasSignal } from "./meta-roas";
import { getCollectionMemberships } from "./collection-memberships";
import { generalCampaignLinkId } from "./general-sheet";

type DB = SupabaseClient<Database>;
type CampaignRow = Pick<Tables<"campaigns">, "campaign_id" | "meta_connection_id" | "campaign_name" | "date" | "spend" | "purchases" | "purchase_value" | "status" | "impressions" | "clicks" | "atc">;

export interface MetaPnlOption {
  key: string;
  name: string;
  storeId: string | null;
  storeName: string;
  accountName: string;
  campaignId: string;
  status?: string | null;
}

/** Current streak stays independent of the month/year selected in the sheet. */
export async function getMetaRoasSignals(db: DB, userId: string, options: MetaPnlOption[]) {
  const checks = await getMetaRoasChecks(db, userId, options);
  return new Map([...checks].flatMap(([key, check]): [string, MetaRoasSignal][] => check.signal ? [[key, check.signal]] : []));
}

export async function getMetaRoasChecks(db: DB, userId: string, options: MetaPnlOption[], currency?: string) {
  const checks = new Map<string, MetaRoasCheck>();
  if (!options.length) return checks;
  const { data: settings, error } = await db.from("settings").select("timezone").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  const today = todayYmd(settings?.timezone ?? "UTC");
  const range = metaRoasRange(today);
  const fx = currency ? await trackerFxByMetaConnection(db, userId, currency) : null;
  const rows = await selectAllByUser<Pick<CampaignRow, "campaign_id" | "meta_connection_id" | "date" | "spend" | "purchase_value">>(db, "campaigns",
    "campaign_id,meta_connection_id,date,spend,purchase_value", userId,
    (query) => query.gte("date", range.from).lte("date", range.to));
  const facts = new Map<string, MetaRoasFact[]>();
  for (const row of rows) {
    const key = metaCampaignKey(row.meta_connection_id, row.campaign_id);
    const days = facts.get(key) ?? [];
    const rate = fx ? fx.rates.get(row.meta_connection_id ?? "") ?? fx.fallback : 1;
    days.push({ date: row.date, spend: Number(row.spend) * rate, revenue: Number(row.purchase_value) * rate });
    facts.set(key, days);
  }
  for (const option of options) {
    checks.set(option.key, checkMetaRoas(facts.get(option.key) ?? [], today, option.status));
  }
  return checks;
}

export async function getMetaPnlCatalog(db: DB, userId: string, year: number) {
  const [rows, connections, stores] = await Promise.all([
    selectAllByUser<CampaignRow>(db, "campaigns",
      "campaign_id,meta_connection_id,campaign_name,date,spend,purchases,purchase_value,status,impressions,clicks,atc", userId,
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
      status: row.status,
    });
  }
  return {
    rows,
    stores,
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
  const campaigns = inRange.map((r) => {
    const storeId = fx.stores.get(r.meta_connection_id ?? "") ?? null;
    if (storeId && !resolvers.has(storeId)) resolvers.set(storeId, buildResolver(products, targets, storeId));
    const manualKey = generalCampaignLinkId("meta", metaCampaignKey(r.meta_connection_id, r.campaign_id));
    const target = storeId ? resolvers.get(storeId)!(targets.has(manualKey) ? manualKey : r.campaign_id, r.campaign_name ?? "") : null;
    const product = target?.productId ? products.find((p) => p.storeId === storeId && p.productId === target.productId) : null;
    const displayTarget: MetaPnlTarget | null = target?.collectionHandle
      ? { key: `collection:${target.collectionHandle}`, name: target.collectionHandle.replace(/-/g, " ").replace(/^./u, (c) => c.toUpperCase()), kind: "collection" }
      : target?.productId ? { key: `product:${target.productId}`, name: product?.title || product?.handle || "Produto identificado", kind: "product" } : null;
    return {
      key: metaCampaignKey(r.meta_connection_id, r.campaign_id),
      date: r.date, name: r.campaign_name || r.campaign_id, storeId,
      target, displayTarget,
      rate: fx.rates.get(r.meta_connection_id ?? "") ?? fx.fallback,
      spend: Number(r.spend), purchases: Number(r.purchases), purchaseValue: Number(r.purchase_value),
      impressions: Number(r.impressions ?? 0), clicks: Number(r.clicks ?? 0), atc: Number(r.atc ?? 0),
    };
  });
  const memberships = await getCollectionMemberships(db, userId, campaigns.flatMap((campaign) =>
    campaign.storeId && campaign.target?.collectionHandle ? [{ storeId: campaign.storeId, handle: campaign.target.collectionHandle }] : []));
  return allocateMetaPnl(campaigns, orders, memberships);
}
