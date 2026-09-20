process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-only";
process.env.TOKEN_ENCRYPTION_KEY = "11".repeat(32);
require("../scripts/register-ts.cjs");
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { memoryDb } = require("./helpers/memory-db.cjs");
const { googleOrderCampaign, allocateGooglePnl, summariseGooglePnl } = require("../src/lib/trackers/google-pnl.ts");
const { googleLabelStore } = require("../src/lib/google/store-labels.ts");
const { scriptCampaignId, saveScriptCampaigns } = require("../src/lib/google/script-campaigns.ts");
const { getGooglePnlCatalog, getGooglePnlDays } = require("../src/lib/trackers/google-pnl-query.ts");
const { syncStoreName } = require("../src/lib/shopify/store-name.ts");
const { buildGoogleAdsScript } = require("../src/lib/google/script.ts");
const { pnlUrl } = require("../src/lib/trackers/pnl-navigation.ts");
const { buildGoogleCollections, summariseCollection } = require("../src/lib/trackers/google-collections.ts");
const { collectionFromUrls, saveGoogleCollectionLinks } = require("../src/lib/google/collection-links.ts");
const store = "11111111-1111-1111-1111-111111111111";
const otherStore = "22222222-2222-2222-2222-222222222222";
const date = "2026-09-19";
const campaign = { key: "c1", campaignId: "42", name: "Brand", storeId: store, rate: 2 };
const fees = () => ({ feeFb: 0.5, feeGoogle: 0.1, txFee: 0.3, paymentPct: 0.025 });

test("Google attribution requires an exact unique campaign; gclid/ambiguous names cannot invent sales", () => {
  assert.equal(googleOrderCampaign("/?gclid=abc", [campaign]), null);
  assert.equal(googleOrderCampaign("/?gad_campaignid=42", [campaign]), campaign);
  assert.equal(googleOrderCampaign("/?utm_campaign=Brand", [campaign]), campaign);
  assert.equal(googleOrderCampaign("/?utm_campaign=Brand", [campaign, { ...campaign, key: "c2", campaignId: "43" }]), null);
  assert.equal(googleOrderCampaign("/?gad_campaignid=43&utm_campaign=Brand", [campaign]), null);
});

test("Google economics use Shopify costs/refunds, preserve store FX and Google-specific fees", () => {
  const rows = allocateGooglePnl([campaign], [{ key: "c1", date, spend: 20, grossSpend: 20, conversions: 1, conversionValue: 80, clicks: 10, impressions: 100 }],
    [{ storeId: store, date, landingSite: "/?gad_campaignid=42", grossRevenue: 100, refunds: 10, cost: 30 }]);
  const s = summariseGooglePnl(rows, fees);
  assert.equal(s.input.orders, 1);
  assert.equal(s.net, 180);
  assert.equal(s.input.cogs, 60);
  assert.equal(s.input.adspendGoogle, 40);
  assert.equal(s.agencyFees, 4);
  assert.equal(s.paymentFees, 5.3);
  assert.equal(s.profit, 70.7);
  assert.equal(s.conversionValue, 160);
  assert.equal(s.complete, true);
});

test("Unmatched Google orders and missing Shopify evidence remain incomplete, with spend visible", () => {
  const facts = [{ key: "c1", date, spend: 20, conversions: 1, conversionValue: 80, clicks: 10, impressions: 100 }];
  for (const orders of [[], [{ storeId: store, date, landingSite: "/?gclid=unknown", grossRevenue: 200, refunds: 0, cost: 20 }]]) {
    const rows = allocateGooglePnl([campaign], facts, orders);
    assert.equal(rows[0].complete, false);
    assert.equal(rows[0].input.grossRevenue, 0);
    assert.equal(rows[0].input.adspendGoogle, 40);
  }
  const isolated = allocateGooglePnl([campaign], facts, [{ storeId: otherStore, date, landingSite: "/?gad_campaignid=42", grossRevenue: 200, refunds: 0, cost: 20 }]);
  assert.equal(isolated[0].input.orders, 0);
});

test("Script snapshots are idempotent, scoped by store/account/date and clear corrected-away rows without adding dashboard spend", async () => {
  const db = memoryDb({ google_campaigns: [] });
  const c = { id: "42", name: "Brand", date, cost: 20, conversions: 1, conversionValue: 80, clicks: 10, impressions: 100 };
  const opts = { userId: "u", storeId: store, customerId: "123-456-7890", dates: [date], campaigns: [c], fx: 2 };
  await saveScriptCampaigns(db, opts);
  await saveScriptCampaigns(db, opts);
  await saveScriptCampaigns(db, { ...opts, storeId: otherStore });
  assert.equal(db.tables.google_campaigns.length, 2);
  assert.equal(db.tables.google_campaigns[0].spend, 40);
  assert.equal(db.tables.google_campaigns[0].google_connection_id, null);
  await saveScriptCampaigns(db, { ...opts, campaigns: [] });
  assert.equal(db.tables.google_campaigns[0].spend, 0);
  assert.equal(db.tables.google_campaigns[1].spend, 40);
  await assert.rejects(() => saveScriptCampaigns(db, { ...opts, campaigns: [{ ...c, date: "2025-01-01" }] }), /fora das datas/);
});

test("Google catalog deduplicates API+script observations and retains distinct stores with equal campaign IDs", async () => {
  const base = { user_id: "u", date, campaign_name: "Brand", spend: 10, clicks: 1, impressions: 10, purchases: 1, purchase_value: 30, updated_at: "2026-09-19T12:00:00Z" };
  const db = memoryDb({
    shopify_connections: [{ id: store, user_id: "u", shop_name: "A", shop_domain: "a.myshopify.com" }, { id: otherStore, user_id: "u", shop_name: "B", shop_domain: "b.myshopify.com" }],
    google_connections: [{ id: "api", user_id: "u", shopify_connection_id: store, customer_id: "123", customer_name: "Ads" }],
    campaign_links: [{ user_id: "u", campaign_id: `google:${store}:123:42`, collection_handle: "winter", link_kind: "google-manual" }],
    google_campaigns: [{ ...base, id: "a", google_connection_id: "api", campaign_id: "42" }, { ...base, id: "b", google_connection_id: null, campaign_id: scriptCampaignId(store, "123", "42"), spend: 12, updated_at: "2026-09-19T13:00:00Z" }, { ...base, id: "c", google_connection_id: null, campaign_id: scriptCampaignId(otherStore, "456", "42") }, { ...base, user_id: "other-user", id: "d", campaign_id: "99" }],
  });
  const catalog = await getGooglePnlCatalog(db, "u", 2026);
  assert.equal(catalog.options.length, 2);
  assert.equal(catalog.rows.length, 2);
  assert.equal(catalog.rows.find((r) => r.key.startsWith(store)).spend, 12);
  assert.equal(catalog.options.find((r) => r.storeId === store).collectionHandle, "winter");
  assert.equal(catalog.options.find((r) => r.storeId === store).manualCollection, true);
  assert.equal(catalog.options.find((r) => r.storeId === otherStore).collectionHandle, null);
  assert.equal(db.writes.length, 0);
});

test("A Shopify rename refreshes an already named store and preserves historical Google expenses without touching prefix-neighbour stores", async (t) => {
  const shopify = require("../src/lib/shopify/client.ts");
  t.mock.method(shopify, "shopifyGet", async () => ({ data: { shop: { name: "Nova loja" } } }));
  const conn = { id: store, user_id: "u", shop_name: "Ana", shop_domain: "ana.myshopify.com" };
  const neighbor = { id: otherStore, user_id: "u", shop_name: "Ana Maria", shop_domain: "maria.myshopify.com" };
  const db = memoryDb({ shopify_connections: [conn, neighbor], manual_entries: [
    { id: "e1", user_id: "u", label: "Google Ana 42,00", amount: 42 },
    { id: "e2", user_id: "u", label: "Google Ana Maria 31,00", amount: 31 },
    { id: "e3", user_id: "someone-else", label: "Google Ana 10,00", amount: 10 },
  ] });
  await syncStoreName(db, conn, "test-token");
  assert.equal(db.tables.shopify_connections[0].shop_name, "Nova loja");
  assert.equal(db.tables.manual_entries[0].label, "Google Nova loja 42,00");
  assert.equal(db.tables.manual_entries[1].label, "Google Ana Maria 31,00");
  assert.equal(db.tables.manual_entries[2].label, "Google Ana 10,00");
  assert.equal(googleLabelStore(db.tables.manual_entries[0].label, db.tables.shopify_connections), store);
});

test("Generated v5 Google script sends account totals, campaign metrics and ad/Performance Max destinations", () => {
  const iterator = (rows) => { let i = 0; return { hasNext: () => i < rows.length, next: () => rows[i++] }; };
  let sent;
  const context = {
    AdsApp: { currentAccount: () => ({ getTimeZone: () => "UTC", getCurrencyCode: () => "EUR", getCustomerId: () => "123-456-7890" }),
      search: (q) => q.includes("FROM customer") ? iterator([{ segments: { date }, metrics: { costMicros: 25000000 } }])
        : q.includes("FROM applied_incentive") ? iterator([])
        : q.includes("FROM ad_group_ad") ? iterator([{ campaign: { id: "42" }, adGroupAd: { ad: { finalUrls: ["https://store.test/collections/winter"] } } }])
        : q.includes("FROM asset_group") ? iterator([{ campaign: { id: "42" }, assetGroup: { finalUrls: ["https://store.test/collections/winter?source=pmax"] } }])
        : iterator([{ campaign: { id: "42", name: "Brand", status: "ENABLED" }, segments: { date }, metrics: { costMicros: 20000000, impressions: 100, clicks: 10, conversions: 1.5, conversionsValue: 80 } }]) },
    Utilities: { formatDate: (d) => d.toISOString().slice(0, 10) },
    UrlFetchApp: { fetch: (_url, opts) => { sent = JSON.parse(opts.payload); return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ ok: true, campaignRows: 1, collectionLinks: 1 }) }; } },
    Logger: { log() {} },
    Date: class extends Date { constructor(...args) { super(...(args.length ? args : [date + "T12:00:00Z"])); } },
  };
  vm.runInNewContext(buildGoogleAdsScript({ userId: "u", storeId: store, storeName: "Test" }) + "\nmain();", context);
  assert.equal(sent.days.length, 32);
  assert.equal(sent.days.find((d) => d.date === date).cost, 25);
  assert.equal(sent.campaigns[0].cost, 20);
  assert.equal(sent.version, 5);
  assert.equal(sent.campaigns[0].grossCost, 20);
  assert.equal(sent.campaigns[0].conversions, 1.5);
  assert.equal(sent.campaigns[0].conversionValue, 80);
  assert.equal(sent.store, store);
  assert.equal(sent.targets[0].finalUrls.length, 2);
  assert.equal(collectionFromUrls(sent.targets[0].finalUrls), "winter");
  context.UrlFetchApp.fetch = () => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify({ ok: true }) });
  assert.throws(() => vm.runInNewContext(buildGoogleAdsScript({ userId: "u", storeId: store, storeName: "Test" }) + "\nmain();", context), /nao suporta colecoes v3/);
});

test("Google script uses its configured public receiver while the app runs on localhost", (t) => {
  const previous = process.env.GOOGLE_ADS_SCRIPT_APP_URL;
  t.after(() => { if (previous === undefined) delete process.env.GOOGLE_ADS_SCRIPT_APP_URL; else process.env.GOOGLE_ADS_SCRIPT_APP_URL = previous; });
  process.env.GOOGLE_ADS_SCRIPT_APP_URL = "https://revflow.example/";
  assert.equal(require("../src/lib/google/script.ts").googleScriptEndpoint(), "https://revflow.example/api/google/script-costs");
});

test("Promotional credit is consumed from its real start date and apportioned once across campaigns to exact cents", () => {
  const iterator = (rows) => { let i = 0; return { hasNext: () => i < rows.length, next: () => rows[i++] }; };
  let sent, accountQuery;
  const costs = [["2026-08-01", 800], ["2026-09-18", 50], [date, 100]];
  const context = {
    AdsApp: { currentAccount: () => ({ getTimeZone: () => "UTC", getCurrencyCode: () => "EUR", getCustomerId: () => "1234567890" }),
      search: (q) => {
        if (q.includes("FROM customer")) { accountQuery = q; return iterator(costs.map(([date, cost]) => ({ segments: { date }, metrics: { costMicros: cost * 1e6 } }))); }
        if (q.includes("FROM campaign")) return iterator([...[1, 2, 3].map((id) => ({ campaign: { id: String(id), name: "Campaign " + id }, segments: { date }, metrics: { costMicros: (id === 3 ? 33.34 : 33.33) * 1e6 } })),
          { campaign: { id: "1", name: "Campaign 1" }, segments: { date: "2026-09-18" }, metrics: { costMicros: 50e6 } }]);
        return iterator([]);
      } },
    Utilities: { formatDate: (d) => d.toISOString().slice(0, 10) },
    UrlFetchApp: { fetch: (_url, opts) => { sent = JSON.parse(opts.payload); return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ ok: true, campaignRows: 4, collectionLinks: 3 }) }; } },
    Logger: { log() {} },
    Date: class extends Date { constructor(...args) { super(...(args.length ? args : [date + "T12:00:00Z"])); } },
  };
  const code = buildGoogleAdsScript({ userId: "u", storeId: store, storeName: "Test", credits: [{ valor: 874.25, inicio: "2026-08-01" }] });
  vm.runInNewContext(code + "\nmain();", context);
  assert.match(accountQuery, /2026-08-01/); // read credit consumed before the 32-day export window
  assert.equal(sent.days.find((d) => d.date === "2026-09-18").cost, 0);
  assert.equal(sent.days.find((d) => d.date === date).cost, 75.75);
  assert.equal(sent.campaigns.find((c) => c.date === "2026-09-18").cost, 0);
  assert.equal(sent.campaigns.find((c) => c.date === "2026-09-18").grossCost, 50);
  assert.equal(sent.campaigns.filter((c) => c.date === date).reduce((sum, c) => sum + c.grossCost, 0), 100);
  assert.equal(Math.round(sent.campaigns.filter((c) => c.date === date).reduce((sum, c) => sum + c.cost, 0) * 100), 7575);
  assert.ok(sent.campaigns.every((c) => c.cost >= 0));
  vm.runInNewContext(code, context);
  const unchanged = [{ id: "1", date, cost: 30 }, { id: "2", date, cost: 70 }];
  context.allocatePaidCampaignCosts(unchanged, { [date]: 100 }, { [date]: 100 });
  assert.equal(unchanged[0].cost, 30);
  assert.equal(unchanged[1].cost, 70);
});

test("Finance navigation preserves store and campaign while moving between months and year", () => {
  assert.equal(pnlUrl("store=s&campaign=c&month=9", { view: "dashboard", month: null }, "/finance/google"), "/finance/google?store=s&campaign=c&view=dashboard");
});

const collectionCampaign = { ...campaign, rate: 1, collectionHandle: "winter", storeName: "Store A", accountName: "Google" };
const collectionStores = [{ id: store, name: "Store A", rate: 1 }, { id: otherStore, name: "Store B", rate: 2 }];
const fact = { key: "c1", date, spend: 20, grossSpend: 20, conversions: 1, conversionValue: 100, clicks: 10, impressions: 100 };
const order = { id: "order1", storeId: store, date, landingSite: "/collections/winter?gclid=abc", collectionHandle: "winter", grossRevenue: 100, refunds: 10, cost: 30 };

test("Collection P&L counts a gclid landing sale once across several campaigns and retains supplier COGS/refunds", () => {
  const groups = buildGoogleCollections([collectionCampaign, { ...collectionCampaign, key: "c2", campaignId: "43" }],
    [fact, { ...fact, key: "c2", spend: 10, grossSpend: 10 }], [order], collectionStores);
  assert.equal(groups.length, 1);
  const s = summariseCollection(groups[0].days);
  assert.equal(s.orders, 1);
  assert.equal(s.revenue, 90);
  assert.equal(s.cogs, 30);
  assert.equal(s.spend, 30);
  assert.equal(s.profit, 30);
  assert.equal(s.complete, true);
  assert.equal(s.roas, 3);
  assert.equal(s.breakEven, 1.5);
  assert.equal(groups[0].campaigns.length, 2);
});

test("Equal collection handles and campaign IDs remain store-scoped with separate FX", () => {
  const groups = buildGoogleCollections([collectionCampaign, { ...collectionCampaign, key: "c2", storeId: otherStore, rate: 2 }],
    [fact, { ...fact, key: "c2" }], [order, { ...order, id: "order2", storeId: otherStore }], collectionStores);
  assert.equal(groups.length, 2);
  assert.equal(summariseCollection(groups.find((g) => g.storeId === store).days).profit, 40);
  assert.equal(summariseCollection(groups.find((g) => g.storeId === otherStore).days).profit, 80);
});

test("Unknown campaign spend and missing historical coverage cannot create a false collection profit", () => {
  const unmapped = { ...collectionCampaign, key: "c2", collectionHandle: null };
  const groups = buildGoogleCollections([collectionCampaign, unmapped], [fact, { ...fact, key: "c2", spend: 25 }], [order], collectionStores,
    [{ storeId: store, date, spend: 60 }]);
  const all = summariseCollection(groups.flatMap((g) => g.days));
  assert.equal(all.spend, 60); // 20 mapped + 25 unmapped + 15 missing from snapshot
  assert.equal(all.orders, 1);
  assert.equal(all.complete, false);
  assert.equal(summariseCollection(groups.find((g) => g.handle === "winter").days).complete, false);
  const historic = buildGoogleCollections([collectionCampaign], [fact], [{ ...order, date: "2026-09-01" }], collectionStores);
  assert.equal(historic[0].days.find((d) => d.date === "2026-09-01").complete, false);
  const legacy = buildGoogleCollections([], [], [order], collectionStores, [{ storeId: store, date, spend: 20 }]);
  assert.equal(summariseCollection(legacy.flatMap((g) => g.days)).spend, 20);
  assert.equal(summariseCollection(legacy.flatMap((g) => g.days)).complete, false);
  assert.equal(summariseCollection(legacy.find((g) => g.handle === "winter").days).spendKnown, false);
});

test("Manual collection association validates the session and campaign ownership, and can return to automatic", async (t) => {
  const server = require("../src/lib/supabase/server.ts");
  const queries = require("../src/lib/trackers/google-pnl-query.ts");
  const cache = require("next/cache");
  const db = memoryDb({ campaign_links: [] });
  t.mock.method(server, "getCurrentUser", async () => ({ id: "owner" }));
  t.mock.method(server, "createClient", async () => db);
  t.mock.method(queries, "getGooglePnlCatalog", async () => ({ options: [collectionCampaign] }));
  t.mock.method(cache, "revalidatePath", () => {});
  const { setGoogleCampaignCollection } = require("../src/lib/trackers/google-collection-actions.ts");
  assert.equal((await setGoogleCampaignCollection("someone-else", 2026, "winter")).ok, false);
  assert.equal(db.writes.length, 0);
  assert.equal((await setGoogleCampaignCollection("c1", 2026, "https://store.test/collections/summer")).ok, true);
  assert.equal(db.tables.campaign_links[0].user_id, "owner");
  assert.equal(db.tables.campaign_links[0].collection_handle, "summer");
  assert.equal(db.tables.campaign_links[0].link_kind, "google-manual");
  assert.equal((await setGoogleCampaignCollection("c1", 2026, "")).ok, true);
  assert.equal(db.tables.campaign_links[0].collection_handle, null);
  assert.equal(db.tables.campaign_links[0].link_kind, "google-auto");
  t.mock.method(server, "getCurrentUser", async () => null);
  assert.equal((await setGoogleCampaignCollection("c1", 2026, "winter")).ok, false);
});

test("Campaign IDs can associate product landings, while conflicting collection landings stay incomplete", () => {
  const direct = buildGoogleCollections([collectionCampaign], [fact], [{ ...order, collectionHandle: null, landingSite: "/products/cardigan?gad_campaignid=42" }], collectionStores);
  assert.equal(direct[0].days[0].orders, 1);
  assert.equal(direct[0].days[0].complete, true);
  const conflict = buildGoogleCollections([collectionCampaign], [fact], [{ ...order, collectionHandle: "summer", landingSite: "/collections/summer?gad_campaignid=42" }], collectionStores);
  assert.equal(conflict.length, 2);
  assert.equal(summariseCollection(conflict.flatMap((g) => g.days)).orders, 1);
  assert.ok(conflict.every((g) => !summariseCollection(g.days).complete));
});

test("Collection links require unanimous destinations, respect manual overrides, and never change Meta links", async () => {
  assert.equal(collectionFromUrls(["https://store.test/collections/Winter", "https://store.test/collections/winter?utm_source=google"]), "winter");
  assert.equal(collectionFromUrls(["https://store.test/collections/winter", "https://store.test/collections/summer"]), null);
  assert.equal(collectionFromUrls(["https://store.test/collections/winter", "https://store.test/products/hat"]), null);
  const manualId = `google:${store}:123:43`;
  const db = memoryDb({ campaign_links: [{ user_id: "u", campaign_id: "42", collection_handle: "meta", link_kind: "collection" },
    { user_id: "u", campaign_id: manualId, collection_handle: "chosen", link_kind: "google-manual" }] });
  await saveGoogleCollectionLinks(db, { userId: "u", storeId: store, customerId: "123", targets: [
    { id: "42", finalUrls: ["https://store.test/collections/winter"] },
    { id: "43", finalUrls: ["https://store.test/collections/winter"] },
  ] });
  assert.equal(db.tables.campaign_links.find((r) => r.campaign_id === manualId).collection_handle, "chosen");
  assert.equal(db.tables.campaign_links.find((r) => r.campaign_id === "42").collection_handle, "meta");
  assert.equal(db.tables.campaign_links.find((r) => r.campaign_id === `google:${store}:123:42`).collection_handle, "winter");
});

test("Collection sheet shows identified profit as partial, but hides profit when costs are missing", () => {
  const { renderToStaticMarkup } = require("react-dom/server");
  const { createElement } = require("react");
  const { GoogleCollectionSheet } = require("../src/components/trackers/google-collection-sheet.tsx");
  const [collection] = buildGoogleCollections([collectionCampaign], [fact], [order], collectionStores);
  const props = { collection, year: 2026, month: 9, currency: "€", query: `collection=${collection.key}&store=${store}` };
  const html = renderToStaticMarkup(createElement(GoogleCollectionSheet, props));
  assert.match(html, /Lucro acum\./);
  assert.match(html, /€40\.00/);
  assert.match(html, /Faturação/);
  const annual = renderToStaticMarkup(createElement(GoogleCollectionSheet, { ...props, month: undefined }));
  assert.match(annual, /collection=.*winter.*month=9/);
  const uncertain = renderToStaticMarkup(createElement(GoogleCollectionSheet, { ...props, collection: { ...collection, days: collection.days.map((d) => ({ ...d, complete: false })) } }));
  assert.match(uncertain, /por apurar/);
  assert.match(uncertain, /Lucro identificado · parcial/);
  assert.match(uncertain, /€40\.00/);
  const noCosts = renderToStaticMarkup(createElement(GoogleCollectionSheet, { ...props, collection: { ...collection, days: collection.days.map((d) => ({ ...d, spendKnown: false, complete: false })) } }));
  assert.doesNotMatch(noCosts, /€40\.00/);
});

test("Google Finance counts gross costs despite promotional credit while preserving paid costs for main reports", async () => {
  const f = { ...fact, spend: 0, grossSpend: 50 };
  const [collection] = buildGoogleCollections([collectionCampaign], [f], [order], collectionStores);
  const s = summariseCollection(collection.days);
  assert.equal(s.grossSpend, 50);
  assert.equal(s.credit, 50);
  assert.equal(s.spend, 0);
  assert.equal(s.profit, 10);
  assert.equal(s.margin, 10 / 90);
  assert.equal(s.cpc, 5);
  assert.equal(s.cpm, 500);
  assert.equal(s.roas, 1.8);
  assert.equal(s.googleRoas, 2);
  assert.equal(s.conversions, 1);
  const legacy = summariseCollection(buildGoogleCollections([collectionCampaign], [{ ...f, grossSpend: null }], [order], collectionStores)[0].days);
  assert.equal(legacy.grossSpend, null);
  assert.equal(legacy.credit, null);
  assert.equal(legacy.cpc, null);
  assert.equal(legacy.roas, null);
  assert.equal(legacy.profit, null);
  assert.equal(legacy.margin, null);
  assert.equal(legacy.spendKnown, false);
  const { calcPnlDay } = require("../src/lib/trackers/pnl.ts");
  const campaignRows = allocateGooglePnl([collectionCampaign], [f], [{ ...order, landingSite: "/?gad_campaignid=42" }]);
  const analysis = summariseGooglePnl(campaignRows, fees);
  assert.ok(Math.abs(analysis.profit - 2.2) < 1e-9);
  assert.equal(analysis.agencyFees, 5);
  assert.equal(campaignRows[0].input.adspendGoogle, 0);
  assert.equal(calcPnlDay(campaignRows[0].input, fees()).profit, 57.2);
  const db = memoryDb({google_campaigns: []});
  await saveScriptCampaigns(db, {userId:'u',storeId:store,customerId:'123',dates:[date],fx:2,storeGrossSpend:true,campaigns:[{id:'42',name:'Brand',date,cost:0,grossCost:50,clicks:10,impressions:100,conversions:1,conversionValue:100}]});
  assert.equal(db.tables.google_campaigns[0].spend, 0);
  assert.equal(db.tables.google_campaigns[0].gross_spend, 100);
  assert.equal(db.tables.google_campaigns[0].cpc, 10);
  await saveScriptCampaigns(db, {userId:'u',storeId:store,customerId:'123',dates:[date],fx:2,storeGrossSpend:true,campaigns:[]});
  assert.equal(db.tables.google_campaigns[0].gross_spend, 0);
});

test("Campaign P&L cannot report a profit for orders without imported cost coverage", () => {
  const { renderToStaticMarkup } = require("react-dom/server");
  const { createElement } = require("react");
  const { GooglePnlSheet } = require("../src/components/trackers/google-pnl-sheet.tsx");
  const rows = allocateGooglePnl([collectionCampaign], [], [{ ...order, landingSite: "/?gad_campaignid=42" }]);
  assert.equal(rows[0].spendKnown, false);
  assert.equal(rows[0].complete, false);
  const props = { campaign: collectionCampaign, rows, year: 2026, month: 9, currency: "€", feesByMonth: Array.from({ length: 12 }, fees), query: "" };
  const html = renderToStaticMarkup(createElement(GooglePnlSheet, props));
  assert.match(html, /€90\.00/); // observed Shopify revenue remains visible
  assert.doesNotMatch(html, /€57\.20/); // hypothetical profit cannot stand in for missing ad cost
  assert.match(html, /Gastos ainda sem cobertura importada/);
  const zero = allocateGooglePnl([collectionCampaign], [{ ...fact, spend: 0, grossSpend: 50 }], [{ ...order, landingSite: "/?gad_campaignid=42" }]);
  assert.equal(zero[0].spendKnown, true);
  const covered = renderToStaticMarkup(createElement(GooglePnlSheet, { ...props, rows: zero }));
  assert.match(covered, /€2\.20/);
  assert.doesNotMatch(covered, /€57\.20|Pago após descontos|Créd\.\/ajustes/);
  assert.match(covered, /€50\.00/);
  const legacy = allocateGooglePnl([collectionCampaign], [{ ...fact, spend: 0, grossSpend: null }], [{ ...order, landingSite: "/?gad_campaignid=42" }]);
  assert.equal(summariseGooglePnl(legacy, fees).profit, null);
  const legacyHtml = renderToStaticMarkup(createElement(GooglePnlSheet, { ...props, rows: legacy }));
  assert.doesNotMatch(legacyHtml, /€57\.20/);
  assert.match(legacyHtml, /Gasto bruto ainda não importado/);
});

test("Collection gross losses and cumulative profit survive fully funded days and inactive calendar gaps", () => {
  const { renderToStaticMarkup } = require("react-dom/server");
  const { createElement } = require("react");
  const { GoogleCollectionSheet } = require("../src/components/trackers/google-collection-sheet.tsx");
  const facts = [
    { ...fact, date: "2026-09-02", spend: 0, grossSpend: 50, conversions: 0, conversionValue: 0 },
    { ...fact, date: "2026-09-04", spend: 0, grossSpend: 25, conversions: 0, conversionValue: 0 },
  ];
  const [collection] = buildGoogleCollections([collectionCampaign], facts, [], collectionStores,
    facts.map((f) => ({ storeId: store, date: f.date, spend: 0 })));
  const summary = summariseCollection(collection.days);
  assert.equal(summary.grossSpend, 75);
  assert.equal(summary.profit, -75);
  assert.equal(summary.complete, true); // reconcile paid against paid, not against gross
  const html = renderToStaticMarkup(createElement(GoogleCollectionSheet, { collection, year: 2026, month: 9, currency: "€", query: "" }));
  assert.match(html, /-€75\.00/);
  assert.doesNotMatch(html, /Pago após descontos|Créd\.\/ajustes/);
  const rows = html.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/g);
  assert.match(rows[3], /-€50\.00/); // Sep 3 retains cumulative Sep 2 gross loss
  assert.match(rows[30], /-€75\.00/); // inactive end of month retains complete cumulative total
  const unknown = { ...collection, days: collection.days.map((d, i) => i ? { ...d, grossSpend: null } : d) };
  const unknownHtml = renderToStaticMarkup(createElement(GoogleCollectionSheet, { collection: unknown, year: 2026, month: 9, currency: "€", query: "" }));
  const unknownRows = unknownHtml.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/g);
  assert.doesNotMatch(unknownRows[30], /-€50\.00|-€75\.00/);
});

test("Unassigned ads funded by credit still prevent invented collection profits", () => {
  const groups = buildGoogleCollections([collectionCampaign, { ...collectionCampaign, key: "c2", collectionHandle: null }],
    [{ ...fact, spend: 0 }, { ...fact, key: "c2", spend: 0, grossSpend: 50, conversions: 0 }], [order], collectionStores);
  const summary = summariseCollection(groups.find((g) => g.handle === "winter").days);
  assert.equal(summary.spendKnown, false);
  assert.equal(summary.profit, null);
});
