/** Financial reads need proof of capture and source freshness, never the full
 * Shopify payload (addresses, customer, fulfilments and duplicated line items).
 * PostgREST extracts these fields in the database before sending the response. */
export const ORDER_EVIDENCE_COLUMNS =
  "paid_portion:raw->revflow_paid_portion,source_updated_at:raw->>updated_at";

export interface OrderEvidence {
  paid_portion?: unknown;
  source_updated_at?: string | null;
  raw?: unknown;
}

export function paidPortion(order: OrderEvidence) {
  return ("paid_portion" in order ? order.paid_portion
    : (order.raw as { revflow_paid_portion?: unknown } | null)?.revflow_paid_portion) as
    { version?: number; captured?: number } | null | undefined;
}

export function sourceUpdatedAt(order: OrderEvidence) {
  return "source_updated_at" in order ? order.source_updated_at
    : (order.raw as { updated_at?: string } | null)?.updated_at;
}
