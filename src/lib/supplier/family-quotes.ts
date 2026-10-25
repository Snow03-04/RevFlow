import { ymdInTz } from "@/lib/date";
import type { CostLineItem, SupplierQuantityQuote } from "@/lib/cogs/order-cost";
import type { SupplierItem, SupplierOrder } from "./plan";

type Invoice = { shopify_connection_id: string | null; order_number: string; cost: number; currency: string | null };
type Sample = SupplierQuantityQuote & { day: string; at: string; products: Set<string> };
export type SupplierFamilyGroup = { productIds: string[]; phrase: string; quote: SupplierQuantityQuote; unitCost: number };

/** Learn a product family only when a shared title phrase is supported by
 * several independently invoiced products at the same unit price AND bundle
 * invoices. Names alone never establish a discount. Everything stays scoped
 * to one store and to evidence available on the order's local date. */
export function buildFamilyQuotes(orders: SupplierOrder[], items: SupplierItem[], invoices: Invoice[], opts: {
  storeId: string; timezone: string; toBase: (cost: number, currency: string | null) => number;
  catalogue: { productId: string; title: string | null }[];
}) {
  const phrases = new Map<string, Set<string>>();
  for (const product of opts.catalogue) {
    const words = (product.title ?? "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().match(/\p{L}+/gu) ?? [];
    for (const size of [2, 3]) for (let i = 0; i <= words.length - size; i++) {
      const part = words.slice(i, i + size);
      if (part.some(word => word.length < 3)) continue;
      const phrase = part.join(" ");
      const members = phrases.get(phrase) ?? new Set<string>();
      members.add(product.productId); phrases.set(phrase, members);
    }
  }
  const candidates = [...phrases].filter(([, members]) => members.size >= 3);
  const invoiceByNumber = new Map(invoices.filter(i => i.shopify_connection_id === opts.storeId)
    .map(i => [i.order_number.replace(/\D/g, ""), i]));
  const linesByOrder = new Map<string, SupplierItem[]>();
  for (const item of items) { const lines = linesByOrder.get(item.order_id) ?? []; lines.push(item); linesByOrder.set(item.order_id, lines); }
  const samples: Sample[] = [];
  for (const order of orders) {
    if (order.shopify_connection_id !== opts.storeId || order.financial_status !== "paid" || order.test ||
      order.cancelled_at || Number(order.total_refunded ?? 0) > 0 || !Number.isFinite(Date.parse(order.processed_at))) continue;
    const invoice = invoiceByNumber.get((order.order_number ?? "").replace(/\D/g, ""));
    const lines = linesByOrder.get(order.id) ?? [];
    if (!invoice || !(Number(invoice.cost) > 0) || !Number.isFinite(Number(invoice.cost)) || !lines.length ||
      lines.some(l => !l.shopify_product_id || !Number.isInteger(Number(l.quantity)) || Number(l.quantity) <= 0 ||
        (l.current_quantity != null && Number(l.current_quantity) !== Number(l.quantity)))) continue;
    samples.push({ cost: opts.toBase(Number(invoice.cost), invoice.currency), quantity: lines.reduce((n, l) => n + Number(l.quantity), 0),
      orderNumber: invoice.order_number, day: ymdInTz(new Date(order.processed_at), opts.timezone), at: order.processed_at,
      products: new Set(lines.map(l => l.shopify_product_id!)) });
  }
  samples.sort((a, b) => a.at.localeCompare(b.at) || a.orderNumber.localeCompare(b.orderNumber, undefined, { numeric: true }));
  const cache = new Map<string, { phrase: string; members: Set<string>; unitCost: number; quotes: Map<number, SupplierQuantityQuote> }[]>();
  function families(day: string) {
    if (cache.has(day)) return cache.get(day)!;
    const dated = samples.filter(s => s.day <= day);
    const unitByProduct = new Map<string, Sample>();
    for (const sample of dated) if (sample.quantity === 1) unitByProduct.set([...sample.products][0], sample);
    const result = [];
    for (const [phrase, originalMembers] of candidates) {
      const known = [...originalMembers].flatMap(id => unitByProduct.has(id) ? [{ id, sample: unitByProduct.get(id)! }] : []);
      const counts = new Map<string, number>();
      for (const { sample } of known) { const key = sample.cost.toFixed(6); counts.set(key, (counts.get(key) ?? 0) + 1); }
      const modal = [...counts].sort((a, b) => b[1] - a[1])[0];
      if (!modal || modal[1] < 3 || modal[1] / known.length < 0.8) continue;
      const unitCost = Number(modal[0]);
      // A known more expensive/cheaper product is not a new design of this price group.
      const members = new Set([...originalMembers].filter(id => !unitByProduct.has(id) || Math.abs(unitByProduct.get(id)!.cost - unitCost) < 0.00001));
      const compatible = dated.filter(s => [...s.products].every(id => members.has(id)));
      if (compatible.filter(s => s.quantity > 1).length < 2) continue;
      const quotes = new Map<number, SupplierQuantityQuote>();
      const lower = new Map<number, Sample>();
      for (const sample of compatible) {
        if (sample.quantity === 1 && Math.abs(sample.cost - unitCost) > 0.00001) continue;
        const previous = quotes.get(sample.quantity), pending = lower.get(sample.quantity);
        if (!previous || sample.cost >= previous.cost - 0.00001 || (pending && Math.abs(sample.cost - pending.cost) < 0.00001)) {
          quotes.set(sample.quantity, { cost: sample.cost, quantity: sample.quantity, orderNumber: sample.orderNumber });
          lower.delete(sample.quantity);
        } else lower.set(sample.quantity, sample);
      }
      for (const [quantity, pending] of lower) quotes.get(quantity)!.pendingLowerQuote = pending.orderNumber;
      result.push({ phrase, members, unitCost, quotes, support: modal[1] });
    }
    // Ranking cannot depend on which unpriced orders happen to be in the
    // caller's date range: audit, dashboard and trackers must choose identically.
    result.sort((a, b) => b.support - a.support || b.phrase.length - a.phrase.length || a.phrase.localeCompare(b.phrase));
    cache.set(day, result); return result;
  }
  return (lines: CostLineItem[], day: string): SupplierFamilyGroup[] => {
    const remaining = new Map<string, number>();
    for (const line of lines) {
      const qty = Number(line.current_quantity ?? line.quantity);
      if (line.shopify_product_id && qty > 0) remaining.set(line.shopify_product_id, (remaining.get(line.shopify_product_id) ?? 0) + qty);
    }
    const groups: SupplierFamilyGroup[] = [];
    for (const family of families(day)) {
      const productIds = [...remaining.keys()].filter(id => family.members.has(id));
      const quantity = productIds.reduce((n, id) => n + remaining.get(id)!, 0);
      if (!quantity) continue;
      const quotedQuantity = [...family.quotes.keys()].filter(q => q <= quantity).sort((a, b) => b - a)[0];
      if (!quotedQuantity) continue;
      groups.push({ productIds, phrase: family.phrase, quote: family.quotes.get(quotedQuantity)!, unitCost: family.unitCost });
      for (const id of productIds) remaining.delete(id);
    }
    return groups;
  };
}
