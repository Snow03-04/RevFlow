process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-only";
process.env.TOKEN_ENCRYPTION_KEY = "11".repeat(32);
require("../scripts/register-ts.cjs");
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { memoryDb } = require("./helpers/memory-db.cjs");
const { readCampaignChanges, compareGoogleCampaignChanges } = require("../src/lib/google/change-events.ts");
const { buildGoogleAdsScript } = require("../src/lib/google/script.ts");
const { saveGoogleChanges, ScriptCampaignChange } = require("../src/lib/google/change-history.ts");
const { getGoogleSignals } = require("../src/lib/trackers/google-signals-query.ts");
const { calculateGoogleScale } = require("../src/lib/trackers/google-scale.ts");
const { renderToStaticMarkup } = require("react-dom/server");
const { createElement } = require("react");
const { GoogleCampaignSignals } = require("../src/components/trackers/google-campaign-signals.tsx");

const event = (id, patch = {}) => ({ changeEvent: {
  resourceName: `customers/123/changeEvents/creation-${id}`, changeDateTime: "2026-09-14 12:00:00",
  resourceChangeOperation: "CREATE", changeResourceType: "CAMPAIGN",
  changeResourceName: `customers/123/campaigns/${id}`,
  changedFields: "name,status,campaign_budget,target_roas", ...patch,
} });
const fees = () => ({ feeFb: 0, feeGoogle: 0, txFee: 0, paymentPct: 0 });

test("The generated Ads script and API reader preserve real campaign creations with their original dates", () => {
  const events = [event("42"), event("43", { campaign: "customers/123/campaigns/43", changedFields: undefined }),
    event("99", { changeResourceType: "CAMPAIGN_BUDGET", changeResourceName: "budget1", changedFields: "amount_micros" }),
    event("99", { changeResourceType: "AD_GROUP" }), event("99", { resourceChangeOperation: "REMOVE" }),
    event("invalid"), event("99", { changeDateTime: undefined })];
  const expected = readCampaignChanges(events, { budget1: ["42", "43"] });
  assert.equal(expected.length, 2);
  assert.deepEqual(expected.map(c => c.campaignId), ["42", "43"]);
  for (const change of expected) {
    assert.equal(change.changedAt, "2026-09-14 12:00:00");
    assert.equal(change.kind, "campaign");
    assert.ok(change.eventId.startsWith("created:customers/123/changeEvents/"));
    assert.equal(ScriptCampaignChange.safeParse(change).success, true);
  }
  const context = {};
  vm.runInNewContext(buildGoogleAdsScript({ userId: "u", storeId: "s", storeName: "Test" }), context);
  assert.deepEqual(JSON.parse(JSON.stringify(context.readCampaignChanges(events, { budget1: ["42", "43"] }))), expected);
});

test("Creation import unlocks both ROAS regardless of campaign name; later edits reset only that campaign", async (t) => {
  t.mock.method(require("../src/lib/date.ts"), "todayYmd", () => "2026-09-20");
  t.mock.method(require("../src/lib/trackers/sales.ts"), "fetchTrackerOrderSales", async () => [
    { id: "sale", storeId: "s", date: "2026-09-18", grossRevenue: 200, refunds: 0,
      items: [{ productId: "p", weight: 200, units: 2, cost: 60 }] },
    { id: "before", storeId: "s", date: "2026-09-14", grossRevenue: 99999, refunds: 0,
      items: [{ productId: "p", weight: 99999, units: 2, cost: 60 }] },
  ]);
  t.mock.method(require("../src/lib/queries.ts"), "getStoreFxRates", async () => new Map());
  const pnl = require("../src/lib/trackers/queries.ts");
  t.mock.method(pnl, "getPnlSettings", async () => ({ currency: "EUR", agency_fee_fb: 0, agency_fee_google: 0, transaction_fee: 0, payment_fee_pct: 0 }));
  t.mock.method(pnl, "getPnlYear", async () => ({ overrides: [] }));
  t.mock.method(require("../src/lib/fx.ts"), "resolveFx", async () => 1);
  const campaigns = [{ id: "42", name: "BASKETS 14/09" }, { id: "43", name: "BASKETS 14/09 #2" }];
  const db = memoryDb({
    google_connections: [{ user_id: "u", id: "conn", customer_id: "123", shopify_connection_id: "s" }],
    shopify_connections: [{ user_id: "u", id: "s", shop_name: "Test", shop_domain: "test.myshopify.com" }],
    products: [{ user_id: "u", handle: "coat", shopify_product_id: "p", shopify_connection_id: "s" }],
    campaign_links: campaigns.map(c => ({ user_id: "u", campaign_id: `google:s:123:${c.id}`, product_handle: "coat", link_kind: "google-auto" })),
    google_campaigns: campaigns.flatMap(c => Array.from({ length: 7 }, (_, i) => ({
      user_id: "u", google_connection_id: "conn", campaign_id: c.id, campaign_name: c.name,
      status: "ENABLED", date: `2026-09-${14 + i}`, updated_at: "2026-09-20T10:00:00Z",
      gross_spend: i === 0 || i === 6 ? 1000 : 10, purchase_value: i === 0 || i === 6 ? 99999 : 25, purchases: 2,
    }))),
  });
  const request = { userId: "u", storeId: "s", customerId: "123", currency: "EUR", changes: readCampaignChanges(campaigns.map(c => event(c.id)), {}) };
  await saveGoogleChanges(db, request);
  await saveGoogleChanges(db, request);
  assert.equal(db.tables.google_campaign_changes.length, 2);
  const before = await getGoogleSignals(db, "u", "EUR");
  for (const c of campaigns) {
    const signal = before.signals.get(`s:123:${c.id}`);
    assert.equal(signal.referenceKind, "creation");
    assert.deepEqual(signal.range, { from: "2026-09-15", to: "2026-09-19" });
    assert.equal(signal.google.roas, 2.5);
    assert.equal(signal.shopify.roas, 4);
    assert.equal(signal.google.level, "scale");
    assert.equal(signal.shopify.level, "ready");
    const html = renderToStaticMarkup(createElement(GoogleCampaignSignals, { signal,
      changes: before.changes.filter(e => e.campaign_key === `s:123:${c.id}`), today: "2026-09-20", currency: "€", expanded: true }));
    assert.match(html, /ROAS desde a criação/);
    assert.match(html, /Campanha criada há 6 dias/);
    assert.doesNotMatch(html, /Campanha modificada|ROAS desde a última alteração/);
  }
  for (const row of db.tables.google_campaigns) row.campaign_name = row.campaign_name.replace("BASKETS", "NOVO NOME").replace(" #2", "");
  const renamed = await getGoogleSignals(db, "u", "EUR");
  assert.deepEqual([...renamed.signals], [...before.signals]);
  await saveGoogleChanges(db, { ...request, changes: readCampaignChanges([event("42", {
    resourceName: "customers/123/changeEvents/edit42", resourceChangeOperation: "UPDATE",
    changeDateTime: "2026-09-17 15:00:00", changedFields: "status",
  })], {}) });
  const after = await getGoogleSignals(db, "u", "EUR");
  assert.equal(after.signals.get("s:123:42").referenceKind, "change");
  assert.deepEqual(after.signals.get("s:123:42").range, { from: "2026-09-18", to: "2026-09-19" });
  assert.equal(after.signals.get("s:123:42").shopify.roas, 10);
  assert.equal(after.signals.get("s:123:42").google.level, null);
  assert.deepEqual(after.signals.get("s:123:43"), before.signals.get("s:123:43"));
});

test("Creation never invents missing daily coverage or a reference for campaigns without history", () => {
  const opts = { range: { from: "2026-09-15", to: "2026-09-19" }, lastChangedAt: "2026-09-14T12:00:00", referenceKind: "creation",
    status: "ENABLED", storeId: "s", rate: 1, orders: [], productIds: [], scope: "coat", shared: false, fees,
    facts: [{ date: "2026-09-19", grossSpend: 10, conversionValue: 25, conversions: 1 }] };
  const incomplete = calculateGoogleScale(opts);
  assert.equal(incomplete.google.roas, null);
  assert.match(incomplete.reason, /Dados incompletos desde a criação \(1\/5 dias\)/);
  const fresh = calculateGoogleScale({ ...opts, lastChangedAt: "2026-09-19T12:00:00" });
  assert.match(fresh.reason, /primeiro dia completo após a criação/);
  const unknown = calculateGoogleScale({ ...opts, lastChangedAt: undefined });
  assert.equal(unknown.google.roas, null);
  assert.equal(unknown.referenceKind, undefined);
  assert.match(unknown.reason, /Sem criação ou alteração importada/);
  const creation = { event_id: "created:event", changed_at: "2026-09-14T12:00:00" };
  const edit = { event_id: "edit", changed_at: creation.changed_at };
  assert.deepEqual([creation, edit].sort(compareGoogleCampaignChanges), [edit, creation]);
});
