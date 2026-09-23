import "server-only";
import { serverEnv } from "@/lib/env";

// Sales agreements identify the original basket and later additions by line ID.
// Never infer paid items from array order, product names or an AfterSell tag.
export const PAID_PORTION_QUERY = `query PaidOrderPortion($id: ID!, $after: String) {
  order(id: $id) {
    totalReceivedSet { shopMoney { amount currencyCode } }
    totalRefundedSet { shopMoney { amount currencyCode } }
    currentTotalPriceSet { shopMoney { amount currencyCode } }
    totalOutstandingSet { shopMoney { amount currencyCode } }
    agreements(first: 50, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        happenedAt
        sales(first: 250) {
          pageInfo { hasNextPage endCursor }
          nodes {
            actionType lineType quantity
            totalAmount { shopMoney { amount currencyCode } }
            totalTaxAmount { shopMoney { amount currencyCode } }
            ... on ProductSale { lineItem { id } }
          }
        }
      }
    }
  }
}`;

type Money = { shopMoney: { amount: string; currencyCode: string } };
type Sale = {
  actionType: string; lineType: string; quantity: number | null;
  totalAmount: Money; totalTaxAmount: Money; lineItem?: { id: string };
};
type Agreement = {
  happenedAt: string;
  sales: { nodes: Sale[]; pageInfo: { hasNextPage: boolean } };
};
export interface PaymentEvidence {
  totalReceivedSet: Money;
  totalRefundedSet: Money;
  currentTotalPriceSet: Money;
  totalOutstandingSet: Money;
  agreements: { nodes: Agreement[]; pageInfo: { hasNextPage: boolean; endCursor?: string | null } };
}
export interface PaidPortion {
  captured: number;
  subtotal: number;
  shipping: number;
  tax: number;
  discounts: number;
  lines: Record<string, { quantity: number; discount: number }>;
}
const cents = (n: unknown) => n == null || n === "" ? NaN : Math.round(Number(n) * 100);

/** Only recognize complete baskets whose sales reconcile exactly to captured money.
 * A deposit, a return/edit, unsupported charge or incomplete history cannot tell
 * us which units were paid; leave those unresolved rather than inventing units.
 * Amounts use shop currency, including when the customer paid in another currency.
 */
export function buildPaidPortion(order: any, evidence: PaymentEvidence): PaidPortion | null {
  if (order.financial_status !== "partially_paid" || order.test || order.cancelled_at) return null;
  if (evidence.agreements.pageInfo.hasNextPage || (order.refunds ?? []).length) return null;
  const amount = (money: Money) => money?.shopMoney?.currencyCode === order.currency
    ? cents(money.shopMoney.amount) : NaN;
  const captured = amount(evidence.totalReceivedSet);
  const outstanding = amount(evidence.totalOutstandingSet);
  const total = amount(evidence.currentTotalPriceSet);
  if (!(captured > 0) || !(outstanding > 0) || amount(evidence.totalRefundedSet) !== 0
    || captured + outstanding !== total || total !== cents(order.current_total_price ?? order.total_price)
    || outstanding !== cents(order.total_outstanding)) return null;

  const agreements = [...evidence.agreements.nodes].sort((a, b) => a.happenedAt.localeCompare(b.happenedAt));
  const allSales = agreements.flatMap((a) => a.sales.nodes);
  if (agreements.some((a) => a.sales.pageInfo.hasNextPage)
    || allSales.some((s) => s.actionType !== "ORDER" || !["PRODUCT", "SHIPPING"].includes(s.lineType)
      || !Number.isFinite(amount(s.totalAmount)) || amount(s.totalAmount) < 0
      || !Number.isFinite(amount(s.totalTaxAmount)) || amount(s.totalTaxAmount) < 0)
    || allSales.reduce((sum, s) => sum + amount(s.totalAmount), 0) !== total) return null;

  let paid = 0;
  const selected: Sale[] = [];
  for (const agreement of agreements) {
    const value = agreement.sales.nodes.reduce((sum, s) => sum + amount(s.totalAmount), 0);
    if (paid + value > captured) break;
    selected.push(...agreement.sales.nodes);
    paid += value;
    if (paid === captured) break;
  }
  if (paid !== captured) return null;

  const lines: PaidPortion["lines"] = {};
  let subtotal = 0, shipping = 0, tax = 0, discounts = 0;
  for (const sale of selected) {
    const saleTax = amount(sale.totalTaxAmount);
    const net = amount(sale.totalAmount) - (order.taxes_included ? 0 : saleTax);
    if (net < 0) return null;
    tax += saleTax;
    if (sale.lineType === "SHIPPING") { shipping += net; continue; }
    const id = sale.lineItem?.id.split("/").at(-1);
    const line = (order.line_items ?? []).find((li: any) => String(li.id) === id);
    const qty = sale.quantity;
    if (!id || !line || !Number.isInteger(qty) || !qty || qty < 0) return null;
    const previous = lines[id];
    const quantity = (previous?.quantity ?? 0) + qty;
    if (quantity > Number(line.current_quantity ?? line.quantity)) return null;
    const discount = cents(line.price) * qty - net;
    if (!Number.isFinite(discount) || discount < 0) return null;
    lines[id] = { quantity, discount: (cents(previous?.discount ?? 0) + discount) / 100 };
    subtotal += net;
    discounts += discount;
  }
  if (!Object.keys(lines).length) return null;
  return { captured: captured / 100, subtotal: subtotal / 100, shipping: shipping / 100,
    tax: tax / 100, discounts: discounts / 100, lines };
}

export async function fetchPaidPortion(shop: string, token: string, order: any): Promise<PaidPortion | null> {
  if (order.financial_status !== "partially_paid" || order.test || order.cancelled_at) return null;
  let after: string | null = null;
  const agreements: Agreement[] = [];
  let evidence: PaymentEvidence;
  do {
    const response = await fetch(`https://${shop}/admin/api/${serverEnv.shopify.apiVersion}/graphql.json`, {
      method: "POST", headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
      body: JSON.stringify({ query: PAID_PORTION_QUERY, variables: { id: `gid://shopify/Order/${order.id}`, after } }),
      cache: "no-store", signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Shopify payment history failed (${response.status}) for ${order.name ?? order.id}`);
    const result = await response.json();
    if (result.errors?.length || !result.data?.order) throw new Error(`Shopify payment history unavailable for ${order.name ?? order.id}`);
    evidence = result.data.order;
    if (evidence.agreements.nodes.some((a) => a.sales.pageInfo.hasNextPage))
      throw new Error(`Incomplete Shopify sales history for ${order.name ?? order.id}`);
    agreements.push(...evidence.agreements.nodes);
    const page = evidence.agreements.pageInfo;
    if (page.hasNextPage && (!page.endCursor || page.endCursor === after)) throw new Error("Invalid Shopify payment history cursor");
    after = page.hasNextPage ? page.endCursor! : null;
  } while (after);
  return buildPaidPortion(order, { ...evidence, agreements: { nodes: agreements, pageInfo: { hasNextPage: false } } });
}
