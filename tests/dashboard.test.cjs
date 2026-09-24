process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-only";
require("../scripts/register-ts.cjs");
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { memoryDb } = require("./helpers/memory-db.cjs");
const { appearanceScript } = require("../src/lib/appearance.ts");
const { profitMilestone } = require("../src/lib/profit-milestones.ts");
const { HeroMetric } = require("../src/components/dashboard/hero-metric.tsx");
const { refreshRecentData, needsSync } = require("../src/lib/sync/recent.ts");
const { isSameOriginRequest } = require("../src/lib/sync/request.ts");
const jobs = require("../src/lib/jobs.ts");
const metrics = require("../src/lib/metrics.ts");
const pnl = require("../src/lib/trackers/pnl-import.ts");
const roas = require("../src/lib/trackers/roas-import.ts");
const { getGoogleScriptWarnings } = require("../src/lib/google/script-health.ts");
const { GoogleSpendWarning } = require("../src/components/dashboard/google-spend-warning.tsx");
const { AdPlatformBreakdown } = require("../src/components/dashboard/ad-platform-breakdown.tsx");
const { getGoogleSpendEstimates, googleEstimateTotal, includeGoogleEstimate, includeGoogleEstimatesInSeries } = require("../src/lib/google/spend-estimates.ts");

test("Received Google gross costs fill dashboard estimates, respect FX and never become paid database entries", async () => {
  const a = "11111111-1111-4111-8111-111111111111", b = "22222222-2222-4222-8222-222222222222";
  const stores = [{ id: a, shop_name: "Example", shop_domain: "a.myshopify.com" }, { id: b, shop_name: "Example Two", shop_domain: "b.myshopify.com" }];
  const row = (store, account, campaign, amount, date = "2026-09-23", kind = "script-gross") => ({ user_id: "u", campaign_id: `${kind}:${store}:${account}:${campaign}`, date, spend: 0, gross_spend: amount, updated_at: date });
  const db = memoryDb({ google_campaigns: [row(a, "123", "1", 100), row(a, "123", "2", 50), row(b, "456", "1", 20),
    { ...row(a, "123", "3", 999), user_id: "another-user" }, row("33333333-3333-4333-8333-333333333333", "123", "1", 999)] });
  const range = { from: "2026-09-23", to: "2026-09-23" }, rates = new Map([[a, 1], [b, 0.5]]);
  const read = (store) => getGoogleSpendEstimates(db, "u", stores, range, rates, store);
  const estimates = await read();
  assert.equal(googleEstimateTotal(estimates, range), 160);
  assert.equal(googleEstimateTotal(await read(b), range), 10);
  const original = { revenue: 1000, profit: 400, adSpend: 100, adSpendGoogle: 0, adSpendMeta: 100 };
  const totals = includeGoogleEstimate(original, 160);
  assert.equal(totals.adSpendGoogle, 160); assert.equal(totals.adSpend, 260); assert.equal(totals.profit, 240);
  assert.equal(totals.profitMargin, 0.24); assert.equal(totals.roas, 1000 / 260);
  assert.equal(original.profit, 400);
  const [point] = includeGoogleEstimatesInSeries([{ date: range.from, revenue: 1000, adSpend: 100, profit: 400 }], estimates);
  assert.equal(point.profit, totals.profit); assert.equal(point.adSpend, totals.adSpend);
  // A confirmed zero covered by credit replaces the entire account estimate.
  db.tables.google_campaigns.push(row(a, "123", "1", 100, range.from, "script"));
  assert.equal(googleEstimateTotal(await read(), range), 10);
  // An exact store label must not be claimed by its shorter neighbour.
  db.tables.manual_entries = [{ user_id: "u", date: range.from, kind: "expense", label: "Google Example Two 4,00" }];
  assert.deepEqual(await read(), []);
  assert.equal(db.writes.length, 0);
});

test("Legacy manual expenses and OAuth totals suppress duplicate Google estimates, while unrelated days do not", async () => {
  const store = { id: "11111111-1111-4111-8111-111111111111", shop_name: "Example", shop_domain: "example.myshopify.com" };
  const range = { from: "2026-09-23", to: "2026-09-23" };
  const gross = { user_id: "u", campaign_id: `script-gross:${store.id}:123:1`, date: range.from, gross_spend: 80, updated_at: range.from };
  const db = memoryDb({ google_campaigns: [gross], manual_entries: [{ user_id: "u", date: "2026-09-22", kind: "expense", label: "Google 5,00" }] });
  const read = () => getGoogleSpendEstimates(db, "u", [store], range, new Map());
  assert.equal((await read())[0].amount, 80);
  db.tables.manual_entries[0].date = range.from;
  assert.deepEqual(await read(), []);
  db.tables.manual_entries = [];
  db.tables.google_connections = [{ id: "oauth", user_id: "u", shopify_connection_id: store.id }];
  db.tables.google_campaigns.push({ user_id: "u", google_connection_id: "oauth", campaign_id: "1", date: range.from, spend: 80 });
  assert.deepEqual(await read(), []);
});

test("Missing Google imports are shown as pending; confirmed credit-funded zero remains zero", async () => {
  const store = { id: "store-a", shop_name: "Example", shop_domain: "example.myshopify.com" };
  const row = (date, gross = false, user_id = "u") => ({ user_id, campaign_id: `script${gross ? "-gross" : ""}:${store.id}:123:456`, date, spend: 0, gross_spend: 100 });
  const range = { from: "2026-09-23", to: "2026-09-23" };
  const db = memoryDb({ google_campaigns: [row("2026-09-21"), row("2026-09-23", false, "other")] });
  const warnings = await getGoogleScriptWarnings(db, "u", [store], range, "2026-09-24");
  assert.equal(warnings[0].reason, "stale");
  assert.equal(warnings[0].lastReport, "2026-09-21");
  const message = renderToStaticMarkup(React.createElement(GoogleSpendWarning, { warnings }));
  assert.match(message, /2026-09-21/);
  assert.match(message, /incompletos/);
  const pending = renderToStaticMarkup(React.createElement(AdPlatformBreakdown, { meta: 10, google: 0, currency: "EUR", googlePending: true }));
  assert.match(pending, /Por atualizar/);
  assert.doesNotMatch(pending, /€0\.00|100%/);
  db.tables.google_campaigns.push(row("2026-09-23", true));
  assert.equal((await getGoogleScriptWarnings(db, "u", [store], range, "2026-09-24"))[0].reason, "billing");
  db.tables.google_campaigns.push(row("2026-09-23"));
  assert.deepEqual(await getGoogleScriptWarnings(db, "u", [store], range, "2026-09-24"), []);
  assert.match(renderToStaticMarkup(React.createElement(AdPlatformBreakdown, { meta: 10, google: 0, currency: "EUR" })), /€0\.00/);
  assert.equal(db.writes.length, 0);
});

test("Google freshness respects selected store, manual reconciliation, historical periods and future dates", async () => {
  const stores = [{ id: "a", shop_name: "Example", shop_domain: "a.myshopify.com" }, { id: "b", shop_name: "Example Two", shop_domain: "b.myshopify.com" }, { id: "c", shop_name: "Unused", shop_domain: "c.myshopify.com" }];
  const db = memoryDb({ google_campaigns: [
    { user_id: "u", campaign_id: "script:a:123:456", date: "2026-09-21" },
    { user_id: "u", campaign_id: "script-gross:b:789:456", date: "2026-09-23" },
  ], manual_entries: [
    { user_id: "u", kind: "expense", label: "Google Example Two 0,00", amount: 0, date: "2026-09-23" },
    { user_id: "other", kind: "expense", label: "Google Example 100,00", date: "2026-09-23" },
  ] });
  const range = { from: "2026-09-23", to: "2026-09-23" };
  const get = (id, dates = range) => getGoogleScriptWarnings(db, "u", stores, dates, "2026-09-23", id);
  assert.deepEqual((await get()).map((r) => r.storeId), ["a"]);
  assert.equal((await get("a"))[0].reason, "stale");
  assert.deepEqual(await get("b"), []);
  assert.deepEqual(await get("c"), []);
  assert.deepEqual(await get("a", { from: "2026-09-21", to: "2026-09-21" }), []);
  assert.deepEqual(await get("b", { from: "2026-09-23", to: "2026-09-30" }), []);
  assert.deepEqual(await get("a", { from: "2026-09-25", to: "2026-09-30" }), []);
});

function boot(saved = {}, cookie = "", blocked = false) {
  const classes = new Set(["dark"]);
  const root = { dataset: {}, style: {}, classList: { add: (v) => classes.add(v), remove: (...values) => values.forEach((v) => classes.delete(v)) } };
  vm.runInNewContext(appearanceScript, {
    document: { documentElement: root, cookie },
    localStorage: {
      getItem: (key) => { if (blocked) throw Error("Storage blocked"); return saved[key] ?? null; },
      setItem: (key, value) => { if (blocked) throw Error("Storage blocked"); saved[key] = value; },
    },
  });
  return { accent: root.dataset.accent, mode: [...classes][0], colorScheme: root.style.colorScheme };
}

test("First paint uses Cyan/dark and preserves every valid saved theme, including mobile storage fallback", () => {
  assert.deepEqual(boot(), { accent: "cyan", mode: "dark", colorScheme: "dark" });
  for (const accent of ["cyan", "purple", "gold", "pulse"]) {
    assert.equal(boot({ "revflow-accent": accent }).accent, accent);
    assert.equal(boot({}, `revflow-accent=${accent}`, true).accent, accent);
  }
  assert.equal(boot({ "revflow-accent": "invalid", theme: "system" }).accent, "cyan");
  assert.equal(boot({ theme: "system" }).mode, "dark");
  assert.equal(boot({ theme: "light" }).mode, "light");
  assert.equal(boot({ "revflow-accent": "gold" }, "revflow-accent=purple").accent, "gold");
  assert.equal(boot({}, "", true).accent, "cyan");
});

test("Daily profit changes from green to violet at 200, gold at 500 and champagne at 1000, and reverses on a fall", () => {
  for (const [value, style] of [[0, "base"], [99.99, "base"], [100, "rising"], [199.99, "rising"], [200, "violet"], [499.99, "violet"], [500, "gold"], [999.99, "gold"], [1000, "champagne"], [1000000, "champagne"], [199, "rising"], [-1, "base"], [NaN, "base"]]) {
    assert.equal(profitMilestone(value).style, style, String(value));
  }
  assert.equal(profitMilestone(100000).next, null);
});

test("Financial cards render the real amount before hydration; positive daily profit gets persistent effects", () => {
  const render = (props) => renderToStaticMarkup(React.createElement(HeroMetric, { value: 1234.56, currency: "EUR", profit: true, daily: true, ...props }));
  assert.match(render({}), /1,234\.56/);
  assert.match(render({}), /data-profit-style="champagne"/);
  assert.doesNotMatch(render({ daily: false }), /profit-effects/);
  assert.match(render({ daily: false }), /data-profit-style="base"/);
  assert.doesNotMatch(render({ profit: false }), /profit-effects/);
  assert.match(render({ value: -50 }), /var\(--profit-negative\)/);
  assert.doesNotMatch(render({ value: -50 }), /profit-effects/);
  assert.match(render({ value: 199 }), /profit-aura/);
  assert.doesNotMatch(render({ value: 199 }), /profit-sweep|profit-sparks|profit-edge/);
  assert.match(render({ value: 199 }), /data-profit-rising="true"/);
  assert.doesNotMatch(render({}), /vs ontem|Após os custos|Próximo/);
});

test("Dashboard effects follow the selected single day, including yesterday and historical custom dates", async (t) => {
  const server = require("../src/lib/supabase/server.ts");
  const queries = require("../src/lib/queries.ts");
  const { DashboardMetrics } = require("../src/components/dashboard/dashboard-metrics.tsx");
  t.mock.method(server, "createClient", async () => ({}));
  t.mock.method(queries, "getRangeComparison", async () => ({ current: { profit: 520, revenue: 1000, productCost: 100, conversionRate: 0.05 }, previous: {} }));
  t.mock.method(queries, "getDailySeries", async () => []);
  const heroes = (node) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(heroes)
    : node.type === HeroMetric ? [node] : heroes(node.props?.children);
  for (const [period, from, to, expected] of [
    ["today", undefined, undefined, true], ["yesterday", undefined, undefined, true],
    ["custom", "2026-04-12", "2026-04-12", true], ["custom", "2026-04-12", "2026-04-14", false],
    ["last7", undefined, undefined, false],
  ]) {
    const tree = await DashboardMetrics({ userId: "u", storeRates: new Map(), currency: "EUR", tz: "UTC", period, from, to, showAdBreakdown: true });
    const profit = heroes(tree).find((hero) => hero.props.profit);
    assert.equal(profit.props.daily, expected, `${period}: ${from}–${to}`);
    const html = renderToStaticMarkup(profit);
    assert.equal(html.includes('data-profit-style="gold"'), expected);
  }
});

test("Sync origin validation permits the public host behind Next's internal URL and rejects cross-origin requests", () => {
  const request = (headers) => new Request("http://0.0.0.0:3000/api/sync", { headers });
  assert.equal(isSameOriginRequest(request({ host: "localhost:3000", origin: "http://localhost:3000", "sec-fetch-site": "same-origin" })), true);
  assert.equal(isSameOriginRequest(request({ host: "revflow.example", origin: "https://revflow.example" })), true);
  assert.equal(isSameOriginRequest(request({ host: "revflow.example", origin: "https://evil.example" })), false);
  assert.equal(isSameOriginRequest(request({ host: "revflow.example", origin: "null" })), false);
  assert.equal(isSameOriginRequest(request({ "sec-fetch-site": "cross-site" })), false);
});

test("Each connection has its own cooldown; errors and invalid/future timestamps always retry", () => {
  const now = Date.parse("2026-09-19T12:00:00Z");
  const c = (time, status = "active") => ({ last_synced_at: time, status });
  assert.equal(needsSync(c("2026-09-19T11:59:59Z"), now), false);
  for (const conn of [c("2026-09-19T11:59:00Z"), c(null), c("invalid"), c("2026-09-20T12:00:00Z"), c("2026-09-19T11:59:59Z", "error")]) assert.equal(needsSync(conn, now), true);
});

function fixture() {
  return memoryDb({
    shopify_connections: [{ id: "fresh", user_id: "u", status: "active", last_synced_at: new Date().toISOString() }],
    meta_connections: [{ id: "stale", user_id: "u", status: "active", last_synced_at: null }, { id: "other-user", user_id: "other", status: "active", last_synced_at: null }],
    google_connections: [{ id: "google", user_id: "u", status: "active", last_synced_at: null }],
    settings: [{ user_id: "u", timezone: "Europe/Lisbon" }],
    roas_settings: [{ user_id: "u" }],
  });
}
function mockPipeline(t, overrides = {}) {
  const calls = [];
  t.mock.method(jobs, "refreshCampaignLinks", async () => { calls.push("campaign-links"); return 0; });
  for (const name of ["syncShopifyConnection", "syncMetaConnection", "syncGoogleConnection"]) t.mock.method(jobs, name, async (_db, conn) => {
    calls.push(`${name}:${conn.id}`);
    if (overrides.failProvider === name) throw Error("expired token");
  });
  t.mock.method(metrics, "recomputeDailyMetrics", async () => { calls.push("metrics"); if (overrides.failMetrics) throw Error("database unavailable"); });
  t.mock.method(pnl, "currentPnlMonth", async () => ({ year: 2026, month: 9 }));
  t.mock.method(pnl, "projectPnlMonth", async () => { calls.push("pnl"); });
  t.mock.method(roas, "currentRoasMonth", async () => ({ year: 2026, month: 9 }));
  t.mock.method(roas, "projectRoasMonth", async () => { calls.push("roas"); });
  return calls;
}

test("A fresh Shopify store never suppresses stale Meta/Google; totals update after imports and both sheets follow", async (t) => {
  const calls = mockPipeline(t);
  const result = await refreshRecentData(fixture(), "u");
  assert.equal(result.ok, true);
  assert.equal(result.synced, true);
  assert.ok(result.completedAt);
  assert.deepEqual(calls.slice(0, 2), ["syncMetaConnection:stale", "syncGoogleConnection:google"]);
  assert.deepEqual(calls.slice(2), ["metrics", "pnl", "roas"]);
});

test("A partial failure still recomputes successful imports, projects sheets and reports the real error", async (t) => {
  const calls = mockPipeline(t, { failProvider: "syncMetaConnection" });
  const result = await refreshRecentData(fixture(), "u", true);
  assert.equal(result.ok, false);
  assert.equal(result.synced, true);
  assert.match(result.error, /Meta: expired token/);
  assert.equal(result.completedAt, undefined);
  assert.ok(calls.includes("syncShopifyConnection:fresh"));
  assert.ok(calls.includes("metrics") && calls.includes("pnl") && calls.includes("roas"));
  assert.equal(calls.some((call) => call.includes("other-user")), false);
});

test("A failed metric recompute is never reported as a successful refresh", async (t) => {
  const calls = mockPipeline(t, { failMetrics: true });
  const result = await refreshRecentData(fixture(), "u");
  assert.equal(result.ok, false);
  assert.match(result.error, /Totais: database unavailable/);
  assert.equal(calls.includes("pnl"), false);
});

test("Even throttled imports repair rollups left incomplete by an interrupted request", async (t) => {
  const calls = mockPipeline(t);
  const db = fixture();
  db.tables.meta_connections = [];
  db.tables.google_connections = [];
  const result = await refreshRecentData(db, "u");
  assert.equal(result.ok, true);
  assert.equal(result.synced, false);
  assert.deepEqual(calls, ["metrics", "pnl", "roas"]);
});

test("Mobile wake events refresh immediately; hidden pages do not poll and cleanup removes all listeners", (t) => {
  const { observeRefreshLifecycle } = require("../src/lib/sync/lifecycle.ts");
  const page = new EventTarget();
  page.visibilityState = "visible";
  const win = new EventTarget();
  const oldDocument = global.document;
  const oldWindow = global.window;
  global.document = page;
  global.window = win;
  t.after(() => { global.document = oldDocument; global.window = oldWindow; });
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  let count = 0;
  const stop = observeRefreshLifecycle(() => count++);
  t.mock.timers.tick(300);
  assert.equal(count, 1);
  page.visibilityState = "hidden";
  t.mock.timers.tick(120000);
  win.dispatchEvent(new Event("focus"));
  assert.equal(count, 1);
  page.visibilityState = "visible";
  page.dispatchEvent(new Event("visibilitychange"));
  win.dispatchEvent(new Event("pageshow"));
  win.dispatchEvent(new Event("online"));
  win.dispatchEvent(new Event("focus"));
  assert.equal(count, 5);
  stop();
  t.mock.timers.tick(120000);
  win.dispatchEvent(new Event("pageshow"));
  assert.equal(count, 5);
});

test("Overlapping refreshes for one user share one import and release the lock afterwards", async (t) => {
  const calls = mockPipeline(t);
  const db = fixture();
  const [first, second] = await Promise.all([refreshRecentData(db, "u"), refreshRecentData(db, "u", true)]);
  assert.deepEqual(first, second);
  assert.equal(calls.filter((call) => call === "metrics").length, 1);
  await refreshRecentData(db, "u", true);
  assert.equal(calls.filter((call) => call === "metrics").length, 2);
});
