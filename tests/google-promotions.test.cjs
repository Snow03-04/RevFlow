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
    UrlFetchApp: { fetch(url, options) { sent.push(JSON.parse(options.payload)); return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ ok: true, campaignRows: 1, collectionLinks: 1, grossSpendImported: true }) }; } },
  };
  const script = buildGoogleAdsScript({ userId: "u", storeId: "s", storeName: "Test", localEndpoint: "", credits: [{ valor: 874.25, inicio: "2026-09-12" }] });
  vm.runInNewContext(script + "\nmain();", ctx);
  assert.equal(sent[0].days.find(d => d.date === "2026-09-20").cost, 0);
  assert.equal(sent[0].campaigns[0].cost, 0);
  assert.equal(sent[0].campaigns[0].grossCost, 146.37);
  assert.equal(sent[0].campaigns[0].conversionValue, 300);
  unavailable = true;
  assert.throws(() => vm.runInNewContext("main();", ctx), /Importação interrompida/);
  assert.equal(sent.length, 1);
});
