process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-only";
require("../scripts/register-ts.cjs");
const test = require("node:test"), assert = require("node:assert/strict");
const { memoryDb } = require("./helpers/memory-db.cjs");
const { recomputeDailyMetrics } = require("../src/lib/metrics.ts");
const { projectPnlMonth } = require("../src/lib/trackers/pnl-import.ts");
const { getGoogleSpendEstimates } = require("../src/lib/google/spend-estimates.ts");
const { parseGoogleBilledCsv } = require("../src/lib/google/billing-model.ts");
const { withGoogleBillingCredits } = require("../src/lib/google/billing.ts");
const user = "u", store = "11111111-1111-4111-8111-111111111111", date = "2026-10-15";
const range = { from: date, to: date };
const shop = { id: store, user_id: user, shop_name: "Test", shop_domain: "test.myshopify.com", reporting_base_currency: "EUR" };
const expense = (amount, account = "1234567890") => ({ user_id: user, date, kind: "expense", amount, currency: "EUR", label: `Google Test · conta ${account} · ${amount}` });
const campaign = (source, amount, account = "1234567890") => ({ user_id: user, date, campaign_id: `${source}:${store}:${account}:1`, google_connection_id: null, spend: source === "script-gross" ? 0 : amount, gross_spend: amount, clicks: 0, purchase_value: 0, updated_at: `${date}T12:00:00Z` });
const bill = { user_id: user, shopify_connection_id: store, customer_id: "1234567890", date, currency: "EUR", served_cost: 100, billed_cost: 40 };
function fixture(extra = {}) {
  return memoryDb({ settings: [{ user_id: user, currency: "EUR", timezone: "UTC", payment_fee_pct: 0, payment_fee_fixed: 0, default_shipping_cost: 0 }],
    pnl_settings: [{ user_id: user, currency: "€" }], shopify_connections: [shop], ...extra }, { projectColumns: true });
}
async function rollup(db) {
  await recomputeDailyMetrics(db, user, range);
  await projectPnlMonth(db, user, 2026, 10);
  return db.tables.daily_metrics.find(r => r.date === date);
}

test("Account expenses replace duplicate OAuth costs; other Google accounts and Meta still add once", async () => {
  const db = fixture({ manual_entries: [expense(100)], google_billing_reports: [bill],
    google_connections: [{ id: "g1", user_id: user, customer_id: "123-456-7890", shopify_connection_id: store },
      { id: "g2", user_id: user, customer_id: "9999999999", shopify_connection_id: store }],
    google_campaigns: [campaign("script", 100),
      { ...campaign("oauth", 100), campaign_id: "1", google_connection_id: "g1", clicks: 12 },
      { ...campaign("oauth", 15), campaign_id: "2", google_connection_id: "g2" }],
    meta_connections: [{ id: "m", user_id: user, shopify_connection_id: store }],
    campaigns: [{ user_id: user, date, spend: 20, clicks: 0, purchase_value: 0, meta_connection_id: "m" }] });
  for (let i = 0; i < 2; i++) {
    const row = await rollup(db);
    assert.equal(row.ad_spend_google, 55);
    assert.equal(row.ad_spend_meta, 20);
    assert.equal(row.ad_spend, 75);
    assert.equal(row.ad_clicks, 12);
    assert.equal(row.profit, -75);
    assert.equal(db.tables.pnl_days.find(r => r.day === 15).adspend_google, 55);
  }
  db.tables.manual_entries[0].amount = 0;
  db.tables.google_campaigns[0].spend = 0;
  assert.equal((await rollup(db)).ad_spend_google, 15, "funded zero also replaces OAuth");
});

test("One OAuth account cannot hide another account's unconfirmed spend", async () => {
  const db = fixture({ google_connections: [{ id: "g", user_id: user, customer_id: "1234567890", shopify_connection_id: store }],
    google_campaigns: [{ ...campaign("oauth", 20), google_connection_id: "g", campaign_id: "1" },
      campaign("script-gross", 20), campaign("script-gross", 30, "9999999999")] });
  assert.deepEqual(await getGoogleSpendEstimates(db, user, [shop], range, new Map([[store, 1]])), [{ storeId: store, date, amount: 30 }]);
});

test("Billing without a paid script books cost once, preserves later activity and flows into daily profit and P&L", async () => {
  const db = fixture({ google_billing_reports: [bill], google_campaigns: [campaign("script-gross", 120)] });
  for (let i = 0; i < 2; i++) {
    const row = await rollup(db);
    assert.equal(row.ad_spend_google, 60); // 40 billed + 20 newer served activity
    assert.equal(row.profit, -60);
    assert.equal(db.tables.pnl_days.find(r => r.day === 15).adspend_google, 60);
    assert.deepEqual(await getGoogleSpendEstimates(db, user, [shop], range, new Map()), []);
  }
  assert.equal(db.tables.manual_entries, undefined, "reconciliation never rewrites source expenses");
  db.tables.google_campaigns = [];
  assert.equal((await rollup(db)).ad_spend_google, 40, "the report itself proves the account cost");
  db.tables.google_billing_reports[0].billed_cost = 0;
  assert.equal((await rollup(db)).ad_spend_google, 0);
});

test("Legacy store totals remain intact when account allocation is unknown", async () => {
  const entry = { ...expense(90), label: "Google Test 90,00" };
  const db = fixture({ manual_entries: [entry], google_billing_reports: [bill] });
  assert.deepEqual(await withGoogleBillingCredits(db, user, range, [entry], [shop], "EUR", true), [entry]);
});

test("Missing Google billed-cost cells cannot be imported as a 100% discount", () => {
  const header = "Budget name,Day,Currency code,Served cost,Billed cost\n";
  for (const missing of ["--", "—", "–", ""]) {
    assert.throws(() => parseGoogleBilledCsv(header + `Campaign,${date},EUR,100,${missing}`));
  }
  assert.equal(parseGoogleBilledCsv(header + `Campaign,${date},EUR,100,0`)[0].billed_cost, 0);
});

test("A display-currency change cannot reinterpret previously imported ad spend", async t => {
  t.mock.method(require("../src/lib/fx.ts"), "resolveFx", async (from, to) => from === to ? 1 : from === "USD" ? 0.5 : 2);
  const db = fixture({ manual_entries: [{ ...expense(50), currency: "USD" }] });
  const row = await rollup(db);
  assert.equal(row.ad_spend_google, 25);
  assert.equal(row.profit, -25);
  assert.equal(db.tables.manual_entries[0].amount, 50);
  assert.equal(db.tables.manual_entries[0].currency, "USD");
});
