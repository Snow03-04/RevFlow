process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-only";
require("../scripts/register-ts.cjs");
const test = require("node:test");
const assert = require("node:assert/strict");
const { mergeCurrentMetaOptions, selectMetaCampaigns, sumMetaSummaries } = require("../src/lib/trackers/meta-presentation.ts");
const { stableMetaRoas, metaRoasRange } = require("../src/lib/trackers/meta-roas.ts");
const { getMetaRoasSignals } = require("../src/lib/trackers/meta-pnl-query.ts");
const { eachDay, todayYmd } = require("../src/lib/date.ts");
const { memoryDb } = require("./helpers/memory-db.cjs");
const { allocateMetaPnl, summariseMetaPnl } = require("../src/lib/trackers/meta-pnl.ts");
const noFees = () => ({ feeFb: 0, feeGoogle: 0, txFee: 0, paymentPct: 0 });

test("Fire requires ROAS of at least three on every recent complete day, not a high average", () => {
  const today = "2026-09-24";
  const rows = eachDay(metaRoasRange(today)).map((date) => ({ date, spend: 10, revenue: 30 }));
  const signal = stableMetaRoas(rows, today, "ACTIVE");
  assert.equal(signal.roas, 3);
  assert.equal(signal.from, "2026-09-21");
  assert.equal(signal.to, "2026-09-23");
  assert.equal(stableMetaRoas([{ ...rows[0], revenue: 300 }, { ...rows[1], revenue: 29.99 }, rows[2]], today, "ACTIVE"), null);
  for (const status of [null, "PAUSED", "ARCHIVED"]) assert.equal(stableMetaRoas(rows, today, status), null);
  for (const spend of [0, -1, NaN, Infinity]) assert.equal(stableMetaRoas([{ ...rows[0], spend }, ...rows.slice(1)], today, "ACTIVE"), null);
  assert.equal(stableMetaRoas([{ ...rows[0], revenue: NaN }, ...rows.slice(1)], today, "ACTIVE"), null);
  assert.equal(stableMetaRoas(rows.slice(1), today, "ACTIVE"), null);
  assert.equal(stableMetaRoas([rows[0], rows[0], rows[2]], today, "ACTIVE"), null);
  assert.deepEqual(stableMetaRoas([...rows, { date: today, spend: 100, revenue: 0 }], today, "ACTIVE"), signal);
  assert.equal(stableMetaRoas(rows, "2026-09-25", "ACTIVE"), null);
  assert.deepEqual(metaRoasRange("2026-01-02"), { from: "2025-12-30", to: "2026-01-01" });
});

test("Fire query isolates user and ad account and reads recent days independently of the sheet's selected year", async () => {
  const dates = eachDay(metaRoasRange(todayYmd("Pacific/Honolulu")));
  const row = (date, account, user = "u", revenue = 30) => ({ user_id: user, meta_connection_id: account, campaign_id: "42", date, spend: 10, purchase_value: revenue });
  const db = memoryDb({ settings: [{ user_id: "u", timezone: "Pacific/Honolulu" }], campaigns: dates.flatMap((date) => [row(date, "one"), row(date, "two", "u", 0), row(date, "two", "other")]) });
  const options = ["one", "two"].map((account) => ({ key: `${account}:42`, status: "ACTIVE" }));
  const signals = await getMetaRoasSignals(db, "u", options);
  assert.deepEqual([...signals.keys()], ["one:42"]);
  assert.deepEqual(db.writes, []);
});

function campaign(key, status, spend, revenue = 0, extra = {}) {
  const summary = sumMetaSummaries([]);
  summary.input.adspendFb = spend;
  summary.metaRevenue = revenue;
  summary.metaRoas = spend ? revenue / spend : null;
  return { option: { key, name: key, campaignId: key, storeId: "one", storeName: "Loja", accountName: "Conta", status },
    summary, target: null, activity: true, ...extra };
}

test("Current Meta status replaces historical status, keeps accounts distinct and includes new campaigns", () => {
  const historical = [campaign("account-a:42", "ACTIVE", 100).option, campaign("account-b:42", "PAUSED", 50).option];
  const original = structuredClone(historical);
  const current = [{ ...historical[0], name: "Renamed campaign", status: "PAUSED", storeName: "" },
    { ...historical[0], key: "account-a:new", campaignId: "new", status: "ACTIVE", storeName: "" }];
  const result = mergeCurrentMetaOptions(historical, current, new Map([["one", "Actual store"]]));
  assert.equal(result.length, 3);
  assert.equal(result.find((c) => c.key === "account-a:42").status, "PAUSED");
  assert.equal(result.find((c) => c.key === "account-a:42").name, "Renamed campaign");
  assert.equal(result.find((c) => c.key === "account-a:new").storeName, "Actual store");
  assert.equal(result.find((c) => c.key === "account-a:new").status, "ACTIVE");
  assert.equal(result.find((c) => c.key === "account-b:42").status, null);
  assert.deepEqual(historical, original);
  assert.ok(mergeCurrentMetaOptions(historical, [], new Map()).every((c) => c.status === null));
});

test("Online campaigns lead every sort even without spend; historical activity never implies online", () => {
  const items = [campaign("A paused", "PAUSED", 1000, 5000), campaign("B unknown", null, 800, 2000),
    campaign("Z online new", "ACTIVE", 0, 0, { activity: false }), campaign("Y online", "ACTIVE", 10, 20)];
  const original = structuredClone(items);
  for (const sort of ["spend", "revenue", "roas", "name"]) {
    const selected = selectMetaCampaigns(items, "", "all", sort);
    assert.ok(selected.slice(0, 2).every((c) => c.option.status === "ACTIVE"));
    assert.ok(selected.slice(2).every((c) => c.option.status !== "ACTIVE"));
    assert.deepEqual(sumMetaSummaries(selected.map((c) => c.summary)), sumMetaSummaries(items.map((c) => c.summary)));
  }
  assert.equal(selectMetaCampaigns(items, "", "online", "spend").length, 2);
  assert.deepEqual(selectMetaCampaigns(items, "", "other", "spend").map((c) => c.option.key), ["B unknown"]);
  assert.deepEqual(items, original);
});

test("Filters distinguish zero snapshots, paused variants and accented campaign/product/store searches", () => {
  const items = [campaign("Árvore", "ACTIVE", 10, 30, { target: { key: "p", name: "Coleção Verão", kind: "collection" } }),
    campaign("Old", "CAMPAIGN_PAUSED", 20), campaign("Zero snapshot", "PAUSED", 0)];
  assert.equal(selectMetaCampaigns(items, "verao", "online", "spend")[0].option.key, "Árvore");
  assert.equal(selectMetaCampaigns(items, "arvore", "all", "spend").length, 1);
  assert.equal(selectMetaCampaigns(items, "Loja", "all", "spend").length, 3);
  assert.equal(selectMetaCampaigns(items, "", "paused", "spend").length, 2);
  assert.equal(selectMetaCampaigns(items, "", "activity", "spend").length, 2);
  assert.deepEqual(selectMetaCampaigns(items, "no match", "all", "spend"), []);
});

test("Collection campaigns find purchased items on other landing pages and split overlapping claims only once", () => {
  const date = "2026-09-21";
  const base = { date, name: "Cestos", storeId: "s", rate: 2, spend: 10, purchases: 1, purchaseValue: 100,
    target: { productId: null, collectionHandle: "baskets", via: "collection", price: 0, cog: 0, score: 1000 } };
  const campaigns = [{ ...base, key: "a", purchases: 3 }, { ...base, key: "b" },
    { ...base, key: "product", target: { ...base.target, collectionHandle: undefined, productId: "basket" } }];
  const order = { id: "o", storeId: "s", date, collectionHandle: "unrelated", grossRevenue: 120, refunds: 20, cost: 30, sheetCost: true,
    items: [{ productId: "basket", units: 1, revenue: 60, weight: 60, cost: 18 }, { productId: "hat", units: 1, revenue: 40, weight: 40, cost: 12 }] };
  const rows = allocateMetaPnl(campaigns, [order, order, { ...order, id: "private", storeId: "other" }], new Map([["s:baskets", ["basket"]]]));
  const total = summariseMetaPnl(rows, noFees);
  assert.equal(total.net, 120); assert.equal(total.input.cogs, 36); assert.equal(total.sheetCogs, 36);
  assert.equal(total.input.adspendFb, 60); assert.equal(total.profit, 24);
  assert.ok(Math.abs(total.input.orders - .6) < 1e-9);
  assert.equal(total.complete, true);
  assert.ok(Math.abs(rows.find(r => r.key === "a").input.cogs - 21.6) < 1e-9);
  assert.deepEqual(total.activeDates, [date]);
});

test("Confirmed collection with no daily sale produces a loss; an unavailable membership never invents known revenue", () => {
  const base = { key: "a", date: "2026-09-21", name: "Cestos", storeId: "s", rate: 1, spend: 10, purchases: 1, purchaseValue: 100,
    target: { productId: null, collectionHandle: "baskets", via: "collection", price: 0, cog: 0, score: 1000 } };
  const confirmed = summariseMetaPnl(allocateMetaPnl([base], [], new Map([["s:baskets", ["basket"]]])), noFees);
  assert.equal(confirmed.complete, true); assert.equal(confirmed.profit, -10);
  const missing = summariseMetaPnl(allocateMetaPnl([base], [], new Map([["s:baskets", null]])), noFees);
  assert.equal(missing.complete, false); assert.equal(missing.financialActivity, false);
  assert.deepEqual(missing.reasons, ["Produtos da coleção por confirmar no Shopify"]);
});

test("Meta query respects manual collection associations and reads verified products before allocating mixed orders", async (t) => {
  const match = require("../src/lib/trackers/match.ts");
  const sales = require("../src/lib/trackers/sales.ts");
  const memberships = require("../src/lib/trackers/collection-memberships.ts");
  const { getMetaPnlDays } = require("../src/lib/trackers/meta-pnl-query.ts");
  const date = "2026-09-21", db = memoryDb({ settings: [{ user_id: "owner", timezone: "Europe/Lisbon" }] });
  t.mock.method(match, "trackerFxByMetaConnection", async () => ({ stores: new Map([["m", "s"]]), rates: new Map([["m", 1]]), fallback: 1 }));
  t.mock.method(match, "fetchMatcherProducts", async () => []);
  t.mock.method(match, "fetchCampaignTargetMap", async () => new Map([
    ["42", { product: null, collection: "wrong", kind: "collection" }],
    ["general:meta:m:42", { product: null, collection: "baskets", kind: "collection" }],
  ]));
  t.mock.method(sales, "fetchTrackerOrderSales", async (_db, user, _range, timezone, channel) => {
    assert.equal(user, "owner"); assert.equal(timezone, "Europe/Lisbon"); assert.equal(channel, undefined);
    return [{ id: "o", storeId: "s", date, collectionHandle: null, grossRevenue: 100, refunds: 0, cost: 30, sheetCost: true,
      items: [{ productId: "basket", units: 1, revenue: 60, weight: 60, cost: 18 }, { productId: "hat", units: 1, revenue: 40, weight: 40, cost: 12 }] }];
  });
  t.mock.method(memberships, "getCollectionMemberships", async (_db, user, scopes) => {
    assert.equal(user, "owner"); assert.deepEqual(scopes, [{ storeId: "s", handle: "baskets" }]);
    return new Map([["s:baskets", ["basket"]]]);
  });
  const rows = await getMetaPnlDays(db, "owner", [{ date, campaign_id: "42", meta_connection_id: "m", campaign_name: "Cestos", spend: 10, purchases: 1, purchase_value: 60 }], { from: date, to: date }, "EUR");
  assert.equal(rows[0].input.grossRevenue, 60); assert.equal(rows[0].input.cogs, 18);
  assert.equal(rows[0].complete, true); assert.equal(rows[0].target.key, "collection:baskets");
  assert.equal(db.writes.length, 0);
});

test("Break-even includes payment and agency fees, while grouped days count distinct investment dates", () => {
  const rows = ["2026-09-21", "2026-09-22"].map(date => ({ key: "a", date, complete: true, reason: null,
    metaRevenue: 100, metaPurchases: 1, sheetCogs: 20, input: { grossRevenue: 100, refunds: 0, cogs: 20, adspendFb: 10, adspendGoogle: 0, orders: 1 } }));
  const s = summariseMetaPnl(rows, () => ({ ...noFees(), feeFb: .1, paymentPct: .02, txFee: .3 }));
  const expected = 200 * 1.1 / (200 - 40 - 4.6);
  assert.ok(Math.abs(s.breakEven - expected) < 1e-9);
  const grouped = sumMetaSummaries([s, s]);
  assert.ok(Math.abs(grouped.breakEven - expected) < 1e-9);
  assert.equal(grouped.activeDates.length, 2);
  const { checkMetaRoas } = require("../src/lib/trackers/meta-roas.ts");
  const check = checkMetaRoas([{ date: "2026-09-21", spend: 19.26, revenue: 43.79 }, { date: "2026-09-22", spend: 29.53, revenue: 189.54 }, { date: "2026-09-23", spend: 45.60, revenue: 463.59 }], "2026-09-24", "ACTIVE");
  assert.equal(check.qualifiedDays, 2); assert.equal(check.signal, null);
  assert.ok(check.days[0].roas < 3);
});

test("Facebook ROAS uses exactly two complete days, weights spend, and does not change the three-day fire rule", () => {
  const { checkMetaRoas, recentMetaRoas } = require("../src/lib/trackers/meta-roas.ts");
  const today = "2026-09-24";
  const facts = [{ date: "2026-09-21", spend: 10, revenue: 20 }, { date: "2026-09-22", spend: 10, revenue: 50 },
    { date: "2026-09-23", spend: 90, revenue: 900 }, { date: today, spend: 1000, revenue: 0 }];
  const check = checkMetaRoas(facts, today, "ACTIVE");
  assert.equal(check.recent.roas, 9.5); assert.equal(check.signal, null); assert.equal(check.qualifiedDays, 2);
  assert.equal(check.recent.from, "2026-09-22"); assert.equal(check.recent.to, "2026-09-23");
  assert.equal(recentMetaRoas(facts.filter(f => f.date !== "2026-09-22"), today).roas, null);
  assert.equal(recentMetaRoas([...facts, facts[1]], today).roas, null);
  assert.equal(recentMetaRoas(facts.map(f => ({ ...f, spend: 0, revenue: 0 })), today).roas, null);
  assert.equal(recentMetaRoas([{ date: "2025-12-31", spend: 10, revenue: 30 }, { date: "2026-01-01", spend: 10, revenue: 50 }], "2026-01-02").roas, 4);
  const a = { ...sumMetaSummaries([]), recentMeta: check.recent };
  const b = { ...sumMetaSummaries([]), recentMeta: { ...check.recent, spend: 900, revenue: 900, roas: 1 } };
  assert.equal(sumMetaSummaries([a, b]).recentMeta.roas, 1.85);
  const partial = sumMetaSummaries([a, { ...b, recentMeta: { ...b.recentMeta, complete: false, spend: 0, revenue: 0, roas: null } }]);
  assert.equal(partial.recentMeta.complete, false); assert.equal(partial.recentMeta.roas, 9.5);
});

test("Recent Facebook totals convert each Meta account to display currency before aggregating", async (t) => {
  const match = require("../src/lib/trackers/match.ts");
  const { getMetaRoasChecks } = require("../src/lib/trackers/meta-pnl-query.ts");
  const dates = eachDay(metaRoasRange(todayYmd("UTC"))).slice(-2);
  const db = memoryDb({ settings: [{ user_id: "u", timezone: "UTC" }], campaigns: dates.flatMap(date => [
    { user_id: "u", meta_connection_id: "eur", campaign_id: "42", date, spend: 10, purchase_value: 30 },
    { user_id: "u", meta_connection_id: "huf", campaign_id: "42", date, spend: 4000, purchase_value: 20000 },
  ]) });
  t.mock.method(match, "trackerFxByMetaConnection", async () => ({ rates: new Map([["eur", 1], ["huf", 1/400]]), fallback: 1, stores: new Map() }));
  const checks = await getMetaRoasChecks(db, "u", [{ key: "eur:42", status: "ACTIVE" }, { key: "huf:42", status: "PAUSED" }], "EUR");
  const total = sumMetaSummaries([...checks.values()].map(check => ({ ...sumMetaSummaries([]), recentMeta: check.recent })));
  assert.equal(total.recentMeta.spend, 40); assert.equal(total.recentMeta.revenue, 160); assert.equal(total.recentMeta.roas, 4);
  assert.equal(checks.get("huf:42").signal, null);
});
