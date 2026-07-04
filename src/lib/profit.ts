import type { Settings } from "@/types";

/**
 * The profit model.
 *
 *   Profit = Revenue
 *          − Product Cost (COGS)
 *          − Shipping Cost (merchant fulfilment)
 *          − Payment Fees
 *          − Refunds
 *          − Advertising Spend
 *
 * `Revenue` = product subtotal + shipping charged to customers − refunds
 * (i.e. what the customer actually paid, matching Shopify's "Total sales").
 * Shipping revenue is included so it balances the shipping cost merchants
 * usually fold into COGS.
 */

export interface ProfitInputs {
  grossRevenue: number; // sum of order subtotals (after line discounts)
  shippingRevenue: number; // shipping charged to customers
  refunds: number;
  productCost: number; // COGS
  ordersTotalValue: number; // sum of order total_price (for % payment fees)
  ordersCount: number;
  adSpend: number;
}

export interface ProfitResult {
  revenue: number; // gross + shipping − refunds
  productCost: number;
  shippingCost: number;
  paymentFees: number;
  adSpend: number;
  refunds: number;
  profit: number;
  profitMargin: number; // fraction of net revenue
}

export type ProfitSettings = Pick<
  Settings,
  "payment_fee_pct" | "payment_fee_fixed" | "default_shipping_cost"
>;

export function computeProfit(
  inputs: ProfitInputs,
  settings: ProfitSettings,
): ProfitResult {
  const {
    grossRevenue,
    shippingRevenue,
    refunds,
    productCost,
    ordersTotalValue,
    ordersCount,
    adSpend,
  } = inputs;

  const paymentFees =
    ordersTotalValue * (Number(settings.payment_fee_pct) / 100) +
    Number(settings.payment_fee_fixed) * ordersCount;

  const shippingCost = Number(settings.default_shipping_cost) * ordersCount;

  // Revenue includes the shipping the customer paid, so it balances against
  // the shipping cost (which merchants typically bake into COGS). Matches
  // Shopify's "Total sales" (net sales + shipping).
  const netRevenue = grossRevenue + shippingRevenue - refunds;

  const profit =
    netRevenue - productCost - shippingCost - paymentFees - adSpend;

  const profitMargin = netRevenue > 0 ? profit / netRevenue : 0;

  return {
    revenue: round2(netRevenue),
    productCost: round2(productCost),
    shippingCost: round2(shippingCost),
    paymentFees: round2(paymentFees),
    adSpend: round2(adSpend),
    refunds: round2(refunds),
    profit: round2(profit),
    profitMargin: round4(profitMargin),
  };
}

/**
 * COGS for a single line item. Uses the captured per-unit cost snapshot when
 * available, otherwise falls back to a percentage of the selling price.
 */
export function lineItemCost(
  quantity: number,
  unitPrice: number,
  unitCost: number | null | undefined,
  fallbackCostPct: number,
): number {
  if (unitCost != null && unitCost >= 0) {
    return quantity * unitCost;
  }
  return quantity * unitPrice * (fallbackCostPct / 100);
}

/** A quantity tier: the TOTAL cost of buying `minQty` units together. */
export interface CostTier {
  minQty: number; // >= 2
  total: number; // total cost for minQty units, in the same currency as unitCost
}

/**
 * COGS for `qty` units given bundle pricing.
 *
 *   - `unitCost` is the normal single-unit cost (qty 1).
 *   - `tiers` are TOTAL costs for buying `minQty` units together (minQty >= 2).
 *
 * Rule: take the largest tier whose `minQty <= qty`; the units beyond that tier
 * are billed at the base unit cost. So with a top tier at 4 units, buying 5 =
 * total(4) + 1 × unitCost. Below the smallest tier, it's just qty × unitCost.
 */
export function tieredCost(
  qty: number,
  unitCost: number,
  tiers: CostTier[],
): number {
  if (qty <= 0) return 0;
  const u = Number.isFinite(unitCost) && unitCost > 0 ? unitCost : 0;
  // Largest tier with minQty <= qty (tiers need not be pre-sorted).
  let chosen: CostTier | null = null;
  for (const t of tiers) {
    if (t.minQty <= qty && (!chosen || t.minQty > chosen.minQty)) chosen = t;
  }
  if (!chosen) return qty * u;
  return chosen.total + (qty - chosen.minQty) * u;
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function round4(n: number): number {
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}
