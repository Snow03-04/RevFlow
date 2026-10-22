import "server-only";
import Stripe from "stripe";
import { PLANS, type PlanId } from "./plans";
import { billingRpc, type Membership } from "./server";

const priceEnvironment = { monthly: "STRIPE_PRICE_MONTHLY", quarterly: "STRIPE_PRICE_QUARTERLY", yearly: "STRIPE_PRICE_YEARLY" } as const;
export function priceId(plan: PlanId) { return process.env[priceEnvironment[plan]] ?? ""; }
export function billingReady() {
  return process.env.REVFLOW_BILLING_ENABLED === "true" && !!process.env.STRIPE_SECRET_KEY && !!process.env.STRIPE_WEBHOOK_SECRET && PLANS.every(p => priceId(p.id)) && !!process.env.REVFLOW_LEGAL_NAME && !!process.env.REVFLOW_LEGAL_ADDRESS;
}
let client: Stripe | undefined;
export function stripeClient() {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("Pagamentos ainda indisponíveis.");
  return client ??= new Stripe(process.env.STRIPE_SECRET_KEY, { timeout: 20000, maxNetworkRetries: 1 });
}
export function matchingPlan(price: Stripe.Price) {
  return PLANS.find(p => price.id === priceId(p.id) && price.currency === "eur" && price.unit_amount === p.amount && price.recurring?.interval === (p.months === 12 ? "year" : "month") && price.recurring.interval_count === (p.months === 12 ? 1 : p.months));
}
/** Re-read Stripe's current state; never trust browser success URLs or event order. */
export async function reconcileCustomer(customerId: string, eventId: string) {
  const member = await billingRpc<Membership | null>("revflow_customer_account", { p_customer: customerId });
  if (!member) return;
  const snapshotAt = new Date().toISOString();
  const subscriptions = await stripeClient().subscriptions.list({ customer: customerId, status: "all", limit: 100, expand: ["data.latest_invoice"] });
  // Checkout prevents concurrent subscriptions. Prefer a current contract over
  // an abandoned incomplete checkout, then the newest valid RevFlow contract.
  const candidates = subscriptions.data.filter(s => s.items.data.length === 1 && s.items.data[0].quantity === 1 && matchingPlan(s.items.data[0].price));
  candidates.sort((a,b) => Number(b.status === "active") - Number(a.status === "active") || b.created - a.created);
  const sub = candidates[0];
  const invoice = sub?.latest_invoice && typeof sub.latest_invoice !== "string" ? sub.latest_invoice : null;
  const paid = sub?.status === "active" && invoice?.status === "paid";
  const end = sub?.items.data[0].current_period_end;
  await billingRpc("revflow_apply_subscription", { p_user_id: member.user_id, p_event: eventId, p_snapshot: snapshotAt, p_subscription: sub?.id ?? null, p_plan: sub ? matchingPlan(sub.items.data[0].price)?.id : null, p_status: paid ? "active" : sub?.status === "active" ? "payment_pending" : sub?.status ?? "none", p_paid_until: paid && end ? new Date(end * 1000).toISOString() : null, p_cancel: sub?.cancel_at_period_end ?? false });
}
