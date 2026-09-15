import type { SupplierCosts } from "./sheet";
import { ymdInTz } from "@/lib/date";

export interface SupplierOrder {
  id: string;
  order_number: string | null;
  processed_at: string;
  shopify_connection_id: string | null;
}
export interface SupplierItem {
  order_id: string;
  shopify_product_id: string | null;
  quantity: number;
}

/** A store is explicit. Order-number overlap is never proof of store identity. */
export function buildSupplierPlan(
  costs: SupplierCosts,
  orders: SupplierOrder[],
  items: SupplierItem[],
  storeId: string,
  timezone: string,
) {
  if (costs.errors.length) throw new Error(costs.errors.join(" "));
  if (!costs.byOrder.size)
    throw new Error(
      "A sheet não tem encomendas com custo. Os custos anteriores foram mantidos.",
    );
  const byNumber = new Map<string, SupplierOrder>();
  for (const o of orders.filter((o) => o.shopify_connection_id === storeId)) {
    const number = (o.order_number ?? "").replace(/\D/g, "");
    if (byNumber.has(number))
      throw new Error(`Número de encomenda ambíguo na loja: ${number}.`);
    if (number) byNumber.set(number, o);
  }
  const byOrder = new Map<string, SupplierItem[]>();
  for (const li of items)
    byOrder.set(li.order_id, [...(byOrder.get(li.order_id) ?? []), li]);
  const samples = new Map<string, Map<string, number[]>>();
  const exact = [];
  const unknownOrders = [];
  for (const row of costs.byOrder.values()) {
    const order = byNumber.get(row.order);
    if (!order) {
      unknownOrders.push(row.order);
      continue;
    }
    exact.push({ ...row, orderId: order.id });
    const lines = byOrder.get(order.id) ?? [];
    // Do not infer an unrelated product's unit cost from another product or
    // from the price of a multi-item basket. The exact order total still wins.
    if (
      lines.length !== 1 ||
      Number(lines[0].quantity) !== 1 ||
      !lines[0].shopify_product_id
    )
      continue;
    const pid = lines[0].shopify_product_id;
    const day = ymdInTz(new Date(order.processed_at), timezone);
    const daily = samples.get(pid) ?? new Map<string, number[]>();
    daily.set(day, [...(daily.get(day) ?? []), row.cost]);
    samples.set(pid, daily);
  }
  if (!exact.length)
    throw new Error(
      "Nenhuma encomenda corresponde à loja selecionada. Confirma o separador da sheet.",
    );
  const productCosts: {
    shopify_product_id: string;
    effective_from: string;
    cost: number;
  }[] = [];
  for (const [pid, daily] of samples) {
    let previous: number | undefined;
    for (const day of [...daily.keys()].sort()) {
      const frequencies = new Map<number, number>();
      for (const n of daily.get(day)!)
        frequencies.set(n, (frequencies.get(n) ?? 0) + 1);
      const sorted = [...frequencies].sort(
        (a, b) => b[1] - a[1] || a[0] - b[0],
      );
      // No unique modal price: keep the exact orders, do not invent a default.
      if (sorted[1]?.[1] === sorted[0][1]) continue;
      const cost = sorted[0][0];
      if (cost !== previous)
        productCosts.push({
          shopify_product_id: pid,
          effective_from: day,
          cost,
        });
      previous = cost;
    }
  }
  return { exact, productCosts, unknownOrders };
}
