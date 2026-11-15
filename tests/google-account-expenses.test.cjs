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
const shop = { id: store, user_id: user, shop_name: "Valentina", shop_domain: "valentina.myshopify.com", reporting_base_currency: "EUR" };
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
  const db = setup(t, { shopify_connections: [shop, { ...shop, id: other, shop_domain: "other.myshopify.com" }],
    google_campaigns: [{ user_id: user, campaign_id: `script:${other}:3376585292:42`, date }] });
  assert.equal((await post("3376585292", 100)).status, 409);
  const body = { user, store, token: googleScriptToken(user, store), customerId: "3376585292", currency: "EUR", days: [{ date }], campaigns: [] };
  const response = await require("../src/app/api/google/script-gross-costs/route.ts").POST(new Request("http://localhost/api/google/script-gross-costs", { method: "POST", body: JSON.stringify(body) }));
  assert.equal(response.status, 409);
  assert.equal(db.writes.length, 0);
  db.tables.google_campaigns[0].user_id = "another-user";
  assert.equal((await post("3376585292", 100)).status, 200);
});

test("Historical script rows from a deleted store cannot block its newly authorized connection", async (t) => {
  const historical = { user_id: user, campaign_id: `script:${other}:1729221399:42`, date, spend: 12 };
  const db = setup(t, { google_campaigns: [historical] });
  assert.equal((await post("1729221399", 100)).status, 200);
  assert.equal(db.tables.manual_entries.length, 1);
  assert.equal(googleExpenseAccount(db.tables.manual_entries[0].label), "1729221399");
  assert.deepEqual(db.tables.google_campaigns[0], historical);
  const body = { user, store, token: googleScriptToken(user, store), customerId: "1729221399", currency: "EUR", days: [{ date }], campaigns: [] };
  const response = await require("../src/app/api/google/script-gross-costs/route.ts").POST(new Request("http://localhost/api/google/script-gross-costs", { method: "POST", body: JSON.stringify(body) }));
  assert.equal(response.status, 200);
  assert.equal(db.tables.google_campaigns[0].spend, 12);
});
test("One account's booked costs cannot hide another account's missing bill", async () => {
  const db = memoryDb({ manual_entries: [{ user_id: user, kind: "expense", date, label: "Google Valentina · conta 3376585292 · 10,00", amount: 10 }],
    google_campaigns: ["1729221399", "3376585292"].map(account => ({ user_id: user, campaign_id: `script-gross:${store}:${account}:42`, date, gross_spend: 100, spend: 0, updated_at: date })) });
  const estimates = await getGoogleSpendEstimates(db, user, [shop], { from: date, to: date }, new Map([[store, 1]]));
  assert.deepEqual(estimates, [{ storeId: store, date, amount: 100 }]);
});

test("A handed-over account keeps each stored day with its store and books new days to the latest holder", async (t) => {
  const { scriptAccountTimeline } = require("../src/lib/google/account-expenses.ts");
  const account = "1729221399", third = "44444444-4444-4444-8444-444444444444";
  const row = (owner, day) => ({ user_id: user, campaign_id: `script:${owner}:${account}:42`, date: day, spend: 5 });
  const held = [row(other, "2026-09-19"), row(other, "2026-09-20"), row(store, date)];
  const timeline = scriptAccountTimeline(held, new Set([store, other, third]));
  assert.deepEqual(["2026-09-01", "2026-09-19", "2026-09-20", date, "2026-09-30"].map(timeline.owner), [other, other, other, store, store]);
  assert.equal(scriptAccountTimeline([...held, row(store, "2026-09-20")], new Set([store, other])).owner("2026-09-20"), null);
  assert.equal(scriptAccountTimeline([], new Set([store])).accepts(store, date), true);
  assert.equal(timeline.accepts(third, "2026-09-30"), false);

  const db = setup(t, { shopify_connections: [shop, { ...shop, id: other, shop_name: "Antiga", shop_domain: "antiga.myshopify.com" }, { ...shop, id: third, shop_name: "Terceira", shop_domain: "terceira.myshopify.com" }],
    google_campaigns: held.map(r => ({ ...r })),
    manual_entries: [{ id: "old", user_id: user, kind: "expense", date: "2026-09-20", currency: "EUR", label: `Google Antiga · conta ${account} · 7,00`, amount: 7 }] });
  const send = async (owner, costs, path = "script-costs", extra = {}) => {
    const body = { user, store: owner, token: googleScriptToken(user, owner), currency: "EUR", customerId: account,
      days: Object.entries(costs).map(([day, cost]) => path === "script-costs" ? { date: day, cost } : { date: day }), ...extra };
    const response = await require(`../src/app/api/google/${path}/route.ts`).POST(new Request(`http://localhost/api/google/${path}`, { method: "POST", body: JSON.stringify(body) }));
    return { status: response.status, body: await response.json() };
  };
  const booked = () => db.tables.manual_entries.map(e => `${e.date} ${e.label}`).sort();

  // The new store reports its whole window: days held by the old store stay untouched.
  assert.equal((await send(store, { "2026-09-19": 10, "2026-09-20": 10, [date]: 10, "2026-09-22": 10 })).status, 200);
  assert.deepEqual(booked(), [`2026-09-20 Google Antiga · conta ${account} · 7,00`,
    `${date} Google Valentina · conta ${account} · 10,00`, `2026-09-22 Google Valentina · conta ${account} · 10,00`]);

  // The old store's script still corrects its own days, and can no longer rebook the new store's.
  assert.equal((await send(other, { "2026-09-20": 9, [date]: 99, "2026-09-22": 99 })).status, 200);
  assert.deepEqual(booked(), [`2026-09-20 Google Antiga · conta ${account} · 9,00`,
    `${date} Google Valentina · conta ${account} · 10,00`, `2026-09-22 Google Valentina · conta ${account} · 10,00`]);

  const writes = db.writes.length;
  assert.deepEqual(await send(other, { [date]: 99, "2026-09-22": 99 }, "script-costs", { campaigns: [] }),
    { status: 200, body: { ok: true, changed: 0, campaignRows: 0, collectionLinks: 0 } });
  assert.deepEqual(await send(other, { [date]: 0 }, "script-gross-costs", { campaigns: [] }),
    { status: 200, body: { ok: true, campaignRows: 0, collectionLinks: 0 } });
  // A store that never held the account still cannot claim it.
  assert.equal((await send(third, { "2026-09-23": 5 })).status, 409);
  assert.equal((await send(third, { "2026-09-23": 0 }, "script-gross-costs", { campaigns: [] })).status, 409);
  assert.equal(db.writes.length, writes);
});
