process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-only";
process.env.TOKEN_ENCRYPTION_KEY = "11".repeat(32);
process.env.GOOGLE_ADS_SCRIPT_APP_URL = "https://revflow.example";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
require("../scripts/register-ts.cjs");
const { buildGoogleAdsScript, googleScriptEndpoint, googleScriptLocalEndpoint } = require("../src/lib/google/script.ts");
const { createGoogleRelay } = require("../scripts/google-local-relay.cjs");

function runScript(replies, localEndpoint = "https://local.example/api/google/script-costs") {
  const calls = [], logs = [];
  const context = {
    AdsApp: {
      currentAccount: () => ({ getTimeZone: () => "UTC", getCurrencyCode: () => "EUR", getCustomerId: () => "123" }),
      search: () => ({ hasNext: () => false }),
    },
    Utilities: { formatDate: (d) => d.toISOString().slice(0, 10) },
    Logger: { log: (value) => logs.push(value) },
    UrlFetchApp: { fetch(url, opts) {
      calls.push({ url, ...opts });
      const reply = replies[calls.length - 1];
      if (reply instanceof Error) throw reply;
      return { getResponseCode: () => reply.status ?? 200, getContentText: () => JSON.stringify(reply) };
    } },
  };
  const script = buildGoogleAdsScript({ userId: "u", storeId: "s", storeName: "Test", localEndpoint });
  let error;
  try { vm.runInNewContext(script + "\nmain();", context); } catch (e) { error = e; }
  return { calls, logs, error };
}
const complete = { ok: true, campaignRows: 10, collectionLinks: 2 };

test("Temporary destination is only included for the store accepted by the local relay", (t) => {
  const savedUrl = process.env.GOOGLE_ADS_SCRIPT_LOCAL_URL;
  const savedStore = process.env.GOOGLE_ADS_SCRIPT_LOCAL_STORE_ID;
  t.after(() => {
    if (savedUrl === undefined) delete process.env.GOOGLE_ADS_SCRIPT_LOCAL_URL; else process.env.GOOGLE_ADS_SCRIPT_LOCAL_URL = savedUrl;
    if (savedStore === undefined) delete process.env.GOOGLE_ADS_SCRIPT_LOCAL_STORE_ID; else process.env.GOOGLE_ADS_SCRIPT_LOCAL_STORE_ID = savedStore;
  });
  process.env.GOOGLE_ADS_SCRIPT_LOCAL_URL = "https://local.example/api/google/script-costs";
  process.env.GOOGLE_ADS_SCRIPT_LOCAL_STORE_ID = "s";
  assert.equal(googleScriptLocalEndpoint("s"), process.env.GOOGLE_ADS_SCRIPT_LOCAL_URL);
  assert.equal(googleScriptLocalEndpoint("other-store"), "");
});

test("Both receivers get the same import; old online versions do not prevent local campaign import", () => {
  const { calls, logs, error } = runScript([{ ok: true }, complete]);
  assert.equal(error, undefined);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].payload, calls[1].payload);
  assert.equal(calls[0].followRedirects, false);
  assert.ok(logs.some((line) => line.includes("Localhost: custos, campanhas e coleções recebidos")));
});

test("Either receiver may fail independently; total failure is reported and duplicate URLs only send once", () => {
  for (const replies of [[new Error("Offline"), complete], [complete, new Error("Offline")], [{ ok: true }, { status: 503 }]]) {
    const result = runScript(replies);
    assert.equal(result.calls.length, 2);
    assert.equal(result.error, undefined);
  }
  assert.match(runScript([{ status: 500 }, new Error("Offline")]).error.message, /Nenhum destino/);
  const once = runScript([complete], googleScriptEndpoint());
  assert.equal(once.calls.length, 1);
  assert.equal(once.error, undefined);
});

test("A local Google destination must be an HTTPS import endpoint without embedded credentials", () => {
  for (const localEndpoint of ["http://localhost:3000/api/google/script-costs", "https://local.example/dashboard", "https://user:secret@local.example/api/google/script-costs", "https://local.example/api/google/script-costs?secret=x"]) {
    assert.throws(() => buildGoogleAdsScript({ userId: "u", storeId: "s", storeName: "Test", localEndpoint }));
  }
});

test("Local relay only forwards authenticated imports for its configured store and strips unrelated response data", async (t) => {
  const calls = [];
  const server = createGoogleRelay({ userId: "u", storeId: "s", token: "test-scoped-token", fetchImpl: async (url, opts) => {
    calls.push({ url, opts });
    return Response.json({ ...complete, secret: "must-not-return", account: { name: "private" } });
  } });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base + "/dashboard")).status, 404);
  assert.equal((await fetch(base + "/api/google/script-costs")).status, 404);
  const post = (body) => fetch(base + "/api/google/script-costs", { method: "POST", headers: { "Content-Type": "application/json", Cookie: "should-not-forward=1" }, body: JSON.stringify(body) });
  for (const body of [{}, { user: "u", store: "s", token: "wrong" }, { user: "u", store: "other", token: "test-scoped-token" }]) assert.equal((await post(body)).status, 401);
  assert.equal(calls.length, 0);
  const result = await post({ user: "u", store: "s", token: "test-scoped-token", days: [] });
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), complete);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://127.0.0.1:3000/api/google/script-costs");
  assert.deepEqual(calls[0].opts.headers, { "Content-Type": "application/json" });
  assert.equal(calls[0].opts.redirect, "error");
});
