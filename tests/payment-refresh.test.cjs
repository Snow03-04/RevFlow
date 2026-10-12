process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-only";
require("../scripts/register-ts.cjs");
const test = require("node:test");
const assert = require("node:assert/strict");
const { memoryDb } = require("./helpers/memory-db.cjs");

test("Refresh reports payment failures after updating other data and a successful retry clears the error", async (t) => {
  const calls = [];
  const auth = require("../src/lib/shopify/auth.ts");
  const names = require("../src/lib/shopify/store-name.ts");
  const shopify = require("../src/lib/shopify/sync.ts");
  const payments = require("../src/lib/shopify/payments.ts");
  const supplier = require("../src/lib/supplier/sync.ts");
  const metrics = require("../src/lib/metrics.ts");
  const pnl = require("../src/lib/trackers/pnl-import.ts");
  const { refreshRecentData } = require("../src/lib/sync/recent.ts");
  t.mock.method(auth, "resolveShopifyToken", async () => "test-token");
  t.mock.method(names, "syncStoreName", async () => {});
  t.mock.method(shopify, "syncShopifyOrders", async () => { calls.push("orders"); return 0; });
  t.mock.method(require("../src/lib/sync-log.ts"), "withSyncLog", async (_db, _config, fn) => fn());
  let paymentError = "Não foi possível atualizar os pagamentos. Os últimos dados foram mantidos.";
  t.mock.method(payments, "syncShopifyPayments", async () => ({ changed: false, available: true, error: paymentError }));
  t.mock.method(supplier, "syncSupplierCosts", async () => { calls.push("supplier"); });
  t.mock.method(metrics, "recomputeDailyMetrics", async () => { calls.push("totals"); return 0; });
  t.mock.method(pnl, "currentPnlMonth", async () => null);
  const db = memoryDb({ settings: [{ user_id: "u", timezone: "UTC" }], shopify_connections: [{
    id: "s", user_id: "u", shop_domain: "store.myshopify.com", reporting_base_currency: "EUR",
    status: "active", last_synced_at: "2026-09-01",
  }] });

  const failed = await refreshRecentData(db, "u", true);
  assert.equal(failed.ok, false);
  assert.match(failed.error, /Shopify:.*pagamentos/);
  assert.equal(failed.completedAt, undefined);
  assert.deepEqual(calls, ["orders", "supplier", "totals"]);
  const conn = db.tables.shopify_connections[0];
  assert.equal(conn.status, "error");
  assert.equal(conn.last_sync_error, paymentError);
  assert.equal(conn.last_synced_at, "2026-09-01");

  paymentError = undefined;
  const retried = await refreshRecentData(db, "u", true);
  assert.equal(retried.ok, true);
  assert.ok(retried.completedAt);
  assert.equal(db.tables.shopify_connections[0].status, "active");
  assert.equal(db.tables.shopify_connections[0].last_sync_error, null);
});

test("Payment repairs reuse successful supplier totals and remain pending after a failed recalculation", async t => {
  for (const scenario of ["supplier refreshed", "supplier unchanged", "supplier failed", "payment repair failed"]) {
    await t.test(scenario, async t => {
      const calls = [];
      const { syncShopifyConnection } = require("../src/lib/jobs.ts");
      t.mock.method(require("../src/lib/shopify/auth.ts"), "resolveShopifyToken", async () => "test-token");
      t.mock.method(require("../src/lib/shopify/store-name.ts"), "syncStoreName", async () => {});
      t.mock.method(require("../src/lib/shopify/sync.ts"), "syncShopifyOrders", async () => 0);
      t.mock.method(require("../src/lib/sync-log.ts"), "withSyncLog", async (_db, _config, fn) => fn());
      t.mock.method(require("../src/lib/shopify/payments.ts"), "syncShopifyPayments", async () => {
        calls.push("payments saved");
        return { changed: true, available: true, months: ["2026-09"] };
      });
      t.mock.method(require("../src/lib/supplier/sync.ts"), "syncSupplierCosts", async () => {
        calls.push("supplier");
        if (scenario === "supplier failed") throw Error("supplier calculation failed");
        return { refreshed: scenario === "supplier refreshed" };
      });
      t.mock.method(require("../src/lib/cogs/refresh.ts"), "refreshCostDependents", async (_db, userId, options) => {
        assert.equal(userId, "u");
        assert.deepEqual(options, { storeId: "s", months: ["2026-09"] });
        calls.push("payment repair");
        if (scenario === "payment repair failed") throw Error("payment calculation failed");
      });
      const conn = { id: "s", user_id: "u", shop_domain: "store.myshopify.com", reporting_base_currency: "EUR", status: "active" };
      const db = memoryDb({
        settings: [{ user_id: "u", timezone: "UTC" }], shopify_connections: [conn],
        shopify_payment_accounts: [{ user_id: "u", shopify_connection_id: "s", refresh_pending: true }],
      });
      const pending = syncShopifyConnection(db, conn, { skipProducts: true, skipRecompute: true });
      const failed = scenario.endsWith("failed");
      if (failed) await assert.rejects(pending, /calculation failed/);
      else await pending;
      assert.equal(db.tables.shopify_payment_accounts[0].refresh_pending, failed);
      assert.deepEqual(calls, ["payments saved", "supplier", ...(
        scenario === "supplier unchanged" || scenario === "payment repair failed" ? ["payment repair"] : []
      )]);
      assert.equal(db.tables.shopify_connections[0].status, failed ? "error" : "active");
    });
  }
});
