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
