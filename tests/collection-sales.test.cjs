process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-only";
process.env.TOKEN_ENCRYPTION_KEY = "11".repeat(32);
require("../scripts/register-ts.cjs");
const test = require("node:test");
const assert = require("node:assert/strict");
const { memoryDb } = require("./helpers/memory-db.cjs");
const { collectionOrderShare } = require("../src/lib/trackers/collection-sales.ts");
const { buildGoogleCollections, summariseCollection } = require("../src/lib/trackers/google-collections.ts");
const date = "2026-09-19";
const range = { from: date, to: date };
const basket = { productId: "basket", units: 1, revenue: 60, weight: 60, cost: 18 };
const hat = { productId: "hat", units: 1, revenue: 40, weight: 40, cost: 12 };
const order = { id: "o", storeId: "s", date, collectionHandle: "unrelated", landingSite: "/collections/unrelated?utm_source=newsletter",
  grossRevenue: 120, refunds: 20, cost: 30, sheetCost: true, items: [basket, hat] };
const campaign = { key: "c1", campaignId: "42", name: "Baskets", storeId: "s", rate: 2, collectionHandle: "baskets" };
const fact = { key: "c1", date, spend: 0, grossSpend: 10, conversions: 0, conversionValue: 0, clicks: 2, impressions: 10 };
const stores = [{ id: "s", name: "Store", rate: 2 }];

test("Collection amounts select matching lines and retain allocated supplier costs, refunds and free items", () => {
  assert.deepEqual(collectionOrderShare(order, new Set(["basket"])), {
    units: 1, grossRevenue: 72, refunds: 12, cogs: 18, feeOrders: .6,
  });
  assert.equal(collectionOrderShare(order, new Set(["other"])), null);
  const removed = { ...basket, units: 0, revenue: 0, cost: 0 };
  assert.equal(collectionOrderShare({ ...order, refunds: 0, items: [removed, hat] }, new Set(["basket"])), null);
  const refunded = collectionOrderShare({ ...order, items: [removed, hat] }, new Set(["basket"]));
  assert.equal(refunded.units, 0); assert.equal(refunded.refunds, 12);
  const edited = collectionOrderShare({ ...order, refunds: 0, items: [{ ...basket, weight: 120 }, hat] }, new Set(["basket"]));
  assert.equal(edited.grossRevenue, 72); assert.equal(edited.units, 1);
  const free = collectionOrderShare({ ...order, refunds: 0, items: [{ ...basket, weight: 0, revenue: 0 }, { ...hat, weight: 0, revenue: 0, units: 3 }] }, new Set(["basket"]));
  assert.equal(free.grossRevenue, 30); assert.equal(free.feeOrders, .25); assert.equal(free.cogs, 18);
});

test("Google collection sheets include every sales channel, ignore other landing pages, deduplicate and convert store currency", () => {
  const purchases = [null, "/?gclid=google", "/?fbclid=meta", order.landingSite].map((landingSite, i) => ({ ...order, id: String(i), landingSite }));
  const [group] = buildGoogleCollections([campaign], [fact], [...purchases, purchases[0], { ...order, id: "other-store", storeId: "other" }],
    stores, [], new Map([["s:baskets", ["basket"]]]));
  const result = summariseCollection(group.days, group.productIds !== null);
  assert.equal(result.orders, 4); assert.equal(result.units, 4);
  assert.equal(result.revenue, 480); assert.equal(result.cogs, 144);
  assert.equal(result.grossSpend, 20); assert.equal(result.spend, 0); assert.equal(result.credit, 20);
  assert.equal(result.profit, 316);
  assert.equal(result.complete, true);
});

test("Unknown membership is unavailable, a confirmed empty collection is zero, and missing ad coverage stays unknown", () => {
  for (const ids of [null, []]) {
    const [group] = buildGoogleCollections([campaign], [fact], [order], stores, [], new Map([["s:baskets", ids]]));
    const result = summariseCollection(group.days, group.productIds !== null);
    assert.equal(result.revenue, ids === null ? null : 0);
    assert.equal(result.units, ids === null ? null : 0);
    assert.equal(result.profit, ids === null ? null : -20);
    assert.equal(result.grossSpend, 20);
  }
  const [group] = buildGoogleCollections([campaign], [], [order], stores, [], new Map([["s:baskets", ["basket"]]]));
  const result = summariseCollection(group.days);
  assert.equal(result.revenue, 120); assert.equal(result.grossSpend, null); assert.equal(result.profit, null);
});

test("Google overview counts overlapping products once and keeps individual campaign attribution Google-only", async (t) => {
  const sales = require("../src/lib/trackers/sales.ts");
  const queries = require("../src/lib/queries.ts");
  const memberships = require("../src/lib/trackers/collection-memberships.ts");
  const { getGoogleFinanceData } = require("../src/lib/trackers/google-pnl-query.ts");
  const db = memoryDb({ settings: [{ user_id: "owner", currency: "EUR", timezone: "Europe/Lisbon" }] });
  t.mock.method(sales, "fetchTrackerOrderSales", async (_db, user, dates, timezone, channel) => {
    assert.equal(user, "owner"); assert.deepEqual(dates, range);
    assert.equal(timezone, "Europe/Lisbon"); assert.equal(channel, "all");
    return [order];
  });
  t.mock.method(queries, "getStoreFxRates", async () => new Map([["s", 2]]));
  const scopes = new Map([["s:baskets", ["basket"]], ["s:gifts", ["basket", "hat"]]]);
  t.mock.method(memberships, "getCollectionMemberships", async (_db, user, requested) => {
    assert.equal(user, "owner"); assert.equal(requested.length, 2); return scopes;
  });
  const catalog = { stores: [{ id: "s", shop_domain: "s.myshopify.com", shop_name: "Store" }],
    options: [campaign, { ...campaign, key: "c2", campaignId: "43", collectionHandle: "gifts" }],
    rows: [{ key: "c1", campaign_id: "42", date, spend: 10, gross_spend: 10, purchases: 0, purchase_value: 0, clicks: 2, impressions: 10 },
      { key: "c2", campaign_id: "43", date, spend: 20, gross_spend: 20, purchases: 0, purchase_value: 0, clicks: 2, impressions: 10 }] };
  const result = await getGoogleFinanceData(db, "owner", catalog, range, "EUR");
  assert.deepEqual(result.collections.map((c) => summariseCollection(c.days).revenue), [120, 200]);
  const total = summariseCollection(result.totals.flatMap((c) => c.days), result.totals.every((c) => c.salesKnown));
  assert.equal(total.revenue, 200); assert.equal(total.units, 2); assert.equal(total.orders, 1);
  assert.equal(total.cogs, 60); assert.equal(total.grossSpend, 60); assert.equal(total.profit, 80);
  assert.equal(result.days.reduce((sum, day) => sum + day.input.orders, 0), 0);
  assert.equal(db.writes.length, 0);
  scopes.set("s:gifts", null);
  const partial = await getGoogleFinanceData(db, "owner", catalog, range, "EUR");
  const identified = summariseCollection(partial.totals.flatMap((c) => c.days), partial.totals.every((c) => c.salesKnown));
  assert.equal(identified.revenue, 120); assert.equal(identified.complete, false);
  assert.equal(partial.totals.every(c => c.salesComplete), false);
  scopes.set("s:baskets", null);
  const unknown = await getGoogleFinanceData(db, "owner", { ...catalog, rows: [] }, range, "EUR");
  assert.equal(summariseCollection(unknown.totals.flatMap((c) => c.days), unknown.totals.every((c) => c.salesKnown)).revenue, null);
});

test("Membership lookup isolates users and stores, reuses a token per store and retries failed collection reads", async (t) => {
  const auth = require("../src/lib/shopify/auth.ts");
  const api = require("../src/lib/shopify/collection-products.ts");
  const { getCollectionMemberships } = require("../src/lib/trackers/collection-memberships.ts");
  const db = memoryDb({ shopify_connections: [
    { id: "s", user_id: "membership-owner", shop_domain: "s.myshopify.com" },
    { id: "private", user_id: "other-owner", shop_domain: "private.myshopify.com" },
  ] });
  let tokenCalls = 0, reads = 0, retry = false;
  t.mock.method(auth, "resolveShopifyToken", async (store) => { assert.equal(store.id, "s"); tokenCalls++; return "test-only"; });
  t.mock.method(api, "fetchCollectionProductIds", async (domain, _token, handle) => {
    assert.equal(domain, "s.myshopify.com"); reads++;
    return handle === "retry" && !retry ? null : [handle];
  });
  const scopes = [{ storeId: "s", handle: "baskets" }, { storeId: "s", handle: "baskets" }, { storeId: "s", handle: "retry" }, { storeId: "private", handle: "baskets" }];
  const first = await getCollectionMemberships(db, "membership-owner", scopes);
  assert.equal(tokenCalls, 1); assert.equal(reads, 2);
  assert.equal(first.get("private:baskets"), null); assert.equal(first.get("s:retry"), null);
  retry = true;
  const second = await getCollectionMemberships(db, "membership-owner", scopes);
  assert.equal(reads, 3); assert.deepEqual(second.get("s:retry"), ["retry"]);
  assert.equal((await getCollectionMemberships(db, "different-owner", [{ storeId: "s", handle: "baskets" }])).get("s:baskets"), null);
});
