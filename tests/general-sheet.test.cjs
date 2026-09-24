process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-only";
process.env.TOKEN_ENCRYPTION_KEY = "11".repeat(32);
require("../scripts/register-ts.cjs");
const test = require("node:test");
const assert = require("node:assert/strict");
const { memoryDb } = require("./helpers/memory-db.cjs");
const { buildGeneralCollections, summariseGeneralSheet, generalCampaignLinkId } = require("../src/lib/trackers/general-sheet.ts");
const range = { from: "2026-09-01", to: "2026-09-30" };
const date = "2026-09-19";
const noFees = () => ({ feeFb: 0, feeGoogle: 0, txFee: 0, paymentPct: 0 });
const meta = { key: "m:42", platform: "meta", name: "Baskets", storeId: "s", collectionHandle: "baskets", productId: null, active: true };
const google = { ...meta, key: "s:123:42", platform: "google" };
const definition = { key: "s:baskets", handle: "baskets", name: "Baskets", storeId: "s", storeName: "Store", productIds: ["basket"], rate: 1, campaigns: [meta, google] };
const facts = [{ key: meta.key, platform: "meta", date, spend: 10 }, { key: google.key, platform: "google", date, spend: 20 }];
const order = { id: "o", storeId: "s", date, collectionHandle: null, grossRevenue: 100, refunds: 10, cost: 30,
  items: [{ productId: "basket", units: 2, revenue: 90, weight: 100, cost: 30 }] };
const summary = (collection, fees = noFees) => summariseGeneralSheet(collection.days, collection.productIds != null, fees);
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test("General sheet counts basket purchases from every channel once despite multiple campaigns and line items", () => {
  const purchases = [null, "/?gclid=google", "/?fbclid=facebook", "/?utm_source=newsletter"].map((landingSite, i) => ({ ...order, id: "o" + i, landingSite }));
  purchases[0].items = [{ ...order.items[0], units: 1, weight: 50, cost: 15 }, { ...order.items[0], units: 1, weight: 50, cost: 15 }];
  const [collection] = buildGeneralCollections([definition], facts, [...purchases, purchases[0],
    { ...order, id: "other-store", storeId: "other" },
    { ...order, id: "outside-period", date: "2026-08-31" },
    { ...order, id: "wrong-product", collectionHandle: "baskets", items: [{ ...order.items[0], productId: "hat" }] }], range);
  const result = summary(collection);
  assert.equal(result.orders, 4);
  assert.equal(result.units, 8);
  assert.equal(result.revenue, 360);
  assert.equal(result.cogs, 120);
  assert.equal(result.spend, 30);
  assert.equal(result.profit, 210);
});

test("Mixed orders allocate only each collection's items, with proportional shipping, refunds and fixed fees", () => {
  const mixed = { ...order, grossRevenue: 120, refunds: 20, cost: 30, items: [
    { productId: "basket", units: 1, revenue: 50, weight: 60, cost: 18 },
    { productId: "hat", units: 1, revenue: 30, weight: 40, cost: 12 },
  ] };
  const defs = [{ ...definition, campaigns: [meta] },
    { ...definition, key: "s:hats", handle: "hats", productIds: ["hat"], campaigns: [{ ...meta, key: "m:hats", collectionHandle: "hats" }] }];
  const cols = buildGeneralCollections(defs, [facts[0], { key: "m:hats", platform: "meta", date, spend: 5 }], [mixed], range);
  const fee = () => ({ ...noFees(), paymentPct: .025, txFee: .3, feeFb: .1 });
  const baskets = summary(cols[0], fee), hats = summary(cols[1], fee);
  assert.equal(baskets.orders, 1); assert.equal(hats.orders, 1);
  assert.equal(baskets.units, 1); assert.equal(hats.units, 1);
  assert.equal(baskets.gross, 72); assert.equal(baskets.refunds, 12); assert.equal(baskets.cogs, 18);
  close(baskets.payments, 1.98);
  assert.equal(baskets.revenue, 60); assert.equal(hats.revenue, 40);
  assert.equal(hats.cogs, 12);
  close(baskets.profit, 29.02); close(hats.profit, 21.18);
  close(baskets.gross + hats.gross, mixed.grossRevenue);
  close(baskets.refunds + hats.refunds, mixed.refunds);
  close(baskets.cogs + hats.cogs, mixed.cost);
  close(baskets.payments + hats.payments, 3.3);
});

test("Identical collection handles remain store-scoped and amounts use each store's currency conversion", () => {
  const other = { ...definition, key: "other:baskets", storeId: "other", rate: 2, campaigns: [{ ...meta, key: "other:42", storeId: "other" }] };
  const cols = buildGeneralCollections([definition, other], [...facts, { platform: "meta", key: "other:42", date, spend: 10 }],
    [order, { ...order, id: "other-order", storeId: "other" }], range);
  assert.equal(summary(cols[0]).revenue, 90);
  assert.equal(summary(cols[1]).revenue, 180);
  assert.equal(summary(cols[1]).cogs, 60);
  assert.equal(summary(cols[1]).metaSpend, 20);
  assert.equal(summary(cols[1]).googleSpend, 0);
  assert.equal(summary(cols[1]).profit, 100);
});

test("Unknown membership, absent platform coverage and legacy gross costs never produce invented profit", () => {
  const [unknown] = buildGeneralCollections([{ ...definition, productIds: null }], facts, [order], range);
  assert.equal(summary(unknown).orders, null);
  assert.equal(summary(unknown).revenue, null);
  assert.equal(summary(unknown).profit, null);
  assert.equal(summary(unknown).spend, 30);
  for (const input of [facts.slice(0, 1), [{ ...facts[0] }, { ...facts[1], spend: null }], []]) {
    const [collection] = buildGeneralCollections([definition], input, [order], range);
    assert.equal(summary(collection).revenue, 90);
    assert.equal(summary(collection).spend, null);
    assert.equal(summary(collection).profit, null);
  }
  const [loss] = buildGeneralCollections([definition], facts, [], range);
  assert.equal(summary(loss).orders, 0);
  assert.equal(summary(loss).profit, -30);
});

test("Monthly fee changes apply to annual totals and zero-weight orders allocate shared amounts by quantity", () => {
  const zeroWeight = { ...order, items: [{ ...order.items[0], weight: 0, units: 1 }, { ...order.items[0], productId: "hat", weight: 0, units: 3, cost: 0 }] };
  const [collection] = buildGeneralCollections([definition], [...facts, ...facts.map((f) => ({ ...f, date: "2026-08-01" }))],
    [zeroWeight, { ...zeroWeight, id: "aug", date: "2026-08-01" }], { from: "2026-01-01", to: "2026-12-31" });
  const result = summary(collection, (date) => ({ ...noFees(), feeFb: date.includes("-08-") ? .1 : .2, feeGoogle: .1, txFee: .4 }));
  assert.equal(result.orders, 2);
  assert.equal(result.units, 2);
  assert.equal(result.revenue, 45);
  assert.equal(result.agency, 7);
  close(result.payments, .2);
});

test("A paid AfterSell update includes its items only in their collections and never creates a second order", async () => {
  const { upsertOrders } = require("../src/lib/shopify/sync.ts");
  const { fetchTrackerOrderSales } = require("../src/lib/trackers/sales.ts");
  const db = memoryDb();
  const ctx = { supabase: db, userId: "u", connectionId: "s" };
  const costs = new Map([["vb", 18], ["vh", 12]]);
  const first = { id: 1, name: "#1", financial_status: "paid", processed_at: date + "T12:00:00Z", currency: "EUR", subtotal_price: "60", total_price: "60",
    line_items: [{ id: 11, product_id: "basket", variant_id: "vb", quantity: 1, price: "60" }] };
  await upsertOrders(ctx, [first], costs);
  const upsold = { ...first, subtotal_price: "100", total_price: "100", line_items: [...first.line_items,
    { id: 12, product_id: "hat", variant_id: "vh", quantity: 1, price: "40", properties: [{ name: "_aftersell", value: "true" }] }] };
  await upsertOrders(ctx, [upsold], costs);
  await upsertOrders(ctx, [upsold], costs);
  const orders = await fetchTrackerOrderSales(db, "u", range, "UTC", "all");
  const [collection] = buildGeneralCollections([definition], facts, orders, range);
  const result = summary(collection);
  assert.equal(result.orders, 1); assert.equal(result.units, 1);
  assert.equal(result.revenue, 60); assert.equal(result.cogs, 18);
  assert.equal(result.profit, 12);
  const [both] = buildGeneralCollections([{ ...definition, productIds: ["basket", "hat"] }], facts, orders, range);
  const all = summary(both);
  assert.equal(all.orders, 1); assert.equal(all.units, 2);
  assert.equal(all.revenue, 100); assert.equal(all.cogs, 30);
  assert.equal(all.profit, 40);
});

test("Complete Meta snapshots record confirmed zero days, while failed pagination cannot erase spend", async (t) => {
  const api = require("../src/lib/meta/client.ts");
  const { syncMetaCampaigns } = require("../src/lib/meta/sync.ts");
  const db = memoryDb({ campaigns: [
    { user_id: "u", meta_connection_id: "m", campaign_id: "42", campaign_name: "Baskets", date: "2026-08-01", spend: 10 },
    { user_id: "other", meta_connection_id: "m2", campaign_id: "other", date, spend: 80 },
  ] });
  let fail = false;
  t.mock.method(api, "graphPaginate", async function* () {
    yield [{ campaign_id: "42", campaign_name: "Baskets", date_start: date, spend: "20" }];
    if (fail) throw Error("page failed");
  });
  const ctx = { supabase: db, userId: "u", connectionId: "m", adAccountId: "act_m", token: "test", fxToStore: 2 };
  await syncMetaCampaigns(ctx, { from: date, to: "2026-09-20" });
  assert.equal(db.tables.campaigns.find(r => r.campaign_id === "42" && r.date === "2026-09-20").spend, 0);
  assert.equal(db.tables.campaigns.find(r => r.campaign_id === "42" && r.date === date).spend, 40);
  assert.equal(db.tables.campaigns.find(r => r.campaign_id === "other").spend, 80);
  const writes = db.writes.length;
  fail = true;
  await assert.rejects(() => syncMetaCampaigns(ctx, { from: date, to: "2026-09-20" }), /page failed/);
  assert.equal(db.writes.length, writes);
});

function mockSources(t, source, userId) {
  const metaModule = require("../src/lib/trackers/meta-pnl-query.ts");
  const googleModule = require("../src/lib/trackers/google-pnl-query.ts");
  const sales = require("../src/lib/trackers/sales.ts");
  const queries = require("../src/lib/queries.ts");
  const auth = require("../src/lib/shopify/auth.ts");
  const members = require("../src/lib/shopify/collection-products.ts");
  const productCollections = require("../src/lib/shopify/product-collections.ts");
  t.mock.method(metaModule, "getMetaPnlCatalog", async () => source.meta);
  t.mock.method(googleModule, "getGooglePnlCatalog", async () => source.google);
  t.mock.method(sales, "fetchTrackerOrderSales", async (_db, user, _range, _timezone, channel) => {
    assert.equal(user, userId); assert.equal(channel, "all"); return source.orders ?? [order];
  });
  t.mock.method(queries, "getStoreFxRates", async () => new Map([["s", 1], ["other", 2]]));
  t.mock.method(auth, "resolveShopifyToken", async () => "test-token");
  t.mock.method(members, "fetchCollectionProductIds", async (_shop, _token, handle) => handle === "unavailable" ? null : ["basket"]);
  t.mock.method(productCollections, "fetchProductCollections", async (_shop, _token, id) => id === "basket" ? [{ handle: "baskets", title: "Baskets" }] : [{ handle: "one", title: "One" }, { handle: "two", title: "Two" }]);
  return memoryDb({
    shopify_connections: ["s", "other"].map((id) => ({ id, user_id: userId, shop_domain: id + ".myshopify.com", shop_name: id })),
    campaign_links: source.links ?? [],
    products: source.products ?? [],
  });
}

test("Query merges active Meta and Google collections and retains paused historical costs without listing paused-only collections", async (t) => {
  const userId = "general-merge-test";
  const source = {
    meta: {
      options: [
        { key: meta.key, campaignId: "42", name: "Meta baskets", storeId: "s", status: "ACTIVE" },
        { key: "m:old", campaignId: "old", name: "Old baskets", storeId: "s", status: "PAUSED" },
        { key: "m:paused", campaignId: "paused", name: "Old hats", storeId: "s", status: "PAUSED" },
      ],
      rows: ["42", "old"].map((campaign_id) => ({ meta_connection_id: "m", campaign_id, date, spend: 5 })),
    },
    google: {
      options: [{ key: google.key, campaignId: "42", name: "Google baskets", storeId: "s", status: "ENABLED", collectionHandle: "baskets" },
        { key: "other:123:42", campaignId: "42", name: "Other store baskets", storeId: "other", status: "ENABLED", collectionHandle: "baskets" }],
      rows: [{ key: google.key, campaign_id: "42", date, spend: 0, gross_spend: 20 }],
    },
    links: ["42", "old", "paused"].map((campaign_id) => ({ user_id: userId, campaign_id, collection_handle: campaign_id === "paused" ? "hats" : "baskets", product_handle: null, link_kind: "collection" })),
  };
  const db = mockSources(t, source, userId);
  const { getGeneralSheetData } = require("../src/lib/trackers/general-sheet-query.ts");
  const result = await getGeneralSheetData(db, userId, 2026, range, "EUR");
  assert.equal(result.collections.length, 2);
  const baskets = result.collections.find((c) => c.storeId === "s");
  assert.equal(baskets.campaigns.length, 3);
  assert.equal(baskets.campaigns.filter((c) => c.active).length, 2);
  assert.equal(summary(baskets).spend, 30);
  assert.equal(summary(baskets).revenue, 90);
  assert.equal(result.unresolved.length, 0);
  const filtered = await getGeneralSheetData(db, userId, 2026, range, "EUR", "other");
  assert.equal(filtered.collections.length, 1);
  assert.equal(filtered.collections[0].storeId, "other");
  assert.equal(db.writes.length, 0);
});

test("Product ads infer only an unambiguous collection, manual associations survive and failed memberships stay unknown", async (t) => {
  const userId = "general-products-test";
  const options = [
    { key: "m:p", campaignId: "p", name: "Baskets", storeId: "s", status: "ACTIVE" },
    { key: "m:amb", campaignId: "amb", name: "Ambiguous", storeId: "s", status: "ACTIVE" },
    { key: "m:manual", campaignId: "manual", name: "Manual", storeId: "s", status: "ACTIVE" },
  ];
  const source = { meta: { options, rows: [] }, google: { options: [], rows: [] },
    products: ["basket", "ambiguous"].map((id) => ({ user_id: userId, shopify_product_id: id, shopify_connection_id: "s", handle: id, title: id, price: 100 })),
    links: [
      { user_id: userId, campaign_id: "p", product_handle: "basket" },
      { user_id: userId, campaign_id: "amb", product_handle: "ambiguous" },
      { user_id: userId, campaign_id: "manual", collection_handle: "original" },
      { user_id: userId, campaign_id: generalCampaignLinkId("meta", "m:manual"), collection_handle: "unavailable", link_kind: "general-manual" },
    ],
  };
  const db = mockSources(t, source, userId);
  const { getGeneralSheetData } = require("../src/lib/trackers/general-sheet-query.ts");
  const result = await getGeneralSheetData(db, userId, 2026, range, "EUR");
  assert.deepEqual(result.collections.map((c) => c.handle).sort(), ["baskets", "unavailable"]);
  assert.equal(result.collections.find((c) => c.handle === "baskets").campaigns[0].key, "m:p");
  assert.equal(result.collections.find((c) => c.handle === "unavailable").productIds, null);
  assert.deepEqual(result.unresolved.map((c) => c.key), ["m:amb"]);
});

test("General associations require campaign ownership and preserve automatic Meta and Google links", async (t) => {
  const server = require("../src/lib/supabase/server.ts");
  const metaModule = require("../src/lib/trackers/meta-pnl-query.ts");
  const googleModule = require("../src/lib/trackers/google-pnl-query.ts");
  const cache = require("next/cache");
  const db = memoryDb({ campaign_links: [{ user_id: "owner", campaign_id: "42", collection_handle: "original" }] });
  t.mock.method(server, "getCurrentUser", async () => ({ id: "owner" }));
  t.mock.method(server, "createClient", async () => db);
  t.mock.method(metaModule, "getMetaPnlCatalog", async () => ({ options: [{ key: meta.key, campaignId: "42", storeId: "s" }] }));
  t.mock.method(googleModule, "getGooglePnlCatalog", async () => ({ options: [{ key: google.key, campaignId: "42", storeId: "s" }] }));
  t.mock.method(cache, "revalidatePath", () => {});
  const { setGeneralCampaignCollection } = require("../src/lib/trackers/general-sheet-actions.ts");
  assert.equal((await setGeneralCampaignCollection("meta", "someone-else", 2026, "baskets")).ok, false);
  assert.equal((await setGeneralCampaignCollection("meta", meta.key, 2026, "../bad")).ok, false);
  assert.equal(db.writes.length, 0);
  assert.equal((await setGeneralCampaignCollection("meta", meta.key, 2026, "https://s.test/collections/baskets")).ok, true);
  assert.equal((await setGeneralCampaignCollection("google", google.key, 2026, "baskets")).ok, true);
  assert.equal(db.tables.campaign_links.find((r) => r.campaign_id === "42").collection_handle, "original");
  assert.equal(db.tables.campaign_links.find((r) => r.campaign_id === generalCampaignLinkId("meta", meta.key)).collection_handle, "baskets");
  assert.equal(db.tables.campaign_links.find((r) => r.campaign_id === generalCampaignLinkId("google", google.key)).user_id, "owner");
  t.mock.method(server, "getCurrentUser", async () => null);
  assert.equal((await setGeneralCampaignCollection("meta", meta.key, 2026, "baskets")).ok, false);
});

test("Product collection lookup paginates, deduplicates and discards partial results on failure", async (t) => {
  const { fetchProductCollections } = require("../src/lib/shopify/product-collections.ts");
  let calls = 0;
  t.mock.method(global, "fetch", async (_url, init) => {
    calls++;
    const variables = JSON.parse(init.body).variables;
    assert.equal(variables.id, "gid://shopify/Product/42");
    assert.equal(variables.after, calls === 1 ? null : "next");
    return { ok: true, json: async () => ({ data: { product: { collections: {
      nodes: [{ handle: "baskets", title: "Baskets" }, ...(calls === 2 ? [{ handle: "gifts", title: "Gifts" }] : [])],
      pageInfo: { hasNextPage: calls === 1, endCursor: "next" },
    } } } }) };
  });
  assert.deepEqual((await fetchProductCollections("s.myshopify.com", "test", "42")).map((c) => c.handle), ["baskets", "gifts"]);
  calls = 0;
  t.mock.method(global, "fetch", async () => {
    calls++;
    return calls === 2 ? { ok: false } : { ok: true, json: async () => ({ data: { product: { collections: { nodes: [{ handle: "baskets" }], pageInfo: { hasNextPage: true, endCursor: "next" } } } } }) };
  });
  assert.equal(await fetchProductCollections("s.myshopify.com", "test", "42"), null);
});

test("Current Meta metadata includes campaigns without insight rows and paginates without writing financial history", async (t) => {
  const client = require("../src/lib/meta/client.ts");
  const crypto = require("../src/lib/crypto.ts");
  const { getCurrentMetaCampaigns } = require("../src/lib/meta/campaign-catalog.ts");
  t.mock.method(crypto, "decryptToken", () => "test-token");
  t.mock.method(client, "graphPaginate", async function* (path, params, options) {
    assert.equal(path, "act_123/campaigns");
    assert.equal(params.fields, "id,name,effective_status,status");
    assert.ok(options.signal);
    yield [{ id: "42", name: "Baskets", effective_status: "ACTIVE" }];
    yield [{ id: "43", name: "Paused", effective_status: "PAUSED" }];
  });
  const db = memoryDb({ meta_connections: [
    { user_id: "meta-catalog-test", id: "m", status: "active", ad_account_id: "act_123", shopify_connection_id: "s", access_token: "encrypted", updated_at: "1" },
    { user_id: "someone-else", id: "other", status: "active", ad_account_id: "act_private" },
  ] });
  const result = await getCurrentMetaCampaigns(db, "meta-catalog-test");
  assert.equal(result.options.length, 2);
  assert.equal(result.options[0].key, "m:42");
  assert.equal(result.options[0].status, "ACTIVE");
  assert.equal(result.options[1].status, "PAUSED");
  assert.deepEqual(result.unavailable, []);
  assert.equal(db.writes.length, 0);
  t.mock.method(client, "graphPaginate", async function* () { yield [{ id: "partial", name: "Partial", status: "ACTIVE" }]; throw Error("Meta Graph error 190: Session expired"); });
  t.mock.method(console, "warn", () => {});
  db.tables.meta_connections[0].updated_at = "2";
  const failure = await getCurrentMetaCampaigns(db, "meta-catalog-test");
  assert.deepEqual(failure.options, []);
  assert.equal(failure.unavailable.length, 1);
});

test("General sheet uses live Meta status when imported insights have no status", async (t) => {
  const userId = "general-meta-live-test";
  const c = { key: "m:42", campaignId: "42", storeId: "s", name: "Baskets", status: null };
  const source = { meta: { options: [c], rows: [] }, google: { options: [], rows: [] },
    links: [{ user_id: userId, campaign_id: "42", collection_handle: "baskets", product_handle: null, link_kind: "collection" }] };
  const db = mockSources(t, source, userId);
  const current = require("../src/lib/meta/campaign-catalog.ts");
  t.mock.method(current, "getCurrentMetaCampaigns", async () => ({ options: [{ ...c, status: "ACTIVE" }], unavailable: [] }));
  const { getGeneralSheetData } = require("../src/lib/trackers/general-sheet-query.ts");
  const result = await getGeneralSheetData(db, userId, 2026, range, "EUR");
  assert.equal(result.collections.length, 1);
  assert.equal(result.collections[0].campaigns[0].active, true);
  t.mock.method(current, "getCurrentMetaCampaigns", async () => ({ options: [{ ...c, status: "PAUSED" }], unavailable: [] }));
  const paused = await getGeneralSheetData(db, userId, 2026, range, "EUR");
  assert.equal(paused.collections.length, 0);
});


test("General sheet renders daily and annual views with scoped navigation and retains cumulative losses across empty days", () => {
  const { renderToStaticMarkup } = require("react-dom/server");
  const { createElement } = require("react");
  const { GeneralCollectionSheet } = require("../src/components/trackers/general-collection-sheet.tsx");
  const [collection] = buildGeneralCollections([definition], facts, [], range);
  const props = { collection, year: 2026, month: 9, currency: "€", feesByMonth: Array.from({ length: 12 }, noFees), query: "store=s&collection=s%3Abaskets" };
  const html = renderToStaticMarkup(createElement(GeneralCollectionSheet, props));
  assert.match(html, /Lucro após taxas/);
  assert.match(html, /-€30\.00/);
  const rows = html.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/g);
  assert.match(rows[30], /-€30\.00/);
  const annual = renderToStaticMarkup(createElement(GeneralCollectionSheet, { ...props, month: undefined }));
  assert.match(annual, /finance\/general\?store=s.*collection=s%3Abaskets.*month=9/);
  const unknown = renderToStaticMarkup(createElement(GeneralCollectionSheet, { ...props, collection: { ...collection, productIds: null } }));
  assert.match(unknown, /Não foi possível confirmar/);
  assert.doesNotMatch(unknown, /-€30\.00/);
});
