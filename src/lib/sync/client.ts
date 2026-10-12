import { REFRESH_STREAM_TYPE, type RefreshEvent, type RefreshResult } from "./protocol";

export class RefreshSessionExpired extends Error {
  constructor() { super("Sessão expirada. Inicia sessão novamente."); }
}

/** Accept JSON during rolling deploys and require a final result from streams. */
export async function requestRefresh(force: boolean, signal: AbortSignal, progress: (message: string) => void): Promise<RefreshResult> {
  const response = await fetch("/api/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: REFRESH_STREAM_TYPE },
    body: JSON.stringify({ force }),
    cache: "no-store",
    signal,
  });
  if (response.status === 401 || response.redirected) throw new RefreshSessionExpired();
  const validResult = (result: RefreshResult) => {
    if (!result || typeof result.ok !== "boolean") throw new Error("Resposta de atualização inválida.");
    if (!response.ok) return { ...result, ok: false };
    return result;
  };
  if (!response.headers.get("content-type")?.includes(REFRESH_STREAM_TYPE)) {
    return validResult(await response.json());
  }
  if (!response.ok || !response.body) throw new Error("Não foi possível iniciar a atualização.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let result: RefreshResult | undefined;
  function consume(line: string) {
    if (!line.trim()) return;
    const event: RefreshEvent = JSON.parse(line);
    if (event.type === "progress" && typeof event.message === "string") progress(event.message);
    if (event.type === "result") result = validResult(event.result);
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
    if (!result) throw new Error("A ligação terminou antes de confirmar a atualização.");
    return result;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
