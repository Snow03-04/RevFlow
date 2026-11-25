require("../scripts/register-ts.cjs");
const test = require("node:test"), assert = require("node:assert/strict"), Module = require("node:module");
let connections, snapshots, histories, observations, calls, fxUnavailable, provider;
const load = Module._load;
const day = new Date().toISOString().slice(0, 10);
const at = new Date().toISOString();
const admin = {};
const db = { rpc: async () => ({ data: observations }) };
Module._load = function(request, ...args) {
  if (request === "@/lib/supabase/admin") return { createAdminClient: () => admin };
  if (request === "@/lib/queries") return {
    getSettings: async (_, user) => { calls.push(["settings", user]); return { currency: "EUR", timezone: "UTC" }; },
    getConnections: async (_, user) => { calls.push(["connections", user]); return connections; },
  };
  if (request === "@/lib/crypto") return { decryptToken: t => t };
  if (request === "@/lib/fx") return { resolveFx: async from => { if (fxUnavailable) throw Error("FX unavailable"); return from === "HUF" ? .0025 : 1; } };
  if (request === "@/lib/dashboard/store-participation") return { readStoreParticipation: (_, id) => ({ percentage: id === "a" ? 50 : 100 }) };
  if (request === "@/lib/meta/daily-budget") return { readMetaBudget: async (...args) => { calls.push(["meta", ...args]); return provider; } };
  if (request === "@/lib/google/read-budget") return { readGoogleBudget: async (...args) => { calls.push(["google", ...args]); return provider; } };
  if (request === "@/lib/google/budget-snapshots") return {
    readBudgetSnapshots: async (client, user) => { assert.equal(client, admin); calls.push(["snapshots", user]); return snapshots; },
    currentBudget: value => value.date === day,
  };
  if (request === "@/lib/google/script-accounts") return { getScriptAccounts: async (_, user, store) => { calls.push(["history", user, store.id]); return histories[store.id] ?? []; } };
  if (request === "@/lib/google/account-monitoring") return { readGoogleAccountState: () => "active" };
  return load.call(this, request, ...args);
};
const { readAdSpendPacing } = require("../src/lib/ads/read-pacing.ts");
Module._load = load;
function reset() {
  connections = { shopify: [{ id: "a", status: "active" }, { id: "b", status: "active" }], meta: [], google: [], unavailableAdPlatforms: [] };
  histories = {}; snapshots = new Map(); observations = []; calls = []; fxUnavailable = false;
  provider = { budget: 200, forecast: 300, spent: 100, currency: "EUR" };
}
test("source aggregation converts currency before applying shares; Meta-only stores need no Google account", async () => {
  reset(); connections.meta = [{ id: "meta-a", status: "active", shopify_connection_id: "a" }];
  observations = [{ connection_id: "meta-a", budget: 40000, spent: 20000, currency: "HUF", observed_at: at }];
  const report = await readAdSpendPacing(db, "owner", {});
  assert.equal(report.total.status, "ready"); assert.equal(report.total.spent, 25); assert.equal(report.total.forecast, 50);
  assert.equal(report.stores.a.spent, 50); assert.equal(report.full.forecast, 100);
  assert.equal(report.stores.b.status, "empty");
  assert.ok(calls.filter(c => ["settings", "connections", "snapshots", "history"].includes(c[0])).every(c => c[1] === "owner"));
  assert.ok(!calls.some(c => c[0] === "meta" || c[0] === "google"));
});
test("Google account shared by import history and OAuth is counted once; foreign stores never enter totals", async () => {
  reset(); histories.a = [{ customerId: "123", lastReport: day }];
  connections.google = [{ id: "oauth", customer_id: "123", status: "active", shopify_connection_id: "a" }];
  snapshots.set("123", { storeId: "a", date: day, observedAt: at, spent: 80, budget: 100, forecast: 200, firstDayExtra: 100, currency: "EUR" });
  snapshots.set("456", { storeId: "another-owner-store", date: day, spent: 9999, forecast: 9999 });
  const report = await readAdSpendPacing(db, "owner", {});
  assert.equal(report.full.spent, 80); assert.equal(report.total.forecast, 100); assert.equal(report.total.firstDayExtra, 50);
  assert.ok(!calls.some(c => c[0] === "google"));
});
test("missing forecasts, stale sources, connection errors and unavailable FX cannot produce a plausible partial total", async () => {
  reset(); histories.a = [{ customerId: "123", lastReport: day }];
  snapshots.set("123", { storeId: "a", date: day, observedAt: at, spent: 80, budget: 100, currency: "EUR" });
  assert.equal((await readAdSpendPacing(db, "owner", {})).total.status, "pending");
  snapshots.set("123", { storeId: "a", date: "2000-01-01", spent: 80, budget: 100, forecast: 200, currency: "EUR" });
  assert.equal((await readAdSpendPacing(db, "owner", {})).total.status, "pending");
  reset(); connections.unavailableAdPlatforms = ["google"];
  assert.equal((await readAdSpendPacing(db, "owner", {})).total.status, "pending");
  reset(); fxUnavailable = true; connections.meta = [{ id: "m", status: "active", shopify_connection_id: "a" }];
  observations = [{ connection_id: "m", budget: 40, spent: 20, currency: "HUF", observed_at: at }];
  assert.equal((await readAdSpendPacing(db, "owner", {})).total.status, "pending");
});
