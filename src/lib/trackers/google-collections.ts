import { googleOrderCampaign, type GooglePnlCampaign, type GooglePnlFact } from "./google-pnl";
import type { MetaPnlOption } from "./meta-pnl-query";
import type { TrackerOrderSales } from "./sales";
import { summariseGoogleAdCoverage } from "./google-ad-coverage";

export type GoogleCollectionCampaign = MetaPnlOption & GooglePnlCampaign & { collectionHandle: string | null; productHandle?: string | null; manualCollection?: boolean };
export type CollectionDay = {
  date: string; orders: number; revenue: number; cogs: number; spend: number | null;
  clicks: number; impressions: number; complete: boolean; spendKnown: boolean;
  grossSpend: number | null; conversions: number; conversionValue: number; reasons: string[];
};
export type GoogleCollection = {
  key: string; handle: string | null; name: string; storeId: string | null; storeName: string;
  campaigns: GoogleCollectionCampaign[]; days: CollectionDay[];
};
export type GoogleAccountSpend = { storeId: string; date: string; spend: number };
export const googleCollectionKey = (store: string | null, handle: string | null) => `${store ?? "unmapped"}:${handle ?? "~unassigned"}`;

/** Whole orders belong to one collection. Never split spend by guessed names or
 * distribute the same sale across all campaigns advertising that collection. */
export function buildGoogleCollections(campaigns: GoogleCollectionCampaign[], facts: GooglePnlFact[], orders: TrackerOrderSales[],
  stores: { id: string; name: string; rate: number }[], accountSpend: GoogleAccountSpend[] = []) {
  const groups = new Map<string, GoogleCollection>();
  const byStore = new Map(stores.map((s) => [s.id, s]));
  const byCampaign = new Map(campaigns.map((c) => [c.key, c]));
  const uncertain = new Set<string>();
  const unknownSpend = new Set<string>();
  const spendByStoreDay = new Map<string, number | null>();
  const conversionDays = new Set<string>();
  const accountDates = new Set(accountSpend.map((a) => `${a.storeId}:${a.date}`));
  function group(storeId: string | null, handle: string | null) {
    const key = googleCollectionKey(storeId, handle);
    if (!groups.has(key)) groups.set(key, { key, handle, storeId,
      name: handle ? handle.replace(/-/g, " ").replace(/^./u, (c) => c.toUpperCase()) : "Sem coleção associada",
      storeName: byStore.get(storeId ?? "")?.name ?? "Sem loja associada", campaigns: [], days: [] });
    return groups.get(key)!;
  }
  function day(g: GoogleCollection, date: string) {
    let d = g.days.find((r) => r.date === date);
    if (!d) { d = { date, orders: 0, revenue: 0, cogs: 0, spend: 0, clicks: 0, impressions: 0, complete: true, spendKnown: false, grossSpend: 0, conversions: 0, conversionValue: 0, reasons: [] }; g.days.push(d); }
    return d;
  }
  for (const c of campaigns) group(c.storeId, c.collectionHandle).campaigns.push(c);
  for (const f of facts) {
    const c = byCampaign.get(f.key);
    if (!c) continue;
    const d = day(group(c.storeId, c.collectionHandle), f.date);
    d.spend = d.spend == null || f.spend == null ? null : d.spend + f.spend * c.rate; d.clicks += f.clicks; d.impressions += f.impressions;
    d.grossSpend = d.grossSpend == null || f.grossSpend == null ? null : d.grossSpend + f.grossSpend * c.rate;
    d.conversions += f.conversions; d.conversionValue += f.conversionValue * c.rate;
    d.spendKnown = true;
    if (f.conversions > 0 || f.conversionValue > 0) conversionDays.add(`${googleCollectionKey(c.storeId, c.collectionHandle)}:${f.date}`);
    const key = `${c.storeId}:${f.date}`;
    spendByStoreDay.set(key, spendByStoreDay.get(key) === null || f.spend == null ? null : (spendByStoreDay.get(key) ?? 0) + f.spend * c.rate);
    if (!c.collectionHandle && (f.spend || f.grossSpend || f.conversions)) uncertain.add(key);
    if (!c.collectionHandle && (f.spend || f.grossSpend)) unknownSpend.add(key);
  }
  for (const o of orders) {
    const c = googleOrderCampaign(o.landingSite, campaigns.filter((r) => r.storeId === o.storeId)) as GoogleCollectionCampaign | null;
    const handle = o.collectionHandle || c?.collectionHandle || null;
    const d = day(group(o.storeId, handle), o.date);
    const rate = byStore.get(o.storeId ?? "")?.rate ?? c?.rate ?? 1;
    d.orders++; d.revenue += (o.grossRevenue - o.refunds) * rate; d.cogs += o.cost * rate;
    if (!handle || (c?.collectionHandle && o.collectionHandle && c.collectionHandle !== o.collectionHandle)) uncertain.add(`${o.storeId}:${o.date}`);
  }
  // Reconcile the independent account total: costs absent from campaign imports
  // remain visible once in the unassigned bucket, never as invented zero profit.
  for (const a of accountSpend) {
    const key = `${a.storeId}:${a.date}`;
    // A gross-only report says nothing about cash expenses or credit usage.
    if (spendByStoreDay.get(key) === null) continue;
    const difference = a.spend - (spendByStoreDay.get(key) ?? 0);
    if (Math.abs(difference) > 0.05) {
      uncertain.add(key);
      unknownSpend.add(key);
      if (difference > 0) { const d = day(group(a.storeId, null), a.date); d.spend = (d.spend ?? 0) + difference; d.spendKnown = true; d.grossSpend = null; }
    }
  }
  for (const g of groups.values()) for (const d of g.days) {
    const storeDay = `${g.storeId}:${d.date}`;
    if (g.handle) d.spendKnown = !unknownSpend.has(storeDay)
      && (spendByStoreDay.has(storeDay) || accountDates.has(storeDay))
      && campaigns.some((c) => c.storeId === g.storeId && c.collectionHandle === g.handle);
    d.complete = !!g.handle && d.spendKnown && d.grossSpend != null && !uncertain.has(storeDay)
      && !(conversionDays.has(`${g.key}:${d.date}`) && !d.orders);
    if (!d.spendKnown) { d.reasons.push("Gastos ainda sem cobertura importada"); d.grossSpend = null; }
    else if (d.grossSpend == null) d.reasons.push("Gasto bruto ainda não importado");
    if (!g.handle || uncertain.has(storeDay)) d.reasons.push("Existem gastos ou encomendas sem coleção confirmada");
    if (conversionDays.has(`${g.key}:${d.date}`) && !d.orders) d.reasons.push("Conversões Google sem encomendas Shopify identificadas neste dia");
  }
  return [...groups.values()].sort((a, b) => a.storeName.localeCompare(b.storeName) || Number(!a.handle) - Number(!b.handle) || a.name.localeCompare(b.name));
}

export function summariseCollection(days: CollectionDay[]) {
  const s = days.reduce((a, d) => ({ orders: a.orders + d.orders, revenue: a.revenue + d.revenue,
    cogs: a.cogs + d.cogs, spend: a.spend == null || d.spend == null ? null : a.spend + d.spend, clicks: a.clicks + d.clicks,
    impressions: a.impressions + d.impressions, conversions: a.conversions + d.conversions, conversionValue: a.conversionValue + d.conversionValue,
    complete: a.complete && d.complete, spendKnown: a.spendKnown && d.spendKnown }),
  { orders: 0, revenue: 0, cogs: 0, spend: 0 as number | null, clicks: 0, impressions: 0, conversions: 0, conversionValue: 0, complete: true, spendKnown: true });
  const spendKnown = days.length > 0 && s.spendKnown && days.every((d) => d.grossSpend != null);
  const grossSpend = spendKnown ? days.reduce((sum, d) => sum + d.grossSpend!, 0) : null;
  // Collection analysis deliberately ignores billing credits. Keep net spend
  // separately so reconciliation never compares gross costs with paid totals.
  const profit = grossSpend == null ? null : s.revenue - s.cogs - grossSpend;
  return { ...s, spendKnown, complete: s.complete && (!days.length || spendKnown), profit, margin: s.revenue && profit != null ? profit / s.revenue : null,
    adCoverage: summariseGoogleAdCoverage(days),
    grossSpend, credit: grossSpend == null || s.spend == null || !s.spendKnown ? null : Math.max(0, grossSpend - s.spend),
    ctr: s.impressions ? s.clicks / s.impressions : null,
    cpc: grossSpend != null && s.clicks ? grossSpend / s.clicks : null,
    cpm: grossSpend != null && s.impressions ? grossSpend / s.impressions * 1000 : null,
    cpa: grossSpend != null && s.conversions ? grossSpend / s.conversions : null,
    googleRoas: grossSpend ? s.conversionValue / grossSpend : null,
    reasons: [...new Set(days.flatMap((d) => d.reasons ?? []))],
    cogsPct: s.revenue ? s.cogs / s.revenue : null, roas: grossSpend ? s.revenue / grossSpend : null,
    breakEven: s.revenue > s.cogs ? s.revenue / (s.revenue - s.cogs) : null };
}
