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
