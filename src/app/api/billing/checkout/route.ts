import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import { clientEnv } from "@/lib/env";
import { findPlan } from "@/lib/billing/plans";
import { billingRpc, getMembership } from "@/lib/billing/server";
import { billingReady, matchingPlan, priceId, stripeClient } from "@/lib/billing/stripe";
import { isSameOrigin, rateLimit, readLimitedBody } from "@/lib/security/request";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Pedido não autorizado." }, { status: 403 });
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Inicia sessão para continuar." }, { status: 401 });
  if (!billingReady()) return NextResponse.json({ error: "As subscrições ainda não estão disponíveis. Não foi feita qualquer cobrança." }, { status: 503 });
  if (!user.email_confirmed_at) return NextResponse.json({ error: "Confirma o teu email antes de continuar." }, { status: 403 });
  const token = randomUUID(); let locked = false;
  try {
    if (!(await rateLimit(request, "checkout", 8, 600, user.id))) return NextResponse.json({ error: "Aguarda alguns minutos antes de tentar novamente." }, { status: 429 });
    const body = JSON.parse(await readLimitedBody(request, 2048));
    const plan = findPlan(body.plan);
    if (!plan || body.acceptTerms !== true) return NextResponse.json({ error: "Escolhe um plano e aceita os termos da subscrição." }, { status: 400 });
    const member = await getMembership(user.id);
    if (member.role === "admin" || member.complimentary) return NextResponse.json({ error: "A tua conta já tem acesso incluído." }, { status: 409 });
    locked = await billingRpc<boolean>("revflow_checkout_lock", { p_user_id: user.id, p_token: token });
    if (!locked) return NextResponse.json({ error: "Já está a ser preparado um pagamento. Aguarda um momento." }, { status: 409 });
    const stripe = stripeClient();
    const price = await stripe.prices.retrieve(priceId(plan.id));
    if (!price.active || matchingPlan(price)?.id !== plan.id) throw new Error("Invalid Stripe price configuration");
    let customer = member.customer_id;
    if (!customer) {
      const created = await stripe.customers.create({ email: user.email, metadata: { revflow_user_id: user.id } }, { idempotencyKey: `revflow-customer-${user.id}` });
      customer = await billingRpc<string>("revflow_set_customer", { p_user_id: user.id, p_customer: created.id });
    }
    const subscriptions = await stripe.subscriptions.list({ customer, status: "all", limit: 100 });
    if (subscriptions.data.some(s => !["canceled","incomplete_expired"].includes(s.status))) return NextResponse.json({ error: "Já tens uma subscrição. Gere-a na área da subscrição." }, { status: 409 });
    const sessions = await stripe.checkout.sessions.list({ customer, status: "open", limit: 100 });
    for (const session of sessions.data) {
      if (session.metadata?.revflow_plan === plan.id && session.url) return NextResponse.json({ url: session.url });
      if (session.mode === "subscription") await stripe.checkout.sessions.expire(session.id);
    }
    const session = await stripe.checkout.sessions.create({ mode: "subscription", customer, line_items: [{ price: price.id, quantity: 1 }], client_reference_id: user.id, metadata: { revflow_plan: plan.id, terms_version: "2026-10-22" }, subscription_data: { metadata: { revflow_user_id: user.id, revflow_plan: plan.id } }, consent_collection: { terms_of_service: "required" }, locale: "pt", success_url: `${clientEnv.appUrl}/subscribe?payment=received`, cancel_url: `${clientEnv.appUrl}/subscribe?plan=${plan.id}`, allow_promotion_codes: false, billing_address_collection: "required" }, { idempotencyKey: `revflow-checkout-${token}` });
    if (!session.url) throw new Error("No checkout URL");
    return NextResponse.json({ url: session.url });
  } catch (error) {
    if (error instanceof SyntaxError || (error instanceof Error && error.message === "payload_too_large")) return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
    console.error("RevFlow checkout failed", error instanceof Error ? error.name : "UnknownError");
    return NextResponse.json({ error: "Não foi possível abrir o pagamento. Tenta novamente mais tarde." }, { status: 502 });
  } finally { if (locked) await billingRpc("revflow_checkout_lock", { p_user_id: user.id, p_token: token, p_release: true }).catch(() => {}); }
}
