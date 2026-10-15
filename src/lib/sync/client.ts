import type { RefreshPlan, RefreshResult, RefreshStep, RefreshTask } from "./protocol";
import { REFRESH_STEP_TIMEOUT_MS } from "./protocol";
import { RefreshDeadlineError, withRefreshDeadline } from "./deadline";

/** Only deliberate user-facing messages may be shown by the provider. */
export class RefreshRequestError extends Error {}
export class RefreshSessionExpired extends RefreshRequestError {
  constructor() { super("Sessão expirada. Inicia sessão novamente."); }
}
const CONCURRENCY = 4;

/** Short JSON requests avoid holding every store and report inside one serverless invocation. */
export async function requestRefresh(force: boolean, signal: AbortSignal, progress: (message: string) => void, dataReady?: () => void): Promise<RefreshResult> {
  async function send(step: RefreshStep | "plan" | "finish", forceImport = false): Promise<RefreshPlan> {
    const timeout = typeof step === "string" ? 15_000 : REFRESH_STEP_TIMEOUT_MS;
    try {
      return await withRefreshDeadline(signal, timeout, async requestSignal => {
        let response: Response;
        try {
          response = await fetch("/api/sync", {
            method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ step, force: forceImport, progressive: true }), cache: "no-store", signal: requestSignal,
          });
        } catch (error) {
          if (signal.aborted) throw error;
          throw new RefreshRequestError("A ligação ao servidor foi interrompida.");
        }
        if (response.status === 401 || response.redirected) throw new RefreshSessionExpired();
        const invalid = () => new RefreshRequestError(response.ok
          ? "O servidor devolveu uma resposta de atualização inválida."
          : `O servidor não conseguiu concluir a atualização (HTTP ${response.status}).`);
        let result: RefreshPlan;
        try { result = await response.json(); }
        catch { throw invalid(); }
        if (!result || typeof result.ok !== "boolean") throw invalid();
        return response.ok ? result : { ...result, ok: false, error: result.error ?? invalid().message };
      });
    } catch (error) {
      if (error instanceof RefreshDeadlineError) throw new RefreshRequestError(error.message);
      throw error;
    }
  }

  const plan = await send("plan", force);
  // Older servers ignore `step` and return the complete legacy result.
  if (!plan.ok || !plan.stages) return plan;
  const errors: string[] = [];
  let synced = false, totalsFailed = false, fatal: unknown;
  const total = plan.stages.reduce((n, stage) => n + stage.tasks.length, 0);
  let completed = 0;
  for (const stage of plan.stages) {
    if (stage.kind === "publish") {
      if (!totalsFailed && !errors.length) {
        const published = await send("finish");
        if (published.ok) dataReady?.();
        else errors.push(published.error ?? "Não foi possível mostrar os dados atualizados.");
      }
      continue;
    }
    if (stage.kind === "reports" && totalsFailed) continue;
    let next = 0;
    const run = async (task: RefreshTask) => {
      progress(`${task.label} · ${completed}/${total}`);
      try {
        const result = await send(task.step, force);
        synced ||= !!result.synced;
        if (!result.ok) {
          errors.push(`${task.label}: ${result.error ?? "não foi possível atualizar"}`);
          if (stage.kind === "totals") totalsFailed = true;
        }
      } catch (error) {
        if (signal.aborted || error instanceof RefreshSessionExpired) { fatal = error; return; }
        errors.push(`${task.label}: ${error instanceof RefreshRequestError ? error.message : "não foi possível atualizar"}`);
        if (stage.kind === "totals") totalsFailed = true;
      } finally { completed++; progress(`Ligações e relatórios verificados · ${completed}/${total}`); }
    };
    // Continue independent stores after a partial failure; never proceed to
    // metrics while any import is still running, or queue work after expiry.
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, stage.tasks.length) }, async () => {
      while (!fatal && next < stage.tasks.length) await run(stage.tasks[next++]);
    }));
    if (fatal) throw fatal;
  }
  progress("A concluir a atualização…");
  const finished = await send("finish");
  if (!finished.ok) errors.push(finished.error ?? "Não foi possível confirmar a atualização.");
  return errors.length ? { ok: false, synced, error: errors.join(" · ") }
    : { ok: true, synced, completedAt: finished.completedAt };
}
