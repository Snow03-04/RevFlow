import { NextRequest, NextResponse } from "next/server";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { refreshRecentData } from "@/lib/sync/recent";
import { invalidateSyncedViews } from "@/lib/sync/invalidate";
import { isSameOriginRequest } from "@/lib/sync/request";
import { planRefresh, runRefreshStep, refreshStepSchema } from "@/lib/sync/steps";
import { REFRESH_STREAM_TYPE, type RefreshEvent, type RefreshResult } from "@/lib/sync/protocol";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const noStore = { "Cache-Control": "no-store" };

/** HTTP keeps automatic imports out of Next's sequential server-action queue. */
export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ ok: false, error: "Origem inválida." }, { status: 403, headers: noStore });
  }
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ ok: false, error: "Sessão expirada. Inicia sessão novamente." }, { status: 401, headers: noStore });
    const body = await request.json().catch(() => ({}));
    const db = await createClient();
    if (body?.step === "plan") {
      return NextResponse.json(await planRefresh(db, user.id, body?.force === true), { headers: noStore });
    }
    if (body?.step === "finish") {
      invalidateSyncedViews();
      return NextResponse.json({ ok: true, completedAt: new Date().toISOString() }, { headers: noStore });
    }
    if (body?.step !== undefined) {
      const step = refreshStepSchema.safeParse(body.step);
      if (!step.success) return NextResponse.json({ ok: false, error: "Etapa de atualização inválida." }, { status: 400, headers: noStore });
      return NextResponse.json(await runRefreshStep(db, user.id, step.data, body?.force === true), { headers: noStore });
    }
    // Keep the previous protocol for already-open tabs during a rolling deploy.
    if (request.headers.get("accept")?.includes(REFRESH_STREAM_TYPE)) {
      const encoder = new TextEncoder();
      let open = true;
      let heartbeat: ReturnType<typeof setInterval>;
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const send = (event: RefreshEvent) => {
            if (open) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          };
          heartbeat = setInterval(() => send({ type: "heartbeat" }), 15_000);
          try {
            const result = await refreshRecentData(db, user.id, body?.force === true,
              (message) => send({ type: "progress", message }));
            invalidateSyncedViews();
            send({ type: "result", result });
          } catch (error) {
            console.error("Recent data refresh failed", error);
            const result: RefreshResult = { ok: false, error: "Não foi possível concluir a atualização. Será tentada novamente automaticamente." };
            send({ type: "result", result });
          } finally {
            clearInterval(heartbeat);
            if (open) { open = false; controller.close(); }
          }
        },
        cancel() { open = false; clearInterval(heartbeat); },
      });
      return new Response(stream, { headers: { ...noStore, "Content-Type": `${REFRESH_STREAM_TYPE}; charset=utf-8`, "X-Accel-Buffering": "no" } });
    }
    const result = await refreshRecentData(db, user.id, body?.force === true);
    // A partial success still changes data. Invalidate every affected view.
    invalidateSyncedViews();
    return NextResponse.json(result, { headers: noStore });
  } catch (error) {
    console.error("Recent data refresh failed", error);
    return NextResponse.json({ ok: false, error: "Não foi possível atualizar. Tenta novamente." }, { status: 500, headers: noStore });
  }
}
