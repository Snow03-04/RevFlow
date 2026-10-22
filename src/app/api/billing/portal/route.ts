import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import { getMembership } from "@/lib/billing/server";
import { stripeClient } from "@/lib/billing/stripe";
import { clientEnv } from "@/lib/env";
import { isSameOrigin, rateLimit } from "@/lib/security/request";
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Pedido não autorizado." }, { status: 403 });
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Inicia sessão." }, { status: 401 });
  try {
    if (!(await rateLimit(request,"portal",10,600,user.id))) return NextResponse.json({ error: "Aguarda um momento." }, { status: 429 });
    const member = await getMembership(user.id);
    if (!member.customer_id) return NextResponse.json({ error: "Ainda não tens pagamentos associados." }, { status: 404 });
    const session = await stripeClient().billingPortal.sessions.create({ customer: member.customer_id, return_url: `${clientEnv.appUrl}/subscribe` });
    return NextResponse.json({ url: session.url });
  } catch { return NextResponse.json({ error: "Não foi possível abrir a gestão da subscrição." }, { status: 502 }); }
}
