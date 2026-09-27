process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-only";
require("../scripts/register-ts.cjs");
const test = require("node:test");
const assert = require("node:assert/strict");
const { memoryDb } = require("./helpers/memory-db.cjs");
const { buildLifetimeReport, storeHistorySchema, readStoreHistory, historyKey, lifetimeFees } = require("../src/lib/trackers/lifetime.ts");
const { getLifetimeData } = require("../src/lib/trackers/lifetime-query.ts");
const id1 = "00000000-0000-4000-8000-000000000001";
const id2 = "00000000-0000-4000-8000-000000000002";
const store = { id: "s", shop_name: "Luisa Milano", shop_domain: "shop.myshopify.com", status: "active", last_synced_at: null };
const fees = { feeFb: 0.1, feeGoogle: 0.05, txFee: 0.3, paymentPct: 0.025 };
const metric = (date, changes = {}) => ({ date, shopify_connection_id: "s", gross_revenue: 100, shipping_revenue: 5, refunds: 10,
  product_cost: 20, ad_spend_meta: 30, ad_spend_google: 10, orders_count: 2, units_sold: 3, ...changes });
const history = { version: 1, periods: [{ id: id1, name: "Nadel Atelier", from: null }, { id: id2, name: "Luisa Milano", from: "2026-07-01" }] };
const report = (options = {}) => buildLifetimeReport({ stores: [store], histories: new Map([["s", history]]),
  metrics: [metric("2025-12-31"), metric("2026-06-30"), metric("2026-07-01")],
  rates: new Map([["s", 1]]), feesForDate: () => fees, today: "2026-09-27", ...options });
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test("shared Shopify and ad account split exactly on the new brand's first day; total conserved", () => {
  const split = report();
  const unsplit = report({ histories: new Map() });
  assert.equal(split.rows.length, 2);
  assert.equal(split.rows[0].name, "Nadel Atelier");
  assert.equal(split.rows[0].revenue, 210);
  assert.equal(split.rows[0].adSpend, 80);
  assert.equal(split.rows[0].refunds, 20);
  assert.equal(split.rows[1].revenue, 105);
  assert.equal(split.rows[1].firstDate, "2026-07-01");
  assert.equal(split.total.orders, 6);
  assert.deepEqual(split.total, unsplit.total);
  close(split.total.profit, 3 * (105 - 10 - 20 - 40 - 3.5 - 3.225));
});

test("unconfirmed earlier history stays visible and contributes once", () => {
  const result = report({ histories: new Map([["s", { version: 1, periods: [{ id: id1, name: "Luisa", from: "2026-07-01" }] }]]) });
  assert.equal(result.rows[0].confirmed, false);
  assert.equal(result.rows[0].revenue, 210);
  assert.equal(result.rows[1].confirmed, true);
  assert.equal(result.rows[1].revenue, 105);
  assert.equal(result.total.revenue, 315);
});

test("future metrics do not inflate lifetime and a store without rows is unknown, not zero coverage", () => {
  const result = report({ stores: [store, { ...store, id: "empty" }], metrics: [metric("2026-09-28")] });
  assert.equal(result.total.firstDate, null);
  assert.equal(result.total.revenue, 0);
  assert.equal(result.rows.at(-1).firstDate, null);
  assert.equal(result.total.margin, null);
  assert.equal(result.total.roas, null);
});

test("multi-currency totals convert before summing and use weighted ratios", () => {
  const result = report({ stores: [store, { ...store, id: "huf" }], histories: new Map(), rates: new Map([["s", 1], ["huf", 0.0025]]),
    metrics: [metric("2026-09-01"), metric("2026-09-01", { shopify_connection_id: "huf", gross_revenue: 10000, shipping_revenue: 0, refunds: 0, product_cost: 3000, ad_spend_meta: 1000, ad_spend_google: 0 })] });
  close(result.total.revenue, 130);
  close(result.total.cogs, 27.5);
  close(result.total.adSpend, 42.5);
  close(result.total.margin, result.total.profit / 120);
  close(result.total.roas, 120 / 42.5);
  assert.equal(result.total.orders, 4);
});

test("fee overrides are resolved by year AND month, honouring explicit zero", () => {
  const resolve = lifetimeFees({ agency_fee_fb: 0.1, agency_fee_google: 0.02, transaction_fee: 0.3, payment_fee_pct: 0.025 }, [
    { year: 2025, month: 7, agency_fee_fb: 0, agency_fee_google: null, transaction_fee: 0 },
    { year: 2026, month: 7, agency_fee_fb: 0.3, agency_fee_google: 0, transaction_fee: null },
  ]);
  assert.deepEqual(resolve("2025-07-01"), { feeFb: 0, feeGoogle: 0.02, txFee: 0, paymentPct: 0.025 });
  assert.equal(resolve("2026-07-01").feeFb, 0.3);
  assert.equal(resolve("2024-07-01").feeFb, 0.1);
});

test("Google estimates reduce profit in the correct brand, are flagged, and affect fees", () => {
  const result = report({ estimates: [{ storeId: "s", date: "2026-06-30", amount: 50 }, { storeId: "s", date: "2026-07-01", amount: 20 }] });
  const baseline = report();
  assert.equal(result.rows[0].googleEstimate, 50);
  assert.equal(result.rows[1].googleEstimate, 20);
  close(result.total.profit, baseline.total.profit - 73.5);
  close(result.total.adSpend, baseline.total.adSpend + 70);
});

test("timeline rejects overlap, unsorted or missing boundaries, duplicate ids and invalid calendar dates", () => {
  assert.equal(storeHistorySchema.safeParse(history).success, true);
  for (const periods of [
    [{ id: id1, name: "A", from: "2026-07-01" }, { id: id2, name: "B", from: "2026-07-01" }],
    [{ id: id1, name: "A", from: "2026-07-01" }, { id: id2, name: "B", from: "2026-06-01" }],
    [{ id: id1, name: "A", from: null }, { id: id2, name: "B", from: null }],
    [{ id: id1, name: "A", from: null }, { id: id1, name: "B", from: "2026-07-01" }],
    [{ id: id1, name: "A", from: "2026-02-30" }],
    [{ id: id1, name: " ", from: null }],
  ]) assert.equal(storeHistorySchema.safeParse({ version: 1, periods }).success, false);
  assert.equal(readStoreHistory({ [historyKey("s")]: { version: 99 } }, "s"), null);
  assert.equal(readStoreHistory({ [historyKey("other")]: history }, "s"), null);
});

test("query paginates multiple years, stays user-scoped and does not modify metrics or editable P&L", async () => {
  const days = Array.from({ length: 1205 }, (_, i) => ({ ...metric(new Date(Date.UTC(2020, 0, i + 1)).toISOString().slice(0, 10)), id: `m${String(i).padStart(5, "0")}`, user_id: "u" }));
  const db = memoryDb({
    shopify_connections: [{ ...store, user_id: "u" }, { ...store, id: "foreign", user_id: "other" }],
    daily_metrics: [...days, { ...metric("2020-01-01", { gross_revenue: 99999 }), id: "foreign", user_id: "other" }],
    orders: [{ id: "o", user_id: "u", shopify_connection_id: "s", currency: "EUR", processed_at: "2020-01-01" }],
    settings: [{ user_id: "u", currency: "EUR", timezone: "UTC" }],
    pnl_settings: [{ user_id: "u", currency: "€", base_year: 2026, agency_fee_fb: 0, agency_fee_google: 0, transaction_fee: 0, payment_fee_pct: 0 }],
  });
  const result = await getLifetimeData(db, "u", {});
  assert.equal(result.total.revenue, 1205 * 105);
  assert.equal(result.stores.length, 1);
  assert.equal(result.total.firstDate, "2020-01-01");
  assert.equal(result.total.orders, 2410);
  assert.deepEqual(db.writes, []);
  const unavailable = await getLifetimeData(db, "u", {}, "foreign");
  assert.equal(unavailable.invalidStore, true);
  assert.equal(unavailable.rows.length, 0);
  assert.equal(unavailable.total.revenue, 0);
});

test("unowned metrics are disclosed rather than silently attributed; missing FX fails closed", () => {
  const result = report({ metrics: [metric("2026-06-01", { shopify_connection_id: null })] });
  assert.equal(result.unassignedDays, 1);
  assert.equal(result.total.revenue, 0);
  assert.throws(() => report({ rates: new Map() }), /moeda/);
});
