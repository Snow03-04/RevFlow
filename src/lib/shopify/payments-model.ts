import { round2 } from "@/lib/profit";

export interface PaymentTransaction {
  id: string; type: string; currency: string; amount: number; fee: number; net: number;
  orderId: string | null; orderTransactionId: string | null; payoutId: string | null; processedAt: string; test: boolean;
}
export interface PaymentPayout {
  id: string; date: string; status: string; currency: string; amount: number;
}
export interface PaymentSnapshot {
  version: 1; transactions: PaymentTransaction[]; payouts: PaymentPayout[];
  balances: { currency: string; amount: number }[];
  orders?: Record<string, PaymentOrderCheck>;
}
export interface PaymentOrderCheck {
  updatedAt: string; transactionIds: string[]; captured: number; refunded: number; currency: string; mixed: boolean;
}

function money(value: unknown): number {
  if (value == null || value === "" || !Number.isFinite(Number(value))) throw new Error("Shopify enviou um valor de pagamento inválido.");
  return Number(value);
}
const currency = (value: unknown) => {
  if (typeof value !== "string" || !/^[A-Z]{3}$/.test(value)) throw new Error("Moeda de pagamento inválida.");
  return value;
};
const id = (value: unknown) => {
  if (value == null || !/^\d+$/.test(String(value))) throw new Error("Identificador de pagamento inválido.");
  return String(value);
};

/** Fail the whole snapshot on malformed data; never overwrite a good ledger with partial pages. */
export function normalizePayments(transactions: Record<string, unknown>[], payouts: Record<string, unknown>[], balances: Record<string, unknown>[]): PaymentSnapshot {
  const tx = new Map<string, PaymentTransaction>();
  for (const row of transactions) {
    const amount = money(row.amount), fee = money(row.fee), net = money(row.net);
    if (Math.abs(round2(amount - fee - net)) > 0.01) throw new Error("O líquido de um pagamento não corresponde ao bruto menos taxas.");
    if (typeof row.processed_at !== "string" || !Number.isFinite(Date.parse(row.processed_at))) throw new Error("Data de pagamento inválida.");
    const value: PaymentTransaction = { id: id(row.id), type: String(row.type), currency: currency(row.currency), amount, fee, net,
      orderId: row.source_order_id == null ? null : id(row.source_order_id),
      orderTransactionId: row.source_order_transaction_id == null ? null : id(row.source_order_transaction_id),
      payoutId: row.payout_id == null ? null : id(row.payout_id),
      processedAt: row.processed_at, test: row.test === true };
    tx.set(value.id, value);
  }
  const po = new Map<string, PaymentPayout>();
  for (const row of payouts) {
    if (typeof row.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) throw new Error("Data de transferência inválida.");
    const value = { id: id(row.id), date: row.date, status: String(row.status), currency: currency(row.currency), amount: money(row.amount) };
    po.set(value.id, value);
  }
  return { version: 1, transactions: [...tx.values()], payouts: [...po.values()],
    balances: balances.map((r) => ({ currency: currency(r.currency), amount: money(r.amount) })) };
}

export function readPaymentSnapshot(value: unknown): PaymentSnapshot | null {
  const s = value as PaymentSnapshot | null;
  return s?.version === 1 && Array.isArray(s.transactions) && Array.isArray(s.payouts) && Array.isArray(s.balances) ? s : null;
}

/** Cash reconciliation is always in the original currency, never a sum of USD and EUR. */
export function reconcilePayments(snapshot: PaymentSnapshot) {
  const movements = snapshot.transactions.filter((t) => !t.test && t.type !== "payout");
  const currencies = new Set([...movements, ...snapshot.payouts, ...snapshot.balances].map((r) => r.currency));
  const payoutChecks = snapshot.payouts.map((p) => {
    const rows = movements.filter((t) => t.payoutId === p.id && t.currency === p.currency);
    const total = round2(rows.reduce((n, t) => n + t.net, 0));
    return { ...p, ledgerNet: total, difference: round2(p.amount - total), matched: rows.length > 0 && Math.abs(round2(p.amount - total)) <= 0.01 };
  });
  const totals = [...currencies].sort().map((cur) => {
    const tx = movements.filter((t) => t.currency === cur);
    const payouts = snapshot.payouts.filter((p) => p.currency === cur);
    const sum = (rows: PaymentTransaction[], field: "amount" | "fee" | "net") => round2(rows.reduce((n, t) => n + t[field], 0));
    const payoutSum = (status: string) => round2(payouts.filter((p) => p.status === status).reduce((n, p) => n + p.amount, 0));
    const pending = sum(tx.filter((t) => t.payoutId == null), "net");
    const balance = round2(snapshot.balances.filter((b) => b.currency === cur).reduce((n, b) => n + b.amount, 0));
    return { currency: cur, gross: sum(tx.filter((t) => t.type === "charge"), "amount"), refunds: sum(tx.filter((t) => t.type === "refund"), "amount"),
      other: sum(tx.filter((t) => !["charge", "refund"].includes(t.type)), "amount"), fees: sum(tx, "fee"), net: sum(tx, "net"),
      paid: payoutSum("paid"), inTransit: payoutSum("in_transit"), scheduled: payoutSum("scheduled"), failed: payoutSum("failed"),
      cancelled: payoutSum("canceled"), balance, pending, balanceDifference: round2(balance - pending),
      toArrive: round2(payoutSum("in_transit") + payoutSum("scheduled") + pending) };
  });
  return { totals, payouts: payoutChecks, unreconciled: payoutChecks.filter((p) => !p.matched).length };
}

export interface PaymentOrder {
  shopify_order_id: string; total_price: number; total_refunded: number; currency?: string | null; financial_status?: string | null; raw?: unknown;
}
export interface OrderPaymentEffect {
  fees: number; adjustment: number; actual: boolean;
}

/** Order P&L uses capture/refund fees and the difference between booked sales and settlement.
 * Disputes and other balance movements are separate dated effects; payouts never reduce profit.
 * Unknown/mixed gateways retain the explicit fee estimate, rather than pretending full coverage.
 */
export function orderPaymentEffect(order: PaymentOrder, transactions: PaymentTransaction[], rate: (currency: string) => number,
  estimate: number, orderToBase = 1, check?: PaymentOrderCheck): OrderPaymentEffect {
  const raw = order.raw as { financial_status?: string; updated_at?: string } | null;
  const tx = transactions.filter((t) => !t.test && t.orderId === String(order.shopify_order_id) && ["charge", "refund"].includes(t.type));
  const charges = tx.filter((t) => t.type === "charge");
  // A paid order with only Shopify Payments is the coverage boundary. Partial/manual
  // payments and delayed ledger rows must not be mistaken for a fully settled order.
  const ids = new Set(tx.map((t) => t.orderTransactionId));
  const full = Boolean(check && !check.mixed && check.transactionIds.length && check.transactionIds.every((key) => ids.has(key)) &&
    tx.every((t) => t.orderTransactionId != null && check.transactionIds.includes(t.orderTransactionId)) &&
    (!order.currency || check.currency === order.currency) &&
    (!raw?.updated_at || Date.parse(raw.updated_at) === Date.parse(check.updatedAt)) && charges.length &&
    ["paid", "refunded", "partially_refunded", "partially_paid"].includes(order.financial_status ?? raw?.financial_status ?? ""));
  if (!full) return { fees: estimate, adjustment: 0, actual: false };
  const gross = tx.reduce((n, t) => n + t.amount * rate(t.currency), 0);
  return { fees: tx.reduce((n, t) => n + t.fee * rate(t.currency), 0),
    adjustment: gross - (Number(order.total_price) - Number(order.total_refunded)) * orderToBase, actual: true };
}

/** Only permanent income/cost adjustments affect P&L. Reserves and transfers affect cash availability. */
export function isProfitAdjustment(t: PaymentTransaction): boolean {
  return !t.test && ["dispute", "adjustment", "credit", "debit"].includes(t.type);
}
