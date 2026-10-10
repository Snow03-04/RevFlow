process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-only";
require("../scripts/register-ts.cjs");
const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const { memoryDb } = require("./helpers/memory-db.cjs");
const { participationKey, participationSchema, readParticipation } = require("../src/lib/dashboard/store-participation.ts");
const { buildParticipationReport, getParticipationReport } = require("../src/lib/dashboard/report.ts");
const { getRangeComparison, getDailySeries } = require("../src/lib/queries.ts");
const { lastNDays } = require("../src/lib/date.ts");
const a = "00000000-0000-4000-8000-000000000001", b = "00000000-0000-4000-8000-000000000002";
const current = { from: "2026-10-01", to: "2026-10-01" }, previous = { from: "2026-09-30", to: "2026-09-30" };
function row(id, factor = 1, extra = {}) {
  return { user_id: "u", shopify_connection_id: id, date: current.from,
    revenue: 1000 * factor, gross_revenue: 1100 * factor, refunds: 100 * factor,
    ad_spend: 200 * factor, ad_spend_meta: 120 * factor, ad_spend_google: 80 * factor,
    product_cost: 300 * factor, shipping_cost: 20 * factor, payment_fees: 30 * factor,
    payment_adjustment: -10 * factor, manual_adjustment: 0, profit: 440 * factor,
    orders_count: 10, units_sold: 15, ad_clicks: 100, roas: 5, ...extra };
}
function report(extra = {}) {
  return buildParticipationReport({ rows: [row(a), row(b, 354)], estimates: [], rates: new Map([[a, 1], [b, 1 / 354]]),
    percentages: new Map([[a, 50], [b, 25]]), current, previous, chart: { from: previous.from, to: "2026-10-02" }, ...extra });
}

test("different store shares weight every cost after FX, while revenue, counts and performance stay at full scale", () => {
  const r = report(), totals = r.comparison.current;
  assert.equal(totals.revenue, 2000);
  assert.equal(totals.profit, 330);
  assert.equal(totals.adSpend, 150);
  assert.equal(totals.adSpendMeta, 90);
  assert.equal(totals.adSpendGoogle, 60);
  assert.equal(totals.productCost, 225);
  assert.equal(totals.shippingCost, 15);
  assert.equal(totals.paymentFees, 22.5);
  assert.equal(totals.paymentAdjustment, -7.5);
  assert.equal(totals.ordersCount, 20);
  assert.equal(totals.unitsSold, 30);
  assert.equal(totals.roas, 5);
  assert.equal(totals.profitMargin, 0.44);
  assert.equal(totals.aov, 100);
  assert.equal(totals.conversionRate, 0.1);
  assert.equal(r.series[1].profit, totals.profit);
  assert.equal(r.series[1].adSpend, totals.adSpend);
  assert.equal(r.series[2].profit, 0);
});

test("confirmed and estimated Google costs are scaled once, without inflating ROAS or changing individual stores", () => {
  const estimates = [{ storeId: a, date: current.from, amount: 80 }, { storeId: b, date: current.from, amount: 120 }];
  const r = report({ estimates });
  assert.equal(r.googleEstimatedAmount, 70);
  assert.equal(r.comparison.current.adSpendGoogle, 130);
  assert.equal(r.comparison.current.adSpend, 220);
  assert.equal(r.comparison.current.profit, 260);
  assert.equal(r.comparison.current.roas, 2000 / 600);
  assert.equal(r.series[1].roas, 2000 / 600);
  assert.equal(r.series[1].profit, 260);
  for (const id of [a, b]) {
    const selected = report({ estimates, storeId: id }).comparison.current;
    assert.equal(selected.revenue, 1000);
    assert.equal(selected.profit, id === a ? 360 : 320);
    assert.equal(selected.adSpend, id === a ? 280 : 320);
    assert.equal(selected.ordersCount, 10);
  }
});

test("zero, decimal and 100% participation preserve losses and account-level manual adjustments", () => {
  assert.equal(report({ percentages: new Map([[a, 0], [b, 0]]) }).comparison.current.profit, 0);
  assert.equal(report({ percentages: new Map() }).comparison.current.profit, 880);
  assert.equal(report({ rows: [row(a, 1, { profit: -100 })], percentages: new Map([[a, 33.33]]) }).comparison.current.profit, -33.33);
  const entries = [row(a, 1, { profit: 540, manual_adjustment: 100 })];
  const before = structuredClone(entries);
  assert.equal(report({ rows: entries }).comparison.current.profit, 320);
  assert.equal(report({ rows: entries, percentages: new Map([[a, 0]]) }).comparison.current.profit, 100);
  assert.deepEqual(entries, before);
});

test("previous periods use the same shares and round only after summing across days", () => {
  const rows = [row(a, 1, { date: previous.from, profit: 300 }), ...Array.from({ length: 3 }, () => row(a, 1, { profit: 0.01 }))];
  const r = report({ rows });
  assert.equal(r.comparison.previous.profit, 150);
  assert.equal(r.comparison.current.profit, 0.02);
});

test("the reader isolates users and the default 100% matches existing dashboard totals and series", async () => {
  const range = lastNDays(3, "UTC");
  const db = memoryDb({ daily_metrics: [row(a, 1, { date: range.to }), row(b, 354, { date: range.to }), row(a, 999, { date: range.to, user_id: "other" })] });
  const rates = new Map([[a, 1], [b, 1 / 354]]);
  const r = await getParticipationReport(db, "u", { stores: [], rates, percentages: new Map(), current: range, previous, chart: range });
  const expected = await getRangeComparison(db, "u", range, previous, rates);
  assert.deepEqual(r.comparison, expected);
  assert.deepEqual(r.series, await getDailySeries(db, "u", 3, "UTC", rates));
  assert.deepEqual(db.writes, []);
});

test("invalid preferences fall back to 100%; missing values do not turn into zero", () => {
  for (const value of [null, undefined, "50", NaN, Infinity, -1, 101, 1.234]) {
    assert.equal(participationSchema.safeParse(value).success, false);
    assert.equal(readParticipation({ [participationKey(a)]: value }, a), 100);
  }
  for (const value of [0, 0.01, 33.33, 50, 100]) assert.equal(readParticipation({ [participationKey(a)]: value }, a), value);
});

let currentDb;
const invalidated = [];
const load = Module._load;
Module._load = function (request, ...args) {
  if (request === "@/lib/supabase/server") return { createClient: async () => currentDb };
  if (request === "next/cache") return { revalidatePath: (path) => invalidated.push(path) };
  return load.call(this, request, ...args);
};
const { saveStoreParticipation } = require("../src/lib/dashboard/participation-actions.ts");
Module._load = load;
function setup({ user = { id: "u" }, saveError = null } = {}) {
  const writes = [];
  currentDb = memoryDb({ shopify_connections: [{ id: a, user_id: "u" }, { id: b, user_id: "other" }] });
  currentDb.auth = { getUser: async () => ({ data: { user } }), updateUser: async (payload) => { writes.push(payload); return { error: saveError }; } };
  invalidated.length = 0;
  return writes;
}
test("saving merges only the selected owned store preference and refreshes the dashboard", async () => {
  const writes = setup();
  assert.equal((await saveStoreParticipation(a, 33.33)).ok, true);
  assert.deepEqual(writes, [{ data: { [participationKey(a)]: 33.33 } }]);
  assert.deepEqual(invalidated, ["/dashboard"]);
  assert.deepEqual(currentDb.writes, []);
});
test("expired sessions, foreign stores and malformed percentages never write preferences", async () => {
  for (const [user, id, value] of [[null, a, 50], [{ id: "u" }, b, 50], [{ id: "u" }, "bad-id", 50], ...[null, "", -1, 101, NaN, Infinity, 0.001].map(v => [{ id: "u" }, a, v])]) {
    const writes = setup({ user });
    assert.equal((await saveStoreParticipation(id, value)).ok, false);
    assert.deepEqual(writes, []);
    assert.deepEqual(invalidated, []);
  }
});
test("a failed save does not claim success or expose backend errors", async () => {
  setup({ saveError: { message: "private backend error" } });
  const result = await saveStoreParticipation(a, 0);
  assert.equal(result.ok, false);
  assert.doesNotMatch(result.error, /private backend/);
  assert.deepEqual(invalidated, []);
});
