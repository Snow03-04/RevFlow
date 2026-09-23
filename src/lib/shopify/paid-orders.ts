/** Settled orders and verified paid baskets contribute sales, units, costs and fees.
 * AfterSell's tag or an added line does not prove that payment was captured.
 * Refunded orders remain in the calculation so actual refunds and COGS survive.
 */
export function isPaidOrder(order: {
  financial_status?: string | null;
  test?: boolean;
  cancelled_at?: string | null;
  total_price?: number;
  raw?: unknown;
}): boolean {
  if (order.test || order.cancelled_at) return false;
  const status = order.financial_status?.toLowerCase() ?? "";
  if (["paid", "partially_refunded", "refunded"].includes(status)) return true;
  if (status !== "partially_paid") return false;
  const proof = (order.raw as { revflow_paid_portion?: { version?: number; captured?: number } } | null)?.revflow_paid_portion;
  return proof?.version === 1 && typeof proof.captured === "number"
    && Number.isFinite(proof.captured) && proof.captured > 0
    && Number(order.total_price) === proof.captured;
}
