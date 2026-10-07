import { ymdInTz } from "@/lib/date";
import type { CostLineItem, SupplierQuantityQuote } from "@/lib/cogs/order-cost";
import type { SupplierItem, SupplierOrder } from "./plan";

type Invoice = {
  shopify_connection_id: string | null;
  order_number: string;
  cost: number;
  currency: string | null;
};
type Sample = SupplierQuantityQuote & { day: string; processedAt: string };
type BasketItem = { shopify_product_id: string | null; quantity: number };

function basketKey(items: BasketItem[]): string | undefined {
  const quantities = new Map<string, number>();
  for (const item of items) {
    const quantity = Number(item.quantity);
    if (!item.shopify_product_id || !Number.isInteger(quantity) || quantity <= 0)
      return undefined;
    quantities.set(item.shopify_product_id, (quantities.get(item.shopify_product_id) ?? 0) + quantity);
  }
  return quantities.size ? JSON.stringify([...quantities].sort(([a], [b]) => a.localeCompare(b))) : undefined;
}

/** Store-scoped, dated basket totals. A multi-item invoice never teaches a
 * single-unit price or a discount for unrelated products. Rebuild from saved
 * invoices so corrections in the sheet also correct subsequent estimates. */
export function buildQuantityQuotes(
  orders: SupplierOrder[],
  items: SupplierItem[],
  invoices: Invoice[],
  opts: { storeId: string; timezone: string; toBase: (cost: number, currency: string | null) => number },
) {
  const invoiceByNumber = new Map(invoices
    .filter((row) => row.shopify_connection_id === opts.storeId)
    .map((row) => [row.order_number.replace(/\D/g, ""), row]));
  const itemsByOrder = new Map<string, SupplierItem[]>();
  for (const item of items) {
    const list = itemsByOrder.get(item.order_id) ?? [];
    list.push(item);
    itemsByOrder.set(item.order_id, list);
  }
  const samples = new Map<string, Sample[]>();
  const quantitiesByProduct = new Map<string, Set<number>>();
  for (const order of orders) {
    if (order.shopify_connection_id !== opts.storeId || order.financial_status !== "paid" ||
      order.test || order.cancelled_at || Number(order.total_refunded ?? 0) > 0) continue;
    const invoice = invoiceByNumber.get((order.order_number ?? "").replace(/\D/g, ""));
    // Zero invoices still override the exact order, but do not teach free stock.
    if (!invoice || !Number.isFinite(Number(invoice.cost)) || Number(invoice.cost) <= 0) continue;
    const lines = itemsByOrder.get(order.id) ?? [];
    if (lines.some((line) => line.current_quantity != null && Number(line.current_quantity) !== Number(line.quantity))) continue;
    const key = basketKey(lines);
    const quantity = lines.reduce((total, line) => total + Number(line.quantity), 0);
    if (!key || quantity < 2 || !Number.isFinite(Date.parse(order.processed_at))) continue;
    const sample: Sample = {
      cost: opts.toBase(Number(invoice.cost), invoice.currency), quantity,
      orderNumber: invoice.order_number, day: ymdInTz(new Date(order.processed_at), opts.timezone),
      processedAt: order.processed_at,
    };
    const list = samples.get(key) ?? [];
    list.push(sample);
    samples.set(key, list);
    const products = new Set(lines.map((line) => line.shopify_product_id!));
    if (products.size === 1) {
      const pid = lines[0].shopify_product_id!;
      const quantities = quantitiesByProduct.get(pid) ?? new Set<number>();
      quantities.add(quantity);
      quantitiesByProduct.set(pid, quantities);
    }
  }
  for (const list of samples.values()) list.sort((a, b) =>
    Date.parse(a.processedAt) - Date.parse(b.processedAt) || a.orderNumber.localeCompare(b.orderNumber, undefined, { numeric: true }));

  const cache = new Map<string, SupplierQuantityQuote | undefined>();
  function quote(key: string | undefined, day: string): SupplierQuantityQuote | undefined {
    if (!key) return undefined;
    const cacheKey = `${day}:${key}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey);
    let chosen: Sample | undefined;
    let lower: Sample | undefined;
    // One anomalously cheap invoice must not inflate profit on every future
    // order. Require two successive matching quotes for a lower estimate.
    // Increases apply immediately; the exact invoice always bypasses this rule.
    for (const sample of samples.get(key) ?? []) {
      if (sample.day > day) break;
      if (!chosen || sample.cost >= chosen.cost - 0.000001) {
        chosen = sample;
        lower = undefined;
      } else if (lower && Math.abs(lower.cost - sample.cost) < 0.000001) {
        chosen = sample;
        lower = undefined;
      } else lower = sample;
    }
    const result = chosen ? { cost: chosen.cost, quantity: chosen.quantity, orderNumber: chosen.orderNumber,
      pendingLowerQuote: lower?.orderNumber } : undefined;
    cache.set(cacheKey, result);
    return result;
  }
  return {
    basket(items: CostLineItem[], day: string) {
      return quote(basketKey(items.map((item) => ({
        shopify_product_id: item.shopify_product_id,
        quantity: Number(item.current_quantity ?? item.quantity),
      })).filter((item) => item.quantity > 0)), day);
    },
    product(productId: string, quantity: number, day: string) {
      for (const count of [...(quantitiesByProduct.get(productId) ?? [])].sort((a, b) => b - a)) {
        if (count > quantity) continue;
        const result = quote(basketKey([{ shopify_product_id: productId, quantity: count }]), day);
        if (result) return result;
      }
      return undefined;
    },
  };
}
