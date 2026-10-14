require("../scripts/register-ts.cjs");
const test = require("node:test"), assert = require("node:assert/strict");
const { requestRefresh, RefreshRequestError, RefreshSessionExpired } = require("../src/lib/sync/client.ts");
const complete = { ok: true, completedAt: "2026-10-12T19:00:00Z" };
const task = (kind, id = "s") => ({ step: { kind, ...(kind === "pnl" || kind === "roas" ? {} : { id }) }, label: `${kind} ${id}` });
const plan = { ok: true, stages: [
  { kind: "imports", tasks: [task("shopify", "a"), task("meta", "b"), task("google", "c"), task("shopify", "d"), task("shopify", "e")] },
  { kind: "totals", tasks: [task("metrics", "a"), task("metrics", "d")] },
  { kind: "reports", tasks: [task("pnl"), task("roas")] },
] };
const flush = () => new Promise(resolve => setImmediate(resolve));

test("Refresh uses bounded concurrent JSON requests and confirms only after imports, totals and reports", async t => {
  const sent = [], release = new Map(), progress = [];
  let active = 0, peak = 0, done = false;
  t.mock.method(global, "fetch", async (url, options) => {
    assert.equal(url, "/api/sync");
    assert.equal(options.headers.Accept, "application/json");
    const body = JSON.parse(options.body); sent.push(body);
    if (body.step === "plan") return Response.json(plan);
    if (body.step === "finish") return Response.json(complete);
    active++; peak = Math.max(peak, active);
    return new Promise(resolve => release.set(`${body.step.kind}:${body.step.id ?? ""}`, () => {
      active--; resolve(Response.json({ ok: true, synced: true }));
    }));
  });
  const pending = requestRefresh(true, new AbortController().signal, m => progress.push(m)).then(r => { done = true; return r; });
  await flush();
  assert.equal(active, 4);
  assert.equal(release.has("shopify:e"), false);
  release.get("shopify:a")(); await flush();
  assert.equal(release.has("shopify:e"), true);
  assert.equal(sent.some(r => r.step.kind === "metrics"), false);
  release.get("meta:b")(); release.get("google:c")(); release.get("shopify:d")(); release.get("shopify:e")(); await flush();
  assert.equal(active, 2);
  assert.equal(sent.some(r => r.step.kind === "pnl"), false);
  release.get("metrics:a")(); release.get("metrics:d")(); await flush();
  assert.equal(done, false);
  release.get("pnl:")(); release.get("roas:")();
  assert.deepEqual(await pending, { ...complete, synced: true });
  assert.equal(peak, 4);
  assert.equal(sent.at(-1).step, "finish");
  assert.ok(sent.slice(0, -1).every(r => r.force));
  assert.match(progress.at(-1), /concluir/);
});

test("A failed store never restarts successful stores or hides a gateway error; healthy totals still update", async t => {
  const sent = [];
  t.mock.method(global, "fetch", async (_url, options) => {
    const { step } = JSON.parse(options.body); sent.push(step);
    if (step === "plan") return Response.json(plan);
    if (step === "finish") return Response.json(complete);
    if (step.kind === "meta") return new Response("private server log", { status: 500 });
    return Response.json({ ok: true, synced: true });
  });
  const result = await requestRefresh(true, new AbortController().signal, () => {});
  assert.equal(result.ok, false);
  assert.equal(result.completedAt, undefined);
  assert.match(result.error, /meta b:.*HTTP 500/);
  assert.doesNotMatch(result.error, /private server log/);
  assert.equal(sent.filter(s => s.kind === "shopify").length, 3);
  assert.ok(sent.some(s => s.kind === "metrics") && sent.some(s => s.kind === "roas"));
});

test("Reports never project incomplete totals and partial changes still invalidate the page", async t => {
  const sent = [];
  t.mock.method(global, "fetch", async (_url, options) => {
    const { step } = JSON.parse(options.body); sent.push(step);
    return Response.json(step === "plan" ? plan : step === "finish" ? complete : step.kind === "metrics"
      ? { ok: false, error: "database unavailable" } : { ok: true, synced: true });
  });
  const result = await requestRefresh(false, new AbortController().signal, () => {});
  assert.equal(result.ok, false);
  assert.equal(sent.some(s => s.kind === "pnl" || s.kind === "roas"), false);
  assert.equal(sent.at(-1), "finish");
});

test("Session expiry and abort stop queuing steps and never confirm success", async t => {
  for (const expired of [true, false]) {
    const abort = new AbortController(), sent = [];
    t.mock.method(global, "fetch", async (_url, options) => {
      const { step } = JSON.parse(options.body); sent.push(step);
      if (step === "plan") return Response.json(plan);
      if (expired) return Response.json({}, { status: 401 });
      abort.abort(); throw new DOMException("Aborted", "AbortError");
    });
    await assert.rejects(requestRefresh(false, abort.signal, () => {}), expired ? RefreshSessionExpired : { name: "AbortError" });
    assert.equal(sent.includes("finish"), false);
    assert.equal(sent.some(s => s.kind === "metrics" || s.id === "e"), false);
  }
});

test("Legacy JSON, malformed responses, HTTP errors and redirects retain truthful outcomes", async t => {
  t.mock.method(global, "fetch", async () => Response.json(complete));
  assert.deepEqual(await requestRefresh(false, new AbortController().signal, () => {}), complete);
  t.mock.method(global, "fetch", async () => Response.json({ ok: true }, { status: 500 }));
  assert.equal((await requestRefresh(false, new AbortController().signal, () => {})).ok, false);
  for (const response of [() => new Response("<html>502</html>", { status: 502 }), () => Response.json({}), () => Response.json(null)]) {
    t.mock.method(global, "fetch", async () => response());
    await assert.rejects(requestRefresh(false, new AbortController().signal, () => {}), RefreshRequestError);
  }
  t.mock.method(global, "fetch", async () => ({ redirected: true, status: 200 }));
  await assert.rejects(requestRefresh(false, new AbortController().signal, () => {}), RefreshSessionExpired);
});

test('A stalled provider times out on its own; other stores finish and partial data is never called complete', async t=>{
 const {REFRESH_STEP_TIMEOUT_MS}=require('../src/lib/sync/protocol.ts');
 t.mock.timers.enable({apis:['setTimeout']});const sent=[];let stalledSignal;
 t.mock.method(global,'fetch',async(_url,options)=>{const {step}=JSON.parse(options.body);sent.push(step);
 if(step==='plan')return Response.json(plan);if(step==='finish')return Response.json(complete);
 if(step.id==='a'&&step.kind==='shopify'){stalledSignal=options.signal;return new Promise(()=>{});}
 return Response.json({ok:true,synced:true});});
 const pending=requestRefresh(true,new AbortController().signal,()=>{});await flush();
 assert.ok(sent.some(s=>s.id==='e'));assert.ok(!sent.some(s=>s.kind==='metrics'));
 t.mock.timers.tick(REFRESH_STEP_TIMEOUT_MS);const result=await pending;
 assert.equal(stalledSignal.aborted,true);assert.equal(result.ok,false);assert.equal(result.completedAt,undefined);assert.match(result.error,/demorou/);
 assert.ok(sent.some(s=>s.kind==='metrics'));assert.equal(sent.filter(s=>s.id==='a'&&s.kind==='shopify').length,1);
});

test('A frozen response body and a fetch ignoring abort cannot trap the refresh lock',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 t.mock.method(global,'fetch',async()=>({ok:true,status:200,json:()=>new Promise(()=>{})}));
 const stalled=requestRefresh(true,new AbortController().signal,()=>{});await flush();
 t.mock.timers.tick(15_000);await assert.rejects(stalled,/demorou/);
 const abort=new AbortController();t.mock.method(global,'fetch',async()=>new Promise(()=>{}));
 const interrupted=requestRefresh(true,abort.signal,()=>{});abort.abort();
 await assert.rejects(interrupted,{name:'AbortError'});
});
