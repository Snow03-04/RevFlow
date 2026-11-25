import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { readAdSpendPacing } from "@/lib/ads/read-pacing";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
const headers = { "Cache-Control": "private, no-store" };
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Inicia sessão." }, { status: 401, headers });
  try {
    return Response.json(await readAdSpendPacing(await createClient(), user.id, user.user_metadata ?? {}), { headers });
  } catch {
    return Response.json({ error: "Previsão por apurar." }, { status: 503, headers });
  }
}
