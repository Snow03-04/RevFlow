import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/types/database";
import type { DateRange } from "@/types";
import { selectAllByUser } from "@/lib/supabase/paginate";
import { getStoreFxRates } from "@/lib/queries";
import { parseScriptCampaignId } from "@/lib/google/script-campaigns";
import { storeLabel } from "@/lib/utils";
import { fetchTrackerOrderSales } from "./sales";
import { allocateGooglePnl } from "./google-pnl";
import type { MetaPnlOption } from "./meta-pnl-query";
import { googleLabelStore } from "@/lib/google/store-labels";
import { resolveFx } from "@/lib/fx";
import { googleCollectionLinkId } from "@/lib/google/collection-links";
import { buildGoogleCollections, type GoogleAccountSpend, type GoogleCollectionCampaign } from "./google-collections";

type DB = SupabaseClient<Database>;
type CampaignRow = Tables<"google_campaigns"> & { key: string };

export async function getGooglePnlCatalog(db: DB, userId: string, year: number) {
  const [raw, connections, stores, links] = await Promise.all([
    selectAllByUser<Tables<"google_campaigns">>(db, "google_campaigns", "*", userId,
      (q) => q.gte("date", `${year}-01-01`).lte("date", `${year}-12-31`).order("date")),
    selectAllByUser<Tables<"google_connections">>(db, "google_connections", "id,customer_id,customer_name,shopify_connection_id", userId),
    selectAllByUser<{ id: string; shop_name: string | null; shop_domain: string }>(db, "shopify_connections", "id,shop_name,shop_domain", userId),
    selectAllByUser<Tables<"campaign_links">>(db, "campaign_links", "campaign_id,collection_handle,link_kind", userId, (q) => q.like("campaign_id", "google:%")),
  ]);
  const byStore = new Map(stores.map((s) => [s.id, s]));
  const byConnection = new Map(connections.map((c) => [c.id, c]));
  const byLink = new Map(links.map((l) => [l.campaign_id, l]));
  const options = new Map<string, MetaPnlOption & { collectionHandle: string | null; manualCollection: boolean; status: string | null }>();
  const rows = new Map<string, CampaignRow>();
  for (const row of raw) {
    const script = parseScriptCampaignId(row.campaign_id);
    const conn = byConnection.get(row.google_connection_id ?? "");
    const storeId = script?.storeId ?? conn?.shopify_connection_id ?? null;
    // A disconnected/deleted script store must not expose orphaned amounts.
    if (script && !byStore.has(script.storeId)) continue;
    const store = byStore.get(storeId ?? "");
    const campaignId = script?.campaignId ?? row.campaign_id;
    const account = script?.customerId ?? conn?.customer_id.replace(/\D/g, "") ?? "unmapped";
    const key = `${storeId ?? "unmapped"}:${account}:${campaignId}`;
    const link = byLink.get(googleCollectionLinkId(key));
    options.set(key, { key, campaignId, name: row.campaign_name || campaignId, storeId,
      status: row.status,
      collectionHandle: link?.collection_handle ?? null, manualCollection: link?.link_kind === "google-manual",
      storeName: store ? storeLabel(store.shop_name, store.shop_domain) : "Sem loja associada",
      accountName: conn?.customer_name || `Google · ${account}` });
    // If both ingestion methods exist, choose the most recent observation of
    // this campaign/day; never add the same campaign to itself.
    const previous = rows.get(`${key}:${row.date}`);
    if (!previous || row.updated_at >= previous.updated_at) rows.set(`${key}:${row.date}`, { ...row, key });
  }
  return { stores, rows: [...rows.values()], options: [...options.values()].sort((a, b) => a.storeName.localeCompare(b.storeName) || a.name.localeCompare(b.name)) };
}

export async function getGooglePnlDays(db: DB, userId: string, catalog: Awaited<ReturnType<typeof getGooglePnlCatalog>>, range: DateRange, currency: string) {
  return (await getGoogleFinanceData(db, userId, catalog, range, currency)).days;
}

export async function getGoogleFinanceData(db: DB, userId: string, catalog: Awaited<ReturnType<typeof getGooglePnlCatalog>>, range: DateRange, currency: string) {
  const { data: settings, error } = await db.from("settings").select("timezone,currency,fx_rate_override").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  const iso = ({ "€": "EUR", "$": "USD", "£": "GBP" } as Record<string, string>)[currency] ?? currency;
  const [rates, orders, accountSpend] = await Promise.all([
    getStoreFxRates(db, userId, iso, settings?.fx_rate_override, true, settings?.currency ?? iso),
    fetchTrackerOrderSales(db, userId, range, settings?.timezone ?? "UTC", "google"),
    getGoogleScriptDailySpend(db, userId, range, currency),
  ]);
  const campaigns: GoogleCollectionCampaign[] = catalog.options.map((c) => ({ ...c, rate: rates.get(c.storeId ?? "") ?? 1 }));
  const facts = catalog.rows.filter((r) => r.date >= range.from && r.date <= range.to).map((r) => ({ key: r.key, date: r.date, spend: Number(r.spend),
    grossSpend: r.gross_spend != null ? Number(r.gross_spend) : parseScriptCampaignId(r.campaign_id) ? null : Number(r.spend),
    conversions: Number(r.purchases), conversionValue: Number(r.purchase_value), clicks: Number(r.clicks), impressions: Number(r.impressions) }));
  return { campaigns, accountSpend, days: allocateGooglePnl(campaigns, facts, orders),
    collections: buildGoogleCollections(campaigns, facts, orders, catalog.stores.map((s) => ({ id: s.id,
      name: storeLabel(s.shop_name, s.shop_domain), rate: rates.get(s.id) ?? 1 })), accountSpend) };
}

export async function getGoogleScriptSpend(db: DB, userId: string, range: DateRange, currency: string, storeId?: string) {
  const entries = (await getGoogleScriptDailySpend(db, userId, range, currency)).filter((e) => !storeId || storeId === "all" || e.storeId === storeId);
  return entries.length ? entries.reduce((sum, e) => sum + e.spend, 0) : null;
}

export async function getGoogleScriptDailySpend(db: DB, userId: string, range: DateRange, currency: string) {
  const [stores, entries] = await Promise.all([
    selectAllByUser<{ id: string; shop_name: string | null; shop_domain: string }>(db, "shopify_connections", "id,shop_name,shop_domain", userId),
    selectAllByUser<Tables<"manual_entries">>(db, "manual_entries", "date,kind,amount,currency,label", userId, (q) => q.gte("date", range.from).lte("date", range.to)),
  ]);
  const iso = ({ "€": "EUR", "$": "USD", "£": "GBP" } as Record<string, string>)[currency] ?? currency;
  const rates = new Map<string, number>();
  const days = new Map<string, GoogleAccountSpend>();
  for (const entry of entries) {
    if (!/^google\b/i.test(entry.label ?? "")) continue;
    const owner = googleLabelStore(entry.label, stores);
    if (!owner) continue;
    const source = entry.currency ?? iso;
    if (!rates.has(source)) rates.set(source, await resolveFx(source, iso, { required: true }));
    const key = `${owner}:${entry.date}`;
    const day = days.get(key) ?? { storeId: owner, date: entry.date, spend: 0 };
    day.spend += Number(entry.amount) * rates.get(source)! * (entry.kind === "expense" ? 1 : -1);
    days.set(key, day);
  }
  return [...days.values()];
}
