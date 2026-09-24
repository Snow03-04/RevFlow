import { campaignSalesWeights, type ProductMatch, type SalesClaimant } from "./match";
import { calcPnlDay, type PnlDayInput, type PnlFees } from "./pnl";
import type { TrackerOrderSales } from "./sales";
import { collectionOrderShare } from "./collection-sales";
import type { MetaRecentRoas } from "./meta-roas";

export type MetaPnlTarget = { key: string; name: string; kind: "product" | "collection" };

export interface MetaPnlCampaignDay {
  key: string;
  date: string;
  name: string;
  storeId: string | null;
  target: ProductMatch | null;
  /** Store-base -> P&L display currency. */
  rate: number;
  spend: number;
  purchases: number;
  purchaseValue: number;
  impressions?: number;
  clicks?: number;
  atc?: number;
  displayTarget?: MetaPnlTarget | null;
}

export interface MetaPnlDay {
  key: string;
  date: string;
  input: PnlDayInput;
  metaPurchases: number;
  metaRevenue: number;
  sheetCogs: number;
  complete: boolean;
  reason: string | null;
  via: ProductMatch["via"] | null;
  impressions?: number;
  clicks?: number;
  atc?: number;
  target?: MetaPnlTarget | null;
}

/** Names are display labels; a campaign's account and ID are its identity. */
export function metaCampaignKey(connectionId: string | null, campaignId: string): string {
  return `${connectionId ?? "unmapped"}:${campaignId}`;
}

export function emptyPnlInput(): PnlDayInput {
  return { grossRevenue: 0, refunds: 0, cogs: 0, adspendFb: 0, adspendGoogle: 0, orders: 0 };
}

/**
 * Estimated campaign economics from actual order totals and shared COGS.
 * Confirmed collection memberships select purchased products, regardless of
 * landing page. Each product's amounts are split once among competing campaigns.
 * Without memberships, legacy callers retain their landing-page projection.
 * Campaigns sharing a target use ROAS's purchase/spend weights. Unmatched
 * portions stay unattributed. Counts are fractional order equivalents so the
 * fixed payment fee is also distributed once, even for mixed baskets.
 *
 * This is a same-day allocation, not evidence of a Meta-attributed conversion.
 * Organic sales may be included; Google-paid, cancelled and test orders are
 * excluded by fetchTrackerOrderSales. All competing campaigns MUST be passed,
 * before filtering to the campaign the user selected.
 */
export function allocateMetaPnl(
  campaigns: MetaPnlCampaignDay[],
  orders: TrackerOrderSales[],
  memberships?: Map<string, string[] | null>,
): MetaPnlDay[] {
  const output = new Map<MetaPnlCampaignDay, MetaPnlDay>();
  const candidates = new Map<string, MetaPnlCampaignDay[]>();
  for (const c of campaigns) {
    const active = c.spend !== 0 || c.purchases !== 0 || c.purchaseValue !== 0;
    const reason = !active ? null : !c.storeId
      ? "Conta Meta sem loja associada"
      : !c.target ? "Produto ou coleção por identificar"
      : memberships && c.target.collectionHandle && memberships.get(`${c.storeId}:${c.target.collectionHandle}`) == null
        ? "Produtos da coleção por confirmar no Shopify" : null;
    output.set(c, {
      key: c.key, date: c.date,
      input: { ...emptyPnlInput(), adspendFb: c.spend * c.rate },
      metaPurchases: c.purchases, metaRevenue: c.purchaseValue * c.rate,
      sheetCogs: 0, complete: reason === null, reason, via: c.target?.via ?? null,
      impressions: c.impressions ?? 0, clicks: c.clicks ?? 0, atc: c.atc ?? 0,
      target: c.displayTarget ?? null,
    });
    if (active && c.storeId && c.target && !reason) {
      const key = `${c.storeId}:${c.date}`;
      const group = candidates.get(key) ?? [];
      group.push(c);
      candidates.set(key, group);
    }
  }

  function assign(
    eligible: MetaPnlCampaignDay[],
    order: TrackerOrderSales,
    fraction: number,
    cost: number,
  ) {
    if (!eligible.length) return;
    const claims: SalesClaimant[] = eligible.map((c) => ({
      campaignId: c.key, metaPurchases: c.purchases, spend: c.spend * c.rate,
    }));
    const weights = campaignSalesWeights(claims);
    eligible.forEach((c, i) => {
      const out = output.get(c)!;
      const portion = weights[i];
      out.input.grossRevenue += order.grossRevenue * fraction * portion * c.rate;
      out.input.refunds += order.refunds * fraction * portion * c.rate;
      out.input.cogs += cost * portion * c.rate;
      out.input.orders += fraction * portion;
      if (order.sheetCost) out.sheetCogs += cost * portion * c.rate;
    });
  }

  const productSets = new Map([...memberships ?? []].map(([key, ids]) => [key, new Set(ids ?? [])]));
  const seen = new Set<string>();
  for (const order of orders) {
    if (!order.storeId) continue;
    const orderKey = `${order.storeId}:${order.id}`;
    if (seen.has(orderKey)) continue;
    seen.add(orderKey);
    const eligible = candidates.get(`${order.storeId}:${order.date}`) ?? [];
    if (!eligible.length) continue;
    if (memberships) {
      for (const productId of new Set(order.items.map((item) => item.productId).filter((id): id is string => !!id))) {
        const share = collectionOrderShare(order, new Set([productId]));
        if (!share) continue;
        const campaigns = eligible.filter((c) => c.target?.collectionHandle
          ? productSets.get(`${c.storeId}:${c.target.collectionHandle}`)?.has(productId)
          : c.target?.productId === productId);
        assign(campaigns, order, share.feeOrders, share.cogs);
      }
      continue;
    }
    const collections = order.collectionHandle
      ? eligible.filter((c) => c.target?.collectionHandle === order.collectionHandle)
      : [];
    if (collections.length) {
      assign(collections, order, 1, order.cost);
      continue;
    }
    const totalWeight = order.items.reduce((sum, li) => sum + li.weight, 0);
    const totalUnits = order.items.reduce((sum, li) => sum + li.units, 0);
    for (const li of order.items) {
      if (!li.productId) continue;
      const products = eligible.filter((c) => c.target?.productId === li.productId);
      const fraction = totalWeight > 0 ? li.weight / totalWeight
        : totalUnits > 0 ? li.units / totalUnits : 1 / order.items.length;
      assign(products, order, fraction, li.cost);
    }
  }

  return [...output.values()].map((row) => {
    // A Meta purchase without any allocated Shopify sale is missing evidence,
    // not a zero-cost profitable sale. Keep spend/Meta attribution visible.
    if (!memberships && row.complete && (row.metaPurchases > 0 || row.metaRevenue > 0) && row.input.orders === 0) {
      row.complete = false;
      row.reason = "Sem vendas Shopify associadas neste dia";
    }
    // Preserve sub-cent FX/allocation precision. Round for display only, after
    // aggregation, as in the overview; per-unit/per-row rounding drifts totals.
    return row;
  });
}

/** Same fees as the general sheet, including each month's explicit overrides. */
export function summariseMetaPnl(
  rows: MetaPnlDay[],
  feesForDate: (date: string) => PnlFees,
) {
  const input = emptyPnlInput();
  let paymentFees = 0, agencyFees = 0, metaRevenue = 0, metaPurchases = 0, sheetCogs = 0;
  let impressions = 0, clicks = 0, atc = 0;
  for (const row of rows) {
    for (const key of Object.keys(input) as (keyof PnlDayInput)[]) input[key] += row.input[key];
    const calc = calcPnlDay(row.input, feesForDate(row.date));
    paymentFees += calc.paymentFee;
    agencyFees += calc.agencyFeeFb;
    metaRevenue += row.metaRevenue;
    metaPurchases += row.metaPurchases;
    sheetCogs += row.sheetCogs;
    impressions += row.impressions ?? 0; clicks += row.clicks ?? 0; atc += row.atc ?? 0;
  }
  const net = input.grossRevenue - input.refunds;
  const profit = net - input.cogs - input.adspendFb - paymentFees - agencyFees;
  const contribution = net - input.cogs - paymentFees;
  return {
    input, net, profit, paymentFees, agencyFees, metaRevenue, metaPurchases, sheetCogs,
    impressions, clicks, atc,
    ctr: impressions ? clicks / impressions : null,
    cpc: clicks ? input.adspendFb / clicks : null,
    cpm: impressions ? input.adspendFb / impressions * 1000 : null,
    cpa: metaPurchases ? input.adspendFb / metaPurchases : null,
    metaRoas: input.adspendFb ? metaRevenue / input.adspendFb : null,
    complete: rows.every((r) => r.complete),
    financialActivity: rows.some((r) => r.complete && (r.input.grossRevenue !== 0 || r.input.cogs !== 0 || r.input.refunds !== 0 || r.input.adspendFb !== 0)),
    reasons: [...new Set(rows.map((r) => r.reason).filter((reason): reason is string => !!reason))],
    activeDates: [...new Set(rows.filter((r) => r.input.adspendFb > 0).map((r) => r.date))],
    breakEven: contribution > 0 ? net * (input.adspendFb > 0 ? 1 + agencyFees / input.adspendFb : 1) / contribution : null,
    recentMeta: undefined as MetaRecentRoas | undefined,
    margin: net === 0 ? null : profit / net,
    cogsImpact: net === 0 ? null : input.cogs / net,
    roas: input.adspendFb === 0 ? null : net / input.adspendFb,
  };
}
