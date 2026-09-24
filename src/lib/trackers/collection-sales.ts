import type { TrackerOrderSales } from "./sales";

/** Product membership selects lines, independently of the order's landing page.
 * Shared shipping, order refunds and fixed payment fees follow discounted line
 * value (quantity for free items). COGS already carries its supplier allocation.
 */
export function collectionOrderShare(order: TrackerOrderSales, products: ReadonlySet<string>) {
  const eligible = order.items.filter((item) => item.units > 0 || item.cost !== 0 || (order.refunds > 0 && item.weight > 0));
  const matching = eligible.filter((item) => item.productId && products.has(item.productId));
  if (!matching.length) return null;
  // Shopify's paid subtotal already excludes unpaid extras and order-edit
  // removals. For monetary refunds, retain the original discounted values so
  // the shared refund is deducted once, including fully returned lines.
  const lineWeight = (item: TrackerOrderSales["items"][number]) => Math.max(0, order.refunds > 0 ? item.weight : item.revenue);
  const weight = eligible.reduce((sum, item) => sum + lineWeight(item), 0);
  const units = eligible.reduce((sum, item) => sum + item.units, 0);
  const fraction = weight > 0 ? matching.reduce((sum, item) => sum + lineWeight(item), 0) / weight
    : units > 0 ? matching.reduce((sum, item) => sum + item.units, 0) / units : matching.length / eligible.length;
  return {
    units: matching.reduce((sum, item) => sum + item.units, 0),
    grossRevenue: order.grossRevenue * fraction,
    refunds: order.refunds * fraction,
    cogs: matching.reduce((sum, item) => sum + item.cost, 0),
    feeOrders: fraction,
  };
}
