process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test";
require("../scripts/register-ts.cjs");
const test = require("node:test"), assert = require("node:assert/strict");
const React = require("react"), Module = require("node:module");
let refreshReads = 0;
const load = Module._load;
Module._load = function(request, ...args) {
  if (request === "next/navigation") return { useRouter: () => ({ refresh: () => { refreshReads++; } }) };
  return load.call(this, request, ...args);
};
const { DataRefreshProvider } = require("../src/components/dashboard/data-refresh-provider.tsx");
const { REFRESH_TIMEOUT_MS } = require("../src/lib/sync/protocol.ts");
Module._load = load;

test("Update unlocks after success, timeout and retry even while the page transition stays pending", async (t) => {
  const slots=[]; let position=0;
  t.mock.method(React,"useState",initial=>{
    const index=position++; if(!(index in slots))slots[index]=initial;
    return [slots[index],v=>{slots[index]=v;}];
  });
  t.mock.method(React,"useRef",initial=>{const index=position++; return slots[index]??=( {current:initial} );});
  t.mock.method(React,"useCallback",fn=>fn);
  t.mock.method(React,"useEffect",()=>{});
  t.mock.method(React,"useTransition",()=>[true,fn=>fn()]); // Simulate a slow page read.
  const descriptor=Object.getOwnPropertyDescriptor(global,"navigator");
  Object.defineProperty(global,"navigator",{configurable:true,value:{onLine:true}});
  t.after(()=>{if(descriptor)Object.defineProperty(global,"navigator",descriptor);else delete global.navigator;});
  t.mock.timers.enable({apis:["setTimeout"]});
  const view=()=>{position=0;return DataRefreshProvider({children:null}).props.value;};
  let finish, requests=0;
  t.mock.method(global,"fetch",async(_url,{signal})=>{
    requests++;
    return new Promise((resolve,reject)=>{
      finish=()=>resolve(Response.json({ok:true,completedAt:"2026-10-08T10:00:00Z"}));
      signal.addEventListener("abort",()=>reject(new DOMException("Aborted","AbortError")),{once:true});
    });
  });
  assert.equal(view().refreshing,false);
  const first=view().refresh(true);
  assert.equal(view().refreshing,true);
  assert.equal(view().refresh(true),first); assert.equal(requests,1);
  finish(); await first;
  assert.equal(view().refreshing,false); assert.equal(view().error,null); assert.equal(refreshReads,1);
  const second=view().refresh(true);
  t.mock.timers.tick(14_999);
  assert.equal(view().refreshing,true);
  t.mock.timers.tick(1); await second;
  assert.equal(view().refreshing,false); assert.match(view().error,/demorou demasiado/);
  const retry=view().refresh(true); finish(); await retry;
  assert.equal(view().refreshing,false); assert.equal(view().error,null); assert.equal(requests,3);
  assert.equal(view().reloading,true, "page rendering stays visible separately from import completion");
});

function harness(t) {
  const slots = []; let position = 0, effect, cleanup;
  t.mock.method(React, "useState", initial => {
    const index = position++; if (!(index in slots)) slots[index] = initial;
    return [slots[index], value => { slots[index] = value; }];
  });
  t.mock.method(React, "useRef", initial => { const index = position++; return slots[index] ??= { current: initial }; });
  t.mock.method(React, "useCallback", fn => fn);
  t.mock.method(React, "useEffect", fn => { effect = fn; });
  t.mock.method(React, "useTransition", () => [false, fn => fn()]);
  const descriptor = Object.getOwnPropertyDescriptor(global, "navigator");
  const oldDocument = global.document, oldWindow = global.window;
  Object.defineProperty(global, "navigator", { configurable: true, value: { onLine: true } });
  global.document = Object.assign(new EventTarget(), { visibilityState: "visible" });
  global.window = new EventTarget();
  t.after(() => {
    cleanup?.();
    global.document = oldDocument; global.window = oldWindow;
    if (descriptor) Object.defineProperty(global, "navigator", descriptor); else delete global.navigator;
  });
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
  return {
    view() { position = 0; return DataRefreshProvider({ children: null }).props.value; },
    mount() { cleanup = effect(); },
    unmount() { cleanup?.(); cleanup = null; },
    async tick(ms) { t.mock.timers.tick(ms); await new Promise(resolve => setImmediate(resolve)); },
  };
}

test("Early publication reads fresh figures, releases the loading presentation, but retains the lock and final error", async t => {
  const h=harness(t), initialReads=refreshReads;
  let release;
  t.mock.method(global,"fetch",async(_url,options)=>{
    const {step}=JSON.parse(options.body);
    if(step==="plan")return Response.json({ok:true,stages:[{kind:"publish",tasks:[]},{kind:"reconcile",tasks:[{step:{kind:"payments",id:"s"},label:"Pagamentos"}]}]});
    if(step==="finish")return Response.json({ok:true,completedAt:"2026-10-15T14:00:00Z"});
    return new Promise(resolve=>release=()=>resolve(Response.json({ok:false,error:"Falha nos pagamentos"})));
  });
  const pending=h.view().refresh(true);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.view().reconciling,true); assert.equal(h.view().refreshing,true);
  assert.equal(h.view().updatedAt,null); assert.equal(refreshReads,initialReads+1);
  assert.equal(h.view().refresh(true),pending);
  release(); await pending;
  assert.equal(h.view().reconciling,false); assert.equal(h.view().refreshing,false);
  assert.match(h.view().error,/pagamentos/); assert.equal(h.view().updatedAt,null);
});

test("Automatic updates retry failures after 30 seconds, retain last success, and coalesce wake events", async (t) => {
  const h = harness(t);
  let requests = 0;
  t.mock.method(global, "fetch", async () => {
    requests++;
    return Response.json(requests === 2 ? { ok: false, synced: true, error: "Meta indisponível" }
      : { ok: true, completedAt: `2026-10-12T14:0${requests}:00Z` });
  });
  h.view(); h.mount();
  await h.tick(300);
  const initial = h.view().updatedAt;
  assert.equal(requests, 1);
  for (const event of ["focus", "pageshow", "online"]) window.dispatchEvent(new Event(event));
  await h.tick(29_999); assert.equal(requests, 1);
  await h.tick(1); assert.equal(requests, 2);
  assert.match(h.view().error, /Meta/);
  assert.equal(h.view().updatedAt, initial);
  await h.tick(29_999); assert.equal(requests, 2);
  await h.tick(1); assert.equal(requests, 3);
  assert.equal(h.view().error, null);
  assert.notEqual(h.view().updatedAt, initial);
});

test("Offline attempts send no request, reconnect resumes, and session expiry stops automatic imports", async (t) => {
  const h = harness(t);
  let requests = 0, expired = false;
  t.mock.method(global, "fetch", async () => {
    requests++;
    return Response.json(expired ? { ok: false } : { ok: true, completedAt: "2026-10-12T14:00:00Z" }, { status: expired ? 401 : 200 });
  });
  h.view(); h.mount();
  navigator.onLine = false;
  window.dispatchEvent(new Event("offline"));
  await h.view().refresh(true); await h.tick(120_000);
  assert.equal(requests, 0);
  assert.match(h.view().error, /Sem ligação/);
  navigator.onLine = true;
  window.dispatchEvent(new Event("online")); await h.tick(0);
  assert.equal(requests, 1);
  assert.equal(h.view().error, null);
  const lastRead = refreshReads;
  expired = true;
  await h.view().refresh(true);
  assert.match(h.view().error, /Sessão expirada/);
  assert.equal(refreshReads, lastRead, "an expired session must not trigger a page redirect or reload loop");
  await h.tick(300_000);
  assert.equal(requests, 2);
  expired = false;
  await h.view().refresh(true);
  assert.equal(h.view().error, null);
  await h.tick(60_000);
  assert.equal(requests, 4, "automatic updates resume after a successful manual retry");
});

test("Late responses from an unmounted provider cannot overwrite a new request or unlock its button", async (t) => {
  const h = harness(t);
  const requests = [];
  t.mock.method(global, "fetch", async (_url, options) => new Promise(resolve => requests.push({ resolve, signal: options.signal })));
  h.view(); h.mount();
  const abandoned = h.view().refresh(true);
  h.unmount();
  assert.equal(requests[0].signal.aborted, true);
  h.view(); h.mount();
  const fresh = h.view().refresh(true);
  requests[0].resolve(Response.json({ ok: true, completedAt: "old" }));
  await abandoned;
  assert.equal(h.view().refreshing, true);
  assert.equal(h.view().updatedAt, null);
  requests[1].resolve(Response.json({ ok: true, completedAt: "2026-10-12T14:00:00Z" }));
  await fresh;
  assert.equal(h.view().refreshing, false);
  assert.equal(h.view().updatedAt, "2026-10-12T14:00:00Z");
});

test("Unmounting between the timer and its queued callback does not start a background import", async (t) => {
  const h = harness(t);
  let requests = 0;
  t.mock.method(global, "fetch", async () => { requests++; return Response.json({ ok: true }); });
  h.view(); h.mount();
  t.mock.timers.tick(300);
  h.unmount();
  await h.tick(0);
  assert.equal(requests, 0);
});

test("The warning identifies server failures without exposing their response body", async (t) => {
  const h = harness(t);
  t.mock.method(global, "fetch", async () => new Response("private server diagnostic", { status: 504 }));
  await h.view().refresh(true);
  assert.match(h.view().error, /HTTP 504/);
  assert.doesNotMatch(h.view().error, /private server diagnostic/);
  assert.equal(h.view().refreshing, false);
  assert.equal(h.view().updatedAt, null);
});

test('Losing mobile connectivity releases an in-flight lock even if fetch never rejects; reconnect retries',async t=>{
 const h=harness(t);let calls=0;
 t.mock.method(global,'fetch',async()=>{calls++;return calls===1?new Promise(()=>{}):Response.json({ok:true,completedAt:'2026-10-14T16:00:00Z'});});
 h.view();h.mount();const pending=h.view().refresh(true);
 navigator.onLine=false;window.dispatchEvent(new Event('offline'));await pending;
 assert.equal(h.view().refreshing,false);assert.match(h.view().error,/Sem ligação/);
 navigator.onLine=true;window.dispatchEvent(new Event('online'));await h.tick(0);
 assert.equal(calls,2);assert.equal(h.view().error,null);
});

test('Returning after suspended mobile timers releases an expired request immediately',async t=>{
 const h=harness(t);t.mock.method(global,'fetch',async()=>new Promise(()=>{}));
 h.view();h.mount();const pending=h.view().refresh(true);
 t.mock.timers.setTime(1_000_000+REFRESH_TIMEOUT_MS+1);
 window.dispatchEvent(new Event('pageshow'));await pending;
 assert.equal(h.view().refreshing,false);assert.match(h.view().error,/demorou demasiado/);
});

test('Completion preserves the mobile keyboard and flushes the page once after editing ends',async t=>{
 const h=harness(t);t.mock.method(global,'fetch',async()=>Response.json({ok:true,completedAt:'2026-10-14T16:00:00Z'}));
 h.view();h.mount();document.activeElement={matches:()=>true};const before=refreshReads;
 await h.view().refresh(true);assert.equal(refreshReads,before);assert.equal(h.view().refreshing,false);
 document.activeElement=null;document.dispatchEvent(new Event('focusout'));await h.tick(300);
 assert.equal(refreshReads,before+1);
});

test('A completed hidden tab waits until visible before refreshing the page',async t=>{
 const h=harness(t);t.mock.method(global,'fetch',async()=>Response.json({ok:true,completedAt:'2026-10-14T16:00:00Z'}));
 h.view();h.mount();document.visibilityState='hidden';const before=refreshReads;
 await h.view().refresh(true);assert.equal(refreshReads,before);
 document.visibilityState='visible';document.dispatchEvent(new Event('visibilitychange'));await h.tick(0);
 assert.equal(refreshReads,before+1);
});
