process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-only";
require("../scripts/register-ts.cjs");
const test = require("node:test");
const assert = require("node:assert/strict");
const { memoryDb } = require("./helpers/memory-db.cjs");
const { buildParticipationReport, buildStoreOverview, getParticipationReport } = require("../src/lib/dashboard/report.ts");
const { dashboardPeriodUrl, dashboardStoreUrl } = require("../src/lib/dashboard-navigation.ts");
const current = { from: "2026-10-23", to: "2026-10-24" }, previous = { from: "2026-10-21", to: "2026-10-22" };
const stores = ["a", "b", "closed"].map(id => ({ id, shop_domain: `${id}.myshopify.com`, shop_name: id }));
function row(id, store, multiplier = 1, extra = {}) {
  return { id, user_id: "u", shopify_connection_id: store, date: current.to, revenue: 1000 * multiplier,
    gross_revenue: 1100 * multiplier, refunds: 100 * multiplier, ad_spend: 200 * multiplier,
    ad_spend_meta: 120 * multiplier, ad_spend_google: 80 * multiplier, product_cost: 320 * multiplier,
    eu_order_fees: 20 * multiplier, shipping_cost: 20 * multiplier, payment_fees: 30 * multiplier,
    payment_adjustment: -10 * multiplier, manual_adjustment: 0, profit: 430 * multiplier,
    orders_count: 10, units_sold: 15, ad_clicks: 100, ...extra };
}
const options = (extra = {}) => ({ stores, rows: [row("1", "a"), row("2", "b", 354)], estimates: [],
  rates: new Map([["a", 1], ["b", 1 / 354], ["closed", 1]]), percentages: new Map([["a", 100], ["b", 50]]),
  current, previous, chart: current, ...extra });

test("store cards reconcile with all-store personal profit across currencies, including EU fees and Google estimates", () => {
  const input = options({ estimates: [{ storeId: "b", date: current.to, amount: 60 }] });
  const result = buildStoreOverview(input), reference = buildParticipationReport(input);
  assert.deepEqual(result.current, reference.comparison.current);
  assert.equal(result.current.profit, 615);
  assert.equal(result.stores.reduce((sum, store) => sum + store.current.profit, 0), 615);
  assert.equal(result.stores[1].current.profit, 185);
  assert.equal(result.stores[1].total.profit, 370);
  assert.equal(result.stores[1].current.adSpendGoogle, 70);
  assert.equal(result.stores[1].current.euOrderFees, 10);
  assert.equal(result.stores[1].total.productCost, 300);
  assert.equal(result.stores[1].current.ordersCount, 10);
  assert.equal(result.stores[1].googleEstimatedAmount, 30);
  assert.deepEqual(result.stores[1].series.map(day => day.date), [current.from, current.to]);
});

test("a selected store never hides other cards, and foreign or orphaned rows cannot enter the overview", () => {
  const input = options({ storeId: "a", rows: [row("1", "a"), row("2", "b", 354), row("x", "foreign", 999), row("o", null, 999)],
    estimates: [{ storeId: "foreign", date: current.to, amount: 100000 }] });
  const result = buildStoreOverview(input);
  assert.deepEqual(result.stores.map(s => s.storeId), ["a", "b", "closed"]);
  assert.equal(result.current.revenue, 2000);
  assert.equal(result.current.profit, 645);
  assert.equal(result.stores[2].current.profit, 0);
  assert.equal(result.stores[2].current.ordersCount, 0);
});

test("losses, zero participation and personal adjustments keep their meaning in historical periods", () => {
  const input = options({ rows: [row("1", "a", 1, { profit: -50 }), row("2", "b", 354, { profit: 35400, manual_adjustment: 35400 }),
    row("p", "a", 1, { date: previous.to, profit: 200 })], percentages: new Map([["a", 100], ["b", 0]]) });
  const copy = structuredClone(input.rows), result = buildStoreOverview(input);
  assert.equal(result.stores[0].current.profit, -50);
  assert.equal(result.stores[0].previous.profit, 200);
  assert.equal(result.stores[1].current.profit, 100);
  assert.equal(result.current.profit, 50);
  assert.deepEqual(input.rows, copy);
});

test("one shared reader serves the detail and all stores without writes or leaking another user's rows", async () => {
  const db = memoryDb({ daily_metrics: [row("1", "a"), row("2", "b", 354), row("private", "a", 999, { user_id: "other" })] });
  const reads = [], original = db.from.bind(db);
  db.from = table => { reads.push(table); return original(table); };
  const { rows, estimates, ...input } = options({ storeId: "b", includeStores: true });
  const result = await getParticipationReport(db, "u", input);
  assert.equal(result.comparison.current.profit, 430);
  assert.equal(result.overview.stores[1].current.profit, 215);
  assert.equal(result.overview.current.revenue, 2000);
  assert.equal(reads.filter(name => name === "daily_metrics").length, 1);
  assert.deepEqual(db.writes, []);
});

test("date changes preserve the overview and previous selection; opening a card returns to its detail at the same dates", () => {
  const query = "store=a&view=stores&period=custom&from=2026-10-23&to=2026-10-24";
  const changed = new URL(dashboardPeriodUrl(query, "yesterday"), "http://localhost");
  assert.equal(changed.searchParams.get("view"), "stores");
  assert.equal(changed.searchParams.get("store"), "a");
  assert.equal(changed.searchParams.has("from"), false);
  const detail = new URL(dashboardStoreUrl(query, "b"), "http://localhost");
  assert.equal(detail.searchParams.get("store"), "b");
  assert.equal(detail.searchParams.has("view"), false);
  assert.equal(detail.searchParams.get("from"), "2026-10-23");
  assert.equal(detail.searchParams.get("to"), "2026-10-24");
});
