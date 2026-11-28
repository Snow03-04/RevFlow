process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-only";
require("../scripts/register-ts.cjs");
const test = require("node:test");
const assert = require("node:assert/strict");
const { salesQuery, parseSalesResponse, readSalesReport, reportMoney } = require("../src/lib/shopify/sales-report.ts");
const { applySales } = require("../src/lib/dashboard/sales.ts");
const { buildParticipationReport, buildStoreOverview } = require("../src/lib/dashboard/report.ts");
const { globeSales, liveSalesTotals, globeRevenueParts } = require("../src/lib/live/sales.ts");
const { zonedDayStartUtc } = require("../src/lib/date.ts");
const { memoryDb } = require("./helpers/memory-db.cjs");
const range = { from: "2026-11-28", to: "2026-11-28" };
const json = rows => ({ data: { shopifyqlQuery: { parseErrors: [], tableData: { rows } } } });
const sales = [{ storeId: "elena", date: range.from, revenue: 2025.31, orders: 23 }];

test("Shopify report precision matches the verified UI and the globe keeps visible cents", () => {
  for (const [raw, displayed] of [[2025.319, 2025.31], [1612.829, 1612.82], [868.196, 868.19], [21.07, 21.07], [-34.979, -34.97]]) assert.equal(reportMoney(raw, "EUR"), displayed);
  assert.deepEqual(globeRevenueParts(2025.31, "EUR"), { whole: 2025, fraction: ",31", sign: "" });
  assert.deepEqual(globeRevenueParts(-1.07, "EUR"), { whole: 1, fraction: ",07", sign: "−" });
  assert.deepEqual(globeRevenueParts(10, "JPY"), { whole: 10, fraction: "", sign: "" });
});

test("Shopify calculates the Portugal day and its own EUR conversion, including summer time", () => {
  assert.match(salesQuery(range, "EUR", "Europe/Lisbon"), /WITH CURRENCY 'EUR', TIMEZONE 'Europe\/Lisbon' SINCE 2026-11-28 UNTIL 2026-11-28/);
  assert.equal(zonedDayStartUtc("2026-11-28", "Europe/Lisbon").toISOString(), "2026-11-28T00:00:00.000Z");
  assert.equal(zonedDayStartUtc("2026-07-01", "Europe/Lisbon").toISOString(), "2026-06-30T23:00:00.000Z");
  assert.throws(() => salesQuery(range, "EUR'", "Europe/Lisbon"));
  assert.throws(() => salesQuery(range, "EUR", "Europe/Lisbon'"));
});

test("valid zero, sales reversals and failed reports remain distinct", () => {
  assert.deepEqual(parseSalesResponse(json([{ day: range.from, total_sales: "2025.31", orders: "23" }]), range), [{ date: range.from, revenue: 2025.31, orders: 23 }]);
  assert.equal(parseSalesResponse(json([{ day: range.from, total_sales: "-34.97", orders: "0" }]), range)[0].revenue, -34.97);
  assert.equal(parseSalesResponse(json([]), range)[0].revenue, 0);
  for (const bad of [{ errors: [{ message: "denied" }] }, { data: { shopifyqlQuery: { parseErrors: ["syntax"], tableData: { rows: [] } } } }, json([{ day: range.from, orders: "23" }])]) assert.throws(() => parseSalesResponse(bad, range));
});

test("dashboard and globe use identical sales without subtracting settlement adjustment or converting EUR twice", () => {
  const base = applySales([], sales)[0];
  const row = { ...base, revenue: 10795.34, gross_revenue: 10814.12, payment_adjustment: -18.78, profit: 4243.1, ad_spend: 1713.9 };
  const input = { rows: [row], sales, estimates: [], rates: new Map([["elena", .18714]]), percentages: new Map([["elena", 50]]), current: range, previous: range, chart: range };
  const report = buildParticipationReport(input);
  const before = buildParticipationReport({ ...input, sales: [] });
  assert.equal(report.comparison.current.revenue, 2025.31);
  assert.equal(report.comparison.current.profit, before.comparison.current.profit);
  assert.equal(report.comparison.current.paymentAdjustment, before.comparison.current.paymentAdjustment);
  assert.equal(report.comparison.current.ordersCount, 23);
  assert.equal(buildParticipationReport({ ...input, personalRevenue: true }).comparison.current.revenue, 1012.66);
  const snapshot = globeSales({ days: sales, unavailable: [], currency: "EUR", timeZone: "Europe/Lisbon", at: 123 }, range.from);
  assert.equal(liveSalesTotals({ elena: { rev: 2023.75, n: 23 } }, snapshot, range.from, ["elena"]).revenue, report.comparison.current.revenue);
  assert.equal(liveSalesTotals({ elena: { rev: 2223.75, n: 24 } }, snapshot, range.from, ["elena"]).revenue, 2025.31, "new realtime order cannot double count a report");
  assert.equal(liveSalesTotals({ elena: { rev: 50, n: 1 } }, snapshot, "2026-11-29", ["elena"]).revenue, 50, "yesterday's report never leaks past midnight");
  assert.equal(liveSalesTotals({ elena: { rev: 50, n: 1 } }, null, range.from, ["elena"]).revenue, 50, "replay and unavailable analytics retain order-based fallback");
});

test("store cards, participation and days awaiting rollups keep sales scoped to each store", () => {
  const second = { ...sales[0], storeId: "other", revenue: 100, orders: 2 };
  const options = { rows: [], sales: [...sales, second], stores: ["elena", "other"].map(id => ({ id, shop_name: id, shop_domain: id+".myshopify.com" })), estimates: [], rates: new Map(), percentages: new Map(), current: range, previous: range, chart: range };
  const report = buildStoreOverview(options);
  assert.deepEqual(report.stores.map(store => store.current.revenue), [2025.31, 100]);
  assert.equal(report.current.revenue, 2125.31);
  assert.equal(buildParticipationReport({ ...options, storeId: "elena" }).comparison.current.revenue, 2025.31);
});

test("report reads only the authenticated owner's stores and preserves the configured HUF rate", async t => {
  const auth = require("../src/lib/shopify/auth.ts");
  t.mock.method(auth, "resolveShopifyToken", async conn => { assert.equal(conn.user_id, "owner"); return "test-token"; });
  const queries = [];
  t.mock.method(global, "fetch", async (url, init) => {
    assert.match(String(url), /^https:\/\/elena\.myshopify\.com\//);
    const q = JSON.parse(init.body).variables.q; queries.push(q);
    return new Response(JSON.stringify(json([{ day: range.from, total_sales: "3540", orders: "23" }])));
  });
  const db = memoryDb({ settings: [{ user_id: "owner", currency: "EUR", timezone: "Europe/Lisbon", fx_rate_override: 354, fx_override_currency: "HUF" }], shopify_connections: [
    { id: "owner-elena-test", user_id: "owner", status: "active", shop_domain: "elena.myshopify.com", access_token: "encrypted", reporting_base_currency: "HUF" },
    { id: "foreign", user_id: "else", status: "active", shop_domain: "foreign.myshopify.com" },
  ] });
  const result = await readSalesReport(db, "owner", range);
  assert.equal(result.days[0].revenue, 10);
  assert.match(queries[0], /CURRENCY 'HUF'/);
  assert.deepEqual(result.unavailable, []);
  assert.equal(db.writes.length, 0);
});
