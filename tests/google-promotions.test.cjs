process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-only";
process.env.TOKEN_ENCRYPTION_KEY = "11".repeat(32);
require("../scripts/register-ts.cjs");
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { applyGooglePromotions } = require("../src/lib/google/promotional-credits.ts");
const { buildGoogleAdsScript } = require("../src/lib/google/script.ts");
const now = "2026-09-20 18:10:00";
const promo = {
  resourceName: "customers/1234567890/appliedIncentives/test", incentiveState: "REWARD_GRANTED",
  rewardGrantDateTime: "2026-09-12 11:36:35.861", rewardExpirationDateTime: "2026-11-10 08:00:00",
  currencyCode: "EUR", grantedAmountMicros: "874250000", rewardBalanceRemainingMicros: "132040000",
};
const apply = (cost, p = promo, at = now) => applyGooglePromotions(cost, [{ appliedIncentive: p }], "EUR", at);
const exhausted = { ...promo, rewardBalanceRemainingMicros: "0" };
const settlement = { promotionId: promo.resourceName, currency: "EUR", exhaustedOn: "2026-09-21",
  creditAtStartOfDay: 91.57, adjustments: { "2026-09-21": 0.08 } };

test("Reconciled exhaustion keeps funded history free, charges only the transition remainder and automatically charges later days", () => {
  const costs = { "2026-09-11": 40, "2026-09-12": 0, "2026-09-19": 260.301985,
    "2026-09-20": 186.923058, "2026-09-21": 117.90, "2026-09-22": 50, "2026-09-23": 80 };
  const reconcile = (input) => applyGooglePromotions(input, [{ appliedIncentive: exhausted }], "EUR", "2026-09-23 17:00:00", [settlement]).paid;
  const result = reconcile(costs);
  assert.equal(result["2026-09-11"], 40);
  assert.equal(result["2026-09-19"], 0);
  assert.equal(result["2026-09-20"], 0);
  assert.equal(Number(result["2026-09-21"].toFixed(2)), 26.25);
  assert.equal(result["2026-09-22"], 50);
  assert.equal(result["2026-09-23"], 80);
  assert.deepEqual(reconcile(costs), result);
  const updated = reconcile({ ...costs, "2026-09-20": 190, "2026-09-21": 140 });
  assert.equal(updated["2026-09-20"], 0);
  assert.equal(Number(updated["2026-09-21"].toFixed(2)), 48.35);
  assert.equal(reconcile({ "2026-09-21": 90 })["2026-09-21"], 0);
});

test("Billing reconciliation is bound to the exact promotion, currency, exhausted balance and valid dates", () => {
  for (const bad of [
    { ...settlement, promotionId: "another-account" }, { ...settlement, currency: "USD" },
    { ...settlement, exhaustedOn: "2026-09-10" }, { ...settlement, exhaustedOn: "2026-09-31" },
    { ...settlement, exhaustedOn: "2026-10-01" }, { ...settlement, creditAtStartOfDay: 900 },
    { ...settlement, creditAtStartOfDay: -1 }, { ...settlement, adjustments: { "2026-09-21": -2 } },
  ]) assert.throws(() => applyGooglePromotions({ "2026-09-21": 120 }, [{ appliedIncentive: exhausted }], "EUR", "2026-09-21 18:00:00", [bad]));
  assert.throws(() => applyGooglePromotions({ "2026-09-21": 120 }, [{ appliedIncentive: promo }], "EUR", "2026-09-21 18:00:00", [settlement]));
  assert.throws(() => applyGooglePromotions({ "2026-09-21": 120 }, [{ appliedIncentive: exhausted }], "EUR", "2026-09-21 18:00:00", [settlement, settlement]));
});

test("A new promotion still covers future spend after a previous credit has ended", () => {
  const next = { ...promo, resourceName: promo.resourceName + "-next", rewardGrantDateTime: "2026-09-22 00:00:00" };
  const result = applyGooglePromotions({ "2026-09-21": 117.90, "2026-09-23": 100 },
    [{ appliedIncentive: exhausted }, { appliedIncentive: next }], "EUR", "2026-09-23 18:00:00", [settlement]);
  assert.equal(result.paid["2026-09-23"], 0);
  assert.equal(Number(result.paid["2026-09-21"].toFixed(2)), 26.25);
});

test("Google's available balance covers eligible ads without spending credit against unbilled served cost", () => {
  const costs = { "2026-08-20": 101.29, "2026-09-12": 0, "2026-09-15": 800, "2026-09-20": 200 };
  const result = apply(costs);
  assert.deepEqual(result.paid, { "2026-08-20": 101.29, "2026-09-12": 0, "2026-09-15": 0, "2026-09-20": 0 });
  assert.equal(costs["2026-09-15"], 800);
  assert.equal(result.promotions[0].remaining, 132.04);
  assert.equal(result.promotions[0].grantedAt, "2026-09-12 11:36:35");
});

test("Unfulfilled offers never pay for ads; exhausted and partial-day credits require billing reconciliation", () => {
  assert.deepEqual(applyGooglePromotions({ "2026-09-20": 100 }, [{ appliedIncentive: { incentiveState: "FULFILLING" } }], "EUR", now).paid, { "2026-09-20": 100 });
  assert.throws(() => apply({ "2026-09-15": 10 }, { ...promo, rewardBalanceRemainingMicros: "0" }), /Faturação/);
  assert.throws(() => apply({ "2026-09-12": 10 }), /parte do dia/);
  assert.throws(() => apply({ "2026-11-10": 10 }, promo, "2026-11-11 12:00:00"), /parte do dia/);
  assert.equal(apply({ "2026-11-11": 20 }, promo, "2026-11-11 12:00:00").paid["2026-11-11"], 20);
  assert.equal(apply({ "2026-11-10": 20 }, promo, "2026-11-10 07:00:00").paid["2026-11-10"], 0);
});

test("Missing balances, inconsistent amounts and currencies cannot turn cash expenses into zero", () => {
  for (const invalid of [{ ...promo, rewardBalanceRemainingMicros: undefined }, { ...promo, rewardBalanceRemainingMicros: "9999999999" }, { ...promo, currencyCode: "USD" }, { ...promo, rewardGrantDateTime: "unknown" }]) {
    assert.throws(() => apply({ "2026-09-20": 10 }, invalid), /Despesas não atualizadas/);
  }
});

test("The installed script reads promotions every run, imports net expenses and preserves gross campaign metrics", () => {
  const sent = [];
  let unavailable = false;
  const iterator = (rows) => { let i = 0; return { hasNext: () => i < rows.length, next: () => rows[i++] }; };
  const ctx = {
    Date: class extends Date { constructor(...args) { super(...(args.length ? args : [now.replace(" ", "T") + "Z"])); } },
    Utilities: { formatDate: (d, tz, format) => format.includes("HH") ? now : d.toISOString().slice(0, 10) },
    Logger: { log() {} },
    AdsApp: { currentAccount: () => ({ getTimeZone: () => "UTC", getCurrencyCode: () => "EUR", getCustomerId: () => "1234567890" }), search(q) {
      if (q.includes("FROM applied_incentive")) { if (unavailable) throw Error("Not allowed"); return iterator([{ appliedIncentive: promo }]); }
      if (q.includes("FROM customer")) return iterator([{ segments: { date: "2026-09-20" }, metrics: { costMicros: 146370000 } }]);
      if (q.includes("metrics.cost_micros") && q.includes("FROM campaign")) return iterator([{ campaign: { id: "42", name: "Test", status: "ENABLED" }, segments: { date: "2026-09-20" }, metrics: { costMicros: 146370000, conversionsValue: 300 } }]);
      return iterator([]);
    } },
    UrlFetchApp: { fetch(url, options) { sent.push({ ...JSON.parse(options.payload), url }); return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ ok: true, campaignRows: 1, collectionLinks: 1, grossSpendImported: true }) }; } },
  };
  const script = buildGoogleAdsScript({ userId: "u", storeId: "s", storeName: "Test", localEndpoint: "", credits: [{ valor: 874.25, inicio: "2026-09-12" }] });
  vm.runInNewContext(script + "\nmain();", ctx);
  assert.equal(sent[0].days.find(d => d.date === "2026-09-20").cost, 0);
  assert.equal(sent[0].campaigns[0].cost, 0);
  assert.equal(sent[0].campaigns[0].grossCost, 146.37);
  assert.equal(sent[0].campaigns[0].conversionValue, 300);
  unavailable = true;
  vm.runInNewContext("main();", ctx);
  assert.equal(sent.length, 2);
  assert.match(sent[1].url, /\/api\/google\/script-gross-costs$/);
  assert.equal(sent[1].campaigns[0].grossCost, 146.37);
  // Exhausted promotions follow the same separate route; no gross cost is ever
  // submitted to the endpoint that books cash expenses, even on legacy servers.
  unavailable = false;
  const originalRemaining = promo.rewardBalanceRemainingMicros;
  promo.rewardBalanceRemainingMicros = "0";
  try {
    vm.runInNewContext("main();", ctx);
    assert.match(sent[2].url, /\/script-gross-costs$/);
  } finally { promo.rewardBalanceRemainingMicros = originalRemaining; }
});

test("Generated script resumes the paid endpoint after reconciliation and keeps local and online identities isolated", () => {
  const sent = [];
  let day = "2026-09-21";
  const iterator = (rows) => { let i = 0; return { hasNext: () => i < rows.length, next: () => rows[i++] }; };
  const ctx = {
    Date: class extends Date { constructor(...args) { super(...(args.length ? args : [day + "T18:00:00Z"])); } },
    Utilities: { formatDate: (d, tz, format) => format.includes("HH") ? day + " 18:00:00" : d.toISOString().slice(0, 10) },
    Logger: { log() {} },
    AdsApp: { currentAccount: () => ({ getTimeZone: () => "UTC", getCurrencyCode: () => "EUR", getCustomerId: () => "1234567890" }), search(q) {
      if (q.includes("FROM applied_incentive")) return iterator([{ appliedIncentive: exhausted }]);
      const data = [["2026-09-20", 186920000], ["2026-09-21", 117900000], ...(day === "2026-09-22" ? [[day, 50000000]] : [])];
      if (q.includes("FROM customer")) return iterator(data.map(([date, costMicros]) => ({ segments: { date }, metrics: { costMicros } })));
      if (q.includes("metrics.cost_micros") && q.includes("FROM campaign")) return iterator(data.map(([date, costMicros]) => ({ campaign: { id: "42", name: "Baskets", status: "ENABLED" }, segments: { date }, metrics: { costMicros } })));
      return iterator([]);
    } },
    UrlFetchApp: { fetch(url, opts) { sent.push({ url, ...JSON.parse(opts.payload) }); return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ ok: true, campaignRows: 3, collectionLinks: 1, grossSpendImported: true }) }; } },
  };
  const script = buildGoogleAdsScript({ userId: "online-user", storeId: "online-store", storeName: "Store", billingReconciliations: [settlement],
    localEndpoint: "https://local.example/api/google/script-costs", localIdentity: { user: "local-user", store: "local-store", token: "local-scoped-token" } });
  vm.runInNewContext(script + "\nmain();", ctx);
  assert.equal(sent[0].days.find(d => d.date === "2026-09-21").cost, 26.25);
  assert.equal(sent[0].days.find(d => d.date === "2026-09-20").cost, 0);
  assert.equal(sent[0].campaigns.find(c => c.date === "2026-09-21").cost, 26.25);
  assert.equal(sent[0].campaigns.find(c => c.date === "2026-09-21").grossCost, 117.9);
  assert.equal(sent[0].user, "online-user"); assert.equal(sent[1].user, "local-user");
  assert.equal(sent[1].store, "local-store"); assert.equal(sent[1].token, "local-scoped-token");
  assert.notEqual(sent[0].token, sent[1].token);
  day = "2026-09-22";
  vm.runInNewContext("main();", ctx);
  assert.match(sent[2].url, /\/script-costs$/);
  assert.equal(sent[2].days.find(d => d.date === day).cost, 50);
  assert.equal(sent[2].days.find(d => d.date === "2026-09-21").cost, 26.25);
});
