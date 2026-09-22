process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-only";
process.env.TOKEN_ENCRYPTION_KEY = "11".repeat(32);
require("../scripts/register-ts.cjs");
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { memoryDb } = require("./helpers/memory-db.cjs");
const { lastFiveCompleteDays, googleRangeSinceChange, summariseGoogleSignalRoas, scaleLevel, calculateGoogleScale } = require("../src/lib/trackers/google-scale.ts");
const { GOOGLE_CHANGE_READER, changeDateLabel, googleChangeQuery } = require("../src/lib/google/change-events.ts");
const { saveGoogleChanges, getGoogleChanges, ScriptCampaignChange } = require("../src/lib/google/change-history.ts");
const { productFromUrls } = require("../src/lib/google/collection-links.ts");
const { fetchCollectionProductIds } = require("../src/lib/shopify/collection-products.ts");
const range = { from: "2026-09-15", to: "2026-09-19" };
const fees = () => ({ feeFb: 0, feeGoogle: 0, txFee: 0, paymentPct: 0 });
const facts = Array.from({ length: 5 }, (_, i) => ({ date: `2026-09-${15 + i}`, grossSpend: 10, conversionValue: 25, conversions: 2 }));
const sale = { id: "o", storeId: "s", date: "2026-09-18", grossRevenue: 200, refunds: 0, cost: 60,
  items: [{ productId: "p", weight: 200, units: 2, cost: 60 }] };
const opts = { range, lastChangedAt: "2026-09-14T12:00:00", status: "ENABLED", storeId: "s", rate: 1, facts, orders: [sale], productIds: ["p"], scope: "winter", shared: false, fees };

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
test("Kill/discale compares weighted since-change ROAS strictly below break-even for each source", () => {
  const afterChange = { ...opts, lastChangedAt: "2026-09-14T23:59:59" };
  const googleLoss = calculateGoogleScale({ ...afterChange, facts: facts.map((f) => ({ ...f, conversionValue: 5 })) });
  assert.equal(googleLoss.google.level, "kill");
  assert.equal(googleLoss.shopify.level, "ready");
  const shopifyLoss = calculateGoogleScale({ ...afterChange, facts: facts.map((f) => ({ ...f, grossSpend: 100, conversionValue: 400 })) });
  assert.equal(shopifyLoss.google.level, "ready");
  assert.equal(shopifyLoss.shopify.level, "kill");
  // Four profitable days cannot outweigh one expensive loss through a daily average.
  const weighted = calculateGoogleScale({ ...afterChange, facts: facts.map((f, i) => ({ ...f, grossSpend: i === 0 ? 100 : 1 })) });
  assert.equal(weighted.google.roas, 125 / 104);
  assert.equal(weighted.google.level, "kill");
  assert.equal(scaleLevel(2, 2, true, true), null);
  assert.equal(scaleLevel(1.99, 2, true, true), "kill");
  assert.equal(scaleLevel(0, 2, true, true), "kill");
  assert.equal(scaleLevel(null, 2, true, true), null);
  assert.equal(scaleLevel(NaN, 2, true, true), null);
});

test("Kill/discale waits for five complete days after the latest edit, excluding the edit day and today", () => {
  const losing = { ...opts, facts: facts.map((f) => ({ ...f, grossSpend: 100 })) };
  for (const lastChangedAt of [undefined, null, "2026-09-15T00:00:00", "2026-09-17T12:00:00", "2026-09-20T00:00:00"]) {
    const signal = calculateGoogleScale({ ...losing, lastChangedAt });
    assert.equal(signal.google.level, null);
    assert.equal(signal.shopify.level, null);
    assert.match(signal.reason, /Sem alteração importada|aguarda 5 dias completos|primeiro dia completo/);
  }
  for (const lastChangedAt of ["2026-09-14T23:59:59", "2026-09-14T00:00:00"]) {
    const signal = calculateGoogleScale({ ...losing, lastChangedAt });
    assert.equal(signal.google.level, "kill");
    assert.equal(signal.shopify.level, "kill");
    assert.equal(signal.reason, null);
  }
  const yearRange = lastFiveCompleteDays("2026-01-03");
  const yearOpts = { ...losing, range: yearRange, lastChangedAt: "2025-12-28T23:59:59",
    facts: ["2025-12-29", "2025-12-30", "2025-12-31", "2026-01-01", "2026-01-02"].map((date) => ({ ...losing.facts[0], date })),
    orders: [{ ...sale, date: "2026-01-01" }] };
  assert.equal(calculateGoogleScale(yearOpts).google.level, "kill");
  assert.equal(calculateGoogleScale({ ...yearOpts, lastChangedAt: "2025-12-29T00:00:00" }).google.level, null);
});

test("Both ROAS restart after the latest edit and exclude its day and today's performance", () => {
  const s = calculateGoogleScale({ ...opts, lastChangedAt: "2026-09-17T12:00:00",
    facts: [...facts, { date: "2026-09-20", grossSpend: 10000, conversionValue: 99999 }],
    orders: [sale, { ...sale, date: "2026-09-17", grossRevenue: 99999 }, { ...sale, date: "2026-09-20", grossRevenue: 99999 }] });
  assert.deepEqual(s.range, { from: "2026-09-18", to: "2026-09-19" });
  assert.equal(s.googleRevenue, 50);
  assert.equal(s.grossSpend, 20);
  assert.equal(s.shopifyRevenue, 200);
  assert.equal(s.google.roas, 2.5);
  assert.equal(s.shopify.roas, 10);
  assert.equal(s.google.level, null);
  assert.equal(s.shopify.level, null);
  const reset = calculateGoogleScale({ ...opts, lastChangedAt: "2026-09-19T10:00:00" });
  assert.equal(reset.google.roas, null);
  assert.equal(reset.shopify.roas, null);
  assert.equal(reset.range, null);
});

test("ROAS includes the whole post-edit interval, not just the most recent five days", () => {
  const s = calculateGoogleScale({ ...opts, lastChangedAt: "2026-09-12T23:59:59",
    facts: [
      { date: "2026-09-12", grossSpend: null, conversionValue: 99999 },
      { date: "2026-09-13", grossSpend: 100, conversionValue: 10 },
      { date: "2026-09-14", grossSpend: 50, conversionValue: 15 }, ...facts,
    ], orders: [sale, { ...sale, date: "2026-09-13", grossRevenue: 300, cost: 60 }] });
  assert.equal(s.expectedDays, 7);
  assert.equal(s.coverage, 7);
  assert.equal(s.grossSpend, 200);
  assert.equal(s.google.roas, 150 / 200);
  assert.equal(s.shopify.roas, 500 / 200);
  assert.equal(s.google.level, "kill");
  assert.equal(s.shopify.level, "scale");
});

test("Unknown change dates or incomplete post-edit coverage never fall back to older ROAS", () => {
  for (const patch of [
    { lastChangedAt: null }, { lastChangedAt: undefined },
    { lastChangedAt: "2026-09-20T09:00:00" },
    { lastChangedAt: "2026-08-01T12:00:00" },
    { facts: facts.slice(1) },
    { facts: facts.map((f, i) => i ? f : { ...f, grossSpend: null }) },
  ]) {
    const s = calculateGoogleScale({ ...opts, ...patch });
    assert.equal(s.google.roas, null);
    assert.equal(s.shopify.roas, null);
    assert.equal(s.google.level, null);
    assert.equal(s.shopify.level, null);
    assert.ok(s.reason);
  }
  assert.deepEqual(googleRangeSinceChange("2025-12-31T23:59:59", "2026-01-06"), { from: "2026-01-01", to: "2026-01-06" });
  assert.deepEqual(googleRangeSinceChange("2024-02-28T10:00:00", "2024-03-02"), { from: "2024-02-29", to: "2024-03-02" });
});

test("Google summaries weight conversion value and spend from each campaign's own reset", () => {
  const first = calculateGoogleScale(opts);
  const second = calculateGoogleScale({ ...opts, lastChangedAt: "2026-09-17T12:00:00", facts: facts.map((f) => ({ ...f, grossSpend: 100 })) });
  assert.equal(summariseGoogleSignalRoas([first, second]), (125 + 50) / (50 + 200));
  assert.equal(summariseGoogleSignalRoas([first, undefined]), null);
  assert.equal(summariseGoogleSignalRoas([first, calculateGoogleScale({ ...opts, lastChangedAt: null })]), null);
  assert.equal(summariseGoogleSignalRoas([]), null);
});

test("Campaign cost per conversion uses weighted Google conversions in the reset interval", () => {
  const datedFacts = facts.map((f, i) => ({ ...f, grossSpend: i < 3 ? 1000 : 10, conversions: i < 3 ? 100 : i === 3 ? .5 : 2 }));
  const signal = calculateGoogleScale({ ...opts, lastChangedAt: "2026-09-17T12:00:00", facts: datedFacts });
  assert.equal(signal.costPerConversion, 20 / 2.5);
  for (const patch of [
    { lastChangedAt: null }, { facts: facts.slice(1) },
    { facts: facts.map((f) => ({ ...f, grossSpend: null })) },
    { facts: facts.map((f) => ({ ...f, conversions: 0 })) },
  ]) assert.equal(calculateGoogleScale({ ...opts, ...patch }).costPerConversion, null);
  assert.equal(calculateGoogleScale({ ...opts, facts: facts.map((f) => ({ ...f, grossSpend: 0 })) }).costPerConversion, 0);
});

test("Kill/discale requires complete costs, active status and a known break-even", () => {
  const losing = { ...opts, lastChangedAt: "2026-09-14T12:00:00", facts: facts.map((f) => ({ ...f, grossSpend: 100 })) };
  for (const patch of [
    { facts: losing.facts.slice(1) },
    { facts: losing.facts.map((f, i) => i === 0 ? { ...f, grossSpend: null } : f) },
    { facts: losing.facts.map((f) => ({ ...f, grossSpend: 0 })) },
    { productIds: null }, { orders: [] }, { status: "PAUSED" }, { status: "REMOVED" }, { status: null },
  ]) {
    const signal = calculateGoogleScale({ ...losing, ...patch });
    assert.equal(signal.google.level, null);
    assert.equal(signal.shopify.level, null);
    assert.ok(signal.reason);
  }
});

test("Signals use the newest edit of the exact campaign, isolated by user, store and Google account", async (t) => {
  const dateModule = require("../src/lib/date.ts");
  const catalogModule = require("../src/lib/trackers/google-pnl-query.ts");
  const salesModule = require("../src/lib/trackers/sales.ts");
  const queries = require("../src/lib/queries.ts");
  const pnlQueries = require("../src/lib/trackers/queries.ts");
  const fx = require("../src/lib/fx.ts");
  const keys = ["s:123:42", "s:456:42", "other:123:42"];
  const campaigns = keys.map((key) => ({ key, campaignId: "42", storeId: key.split(":")[0], status: "ENABLED", productHandle: "coat" }));
  t.mock.method(dateModule, "todayYmd", () => "2026-09-20");
  t.mock.method(catalogModule, "getGooglePnlCatalog", async () => ({ options: campaigns,
    rows: keys.flatMap((key) => facts.map((f) => ({ key, date: f.date, campaign_id: "42", gross_spend: 100, purchase_value: 25 }))) }));
  t.mock.method(salesModule, "fetchTrackerOrderSales", async () => [sale, { ...sale, id: "other-order", storeId: "other" }]);
  t.mock.method(queries, "getStoreFxRates", async () => new Map());
  t.mock.method(pnlQueries, "getPnlSettings", async () => ({ currency: "EUR", agency_fee_fb: 0, agency_fee_google: 0, transaction_fee: 0, payment_fee_pct: 0 }));
  t.mock.method(pnlQueries, "getPnlYear", async () => ({ overrides: [] }));
  t.mock.method(fx, "resolveFx", async () => 1);
  const db = memoryDb({
    products: ["s", "other"].map((storeId) => ({ user_id: "u", handle: "coat", shopify_product_id: "p", shopify_connection_id: storeId })),
    google_campaign_changes: [
      { user_id: "u", campaign_key: keys[0], changed_at: "2026-09-14T12:00:00", kind: "budget" },
      { user_id: "u", campaign_key: keys[0], changed_at: "2026-09-19T12:00:00", kind: "bidding" },
      { user_id: "u", campaign_key: keys[1], changed_at: "2026-09-14T12:00:00", kind: "campaign" },
      { user_id: "someone-else", campaign_key: keys[1], changed_at: "2026-09-20T12:00:00", kind: "status" },
    ],
  });
  const { getGoogleSignals } = require("../src/lib/trackers/google-signals-query.ts");
  const { signals } = await getGoogleSignals(db, "u", "EUR");
  assert.equal(signals.get(keys[0]).google.level, null);
  assert.match(signals.get(keys[0]).reason, /primeiro dia completo/);
  assert.equal(signals.get(keys[0]).google.roas, null);
  assert.equal(signals.get(keys[0]).shopify.roas, null);
  assert.equal(signals.get(keys[1]).google.level, "kill");
  assert.equal(signals.get(keys[1]).shopify.level, "kill");
  assert.equal(signals.get(keys[2]).google.level, null);
  assert.match(signals.get(keys[2]).reason, /Sem alteração importada/);
  assert.equal(db.writes.length, 0);
});

test("Campaign signals show the red Kill/discale badge in compact and expanded views", () => {
  const { renderToStaticMarkup } = require("react-dom/server");
  const { createElement } = require("react");
  const { GoogleCampaignSignals } = require("../src/components/trackers/google-campaign-signals.tsx");
  const signal = calculateGoogleScale({ ...opts, lastChangedAt: "2026-09-14T12:00:00", facts: facts.map((f) => ({ ...f, conversionValue: 5 })) });
  for (const expanded of [false, true]) {
    const html = renderToStaticMarkup(createElement(GoogleCampaignSignals, { signal, changes: [], today: "2026-09-20", currency: "€", expanded }));
    assert.match(html, /text-red-400/);
    assert.ok(html.includes("Kill/discale"));
    assert.match(html, /Scale pronto/);
    assert.match(html, /ROAS desde a última alteração/);
    assert.match(html, /15\/09\/2026–19\/09\/2026/);
    assert.doesNotMatch(html, /Últimos 5 dias completos/);
    if (expanded) assert.match(html, /uma nova alteração reinicia a contagem e a espera/);
  }
});

test("ROAS age follows the latest actual change, while zero conversions are explained", () => {
  const { renderToStaticMarkup } = require("react-dom/server");
  const { createElement } = require("react");
  const { GoogleCampaignSignals } = require("../src/components/trackers/google-campaign-signals.tsx");
  const changes = [
    { event_id: "budget", changed_at: "2026-09-10T12:00:00", kind: "budget" },
    { event_id: "status", changed_at: "2026-09-17T12:00:00", kind: "status" },
  ];
  const signal = calculateGoogleScale({ ...opts, lastChangedAt: changes[1].changed_at, facts: facts.map((f) => ({ ...f, conversions: 0, conversionValue: 0 })) });
  assert.equal(signal.expectedDays, 2);
  assert.equal(signal.googleConversions, 0);
  for (const expanded of [false, true]) {
    const html = renderToStaticMarkup(createElement(GoogleCampaignSignals, { signal, changes, today: "2026-09-20", currency: "€", expanded }));
    assert.equal((html.match(/>· há 3 dias<\/span>/g) ?? []).length, 2);
    assert.match(html, /Estado modificado em 17\/09\/2026/);
    assert.match(html, /Sem conversões/);
  }
  const unknown = calculateGoogleScale({ ...opts, lastChangedAt: null });
  const html = renderToStaticMarkup(createElement(GoogleCampaignSignals, { signal: unknown, changes: [], today: "2026-09-20", currency: "€" }));
  assert.match(html, /data por confirmar/);
  assert.doesNotMatch(html, /há \d+ dias|Sem conversões/);
  const confirmed = { ...changes[1], event_id: "manual:confirmed-change:42:2026-09-17", kind: "campaign" };
  const confirmedHtml = renderToStaticMarkup(createElement(GoogleCampaignSignals, { signal, changes: [confirmed], today: "2026-09-20", currency: "€" }));
  assert.match(confirmedHtml, /Data da alteração confirmada há 3 dias/);
  assert.match(confirmedHtml, /data indicada pelo utilizador/);
  assert.doesNotMatch(confirmedHtml, /Estado modificado|2026-09-17 12:00:00/);
});

test("Signals fetch all post-edit days and fee years with separate reset dates per campaign", async (t) => {
  const dateModule = require("../src/lib/date.ts");
  const catalogModule = require("../src/lib/trackers/google-pnl-query.ts");
  const salesModule = require("../src/lib/trackers/sales.ts");
  const queries = require("../src/lib/queries.ts");
  const pnlQueries = require("../src/lib/trackers/queries.ts");
  const fx = require("../src/lib/fx.ts");
  const { getGoogleSignals } = require("../src/lib/trackers/google-signals-query.ts");
  const keys = ["s:123:42", "s:123:43"];
  const days = Array.from({ length: 10 }, (_, i) => new Date(Date.UTC(2025, 11, 31 + i)).toISOString().slice(0, 10));
  const expectedRange = { from: "2025-12-31", to: "2026-01-09" };
  const years = [];
  t.mock.method(dateModule, "todayYmd", (tz) => { assert.equal(tz, "Europe/Lisbon"); return "2026-01-10"; });
  t.mock.method(catalogModule, "getGooglePnlCatalog", async (_db, _user, _year, requestedRange) => {
    assert.deepEqual(requestedRange, expectedRange);
    return { options: keys.map((key) => ({ key, storeId: "s", status: "ENABLED", productHandle: "coat" })),
      rows: keys.flatMap((key) => days.map((date, i) => ({ key, date, campaign_id: key.split(":")[2], gross_spend: i === 0 ? 100 : 10, purchase_value: 20, purchases: 2 }))) };
  });
  t.mock.method(salesModule, "fetchTrackerOrderSales", async (_db, _user, requestedRange, _tz, channel) => {
    assert.deepEqual(requestedRange, expectedRange);
    assert.equal(channel, "all");
    return days.map((date) => ({ ...sale, date, grossRevenue: 100 }));
  });
  t.mock.method(queries, "getStoreFxRates", async () => new Map());
  t.mock.method(pnlQueries, "getPnlSettings", async () => ({ currency: "EUR", agency_fee_fb: 0, agency_fee_google: 0, transaction_fee: 0, payment_fee_pct: 0 }));
  t.mock.method(pnlQueries, "getPnlYear", async (_db, _user, year) => { years.push(year); return { overrides: [] }; });
  t.mock.method(fx, "resolveFx", async () => 1);
  const db = memoryDb({
    settings: [{ user_id: "u", timezone: "Europe/Lisbon" }],
    products: [{ user_id: "u", handle: "coat", shopify_product_id: "p", shopify_connection_id: "s" }],
    google_campaign_changes: [
      { user_id: "u", campaign_key: keys[0], changed_at: "2025-11-01T12:00:00", kind: "budget" },
      { user_id: "u", campaign_key: keys[0], changed_at: "2025-12-30T12:00:00", kind: "bidding" },
      { user_id: "u", campaign_key: keys[1], changed_at: "2026-01-07T12:00:00", kind: "status" },
    ],
  });
  const { signals } = await getGoogleSignals(db, "u", "EUR");
  assert.deepEqual(years, [2025, 2026]);
  assert.deepEqual(signals.get(keys[0]).range, expectedRange);
  assert.equal(signals.get(keys[0]).google.roas, 200 / 190);
  assert.equal(signals.get(keys[0]).shopify.roas, 1000 / 190);
  assert.equal(signals.get(keys[0]).costPerConversion, 190 / 20);
  assert.deepEqual(signals.get(keys[1]).range, { from: "2026-01-08", to: "2026-01-09" });
  assert.equal(signals.get(keys[1]).google.roas, 2);
  assert.equal(signals.get(keys[1]).shopify.roas, 10);
  assert.equal(signals.get(keys[1]).costPerConversion, 5);
  assert.equal(signals.get(keys[1]).google.level, null);
  assert.equal(db.writes.length, 0);
});

test("Performance summaries show the reset ROAS and never fall back to period ROAS", () => {
  const { renderToStaticMarkup } = require("react-dom/server");
  const { createElement } = require("react");
  const { GooglePerformance } = require("../src/components/trackers/google-performance.tsx");
  const { summariseGoogleAdCoverage } = require("../src/lib/trackers/google-ad-coverage.ts");
  const metrics = { impressions: 0, clicks: 0, conversions: 0, conversionValue: 0, ctr: null, cpc: null, cpm: null, cpa: null, googleRoas: 99, adCoverage: summariseGoogleAdCoverage([]) };
  for (const googleRoasSinceChange of [2.5, null]) {
    const html = renderToStaticMarkup(createElement(GooglePerformance, { metrics, currency: "€", googleRoasSinceChange }));
    assert.match(html, /ROAS Google · após alteração/);
    assert.doesNotMatch(html, /99\.00x/);
    if (googleRoasSinceChange != null) assert.match(html, /2\.50x/);
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
