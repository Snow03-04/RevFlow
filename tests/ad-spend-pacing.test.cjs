require("../scripts/register-ts.cjs");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
const { googleDailyForecast } = require("../src/lib/google/daily-budget.ts");
const { sumPacing, pacingFraction } = require("../src/lib/ads/pacing.ts");
const row = (id, amount, startDate, status = "ELIGIBLE", period = "DAILY") => ({ campaign: { startDate, primaryStatus: status }, campaignBudget: { resourceName: id, amountMicros: amount * 1e6, period } });

test("first-day prediction is doubled only on that campaign's start date", () => {
  const rows = [row("new", 100, "2026-11-25"), row("old", 80, "2026-11-24")];
  assert.deepEqual(googleDailyForecast(rows, "2026-11-25"), { budget: 180, forecast: 280, firstDayExtra: 100 });
  assert.deepEqual(googleDailyForecast(rows, "2026-11-26"), { budget: 180, forecast: 180, firstDayExtra: 0 });
  assert.deepEqual(googleDailyForecast([row("new", 20, "20261125")], "2026-11-25"), { budget: 20, forecast: 40, firstDayExtra: 20 });
});
test("shared budgets count once, including a new campaign sharing an existing budget", () => {
  assert.deepEqual(googleDailyForecast([row("shared", 100, "2026-11-20"), row("shared", 100, "2026-11-25")], "2026-11-25"), { budget: 100, forecast: 200, firstDayExtra: 100 });
});
test("future, ended and paused campaigns do not inflate today's forecast; missing evidence is unknown", () => {
  const rows = [row("future", 80, "2026-11-26"), row("paused", 100, "2026-11-25", "PAUSED"), { ...row("ended", 20, "2026-11-01"), campaign: { startDate: "2026-11-01", endDate: "2026-11-24" } }];
  assert.equal(googleDailyForecast(rows, "2026-11-25").forecast, 0);
  assert.equal(googleDailyForecast([row("unknown", 100)], "2026-11-25").forecast, null);
  assert.equal(googleDailyForecast([row("life", 100, "2026-11-25", "ELIGIBLE", "CUSTOM_PERIOD")], "2026-11-25").forecast, null);
});
test("participation scales spend and forecast equally; store view remains the full store", () => {
  const accounts = [{ storeId: "a", spent: 100, forecast: 200, firstDayExtra: 50, observedAt: "2026-11-25T12:00:00Z" }, { storeId: "b", spent: 30, forecast: 100, firstDayExtra: 0, observedAt: "2026-11-25T11:00:00Z" }];
  const total = sumPacing(accounts, new Map([["a", 50], ["b", 0]]));
  assert.deepEqual(total, { status: "ready", spent: 50, forecast: 100, firstDayExtra: 25, updatedAt: "2026-11-25T12:00:00Z" });
  assert.equal(pacingFraction(total), .5);
  assert.equal(sumPacing(accounts, new Map([["a", 50]]), "a").spent, 100);
  assert.equal(sumPacing([{ ...accounts[0], forecast: null }]).status, "pending");
  assert.equal(pacingFraction(sumPacing([{ ...accounts[0], forecast: 0 }])), null);
  assert.equal(pacingFraction(sumPacing([{ ...accounts[0], forecast: 20 }])), 1);
  assert.equal(sumPacing([]).status, "empty");
});

const filename = path.resolve(__dirname, "../src/components/live/globe/engine/ad-spend.js");
const compiled = new Module(filename, module); compiled.filename = filename; compiled.paths = module.paths;
compiled._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, filename);
const { paintAdSpend } = compiled.exports;
test("globe privacy removes actual text, percentages and accessible numbers and restores them when off", () => {
  const nodes = new Map();
  const root = { querySelector(key) { if (!nodes.has(key)) nodes.set(key, { hidden: false, textContent: "", style: {}, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; } }); return nodes.get(key); } };
  const total = { status: "ready", spent: 150, forecast: 300 };
  const input = { report: { day: "2026-11-25", full: total, stores: { a: { ...total, spent: 30 } } }, store: "all", day: "2026-11-25", replaying: false, privateNumbers: false, formatMoney: v => `€${v}` };
  paintAdSpend(root, input);
  assert.equal(nodes.get("#ad-progress-values").textContent, "€150 / €300 previstos");
  paintAdSpend(root, { ...input, privateNumbers: true });
  assert.equal(nodes.get("#ad-progress-values").textContent, "");
  assert.equal(nodes.get("#ad-progress-values").hidden, true);
  assert.deepEqual(nodes.get("#ad-progress-track").attrs, { role: "img" });
  assert.equal(nodes.get("#ad-progress-fill").style.width, "50%");
  paintAdSpend(root, { ...input, store: "a" });
  assert.equal(nodes.get("#ad-progress-values").textContent, "€30 / €300 previstos");
  paintAdSpend(root, { ...input, replaying: true });
  assert.equal(nodes.get("#ad-progress").hidden, true);
  paintAdSpend(root, { ...input, day: "2026-11-26" });
  assert.equal(nodes.get("#ad-progress-values").textContent, "");
  assert.equal(nodes.get("#ad-progress-track").attrs["aria-valuenow"], undefined);
});
