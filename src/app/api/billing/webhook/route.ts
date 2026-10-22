import { NextResponse } from "next/server";
import { stripeClient, reconcileCustomer } from "@/lib/billing/stripe";
import { readLimitedBody } from "@/lib/security/request";
import type Stripe from "stripe";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !process.env.STRIPE_SECRET_KEY) return new NextResponse("Not configured", { status: 503 });
  let event: Stripe.Event;
  try { event = stripeClient().webhooks.constructEvent(await readLimitedBody(request, 1024 * 1024), request.headers.get("stripe-signature") ?? "", secret); }
  catch { return new NextResponse("Invalid signature or payload", { status: 400 }); }
  const live = process.env.STRIPE_SECRET_KEY.startsWith("sk_live_") || process.env.STRIPE_SECRET_KEY.startsWith("rk_live_");
  if (event.livemode !== live) return new NextResponse("Mode mismatch", { status: 400 });
  const relevant = ["checkout.session.completed","checkout.session.async_payment_succeeded","customer.subscription.created","customer.subscription.updated","customer.subscription.deleted","invoice.paid","invoice.payment_failed"];
  if (!relevant.includes(event.type)) return NextResponse.json({ received: true });
  const object = event.data.object as { customer?: string | { id: string } | null };
  const customer = typeof object.customer === "string" ? object.customer : object.customer?.id;
  try { if (customer) await reconcileCustomer(customer, event.id); return NextResponse.json({ received: true }); }
  catch { console.error("RevFlow billing reconciliation failed", event.id); return new NextResponse("Retry required", { status: 500 }); }
}
