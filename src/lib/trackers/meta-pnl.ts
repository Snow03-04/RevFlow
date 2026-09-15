import { campaignSalesWeights, type ProductMatch, type SalesClaimant } from "./match";
import { calcPnlDay, type PnlDayInput, type PnlFees } from "./pnl";
import type { TrackerOrderSales } from "./sales";

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
 * A matching collection landing takes the whole basket; otherwise product
 * campaigns share each matching line. An order can never enter BOTH paths.
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
): MetaPnlDay[] {
  const output = new Map<MetaPnlCampaignDay, MetaPnlDay>();
  const candidates = new Map<string, MetaPnlCampaignDay[]>();
  for (const c of campaigns) {
    const active = c.spend !== 0 || c.purchases !== 0 || c.purchaseValue !== 0;
    const reason = !active ? null : !c.storeId
      ? "Conta Meta sem loja associada"
      : !c.target ? "Produto ou coleção por identificar" : null;
    output.set(c, {
      key: c.key, date: c.date,
      input: { ...emptyPnlInput(), adspendFb: c.spend * c.rate },
      metaPurchases: c.purchases, metaRevenue: c.purchaseValue * c.rate,
      sheetCogs: 0, complete: reason === null, reason, via: c.target?.via ?? null,
    });
    if (active && c.storeId && c.target) {
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

  for (const order of orders) {
    if (!order.storeId) continue;
    const eligible = candidates.get(`${order.storeId}:${order.date}`) ?? [];
    if (!eligible.length) continue;
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
    if (row.complete && (row.metaPurchases > 0 || row.metaRevenue > 0) && row.input.orders === 0) {
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
  for (const row of rows) {
    for (const key of Object.keys(input) as (keyof PnlDayInput)[]) input[key] += row.input[key];
    const calc = calcPnlDay(row.input, feesForDate(row.date));
    paymentFees += calc.paymentFee;
    agencyFees += calc.agencyFeeFb;
    metaRevenue += row.metaRevenue;
    metaPurchases += row.metaPurchases;
    sheetCogs += row.sheetCogs;
  }
  const net = input.grossRevenue - input.refunds;
  const profit = net - input.cogs - input.adspendFb - paymentFees - agencyFees;
  return {
    input, net, profit, paymentFees, agencyFees, metaRevenue, metaPurchases, sheetCogs,
    complete: rows.every((r) => r.complete),
    margin: net === 0 ? null : profit / net,
    cogsImpact: net === 0 ? null : input.cogs / net,
    roas: input.adspendFb === 0 ? null : net / input.adspendFb,
  };
}
