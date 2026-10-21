process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-only";
require("../scripts/register-ts.cjs");
const test = require("node:test");
const assert = require("node:assert/strict");
const { memoryDb } = require("./helpers/memory-db.cjs");
const { syncMetaCampaigns } = require("../src/lib/meta/sync.ts");
const { graphPaginate } = require("../src/lib/meta/client.ts");

const range = { from: "2026-10-20", to: "2026-10-21" };
const ctx = (db) => ({ supabase: db, userId: "u", connectionId: "m", adAccountId: "act_1", token: "test-only", fxToStore: 2 });
const insight = (campaign_id, date_start, fields = {}) => ({ campaign_id, campaign_name: campaign_id, date_start, ...fields });

test("Delivery stays authoritative when Meta conversion reports return zero spend; join campaigns and dates across all pages", async (t) => {
  const db = memoryDb({ campaigns: [
    { id: "old", user_id: "u", meta_connection_id: "m", campaign_id: "inactive", campaign_name: "Inactive", date: range.from, spend: 99 },
    { id: "other", user_id: "other-user", meta_connection_id: "m", campaign_id: "a", date: range.from, spend: 77 },
  ] });
  t.mock.method(global, "fetch", async (url) => {
    const u = new URL(url), fields = u.searchParams.get("fields");
    const conversion = fields.includes("actions");
    // Reproduce the provider regression without letting a combined query pass.
    if (conversion && fields.includes("spend")) return Response.json({ data: [insight("a", range.from, { spend: "0" })] });
    if (u.searchParams.has("after")) return Response.json({ data: conversion
      ? [insight("conversion-only", range.to, { spend: "0", actions: [{ action_type: "purchase", value: "1" }], action_values: [{ action_type: "purchase", value: "30" }] })]
      : [insight("a", range.to, { spend: "6", impressions: "60", clicks: "3" })] });
    u.searchParams.set("after", "page2");
    return Response.json({ paging: { next: u.toString() }, data: conversion
      ? [insight("a", range.to, { spend: "0", impressions: "0", actions: [{ action_type: "purchase", value: "2" }], action_values: [{ action_type: "purchase", value: "50" }] }),
         insight("a", range.from, { spend: "0", actions: [{ action_type: "purchase", value: "3" }], action_values: [{ action_type: "purchase", value: "80" }] })]
      : [insight("a", range.from, { spend: "10", impressions: "100", clicks: "5", cpm: "100", cpc: "2" }), insight("delivery-only", range.from, { spend: "4" })] });
  });
  await syncMetaCampaigns(ctx(db), range);
  const owned = db.tables.campaigns.filter(r => r.user_id === "u");
  const a = owned.find(r => r.campaign_id === "a" && r.date === range.from);
  assert.equal(a.spend, 20);
  assert.equal(a.impressions, 100);
  assert.equal(a.clicks, 5);
  assert.equal(a.cpc, 4);
  assert.equal(a.purchases, 3);
  assert.equal(a.purchase_value, 160);
  const second = owned.find(r => r.campaign_id === "a" && r.date === range.to);
  assert.equal(second.spend, 12);
  assert.equal(second.purchase_value, 100);
  assert.equal(owned.find(r => r.campaign_id === "delivery-only" && r.date === range.from).spend, 8);
  const conversionOnly = owned.find(r => r.campaign_id === "conversion-only" && r.date === range.to);
  assert.equal(conversionOnly.spend, 0);
  assert.equal(conversionOnly.purchase_value, 60);
  assert.ok(owned.filter(r => r.campaign_id === "inactive").every(r => r.spend === 0));
  assert.equal(db.tables.campaigns.find(r => r.user_id === "other-user").spend, 77);
  const before = structuredClone(db.tables.campaigns);
  await syncMetaCampaigns(ctx(db), range);
  assert.deepEqual(db.tables.campaigns, before);
});

test("A failed or incomplete page in either report preserves the entire previous snapshot", async (t) => {
  for (const broken of ["delivery", "conversions"]) {
    for (const status of [200, 500]) {
      const db = memoryDb({ campaigns: [{ id: "saved", user_id: "u", meta_connection_id: "m", campaign_id: "a", date: range.from, spend: 42 }] });
      const before = structuredClone(db.tables.campaigns);
      const mock = t.mock.method(global, "fetch", async (url) => {
        const u = new URL(url), report = u.searchParams.get("fields").includes("actions") ? "conversions" : "delivery";
        if (report === broken && u.searchParams.has("after")) return Response.json({}, { status });
        u.searchParams.set("after", "page2");
        return Response.json({ data: [insight("a", range.from, { spend: "9" })], ...(report === broken ? { paging: { next: u.toString() } } : {}) });
      });
      await assert.rejects(syncMetaCampaigns(ctx(db), range), /incomplete response/);
      assert.deepEqual(db.tables.campaigns, before);
      assert.equal(db.writes.length, 0);
      mock.mock.restore();
    }
  }
});

test("A valid empty report remains valid, while a non-success HTTP response cannot be an empty report", async (t) => {
  const mock = t.mock.method(global, "fetch", async () => Response.json({ data: [] }));
  assert.deepEqual((await graphPaginate("act_1/insights", {}).next()).value, []);
  mock.mock.mockImplementation(async () => Response.json({ data: [] }, { status: 500 }));
  await assert.rejects(graphPaginate("act_1/insights", {}).next(), /incomplete response/);
});
