process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-only";
require("../scripts/register-ts.cjs");
const test = require("node:test");
const assert = require("node:assert/strict");
const { memoryDb } = require("./helpers/memory-db.cjs");
const { syncMetaConnection } = require("../src/lib/jobs.ts");
const { syncStoreName } = require("../src/lib/shopify/store-name.ts");
const { trackerFxByMetaConnection } = require("../src/lib/trackers/match.ts");
const { metaSyncWindow } = require("../src/lib/meta/sync-window.ts");
const { todayYmd } = require("../src/lib/date.ts");

test("Meta catches up from its last completed sync instead of leaving partial days outside the recent window", () => {
  const now = new Date("2026-10-10T00:30:00Z");
  const expected = { range: { from: "2026-09-26", to: "2026-10-10" }, historical: { from: "2026-09-26", to: "2026-10-07" } };
  assert.deepEqual(metaSyncWindow(3, "UTC", "2026-09-27T10:00:00Z", now), expected);
  for (const last of [null, "invalid", "2026-10-11T00:00:00Z", "2026-10-09T10:00:00Z"]) {
    assert.deepEqual(metaSyncWindow(3, "UTC", last, now), { range: { from: "2026-10-08", to: "2026-10-10" }, historical: null });
  }
  assert.deepEqual(metaSyncWindow(3, "America/Los_Angeles", "2026-10-06T01:00:00Z", now),
    { range: { from: "2026-10-04", to: "2026-10-09" }, historical: { from: "2026-10-04", to: "2026-10-06" } });
  assert.equal(metaSyncWindow(120, "UTC", "2026-09-27T10:00:00Z", now).historical, null);
});

test("recovered historical Meta days reach the store rollups even when the caller owns the recent recompute", async (t) => {
  mockSources(t);
  const db = fixture();
  const old = new Date(); old.setUTCDate(old.getUTCDate() - 10);
  db.tables.meta_connections[0].last_synced_at = old.toISOString();
  let imported, recomputed;
  t.mock.method(require("../src/lib/meta/sync.ts"), "syncMetaCampaigns", async (_ctx, range) => { imported = range; return 1; });
  t.mock.method(require("../src/lib/metrics.ts"), "recomputeDailyMetrics", async (_db, userId, range, options) => { recomputed = { userId, range, options }; });
  await syncMetaConnection(db, db.tables.meta_connections[0], { skipRecompute: true });
  assert.equal(imported.to, todayYmd("UTC"));
  assert.equal(recomputed.range.from, imported.from);
  assert.ok(recomputed.range.to < imported.to);
  assert.deepEqual(recomputed.options, { storeId: "s" });
  assert.equal(recomputed.userId, "u");
  assert.equal(db.tables.meta_connections[0].status, "active");
});

function fixture(extra = {}) {
  return memoryDb({
    settings: [{ user_id: "u", currency: "EUR", timezone: "UTC", fx_rate_override: 354, fx_override_currency: "HUF" }],
    shopify_connections: [{ id: "s", user_id: "u", shop_domain: "store.myshopify.com", shop_name: "Store", reporting_base_currency: null }],
    meta_connections: [{ id: "m", user_id: "u", ad_account_id: "act_123", account_currency: "USD", shopify_connection_id: "s", status: "error" }],
    ...extra,
  });
}

function mockSources(t, currency = "RON") {
  const requests = [];
  t.mock.method(require("../src/lib/crypto.ts"), "decryptToken", () => "meta-token");
  t.mock.method(require("../src/lib/shopify/auth.ts"), "resolveShopifyToken", async () => "shop-token");
  t.mock.method(require("../src/lib/shopify/client.ts"), "shopifyGet", async (shop, token, resource, query) => {
    requests.push({ shop, token, resource, query });
    return { data: { shop: { name: "Store", currency } } };
  });
  t.mock.method(global, "fetch", async (url) => {
    const u = new URL(url);
    const rates = { "USD:RON": 4.5, "RON:EUR": 0.2, "USD:HUF": 350, "CAD:EUR": 0.65 };
    const pair = `${u.searchParams.get("from")}:${u.searchParams.get("to")}`;
    assert.ok(pair in rates, `Unexpected currency pair ${pair}`);
    return new Response(JSON.stringify({ rates: { [u.searchParams.get("to")]: rates[pair] } }));
  });
  t.mock.method(require("../src/lib/meta/client.ts"), "graphPaginate", async function* (_path, params) {
    yield [{ campaign_id: "42", campaign_name: "Campaign", date_start: JSON.parse(params.time_range).until,
      spend: "100", cpc: "2", cpm: "10", ctr: "2", clicks: "50", impressions: "10000",
      actions: [{ action_type: "purchase", value: "2" }], action_values: [{ action_type: "purchase", value: "300" }] }];
  });
  t.mock.method(require("../src/lib/metrics.ts"), "recomputeDailyMetrics", async () => {});
  return requests;
}

test("A USD Meta account syncs before the RON store's first order and displays converted EUR exactly once", async (t) => {
  const requests = mockSources(t);
  const db = fixture();
  await syncMetaConnection(db, db.tables.meta_connections[0], { sinceDays: 1 });
  assert.equal(db.tables.shopify_connections[0].reporting_base_currency, "RON");
  assert.equal(db.tables.meta_connections[0].account_currency, "USD");
  assert.equal(db.tables.meta_connections[0].status, "active");
  assert.equal(db.tables.meta_connections[0].last_sync_error, null);
  const campaign = db.tables.campaigns[0];
  assert.equal(campaign.spend, 450);
  assert.equal(campaign.purchase_value, 1350);
  assert.equal(campaign.cpc, 9);
  assert.equal(campaign.cpm, 45);
  assert.equal(campaign.purchases, 2);
  const fx = await trackerFxByMetaConnection(db, "u", "€");
  assert.equal(campaign.spend * fx.rates.get("m"), 90);
  assert.equal(campaign.purchase_value / campaign.spend, 3);
  await syncMetaConnection(db, db.tables.meta_connections[0], { sinceDays: 1 });
  assert.equal(db.tables.campaigns.length, 1);
  assert.equal(db.tables.campaigns[0].spend, 450);
  assert.equal(requests.length, 1, "Pinned currency avoids extra Shopify calls");
});

test("Shopify metadata initializes currency even when the store name is unchanged and there are no orders", async (t) => {
  mockSources(t);
  const db = fixture();
  await syncStoreName(db, db.tables.shopify_connections[0], "shop-token");
  assert.equal(db.tables.shopify_connections[0].reporting_base_currency, "RON");
});

test("Existing reporting currency and legacy order currency survive a Shopify currency change", async (t) => {
  mockSources(t, "CAD");
  for (const pinned of ["HUF", null]) {
    const db = fixture({ orders: [{ user_id: "u", shopify_connection_id: "s", currency: "HUF", processed_at: "2026-09-01" },
      { user_id: "u", shopify_connection_id: "other", currency: "USD", processed_at: "2026-10-10" }] });
    db.tables.shopify_connections[0].reporting_base_currency = pinned;
    await syncStoreName(db, db.tables.shopify_connections[0], "shop-token");
    assert.equal(db.tables.shopify_connections[0].reporting_base_currency, "HUF");
  }
});

test("Missing store metadata fails visibly and preserves existing spend instead of assuming USD or EUR", async (t) => {
  mockSources(t, undefined);
  t.mock.method(require("../src/lib/shopify/client.ts"), "shopifyGet", async () => ({ data: { shop: { name: "Store" } } }));
  const db = fixture({ campaigns: [{ id: "old", user_id: "u", meta_connection_id: "m", spend: 123 }] });
  await assert.rejects(syncMetaConnection(db, db.tables.meta_connections[0]), /moeda/i);
  assert.equal(db.tables.meta_connections[0].status, "error");
  assert.equal(db.tables.shopify_connections[0].reporting_base_currency, null);
  assert.equal(db.tables.campaigns[0].spend, 123);
});

test("Meta never borrows currency from an unmapped store or another user's store", async (t) => {
  const requests = mockSources(t);
  for (const storeId of [null, "foreign"]) {
    const db = fixture({ orders: [{ user_id: "u", shopify_connection_id: "s", currency: "RON", processed_at: "2026-10-10" }] });
    db.tables.meta_connections[0].shopify_connection_id = storeId;
    db.tables.shopify_connections.push({ id: "foreign", user_id: "another", reporting_base_currency: "USD" });
    await assert.rejects(syncMetaConnection(db, db.tables.meta_connections[0]), /loja/i);
    assert.equal(db.tables.campaigns, undefined);
  }
  assert.equal(requests.length, 0);
});
