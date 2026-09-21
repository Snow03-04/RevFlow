/** Only settled Shopify orders contribute sales, units, costs and fees.
 * AfterSell's tag or an added line does not prove that payment was captured.
 * Refunded orders remain in the calculation so actual refunds and COGS survive.
 */
export function isPaidOrder(order: {
  financial_status?: string | null;
  test?: boolean;
  cancelled_at?: string | null;
}): boolean {
  return !order.test && !order.cancelled_at
    && ["paid", "partially_refunded", "refunded"].includes(order.financial_status?.toLowerCase() ?? "");
}
