import { ymdInTz } from "@/lib/date";
import { isProfitAdjustment, type PaymentSnapshot, type PaymentTransaction } from "./payments-model";

/** Transfer status does not change profit. A refund changes
 * its original order month; a dispute changes the month it was posted. */
export function paymentRecalculation(previous: PaymentSnapshot | null, next: PaymentSnapshot,
  orders: { shopify_order_id: string; processed_at: string }[], timezone: string, pending = false): { changed: boolean; months?: string[] } {
  if (!previous) return { changed: true }; // Initial import needs the full history.
  const months = new Set(pending ? previous.refreshMonths : []);
  let fullHistory = pending && !previous.refreshMonths;
  let changed = pending;
  const orderDates = new Map(orders.map((o) => [String(o.shopify_order_id), o.processed_at]));
  const addDate = (date?: string) => {
    if (!date || !Number.isFinite(Date.parse(date))) { fullHistory = true; return; }
    months.add(ymdInTz(new Date(date), timezone).slice(0, 7));
  };
  const financial = (t: PaymentTransaction) => !t.test && (["charge", "refund"].includes(t.type) || isProfitAdjustment(t));
  const txKey = (t?: PaymentTransaction) => t && JSON.stringify([
    t.type, t.currency, t.amount, t.fee, t.net, t.orderId, t.orderTransactionId, t.processedAt,
  ]);
  const oldTx = new Map(previous.transactions.filter(financial).map((t) => [t.id, t]));
  const newTx = new Map(next.transactions.filter(financial).map((t) => [t.id, t]));
  for (const id of new Set([...oldTx.keys(), ...newTx.keys()])) {
    const before = oldTx.get(id), after = newTx.get(id);
    if (txKey(before) === txKey(after)) continue;
    changed = true;
    for (const t of [before, after]) {
      if (!t) continue;
      addDate(isProfitAdjustment(t) ? t.processedAt : orderDates.get(t.orderId ?? ""));
    }
  }
  // A fresh proof can restore actual fees after a failed verification left an
  // order estimated. Revisit that order's month even if only updatedAt changed.
  const proofKey = (s: PaymentSnapshot, id: string) => {
    const o = s.orders?.[id];
    return o && JSON.stringify([Date.parse(o.updatedAt), [...o.transactionIds].sort(), o.captured, o.refunded, o.currency, o.mixed]);
  };
  for (const id of new Set([...Object.keys(previous.orders ?? {}), ...Object.keys(next.orders ?? {})])) {
    if (proofKey(previous, id) === proofKey(next, id)) continue;
    changed = true;
    addDate(orderDates.get(id));
  }
  return { changed, ...(changed && !fullHistory ? { months: [...months].sort() } : {}) };
}
