import type { summariseMetaPnl, MetaPnlTarget } from "./meta-pnl";
import type { MetaPnlOption } from "./meta-pnl-query";
import type { MetaRoasSignal } from "./meta-roas";
import { mult } from "./format";

export type MetaSummary = ReturnType<typeof summariseMetaPnl>;
export type MetaCampaignOverview = {
  option: MetaPnlOption; summary: MetaSummary; target: MetaPnlTarget | null; activity: boolean; fire?: MetaRoasSignal | null;
};

export type MetaCampaignFilter = "all" | "online" | "paused" | "other" | "activity";
export type MetaCampaignSort = "spend" | "revenue" | "roas" | "name";

export const metaRoasLabel = (s: MetaSummary) => s.recentMeta ? "ROAS Meta · 2 dias" : "ROAS Meta";
export const metaRoasValue = (s: MetaSummary) => s.recentMeta
  ? `${mult(s.recentMeta.roas)}${!s.recentMeta.complete && s.recentMeta.roas != null ? " parcial" : ""}` : mult(s.metaRoas);

/** Live status is independent of spend in the selected financial period. */
export function mergeCurrentMetaOptions(imported: MetaPnlOption[], current: MetaPnlOption[], storeNames: Map<string, string>) {
  const options = new Map(imported.map((option) => [option.key, { ...option, status: null as string | null }]));
  for (const option of current) {
    const previous = options.get(option.key);
    options.set(option.key, {
      ...option,
      status: option.status ?? null,
      storeName: (option.storeId && storeNames.get(option.storeId)) || previous?.storeName || "Sem loja associada",
    });
  }
  return [...options.values()];
}

export function isMetaPaused(status?: string | null) {
  return status === "PAUSED" || status === "CAMPAIGN_PAUSED" || status === "ADSET_PAUSED";
}

export function hasMetaActivity(campaign: MetaCampaignOverview) {
  const s = campaign.summary;
  return s.input.adspendFb !== 0 || s.metaRevenue !== 0 || s.metaPurchases !== 0 || s.impressions !== 0 || s.clicks !== 0 || s.atc !== 0;
}

export function selectMetaCampaigns(campaigns: MetaCampaignOverview[], search: string, status: MetaCampaignFilter, sort: MetaCampaignSort) {
  const normalise = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase();
  const term = normalise(search.trim());
  return campaigns.filter((campaign) => {
    const o = campaign.option;
    const matchesStatus = status === "all" || (status === "online" ? o.status === "ACTIVE"
      : status === "paused" ? isMetaPaused(o.status)
      : status === "activity" ? hasMetaActivity(campaign)
      : o.status !== "ACTIVE" && !isMetaPaused(o.status));
    return matchesStatus && normalise(`${o.name} ${o.campaignId} ${o.storeName} ${o.accountName} ${campaign.target?.name ?? ""}`).includes(term);
  }).sort((a, b) => {
    const online = Number(b.option.status === "ACTIVE") - Number(a.option.status === "ACTIVE");
    if (online) return online;
    const metric = sort === "spend" ? b.summary.input.adspendFb - a.summary.input.adspendFb
      : sort === "revenue" ? b.summary.metaRevenue - a.summary.metaRevenue
      : sort === "roas" ? ((b.summary.recentMeta ? b.summary.recentMeta.roas : b.summary.metaRoas) ?? -Infinity) - ((a.summary.recentMeta ? a.summary.recentMeta.roas : a.summary.metaRoas) ?? -Infinity) : 0;
    return metric || a.option.name.localeCompare(b.option.name, "pt") || a.option.key.localeCompare(b.option.key);
  });
}

/** Combine the existing estimates after allocation; never redistribute sales in a view. */
export function sumMetaSummaries(summaries: MetaSummary[]): MetaSummary {
  const total: MetaSummary = {
    input: { grossRevenue: 0, refunds: 0, cogs: 0, adspendFb: 0, adspendGoogle: 0, orders: 0 },
    net: 0, profit: 0, paymentFees: 0, agencyFees: 0, metaRevenue: 0, metaPurchases: 0, sheetCogs: 0,
    impressions: 0, clicks: 0, atc: 0, complete: true,
    ctr: null, cpc: null, cpm: null, cpa: null, metaRoas: null, roas: null, margin: null, cogsImpact: null,
    financialActivity: false, activeDates: [], reasons: [], breakEven: null, recentMeta: undefined,
  };
  for (const s of summaries) {
    for (const key of Object.keys(total.input) as (keyof MetaSummary["input"])[]) total.input[key] += s.input[key];
    for (const key of ["net", "profit", "paymentFees", "agencyFees", "metaRevenue", "metaPurchases", "sheetCogs", "impressions", "clicks", "atc"] as const) total[key] += s[key];
    total.complete = total.complete && s.complete;
    total.financialActivity = total.financialActivity || s.financialActivity;
    total.activeDates.push(...s.activeDates);
    total.reasons.push(...s.reasons);
  }
  const spend = total.input.adspendFb;
  const contribution = total.net - total.input.cogs - total.paymentFees;
  const recent = summaries.flatMap((summary) => summary.recentMeta ? [summary.recentMeta] : []);
  if (recent.length) {
    const first = recent[0];
    const matching = recent.filter((row) => row.from === first.from && row.to === first.to);
    const spend = matching.reduce((sum, row) => sum + row.spend, 0);
    const revenue = matching.reduce((sum, row) => sum + row.revenue, 0);
    total.recentMeta = { from: first.from, to: first.to, spend, revenue,
      complete: matching.length === summaries.length && matching.every((row) => row.complete), roas: spend > 0 ? revenue / spend : null };
  }
  return { ...total, ctr: total.impressions ? total.clicks / total.impressions : null,
    activeDates: [...new Set(total.activeDates)], reasons: [...new Set(total.reasons)],
    breakEven: contribution > 0 ? total.net * (spend > 0 ? 1 + total.agencyFees / spend : 1) / contribution : null,
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
