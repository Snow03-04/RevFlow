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
const tasksPrefix = "Etapas por atualizar: ";

function taskLabels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((label): label is string => typeof label === "string")
    .map(label => label.trim().slice(0, 150)).filter(Boolean))].slice(0, 100);
}

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
    if (body?.step === "status") {
      const [run, totals] = await Promise.all([
        db.from("sync_logs").select("status,finished_at,error").eq("user_id", user.id)
          .eq("job_type", "account_refresh").in("source", ["dashboard", "scheduler"])
          .not("finished_at", "is", null).order("finished_at", { ascending: false }).limit(1).maybeSingle(),
        db.from("daily_metrics").select("updated_at").eq("user_id", user.id)
          .order("updated_at", { ascending: false }).limit(1).maybeSingle(),
      ]);
      if (run.error) throw run.error;
      if (totals.error) throw totals.error;
      const data = run.data;
      const latest = Math.max(Date.parse(data?.finished_at ?? "") || 0, Date.parse(totals.data?.updated_at ?? "") || 0);
      const failed = !!data && data.status !== "success";
      let failedTasks: string[] = [];
      if (failed && data.error?.startsWith(tasksPrefix)) {
        try { failedTasks = taskLabels(JSON.parse(data.error.slice(tasksPrefix.length))); } catch { /* Legacy text */ }
      }
      return NextResponse.json({ ok: !failed, completedAt: latest ? new Date(latest).toISOString() : undefined,
        runAt: data?.finished_at ?? undefined,
        ...(failed ? { synced: true, error: failedTasks.length ? "Atualização parcial." : data.error,
          ...(failedTasks.length ? { failedTasks } : {}) } : {}) }, { headers: noStore });
    }
    if (body?.step === "plan") {
      return NextResponse.json(await planRefresh(db, user.id, body?.force === true, body?.progressive === true, body?.prioritizeActive === true), { headers: noStore });
    }
    if (body?.step === "finish") {
      invalidateSyncedViews();
      const completedAt = new Date().toISOString();
      // Progressive publications and older clients send no final outcome.
      if (body.outcome === "success" || body.outcome === "partial") {
        const labels = taskLabels(body.failedTasks);
        const { error } = await db.from("sync_logs").insert({
          user_id: user.id, source: "dashboard", job_type: "account_refresh", status: body.outcome,
          finished_at: completedAt, error: body.outcome === "success" ? null :
            labels.length ? tasksPrefix + JSON.stringify(labels) : "A última atualização ficou incompleta.",
        });
        if (error) throw error;
      }
      return NextResponse.json({ ok: true, completedAt }, { headers: noStore });
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
