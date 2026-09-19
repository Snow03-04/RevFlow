import type { summariseMetaPnl, MetaPnlTarget } from "./meta-pnl";
import type { MetaPnlOption } from "./meta-pnl-query";

export type MetaSummary = ReturnType<typeof summariseMetaPnl>;
export type MetaCampaignOverview = {
  option: MetaPnlOption; summary: MetaSummary; target: MetaPnlTarget | null; activity: boolean;
};

/** Combine the existing estimates after allocation; never redistribute sales in a view. */
export function sumMetaSummaries(summaries: MetaSummary[]): MetaSummary {
  const total: MetaSummary = {
    input: { grossRevenue: 0, refunds: 0, cogs: 0, adspendFb: 0, adspendGoogle: 0, orders: 0 },
    net: 0, profit: 0, paymentFees: 0, agencyFees: 0, metaRevenue: 0, metaPurchases: 0, sheetCogs: 0,
    impressions: 0, clicks: 0, atc: 0, complete: true,
    ctr: null, cpc: null, cpm: null, cpa: null, metaRoas: null, roas: null, margin: null, cogsImpact: null,
  };
  for (const s of summaries) {
    for (const key of Object.keys(total.input) as (keyof MetaSummary["input"])[]) total.input[key] += s.input[key];
    for (const key of ["net", "profit", "paymentFees", "agencyFees", "metaRevenue", "metaPurchases", "sheetCogs", "impressions", "clicks", "atc"] as const) total[key] += s[key];
    total.complete = total.complete && s.complete;
  }
  const spend = total.input.adspendFb;
  return { ...total, ctr: total.impressions ? total.clicks / total.impressions : null,
    cpc: total.clicks ? spend / total.clicks : null, cpm: total.impressions ? spend / total.impressions * 1000 : null,
    cpa: total.metaPurchases ? spend / total.metaPurchases : null, metaRoas: spend ? total.metaRevenue / spend : null,
    roas: spend ? total.net / spend : null, margin: total.net ? total.profit / total.net : null,
    cogsImpact: total.net ? total.input.cogs / total.net : null };
}

export function groupMetaCampaigns(campaigns: MetaCampaignOverview[]) {
  const stores = new Map<string, { key: string; name: string; campaigns: MetaCampaignOverview[] }>();
  for (const campaign of campaigns) {
    const key = campaign.option.storeId ?? "unmapped";
    if (!stores.has(key)) stores.set(key, { key, name: campaign.option.storeName, campaigns: [] });
    stores.get(key)!.campaigns.push(campaign);
  }
  return [...stores.values()].map((store) => {
    const targets = new Map<string, { key: string; name: string; kind: string; campaigns: MetaCampaignOverview[] }>();
    for (const campaign of store.campaigns) {
      const key = campaign.target?.key ?? (campaign.activity ? "unidentified" : "inactive");
      if (!targets.has(key)) targets.set(key, { key: `${store.key}:${key}`,
        name: campaign.target?.name ?? (campaign.activity ? "Destino por identificar" : "Sem atividade no período"),
        kind: campaign.target?.kind === "collection" ? "Coleção" : campaign.target?.kind === "product" ? "Produto" : "Campanhas",
        campaigns: [] });
      targets.get(key)!.campaigns.push(campaign);
    }
    return { ...store, summary: sumMetaSummaries(store.campaigns.map((c) => c.summary)),
      targets: [...targets.values()].map((target) => ({ ...target, summary: sumMetaSummaries(target.campaigns.map((c) => c.summary)) })) };
  });
}
