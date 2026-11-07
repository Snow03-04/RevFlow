import { NextResponse } from "next/server";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { getSubscriptionData } from "@/lib/subscriptions/queries";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, private" };
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Inicia sessão para ver os avisos." }, { status: 401, headers });
    const { alerts } = await getSubscriptionData(await createClient(), user.id);
    return NextResponse.json({ alerts }, { headers });
  } catch {
    return NextResponse.json({ error: "Não foi possível verificar os avisos de subscrições." }, { status: 503, headers });
  }
}
