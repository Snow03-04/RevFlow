process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-only";
process.env.TOKEN_ENCRYPTION_KEY = "11".repeat(32);
require("../scripts/register-ts.cjs");
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { memoryDb } = require("./helpers/memory-db.cjs");
const { lastFiveCompleteDays, scaleLevel, calculateGoogleScale } = require("../src/lib/trackers/google-scale.ts");
const { GOOGLE_CHANGE_READER, changeDateLabel, googleChangeQuery } = require("../src/lib/google/change-events.ts");
const { saveGoogleChanges, getGoogleChanges, ScriptCampaignChange } = require("../src/lib/google/change-history.ts");
const { productFromUrls } = require("../src/lib/google/collection-links.ts");
const { fetchCollectionProductIds } = require("../src/lib/shopify/collection-products.ts");
const range = { from: "2026-09-15", to: "2026-09-19" };
const fees = () => ({ feeFb: 0, feeGoogle: 0, txFee: 0, paymentPct: 0 });
const facts = Array.from({ length: 5 }, (_, i) => ({ date: `2026-09-${15 + i}`, grossSpend: 10, conversionValue: 25 }));
const sale = { id: "o", storeId: "s", date: "2026-09-18", grossRevenue: 200, refunds: 0, cost: 60,
  items: [{ productId: "p", weight: 200, units: 2, cost: 60 }] };
const opts = { range, status: "ENABLED", storeId: "s", rate: 1, facts, orders: [sale], productIds: ["p"], scope: "winter", shared: false, fees };

test("Scale boundaries are strict and all levels require profitability", () => {
  assert.equal(scaleLevel(1.5, 1.5), null);
  assert.equal(scaleLevel(1.6, 1.5), "review");
  assert.equal(scaleLevel(2, 1.5), "review");
  assert.equal(scaleLevel(2.01, 1.5), "scale");
  assert.equal(scaleLevel(3, 1.5), "scale");
  assert.equal(scaleLevel(3.01, 1.5), "ready");
  assert.equal(scaleLevel(3.2, 3.5), null);
  assert.equal(scaleLevel(4, null), null);
  assert.equal(scaleLevel(Infinity, 1), null);
});
test("Rolling window crosses months, leap days and years without including today", () => {
  assert.deepEqual(lastFiveCompleteDays("2026-01-03"), { from: "2025-12-29", to: "2026-01-02" });
  assert.deepEqual(lastFiveCompleteDays("2024-03-02"), { from: "2024-02-26", to: "2024-03-01" });
});
test("Google and full Shopify scope get distinct weighted ROAS and independent badges", () => {
  const s = calculateGoogleScale(opts);
  assert.equal(s.google.roas, 2.5);
  assert.equal(s.google.level, "scale");
  assert.equal(s.shopify.roas, 4);
  assert.equal(s.shopify.level, "ready");
  assert.equal(s.breakEven, 200 / 140);
  const weighted = calculateGoogleScale({ ...opts, facts: facts.map((f, i) => ({ ...f, grossSpend: i === 0 ? 100 : 1 })) });
  assert.equal(weighted.google.roas, 125 / 104);
});
test("No badge with incomplete coverage, missing gross spend, no association, paused status or no spend", () => {
  for (const patch of [{ facts: facts.slice(1) }, { facts: facts.map((f) => ({ ...f, grossSpend: null })) }, { productIds: null }, { status: "PAUSED" }, { status: null }, { facts: facts.map((f) => ({ ...f, grossSpend: 0 })) }]) {
    const s = calculateGoogleScale({ ...opts, ...patch });
    assert.equal(s.google.level, null);
    assert.equal(s.shopify.level, null);
    assert.ok(s.reason);
  }
});
test("Shopify scope counts matching products only, prorates refunds/fees and never leaks another store/day", () => {
  const mixed = { ...sale, grossRevenue: 200, refunds: 20, items: [{ productId: "p", units: 1, weight: 50, cost: 10 }, { productId: "unrelated", units: 3, weight: 150, cost: 60 }] };
  const s = calculateGoogleScale({ ...opts, orders: [mixed, { ...sale, storeId: "other" }, { ...sale, date: "2026-09-20" }],
    fees: () => ({ ...fees(), paymentPct: .03, txFee: .4, feeGoogle: .1 }) });
  assert.equal(s.shopifyRevenue, 45);
  assert.equal(s.breakEven, 45 * 1.1 / (45 - 10 - 1.5 - .1));
});
test("Real changes use original dates, budget fields and all shared-budget campaigns", () => {
  assert.match(googleChangeQuery("2026-09-20"), /BETWEEN '2026-08-22 00:00:00' AND '2026-09-20 23:59:59'/);
  const ctx = {};
  vm.runInNewContext(GOOGLE_CHANGE_READER, ctx);
  const e = { resourceName: "event1", changeDateTime: "2026-09-15 10:45:00", resourceChangeOperation: "UPDATE", changeResourceType: "CAMPAIGN_BUDGET", changeResourceName: "budget1", changedFields: "amount_micros",
    oldResource: { campaignBudget: { amountMicros: "10000000" } }, newResource: { campaignBudget: { amountMicros: "15000000" } } };
  const rows = ctx.readCampaignChanges([{ changeEvent: e }, { changeEvent: { ...e, resourceChangeOperation: "CREATE" } }], { budget1: ["42", "43"] });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].oldBudget, 10);
  assert.equal(rows[1].newBudget, 15);
  assert.equal(rows[0].kind, "budget");
  assert.equal(rows[0].changedAt, "2026-09-15 10:45:00");
  assert.equal(changeDateLabel(rows[0].changedAt, "2026-09-20"), "há 5 dias · 15/09");
  assert.equal(changeDateLabel("2025-12-31T23:00:00", "2026-01-01"), "há 1 dia · 31/12/2025");
  assert.equal(ScriptCampaignChange.safeParse(rows[0]).success, true);
});
test("OAuth imports budget history alongside daily metrics and tolerates an unavailable history API", async (t) => {
  const client = require("../src/lib/google/client.ts");
  const { syncGoogleCampaigns } = require("../src/lib/google/sync.ts");
  const db = memoryDb({ google_connections: [{ id: "conn", user_id: "u", shopify_connection_id: "s", account_currency: "EUR" }] });
  let failHistory = false;
  t.mock.method(client, "searchStream", async (_id, _token, query) => {
    if (query.includes("customer.time_zone")) return [{ customer: { timeZone: "Europe/Lisbon" } }];
    if (query.includes("FROM change_event")) {
      if (failHistory) throw new Error("History unavailable");
      return [{ changeEvent: { resourceName: "e", changeDateTime: "2026-09-15 12:00:00", resourceChangeOperation: "UPDATE", changeResourceType: "CAMPAIGN_BUDGET", changeResourceName: "budget", changedFields: "amountMicros", oldResource: { campaignBudget: { amountMicros: 10000000 } }, newResource: { campaignBudget: { amountMicros: 20000000 } } } }];
    }
    if (query.includes("campaign.campaign_budget")) return [{ campaign: { id: "42", campaignBudget: "budget" } }];
    return [{ campaign: { id: "42", name: "Brand", status: "ENABLED" }, segments: { date: "2026-09-19" }, metrics: { costMicros: 20000000 } }];
  });
  const ctx = { supabase: db, userId: "u", connectionId: "conn", customerId: "123", accessToken: "test" };
  assert.equal(await syncGoogleCampaigns(ctx, range), 1);
  assert.equal(db.tables.google_campaign_changes[0].campaign_key, "s:123:42");
  assert.equal(db.tables.google_campaign_changes[0].new_budget, 20);
  failHistory = true;
  t.mock.method(console, "warn", () => {});
  assert.equal(await syncGoogleCampaigns(ctx, range), 1);
  assert.equal(db.tables.google_campaigns[0].spend, 20);
  assert.equal(db.tables.google_campaign_changes.length, 1);
});
test("History retries are idempotent and isolate stores/accounts/users", async () => {
  const db = memoryDb();
  const change = { eventId: "e", campaignId: "42", changedAt: "2026-09-15 10:45:00", kind: "budget", oldBudget: 10, newBudget: 20 };
  const request = { userId: "u", storeId: "s", customerId: "123-456", currency: "EUR", changes: [change, change] };
  await saveGoogleChanges(db, request);
  await saveGoogleChanges(db, request);
  await saveGoogleChanges(db, { ...request, storeId: "other" });
  await saveGoogleChanges(db, { ...request, userId: "other-user" });
  assert.equal(db.tables.google_campaign_changes.length, 3);
  const rows = await getGoogleChanges(db, "u");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].changed_at, "2026-09-15T10:45:00");
});
test("Explicit product destinations require one unambiguous product", () => {
  assert.equal(productFromUrls(["https://s.test/products/coat", "https://s.test/collections/winter/products/coat?a=1"]), "coat");
  assert.equal(productFromUrls(["https://s.test/products/coat", "https://s.test/products/shirt"]), null);
  assert.equal(productFromUrls([]), null);
});
test("Shopify membership paginates and never presents a failed page as a complete collection", async (t) => {
  let calls = 0;
  t.mock.method(global, "fetch", async (_url, init) => {
    const after = JSON.parse(init.body).variables.after;
    calls++;
    assert.equal(after, calls === 1 ? null : "cursor");
    return { ok: true, json: async () => ({ data: { collectionByHandle: { products: { nodes: [{ id: `gid://shopify/Product/${calls}` }], pageInfo: { hasNextPage: calls === 1, endCursor: "cursor" } } } } }) };
  });
  assert.deepEqual(await fetchCollectionProductIds("s.myshopify.com", "test", "winter"), ["1", "2"]);
  t.mock.method(global, "fetch", async () => ({ ok: false }));
  assert.equal(await fetchCollectionProductIds("s.myshopify.com", "test", "winter"), null);
});
