import { emptyPnlInput } from "./meta-pnl";
import { calcPnlDay, type PnlDayInput, type PnlFees } from "./pnl";
import type { TrackerOrderSales } from "./sales";

export interface GooglePnlCampaign {
  key: string; campaignId: string; name: string; storeId: string | null; rate: number;
  status?: string | null;
}
export interface GooglePnlDay {
  key: string; date: string; input: PnlDayInput;
  conversions: number; conversionValue: number; clicks: number; impressions: number;
  complete: boolean; reason: string | null;
  grossSpend: number | null;
  spendKnown: boolean;
  paidSpendKnown: boolean;
}
export type GooglePnlFact = { key: string; date: string; spend: number | null; grossSpend?: number | null; conversions: number; conversionValue: number; clicks: number; impressions: number };

/** Click IDs alone cannot identify a campaign. Only explicit IDs or an exact,
 * unambiguous UTM campaign name link Shopify orders to Google campaigns. */
export function googleOrderCampaign(landing: string | null | undefined, campaigns: GooglePnlCampaign[]) {
  if (!landing) return null;
  try {
    const params = new URL(landing, "https://store.invalid").searchParams;
    const id = params.get("gad_campaignid") || params.get("utm_id") || params.get("campaign_id");
    const utm = params.get("utm_campaign");
    const match = id ? campaigns.filter((c) => c.campaignId === id)
      : campaigns.filter((c) => c.campaignId === utm || (!!utm && c.name.toLocaleLowerCase() === utm.toLocaleLowerCase()));
    return match.length === 1 ? match[0] : null;
  } catch { return null; }
}

export function allocateGooglePnl(campaigns: GooglePnlCampaign[], facts: GooglePnlFact[], orders: TrackerOrderSales[]): GooglePnlDay[] {
  const byKey = new Map(campaigns.map((c) => [c.key, c]));
  const rows = new Map<string, GooglePnlDay>();
  function rowFor(key: string, date: string) {
    const id = `${key}:${date}`;
    if (!rows.has(id)) rows.set(id, { key, date, input: emptyPnlInput(), conversions: 0, conversionValue: 0, clicks: 0, impressions: 0, complete: true, reason: null, grossSpend: null, spendKnown: false, paidSpendKnown: true });
    return rows.get(id)!;
  }
  for (const fact of facts) {
    const campaign = byKey.get(fact.key);
    if (!campaign) continue;
    const row = rowFor(fact.key, fact.date);
    row.input.adspendGoogle += (fact.spend ?? 0) * campaign.rate;
    row.paidSpendKnown = row.paidSpendKnown && fact.spend != null;
    row.grossSpend = fact.grossSpend == null || (row.spendKnown && row.grossSpend == null) ? null : (row.grossSpend ?? 0) + fact.grossSpend * campaign.rate;
    row.spendKnown = true;
    row.conversions += fact.conversions;
    row.conversionValue += fact.conversionValue * campaign.rate;
    row.clicks += fact.clicks;
    row.impressions += fact.impressions;
  }
  const unassigned = new Set<string>();
  for (const order of orders) {
    const campaign = googleOrderCampaign(order.landingSite, campaigns.filter((c) => c.storeId === order.storeId));
    if (!campaign) { unassigned.add(`${order.storeId}:${order.date}`); continue; }
    const row = rowFor(campaign.key, order.date);
    row.input.grossRevenue += order.grossRevenue * campaign.rate;
    row.input.refunds += order.refunds * campaign.rate;
    row.input.cogs += order.cost * campaign.rate;
    row.input.orders++;
  }
  for (const row of rows.values()) {
    const campaign = byKey.get(row.key)!;
    const active = row.input.adspendGoogle !== 0 || !!row.grossSpend || row.conversions !== 0 || row.conversionValue !== 0 || row.clicks !== 0 || row.impressions !== 0 || row.input.orders !== 0;
    if (!active) continue;
    row.reason = !row.spendKnown ? "Gastos ainda sem cobertura importada"
      : row.grossSpend == null ? "Gasto bruto ainda não importado"
      : !campaign.storeId ? "Conta Google sem loja associada"
      : unassigned.has(`${campaign.storeId}:${row.date}`) ? "Existem encomendas Google sem campanha identificável"
      : (row.conversions > 0 || row.conversionValue > 0) && !row.input.orders ? "Conversões Google sem encomendas Shopify associadas" : null;
    row.complete = row.reason === null;
  }
  return [...rows.values()];
}

/** Campaign analysis uses gross advertising cost; the stored paid input remains
 * unchanged for reconciliation and the main financial reports. */
export function summariseGooglePnl(rows: GooglePnlDay[], feesForDate: (date: string) => PnlFees) {
  const input = emptyPnlInput();
  let profit = 0, paymentFees = 0, agencyFees = 0, conversions = 0, conversionValue = 0, clicks = 0, impressions = 0;
  for (const row of rows) {
    for (const key of Object.keys(input) as (keyof PnlDayInput)[]) input[key] += row.input[key];
    const calc = calcPnlDay({ ...row.input, adspendGoogle: row.grossSpend ?? 0 }, feesForDate(row.date));
    profit += calc.profit; paymentFees += calc.paymentFee; agencyFees += calc.agencyFeeGoogle;
    conversions += row.conversions; conversionValue += row.conversionValue; clicks += row.clicks; impressions += row.impressions;
  }
  const net = input.grossRevenue - input.refunds;
  const spendKnown = rows.length > 0 && rows.every((r) => r.spendKnown && r.grossSpend != null);
  const grossSpend = spendKnown ? rows.reduce((sum, r) => sum + r.grossSpend!, 0) : null;
  return { input, net, profit: spendKnown ? profit : null, paymentFees, agencyFees: spendKnown ? agencyFees : null, conversions, conversionValue, clicks, impressions,
    grossSpend, credit: grossSpend == null || rows.some((r) => !r.paidSpendKnown) ? null : Math.max(0, grossSpend - input.adspendGoogle),
    ctr: impressions ? clicks / impressions : null,
    cpc: grossSpend != null && clicks ? grossSpend / clicks : null,
    cpm: grossSpend != null && impressions ? grossSpend / impressions * 1000 : null,
    cpa: grossSpend != null && conversions ? grossSpend / conversions : null,
    complete: rows.every((r) => r.complete) && (!rows.length || spendKnown),
    spendKnown,
    margin: spendKnown && net ? profit / net : null,
    roas: grossSpend ? net / grossSpend : null,
    googleRoas: grossSpend ? conversionValue / grossSpend : null,
  };
}
