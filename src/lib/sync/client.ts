import { REFRESH_STREAM_TYPE, type RefreshEvent, type RefreshResult } from "./protocol";

/** Only these deliberate, user-facing messages may be shown by the provider. */
export class RefreshRequestError extends Error {}

export class RefreshSessionExpired extends RefreshRequestError {
  constructor() { super("Sessão expirada. Inicia sessão novamente."); }
}

/** Accept JSON during rolling deploys and require a final result from streams. */
export async function requestRefresh(force: boolean, signal: AbortSignal, progress: (message: string) => void): Promise<RefreshResult> {
  const send = (stream: boolean, forceImport: boolean) => fetch("/api/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: stream ? REFRESH_STREAM_TYPE : "application/json" },
    body: JSON.stringify({ force: forceImport }),
    cache: "no-store",
    signal,
  });
  const checkSession = (response: Response) => {
    if (response.status === 401 || response.redirected) throw new RefreshSessionExpired();
  };
  const invalidResponse = (response: Response) => new RefreshRequestError(response.ok
    ? "O servidor devolveu uma resposta de atualização inválida."
    : `O servidor não conseguiu concluir a atualização (HTTP ${response.status}).`);
  const validResult = (result: RefreshResult, response: Response) => {
    if (!result || typeof result.ok !== "boolean") throw invalidResponse(response);
    if (!response.ok) return { ...result, ok: false, error: result.error ?? invalidResponse(response).message };
    return result;
  };
  const readJson = async (response: Response) => {
    checkSession(response);
    let result: RefreshResult;
    try { result = await response.json(); }
    catch { throw invalidResponse(response); }
    return validResult(result, response);
  };
  const response = await send(true, force);
  checkSession(response);
  if (!response.headers.get("content-type")?.includes(REFRESH_STREAM_TYPE)) {
    return readJson(response);
  }
  if (!response.ok || !response.body) throw invalidResponse(response);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let result: RefreshResult | undefined;
  function consume(line: string) {
    if (!line.trim()) return;
    const event: RefreshEvent = JSON.parse(line);
    if (event.type === "progress" && typeof event.message === "string") progress(event.message);
    if (event.type === "result") result = validResult(event.result, response);
  }
  try {
    while (!result) {
      const { done, value } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      const lines = pending.split("\n");
      pending = lines.pop()!;
      for (const line of lines) consume(line);
      if (done) {
        consume(pending);
        break;
      }
    }
    if (!result) throw new RefreshRequestError("A ligação terminou antes de confirmar a atualização.");
  } catch (cause) {
    if (signal.aborted) throw cause;
    // A proxy can close a stream after imports have already saved their data.
    // Confirm once through the buffered endpoint, joining any live job and
    // letting per-source timestamps skip imports that have already completed.
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  if (result) return result;
  progress("A confirmar a atualização com o servidor…");
  return readJson(await send(false, false));
}
