import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { readGlobeState } from "@/lib/live/globe";
import { liveTopic } from "@/lib/live/realtime";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

/** Today's state for the signed-in account's live globe, plus the Realtime topic its new orders arrive on. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Inicia sessão para ver as lojas." }, { status: 401, headers });
  try {
    const db = await createClient();
    const state = await readGlobeState(db, user.id);
    return Response.json({ ...state, topic: liveTopic(user.id) }, { headers });
  } catch {
    return Response.json({ error: "Não foi possível ler as encomendas de hoje." }, { status: 503, headers });
  }
}
