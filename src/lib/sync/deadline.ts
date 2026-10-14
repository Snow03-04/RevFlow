export class RefreshDeadlineError extends Error {}

/** A mobile browser can leave fetch (or its response body) pending after a
 * disconnect. Race cancellation as well as aborting the underlying request. */
export async function withRefreshDeadline<T>(parent: AbortSignal, milliseconds: number,
  run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  if (parent.aborted) throw parent.reason ?? new DOMException("Aborted", "AbortError");
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  let onAbort: () => void = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    onAbort = () => {
      const reason = parent.reason ?? new DOMException("Aborted", "AbortError");
      controller.abort(reason); reject(reason);
    };
    parent.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => {
      const error = new RefreshDeadlineError("Esta ligação demorou demasiado a responder.");
      controller.abort(error); reject(error);
    }, milliseconds);
  });
  try { return await Promise.race([cancelled, run(controller.signal)]); }
  finally { clearTimeout(timer!); parent.removeEventListener("abort", onAbort); }
}
