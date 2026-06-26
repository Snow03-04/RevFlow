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

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function round4(n: number): number {
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}
