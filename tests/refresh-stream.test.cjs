require("../scripts/register-ts.cjs");
const test = require("node:test"), assert = require("node:assert/strict");
const { requestRefresh, RefreshRequestError, RefreshSessionExpired } = require("../src/lib/sync/client.ts");
const { REFRESH_STREAM_TYPE } = require("../src/lib/sync/protocol.ts");
const encoder = new TextEncoder();
const result = { ok: true, synced: true, completedAt: "2026-10-12T14:00:00Z" };
const events = [ { type: "progress", message: "A verificar ligações…" }, { type: "heartbeat" }, { type: "result", result } ];

test("Stream decodes split Unicode and multiple events, returning only the confirmed result", async (t) => {
  const bytes = encoder.encode(events.map(e => JSON.stringify(e)).join("\n"));
  const chunks = Array.from(bytes, byte => Uint8Array.of(byte));
  t.mock.method(global, "fetch", async (url, options) => {
    assert.equal(url, "/api/sync");
    assert.equal(options.headers.Accept, REFRESH_STREAM_TYPE);
    assert.deepEqual(JSON.parse(options.body), { force: true });
    return new Response(new ReadableStream({ pull(c) { if (chunks.length) c.enqueue(chunks.shift()); else c.close(); } }), { headers: { "Content-Type": REFRESH_STREAM_TYPE } });
  });
  const progress = [];
  assert.deepEqual(await requestRefresh(true, new AbortController().signal, m => progress.push(m)), result);
  assert.deepEqual(progress, [events[0].message]);
});

test("Progress arrives while import is still running; partial failures retain their warning", async (t) => {
  let stream;
  t.mock.method(global, "fetch", async () => new Response(new ReadableStream({ start(c) { stream = c; } }), { headers: { "Content-Type": REFRESH_STREAM_TYPE } }));
  const progress = [];
  let complete = false;
  const pending = requestRefresh(false, new AbortController().signal, m => progress.push(m)).then(r => { complete = true; return r; });
  stream.enqueue(encoder.encode(JSON.stringify(events[0]) + "\n"));
  await new Promise(r => setImmediate(r));
  assert.deepEqual(progress, [events[0].message]);
  assert.equal(complete, false);
  const partial = { ok: false, synced: true, error: "Shopify: falta permissão de pagamentos" };
  stream.enqueue(encoder.encode(JSON.stringify({ type: "result", result: partial }) + "\n"));
  stream.close();
  assert.deepEqual(await pending, partial);
});

test("Truncated streams and malformed results never become a successful update", async (t) => {
  for (const body of [JSON.stringify(events[0]) + "\n", JSON.stringify({ type: "result", result: {} }) + "\n", "<html>502</html>"]) {
    t.mock.method(global, "fetch", async () => new Response(body, { headers: { "Content-Type": REFRESH_STREAM_TYPE } }));
    await assert.rejects(() => requestRefresh(false, new AbortController().signal, () => {}));
  }
});

test("JSON compatibility, session expiry, redirects and server failures preserve truthful outcomes", async (t) => {
  t.mock.method(global, "fetch", async () => Response.json(result));
  assert.deepEqual(await requestRefresh(false, new AbortController().signal, () => {}), result);
  t.mock.method(global, "fetch", async () => Response.json({ ok: true }, { status: 500 }));
  assert.equal((await requestRefresh(false, new AbortController().signal, () => {})).ok, false);
  t.mock.method(global, "fetch", async () => Response.json({}, { status: 401 }));
  await assert.rejects(() => requestRefresh(false, new AbortController().signal, () => {}), RefreshSessionExpired);
  t.mock.method(global, "fetch", async () => ({ redirected: true, status: 200 }));
  await assert.rejects(() => requestRefresh(false, new AbortController().signal, () => {}), RefreshSessionExpired);
});

test("An interrupted stream confirms once through JSON without forcing completed imports again", async (t) => {
  for (const interrupted of [false, true]) {
    const requests = [], progress = [];
    t.mock.method(global, "fetch", async (_url, options) => {
      requests.push(options);
      if (requests.length > 1) return Response.json(result);
      let sent = false;
      return new Response(new ReadableStream({ pull(controller) {
        if (!sent) { sent = true; controller.enqueue(encoder.encode(JSON.stringify(events[0]) + "\n")); }
        else if (interrupted) controller.error(new TypeError("terminated"));
        else controller.close();
      } }), { headers: { "Content-Type": REFRESH_STREAM_TYPE } });
    });
    const signal = new AbortController().signal;
    assert.deepEqual(await requestRefresh(true, signal, m => progress.push(m)), result);
    assert.equal(requests.length, 2);
    assert.equal(requests[1].headers.Accept, "application/json");
    assert.deepEqual(JSON.parse(requests[1].body), { force: false });
    assert.equal(requests[1].signal, signal);
    assert.match(progress.at(-1), /confirmar/);
  }
});

test("Confirmation preserves partial failures and never loops or conceals an HTTP gateway error", async (t) => {
  const partial = { ok: false, synced: true, error: "Meta indisponível" };
  for (const final of [() => Response.json(partial), () => new Response("<html>Bad Gateway</html>", { status: 502 })]) {
    let requests = 0;
    t.mock.method(global, "fetch", async () => ++requests === 1
      ? new Response(JSON.stringify(events[0]) + "\n", { headers: { "Content-Type": REFRESH_STREAM_TYPE } })
      : final());
    const pending = requestRefresh(true, new AbortController().signal, () => {});
    if (final().ok) assert.deepEqual(await pending, partial);
    else await assert.rejects(pending, error => error instanceof RefreshRequestError && /HTTP 502/.test(error.message));
    assert.equal(requests, 2);
  }
});

test("Aborting an interrupted stream never starts a confirmation request", async (t) => {
  const abort = new AbortController();
  let requests = 0;
  t.mock.method(global, "fetch", async () => {
    requests++;
    return new Response(new ReadableStream({ pull(controller) {
      abort.abort(); controller.error(new DOMException("Aborted", "AbortError"));
    } }), { headers: { "Content-Type": REFRESH_STREAM_TYPE } });
  });
  await assert.rejects(requestRefresh(false, abort.signal, () => {}), { name: "AbortError" });
  assert.equal(requests, 1);
});
