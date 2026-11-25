import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { replayableDay } from "@/lib/live/day";
import { readGlobeState } from "@/lib/live/globe";
import { liveTopic } from "@/lib/live/realtime";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

/**
 * Today's state for the signed-in account's live globe, plus the Realtime topic its new orders arrive on.
 * `?day=yyyy-mm-dd` answers with that past day instead, for the globe to replay.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Inicia sessão para ver as lojas." }, { status: 401, headers });
  const day = new URL(request.url).searchParams.get("day");
  // The account's own "today" is only known once its timezone is read; here a day is refused only
  // when it could not be one anywhere (tomorrow by UTC+14 at the latest).
  if (day !== null && !replayableDay(day, new Date(Date.now() + 14 * 3600_000).toISOString().slice(0, 10))) {
    return Response.json({ error: "Esse dia não existe." }, { status: 400, headers });
  }
  try {
    const db = await createClient();
    const state = await readGlobeState(db, user.id, day);
    return Response.json({ ...state, topic: liveTopic(user.id) }, { headers });
  } catch {
    return Response.json({ error: "Não foi possível ler as encomendas de hoje." }, { status: 503, headers });
  }
}
