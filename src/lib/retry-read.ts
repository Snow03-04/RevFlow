/** Retry transient HTTP failures only for reads. Writes are never replayed. */
export async function fetchReadWithRetry(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(input, init);
    if (!["GET", "HEAD"].includes(method) || attempt >= 2 || ![502, 503, 504].includes(response.status)) return response;
    await response.body?.cancel();
    await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
  }
}
