process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-only";
process.env.TOKEN_ENCRYPTION_KEY = "11".repeat(32);
require("../scripts/register-ts.cjs");
const test = require("node:test"), assert = require("node:assert/strict");
const { memoryDb } = require("./helpers/memory-db.cjs");
const { googleScriptToken } = require("../src/lib/google/script.ts");
const { googleExpenseAccount } = require("../src/lib/google/account-expenses.ts");
const { getGoogleSpendEstimates } = require("../src/lib/google/spend-estimates.ts");
const user = "33333333-3333-4333-8333-333333333333";
const store = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222", date = "2026-09-21";
const shop = { id: store, user_id: user, shop_name: "Valentina", shop_domain: "valentina.myshopify.com" };
function setup(t, tables = {}) {
  const db = memoryDb({ shopify_connections: [shop], settings: [{ user_id: user, currency: "EUR" }], ...tables });
  t.mock.method(require("../src/lib/supabase/admin.ts"), "createAdminClient", () => db);
  t.mock.method(require("../src/lib/metrics.ts"), "recomputeDailyMetrics", async () => 1);
  t.mock.method(require("../src/lib/sync/invalidate.ts"), "invalidateSyncedViews", () => {});
  return db;
}
function post(account, cost, extra = {}) {
  const body = { user, store, token: googleScriptToken(user, store), currency: "EUR", customerId: account, days: [{ date, cost }], ...extra };
  return require("../src/app/api/google/script-costs/route.ts").POST(new Request("http://localhost/api/google/script-costs", { method: "POST", body: JSON.stringify(body) }));
}
test("Two Google accounts keep additive costs, verified zeros and independent corrections", async (t) => {
  const db = setup(t);
  for (const [account, amount] of [["1729221399", 61.85], ["3376585292", 0], ["1729221399", 70], ["3376585292", 5]]) {
    assert.equal((await post(account, amount)).status, 200);
  }
  assert.equal(db.tables.manual_entries.length, 2);
  assert.equal(db.tables.manual_entries.reduce((n, r) => n + r.amount, 0), 75);
  assert.deepEqual(db.tables.manual_entries.map(r => googleExpenseAccount(r.label)).sort(), ["1729221399", "3376585292"]);
  assert.equal((await post(undefined, 0)).status, 409);
  assert.equal(db.tables.manual_entries.reduce((n, r) => n + r.amount, 0), 75);
});
test("Legacy costs migrate for a sole account; ambiguous multi-account history is preserved", async (t) => {
  const legacy = { id: "legacy", user_id: user, kind: "expense", date, currency: "EUR", label: "Google Valentina 9,00", amount: 9 };
  const db = setup(t, { manual_entries: [legacy] });
  assert.equal((await post("1729221399", 10)).status, 200);
  assert.equal(db.tables.manual_entries.length, 1);
  assert.equal(googleExpenseAccount(db.tables.manual_entries[0].label), "1729221399");
  db.tables.manual_entries = [{ ...legacy }];
  db.tables.google_campaigns = [{ user_id: user, campaign_id: `script:${store}:3376585292:42`, date }];
  assert.equal((await post("1729221399", 0)).status, 409);
  assert.equal(db.tables.manual_entries[0].amount, 9);
});
test("Wrong-store account imports are rejected before writing paid or gross costs", async (t) => {
  const db = setup(t, { google_campaigns: [{ user_id: user, campaign_id: `script:${other}:3376585292:42`, date }] });
  assert.equal((await post("3376585292", 100)).status, 409);
  const body = { user, store, token: googleScriptToken(user, store), customerId: "3376585292", currency: "EUR", days: [{ date }], campaigns: [] };
  const response = await require("../src/app/api/google/script-gross-costs/route.ts").POST(new Request("http://localhost/api/google/script-gross-costs", { method: "POST", body: JSON.stringify(body) }));
  assert.equal(response.status, 409);
  assert.equal(db.writes.length, 0);
  db.tables.google_campaigns[0].user_id = "another-user";
  assert.equal((await post("3376585292", 100)).status, 200);
});
test("One account's booked costs cannot hide another account's missing bill", async () => {
  const db = memoryDb({ manual_entries: [{ user_id: user, kind: "expense", date, label: "Google Valentina · conta 3376585292 · 10,00", amount: 10 }],
    google_campaigns: ["1729221399", "3376585292"].map(account => ({ user_id: user, campaign_id: `script-gross:${store}:${account}:42`, date, gross_spend: 100, spend: 0, updated_at: date })) });
  const estimates = await getGoogleSpendEstimates(db, user, [shop], { from: date, to: date }, new Map([[store, 1]]));
  assert.deepEqual(estimates, [{ storeId: store, date, amount: 100 }]);
});
