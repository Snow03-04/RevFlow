process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test";
require("../scripts/register-ts.cjs");
const test = require("node:test"), assert = require("node:assert/strict"), Module = require("node:module");
const load = Module._load;
let user = { id: "current-user" }, calls = [], invalidations = 0, run;
const db = {};
const { refreshStepSchema } = require("../src/lib/sync/steps.ts");
let stepCalls = [], planCalls = [];
Module._load = function(request, ...args) {
  if (request === "@/lib/supabase/server") return { getCurrentUser: async () => user, createClient: async () => db };
  if (request === "@/lib/sync/invalidate") return { invalidateSyncedViews: () => { invalidations++; } };
  if (request === "@/lib/sync/recent") return { refreshRecentData: async (...args) => { calls.push(args.slice(0, 3)); return run(args[3]); } };
  if (request === "@/lib/sync/steps") return { refreshStepSchema,
    planRefresh: async (...args) => { planCalls.push(args); return { ok: true, stages: [] }; },
    runRefreshStep: async (...args) => { stepCalls.push(args); return { ok: true, synced: true }; },
  };
  return load.call(this, request, ...args);
};
const { POST } = require("../src/app/api/sync/route.ts");
Module._load = load;
const { REFRESH_STREAM_TYPE } = require("../src/lib/sync/protocol.ts");
const request = (headers = {}, body = { force: true }) => new Request("http://localhost:3000/api/sync", {
  method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000", accept: REFRESH_STREAM_TYPE, ...headers }, body: JSON.stringify(body),
});

test("Route streams progress before completion, heartbeats during slow imports, then invalidates partial data", async (t) => {
  calls = []; invalidations = 0;
  t.mock.timers.enable({ apis: ["setInterval"] });
  let finish;
  run = progress => { progress("A recalcular os totais…"); return new Promise(resolve => { finish = resolve; }); };
  const response = await POST(request());
  assert.match(response.headers.get("content-type"), /application\/x-ndjson/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(calls, [[db, "current-user", true]]);
  const reader = response.body.getReader(), decoder = new TextDecoder();
  assert.equal(JSON.parse(decoder.decode((await reader.read()).value)).type, "progress");
  assert.equal(invalidations, 0);
  t.mock.timers.tick(15_000);
  assert.equal(JSON.parse(decoder.decode((await reader.read()).value)).type, "heartbeat");
  const partial = { ok: false, synced: true, error: "Meta indisponível" };
  finish(partial);
  assert.deepEqual(JSON.parse(decoder.decode((await reader.read()).value)), { type: "result", result: partial });
  assert.equal(invalidations, 1);
  assert.equal((await reader.read()).done, true);
  t.mock.timers.tick(60_000); // Closed streams must not retain a heartbeat.
});

test("Unauthorized and cross-origin requests never start imports", async () => {
  calls = [];
  const blocked = await POST(request({ origin: "https://other.example" }));
  assert.equal(blocked.status, 403);
  user = null;
  try { assert.equal((await POST(request())).status, 401); }
  finally { user = { id: "current-user" }; }
  assert.deepEqual(calls, []);
});

test("Existing JSON callers still receive a final result and malformed bodies cannot force imports", async () => {
  calls = [];
  run = async () => ({ ok: true, synced: true });
  const response = await POST(request({ accept: "application/json" }, { force: "true", userId: "other-user" }));
  assert.deepEqual(await response.json(), { ok: true, synced: true });
  assert.deepEqual(calls, [[db, "current-user", false]]);
});

test("Disconnecting a browser does not interrupt completion or write to a closed stream", async () => {
  invalidations = 0;
  let finish, report;
  run = progress => { report = progress; return new Promise(resolve => { finish = resolve; }); };
  const response = await POST(request());
  await response.body.cancel();
  report("A concluir…");
  finish({ ok: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(invalidations, 1);
});

test("Staged route scopes plans and steps to the signed-in user and invalidates only once at finish", async () => {
  stepCalls = []; planCalls = []; invalidations = 0; calls = [];
  const json = { accept: "application/json" };
  assert.deepEqual(await (await POST(request(json, { step: "plan", force: true, userId: "foreign" }))).json(), { ok: true, stages: [] });
  const step = { kind: "metrics", id: "11111111-1111-4111-8111-111111111111" };
  assert.equal((await POST(request(json, { step, force: "true", userId: "foreign" }))).status, 200);
  assert.deepEqual(planCalls, [[db, "current-user", true]]);
  assert.deepEqual(stepCalls, [[db, "current-user", step, false]]);
  assert.equal(invalidations, 0);
  assert.equal(calls.length, 0);
  const finished = await (await POST(request(json, { step: "finish" }))).json();
  assert.equal(finished.ok, true); assert.ok(finished.completedAt);
  assert.equal(invalidations, 1);
});

test("Malformed or cross-origin steps cannot execute work", async () => {
  stepCalls = []; planCalls = [];
  for (const step of [null, "unknown", {kind:"metrics",id:"foreign"}, {kind:"pnl",userId:"foreign"}]) {
    assert.equal((await POST(request({}, { step }))).status, 400);
  }
  assert.equal((await POST(request({ origin: "https://other.example" }, { step: "plan" }))).status, 403);
  assert.deepEqual(stepCalls, []); assert.deepEqual(planCalls, []);
});
