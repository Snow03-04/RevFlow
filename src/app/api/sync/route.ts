import { NextRequest, NextResponse } from "next/server";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { refreshRecentData } from "@/lib/sync/recent";
import { invalidateSyncedViews } from "@/lib/sync/invalidate";
import { isSameOriginRequest } from "@/lib/sync/request";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** HTTP keeps automatic imports out of Next's sequential server-action queue. */
export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ ok: false, error: "Origem inválida." }, { status: 403 });
  }
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Sessão expirada. Inicia sessão novamente." }, { status: 401 });
  try {
    const body = await request.json().catch(() => ({}));
    const result = await refreshRecentData(await createClient(), user.id, body?.force === true);
    // A partial success still changes data. Invalidate every affected view.
    invalidateSyncedViews();
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Recent data refresh failed", error);
    return NextResponse.json({ ok: false, error: "Não foi possível atualizar. Tenta novamente." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
