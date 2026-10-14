import type { TablesInsert } from "@/types/database";

type Order = Partial<TablesInsert<"orders">>;
type Line = Partial<TablesInsert<"order_line_items">>;

/** Fulfilment, contact and provider timestamps do not change financial totals.
 * Compare persisted lines too so interrupted line writes are always repaired. */
export function orderAccountingKey(order: Order, lines: Line[]): string {
  const raw = order.raw as Record<string, unknown> | null;
  const proof = raw?.revflow_paid_portion as { version?: number; captured?: number } | undefined;
  const number = (value: unknown) => value == null ? null : Number(value);
  return JSON.stringify([
    order.shopify_connection_id, order.order_number,
    order.processed_at ? Date.parse(order.processed_at) : null,
    order.currency, order.financial_status, Boolean(order.test), order.cancelled_at ?? null,
    ...[order.subtotal_price, order.total_price, order.total_discounts, order.total_tax,
      order.total_shipping, order.total_refunded].map(number),
    // These proof fields decide whether a partially paid order qualifies as a
    // sale. Its amounts and paid quantities are compared above/below. Avoid
    // comparing JSON object key order, which PostgreSQL may reorder.
    proof?.version ?? null, proof?.captured ?? null,
    lines.map(line => [line.shopify_line_item_id, line.shopify_product_id, line.shopify_variant_id,
      ...[line.quantity, line.current_quantity, line.price, line.total_discount, line.unit_cost].map(number)])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  ]);
}

/** Overlap covers changes made while the preceding request was running. */
export function orderSyncSince(sinceDays: number, connection: { status: string; last_synced_at: string | null },
  incremental: boolean, now = Date.now()): string {
  const last = Date.parse(connection.last_synced_at ?? "");
  const since = incremental && connection.status === "active" && Number.isFinite(last) && last <= now
    ? last - 5 * 60_000 : now - sinceDays * 86_400_000;
  return new Date(since).toISOString();
}
