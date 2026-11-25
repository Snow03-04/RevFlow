import "server-only";
import { graphPaginate } from "./client";

type MetaBudget = { id: string; campaign_id?: string; daily_budget?: string; lifetime_budget?: string;
  start_time?: string; stop_time?: string; end_time?: string; effective_status: string };

// Meta uses whole currency units for these accounts, including HUF and TWD.
const wholeUnit = new Set(["CLP", "COP", "CRC", "HUF", "IDR", "ISK", "JPY", "KRW", "PYG", "TWD", "VND"]);

export function metaDailyBudget(campaigns: MetaBudget[], adSets: MetaBudget[], currency: string, now: number): number | null {
  function active(row: MetaBudget) {
    const end = row.end_time ?? row.stop_time;
    return row.effective_status === "ACTIVE" && (!row.start_time || Date.parse(row.start_time) <= now)
      && (!end || Date.parse(end) > now);
  }
  const adSetCampaigns = new Set<string>();
  let minorUnits = 0;
  for (const campaign of campaigns.filter(active)) {
    if (Number(campaign.lifetime_budget) > 0) return null;
    if (Number(campaign.daily_budget) > 0) minorUnits += Number(campaign.daily_budget);
    else adSetCampaigns.add(campaign.id);
  }
  for (const adSet of adSets.filter(active)) {
    if (!adSetCampaigns.has(adSet.campaign_id ?? "")) continue;
    if (Number(adSet.lifetime_budget) > 0 || !(Number(adSet.daily_budget) > 0)) return null;
    minorUnits += Number(adSet.daily_budget);
  }
  return minorUnits / (wholeUnit.has(currency) ? 1 : 100);
}

export async function readMetaBudget(account: string, token: string, currency: string) {
  const signal = AbortSignal.timeout(8000);
  async function read<T>(edge: string, fields: string, params: Record<string, string>) {
    const rows: T[] = [];
    for await (const page of graphPaginate<T>(`${account}/${edge}`, { fields, access_token: token, limit: "250", ...params }, { signal })) rows.push(...page);
    return rows;
  }
  const active = { effective_status: JSON.stringify(["ACTIVE"]) };
  const [campaigns, adSets, insights] = await Promise.all([
    read<MetaBudget>("campaigns", "id,effective_status,daily_budget,lifetime_budget,start_time,stop_time", active),
    read<MetaBudget>("adsets", "id,campaign_id,effective_status,daily_budget,lifetime_budget,start_time,end_time", active),
    read<{ spend: string }>("insights", "spend", { date_preset: "today", level: "account" }),
  ]);
  const spent = insights.reduce((sum, row) => sum + Number(row.spend), 0);
  if (!Number.isFinite(spent) || spent < 0) throw new Error("Gasto Meta por confirmar.");
  return { budget: metaDailyBudget(campaigns, adSets, currency, Date.now()), spent, currency };
}
