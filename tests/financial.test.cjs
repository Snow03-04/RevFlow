process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-only";
require("../scripts/register-ts.cjs");
const test = require("node:test");
const assert = require("node:assert/strict");
const { memoryDb } = require("./helpers/memory-db.cjs");
const {
  buildOrderCostConfig,
  costOrder,
  allocateOrderCost,
} = require("../src/lib/cogs/order-cost.ts");
const {
  parseSupplierCsv,
  parseSupplierAmount,
  parseSheetRef,
} = require("../src/lib/supplier/sheet.ts");
const { buildSupplierPlan } = require("../src/lib/supplier/plan.ts");
const {
  selectAllByUser,
  selectAllIn,
} = require("../src/lib/supabase/paginate.ts");
const { projectPnlMonth } = require("../src/lib/trackers/pnl-import.ts");
const { projectRoasMonth } = require("../src/lib/trackers/roas-import.ts");
const { recomputeDailyMetrics } = require("../src/lib/metrics.ts");
const { buildResolver } = require("../src/lib/trackers/match.ts");
const { mapOrder } = require("../src/lib/shopify/sync.ts");
const { lineNetRevenue } = require("../src/lib/trackers/sales.ts");
const { zonedRangeUtc } = require("../src/lib/date.ts");
const { dashboardPeriodUrl } = require("../src/lib/dashboard-navigation.ts");
const { getRangeComparison } = require("../src/lib/queries.ts");
const { upsertOrders } = require("../src/lib/shopify/sync.ts");
const { shopifySyncRanges } = require("../src/lib/shopify/sync-ranges.ts");
const { syncMetaCampaigns } = require("../src/lib/meta/sync.ts");
const { syncGoogleConnection } = require("../src/lib/jobs.ts");
const { encryptToken } = require("../src/lib/crypto.ts");
const { cogsImpact } = require("../src/lib/profit.ts");
const { summariseMonth, calcPnlDay } = require("../src/lib/trackers/pnl.ts");
const { allocateMetaPnl, metaCampaignKey, summariseMetaPnl } = require("../src/lib/trackers/meta-pnl.ts");
const { getMetaPnlCatalog, getMetaPnlDays } = require("../src/lib/trackers/meta-pnl-query.ts");
const { groupMetaCampaigns, sumMetaSummaries } = require("../src/lib/trackers/meta-presentation.ts");
const { pnlUrl } = require("../src/lib/trackers/pnl-navigation.ts");
const { getPnlGoogleEstimates } = require("../src/lib/trackers/pnl-google-spend.ts");
const { pnlMonthGoogleEstimates } = require("../src/lib/trackers/pnl.ts");
const raw = () => ({
  productCosts: [],
  tiers: [],
  collections: [],
  collectionProducts: [],
  collectionTiers: [],
});
const cfg = (r = raw(), opts = {}) =>
  buildOrderCostConfig(r, {
    storeToDisplay: 1,
    fallbackCostPct: 30,
    costByVariant: new Map(),
    ...opts,
  });
const item = (values = {}) => ({
  shopify_product_id: "p",
  shopify_variant_id: "v",
  quantity: 1,
  current_quantity: 1,
  price: 30,
  unit_cost: 10,
  ...values,
});
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test("COGS Impact divides aggregate COGS by net revenue, including refunds and zero revenue", () => {
  const fees = { feeFb: 0, feeGoogle: 0, txFee: 0, paymentPct: 0 };
  const summary = summariseMonth(9, [
    { grossRevenue: 100, refunds: 50, cogs: 40, orders: 1, adspendFb: 0, adspendGoogle: 0 },
    { grossRevenue: 900, refunds: 0, cogs: 90, orders: 1, adspendFb: 0, adspendGoogle: 0 },
  ], fees);
  close(summary.cogImpactPct, 130 / 950);
  close(cogsImpact(summary.cogs, summary.net), summary.cogImpactPct);
  assert.equal(cogsImpact(100, 0), null);
  assert.equal(cogsImpact(0, 100), 0);
});

test("P&L navigation preserves stable campaign identity and store across all views", () => {
  const key = metaCampaignKey("meta-account", "123");
  const initial = new URLSearchParams({ scope: "meta", campaign: key, store: "s", month: "9" });
  for (const changes of [{ view: "dashboard", month: null }, { view: "month", month: "8" }, { view: "settings" }]) {
    const url = new URL(pnlUrl(initial.toString(), changes), "http://localhost");
    assert.equal(url.searchParams.get("campaign"), key);
    assert.equal(url.searchParams.get("store"), "s");
    assert.equal(url.searchParams.get("scope"), "meta");
  }
  const general = new URL(pnlUrl(initial.toString(), { scope: null, campaign: null }), "http://localhost");
  assert.equal(general.searchParams.has("campaign"), false);
  assert.equal(general.searchParams.get("store"), "s");
});

test("Meta P&L reads shared supplier COGS, splits duplicate names and never writes the general sheet", async () => {
  const source = storeFixture();
  source.orders[0].total_shipping = 6;
  source.orders[0].total_refunded = 6;
  source.campaigns[0].purchases = 3;
  source.campaigns.forEach(c => { c.campaign_name = "Identical label"; });
  source.pnl_days = [{ user_id: "u", gross_revenue: 999, notes: "keep" }];
  const db = memoryDb(source);
  const catalog = await getMetaPnlCatalog(db, "u", 2026);
  assert.equal(catalog.options.length, 2);
  assert.notEqual(catalog.options[0].key, catalog.options[1].key);
  assert.equal(catalog.options[0].name, catalog.options[1].name);
  const rows = await getMetaPnlDays(db, "u", catalog.rows, { from: "2026-09-01", to: "2026-09-30" }, "€");
  const a = rows.find(r => r.key === metaCampaignKey("meta", "a"));
  const b = rows.find(r => r.key === metaCampaignKey("meta", "b"));
  close(a.input.orders, 0.75);
  close(b.input.orders, 0.25);
  close(a.input.grossRevenue, 49.5);
  close(a.input.refunds, 4.5);
  close(a.input.cogs, 13.5);
  close(b.input.cogs, 4.5);
  close(sum(rows.map(r => r.sheetCogs)), 18);
  const fees = { feeFb: 0, feeGoogle: 0, txFee: 0.3, paymentPct: 0.025 };
  const total = summariseMetaPnl(rows, () => fees);
  const expected = calcPnlDay({ grossRevenue: 66, refunds: 6, cogs: 18, orders: 1, adspendFb: 10, adspendGoogle: 0 }, fees);
  close(total.profit, expected.profit);
  assert.equal(total.complete, true);
  assert.deepEqual(db.writes, []);
  assert.deepEqual(db.tables.pnl_days, source.pnl_days);
});

test("Meta P&L keeps store FX isolated and fractional allocations do not invent cents", () => {
  const target = { productId: "p", via: "handle", price: 0, cog: 0, score: 1000 };
  const base = { date: "2026-09-01", name: "Same", target, spend: 3.54, purchases: 1, purchaseValue: 354 };
  const campaigns = [0,1,2].map(i => ({...base, key: metaCampaignKey("h", String(i)), storeId: "h", rate: 1/354}));
  campaigns.push({...base, key: "eur:1", storeId: "e", rate: 1, spend: 1});
  const order = {id:"o", storeId:"h", date:base.date, collectionHandle:null, grossRevenue:354, refunds:0, cost:3.54, sheetCost:true,
    items:[{productId:"p",units:1,revenue:354,weight:354,cost:3.54}]};
  const rows = allocateMetaPnl(campaigns, [order]);
  close(sum(rows.map(r=>r.input.cogs)), 0.01);
  close(sum(rows.map(r=>r.input.grossRevenue)), 1);
  close(sum(rows.map(r=>r.input.adspendFb)), 1.03);
  const e = rows.find(r => r.key === "eur:1");
  assert.equal(e.input.cogs, 0);
  assert.equal(e.complete, false);
});

test("Meta P&L collection priority prevents product overlap; mixed baskets keep unknown portions unassigned", () => {
  const base = { date:"2026-09-01", name:"Same", storeId:"s", rate:1, spend:1, purchases:0, purchaseValue:0 };
  const target = { productId:"p", via:"handle", price:0, cog:0, score:1000 };
  const campaigns = [
    {...base,key:"product",target},
    {...base,key:"collection",target:{...target, productId:null, collectionHandle:"all", via:"collection"}},
  ];
  const order = {id:"o",storeId:"s",date:base.date,collectionHandle:"all",grossRevenue:100,refunds:10,cost:20,sheetCost:true,
    items:[{productId:"p",units:1,revenue:60,weight:60,cost:12},{productId:"unknown",units:1,revenue:40,weight:40,cost:8}]};
  let rows = allocateMetaPnl(campaigns,[order]);
  close(rows.find(r=>r.key==="collection").input.cogs,20);
  close(rows.find(r=>r.key==="product").input.cogs,0);
  close(sum(rows.map(r=>r.input.orders)),1);
  rows = allocateMetaPnl(campaigns,[{...order,collectionHandle:null}]);
  close(sum(rows.map(r=>r.input.cogs)),12);
  close(sum(rows.map(r=>r.input.grossRevenue)),60);
  close(sum(rows.map(r=>r.input.refunds)),6);
  close(sum(rows.map(r=>r.input.orders)),0.6);
});

test("Meta P&L retains paid supplier expense after full refund, excludes Google/test/cancelled orders and propagates missing matches", async () => {
  const source = storeFixture();
  source.orders[0].total_refunded = 60;
  source.order_line_items[0].current_quantity = 0;
  for (const extra of [{id:"test",test:true},{id:"cancel",cancelled_at:"2026-09-01"},{id:"google",landing_site:"/products/shirt?gclid=123"}]) {
    source.orders.push({...source.orders[0],...extra});
    source.order_line_items.push({...source.order_line_items[0],id:extra.id,order_id:extra.id});
  }
  source.campaigns.push({...source.campaigns[0],id:"unknown",campaign_id:"unknown",campaign_name:"No matching item"});
  const db = memoryDb(source);
  const catalog = await getMetaPnlCatalog(db,"u",2026);
  const rows = await getMetaPnlDays(db,"u",catalog.rows,{from:"2026-09-01",to:"2026-09-30"},"€");
  close(sum(rows.map(r=>r.input.cogs)),18);
  close(sum(rows.map(r=>r.input.orders)),1);
  close(sum(rows.map(r=>r.input.refunds)),60);
  const unknown = rows.find(r=>r.key===metaCampaignKey("meta","unknown"));
  assert.equal(unknown.complete,false);
  assert.equal(unknown.input.adspendFb,5);
  const fees={feeFb:0,feeGoogle:0,txFee:0.3,paymentPct:0.025};
  assert.equal(summariseMetaPnl(rows,()=>fees).complete,false);
  const known=rows.filter(r=>r.complete);
  assert.ok(summariseMetaPnl(known,()=>fees).profit<0);
  assert.deepEqual(db.writes,[]);
});

test("Meta campaign annual totals apply each month's fee overrides", () => {
  const rows = ["2026-08-01","2026-09-01"].map(date=>({key:"c",date,complete:true,reason:null,via:"handle",metaPurchases:1,metaRevenue:100,sheetCogs:10,
    input:{grossRevenue:100,refunds:0,cogs:10,adspendFb:20,adspendGoogle:0,orders:1}}));
  const summary=summariseMetaPnl(rows,date=>({feeFb:date.includes("-08-")?0.1:0,feeGoogle:0,txFee:date.includes("-08-")?0.3:0.5,paymentPct:0.025}));
  close(summary.agencyFees,2);
  close(summary.paymentFees,5.8);
  close(summary.profit,132.2);
  close(summary.cogsImpact,0.1);
});

test("Meta display groups keep stores isolated, preserve allocated money and compute weighted performance", () => {
  const target = { key: "collection:winter", name: "Winter", kind: "collection" };
  const fees = date => ({ feeFb: date.includes("-08-") ? 0.1 : 0.2, feeGoogle: 0, txFee: 0.3, paymentPct: 0.025 });
  const make = (key, storeId, date, impressions, clicks, spend, purchases, revenue) => {
    const summary = summariseMetaPnl([{ key, date, complete: true, metaRevenue: revenue, metaPurchases: purchases, sheetCogs: 20, impressions, clicks, atc: 3,
      input: { grossRevenue: revenue, refunds: 0, cogs: 20, adspendFb: spend, adspendGoogle: 0, orders: purchases } }], fees);
    return { option: { key, storeId, storeName: storeId, name: key, campaignId: key }, target, summary, activity: true };
  };
  const campaigns = [make("a", "one", "2026-08-01", 100, 20, 10, 2, 100), make("b", "one", "2026-09-01", 900, 30, 30, 1, 50), make("c", "two", "2026-09-01", 200, 5, 10, 0, 0)];
  const groups = groupMetaCampaigns(campaigns);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].targets.length, 1);
  assert.equal(groups[0].targets[0].campaigns.length, 2);
  assert.notEqual(groups[0].targets[0].key, groups[1].targets[0].key);
  const s = groups[0].summary;
  close(s.ctr, .05); close(s.cpc, .8); close(s.cpm, 40); close(s.cpa, 40/3); close(s.metaRoas, 3.75);
  close(s.agencyFees, 7); close(s.profit, campaigns[0].summary.profit + campaigns[1].summary.profit);
  assert.deepEqual(groupMetaCampaigns([campaigns[0]])[0].summary.input, campaigns[0].summary.input);
  close(groupMetaCampaigns([campaigns[0]])[0].summary.profit, campaigns[0].summary.profit);
  campaigns[1].summary.complete = false;
  assert.equal(sumMetaSummaries(campaigns.map(c => c.summary)).complete, false);
});

test("Meta query exposes imported status, target and traffic without changing sales allocation", async () => {
  const source = storeFixture();
  source.campaigns[0] = { ...source.campaigns[0], status: "PAUSED", impressions: 1234, clicks: 45, atc: 6 };
  const db = memoryDb(source);
  const catalog = await getMetaPnlCatalog(db, "u", 2026);
  const key = metaCampaignKey(source.campaigns[0].meta_connection_id, source.campaigns[0].campaign_id);
  assert.equal(catalog.options.find(o => o.key === key).status, "PAUSED");
  const rows = await getMetaPnlDays(db, "u", catalog.rows, { from: "2026-09-01", to: "2026-09-30" }, "€");
  const row = rows.find(r => r.key === key);
  assert.equal(row.impressions, 1234); assert.equal(row.clicks, 45); assert.equal(row.atc, 6);
  assert.equal(row.target.kind, "product");
  assert.equal(row.target.name, source.products[0].title);
  assert.deepEqual(db.writes, []);
});

test("Dashboard preserves the selected store across preset and custom date changes", () => {
  const initial = "store=example-store&period=custom&from=2026-07-01&to=2026-07-31";
  for (const period of ["today", "last7", "month", "year"]) {
    const params = new URL(
      dashboardPeriodUrl(initial, period),
      "http://localhost",
    ).searchParams;
    assert.equal(params.get("store"), "example-store");
    assert.equal(params.get("period"), period);
    assert.equal(params.has("from"), false);
    assert.equal(params.has("to"), false);
  }
  const params = new URL(
    dashboardPeriodUrl(initial, "custom", "2026-06-01", "2026-09-15"),
    "http://localhost",
  ).searchParams;
  assert.equal(params.get("store"), "example-store");
  assert.equal(params.get("from"), "2026-06-01");
  assert.equal(params.get("to"), "2026-09-15");
  assert.equal(
    new URL(
      dashboardPeriodUrl("period=today", "year"),
      "http://localhost",
    ).searchParams.has("store"),
    false,
  );
});

test("Dashboard totals page the full history, isolate stores and round only after FX aggregation", async () => {
  const zero = Object.fromEntries(
    [
      "refunds",
      "ad_spend",
      "ad_spend_meta",
      "ad_spend_google",
      "product_cost",
      "shipping_cost",
      "payment_fees",
      "profit",
      "units_sold",
      "ad_clicks",
      "roas",
    ].map((k) => [k, 0]),
  );
  const metrics = Array.from({ length: 1205 }, (_, i) => ({
    ...zero,
    id: `m${i}`,
    user_id: "u",
    shopify_connection_id: "example-store",
    date: new Date(Date.UTC(2020, 0, i + 1)).toISOString().slice(0, 10),
    revenue: 1,
    gross_revenue: 1,
    orders_count: 1,
  }));
  metrics.push({
    ...zero,
    id: "another",
    user_id: "u",
    shopify_connection_id: "other",
    date: "2020-01-01",
    revenue: 99,
    gross_revenue: 99,
    orders_count: 1,
  });
  metrics.push({
    ...metrics[0],
    id: "foreign",
    user_id: "another-user",
    revenue: 999,
  });
  const db = memoryDb({ daily_metrics: metrics });
  const current = { from: "2020-01-01", to: "2026-09-15" },
    previous = { from: "2019-01-01", to: "2019-12-31" };
  const rates = new Map([
    ["example-store", 1 / 354],
    ["other", 1],
  ]);
  const selected = await getRangeComparison(
    db,
    "u",
    current,
    previous,
    rates,
    "example-store",
  );
  assert.equal(selected.current.ordersCount, 1205);
  assert.equal(selected.current.revenue, 3.4);
  assert.equal(selected.previous.revenue, 0);
  const all = await getRangeComparison(db, "u", current, previous, rates);
  assert.equal(all.current.revenue, 102.4);
  assert.equal(db.writes.length, 0);
});

test("Historical imports batch orders and lines, preserve IDs and remain idempotent", async () => {
  const db = memoryDb({
    orders: [
      {
        id: "existing",
        user_id: "u",
        shopify_order_id: "1",
        processed_at: "2026-06-01T12:00:00Z",
      },
    ],
  });
  const orders = Array.from({ length: 250 }, (_, i) => ({
    id: i + 1,
    name: `#${i + 1}`,
    processed_at: "2026-08-01T12:00:00Z",
    subtotal_price: "30",
    currency: "EUR",
    line_items: Array.from({ length: 5 }, (_, j) => ({
      id: i * 10 + j,
      product_id: "p",
      variant_id: "v",
      quantity: 2,
      current_quantity: 1,
      price: "15",
      discount_allocations: [{ amount: "2" }],
    })),
  }));
  const ctx = { supabase: db, userId: "u", connectionId: "s" };
  const dates = await upsertOrders(ctx, orders, new Map([["v", 4]]));
  assert.deepEqual(dates.sort(), [
    "2026-06-01T12:00:00Z",
    "2026-08-01T12:00:00Z",
  ]);
  assert.equal(db.tables.orders.length, 250);
  assert.equal(db.tables.order_line_items.length, 1250);
  assert.equal(db.writes.length, 4);
  assert.equal(db.tables.order_line_items[0].order_id, "existing");
  assert.equal(db.tables.order_line_items[0].current_quantity, 1);
  assert.equal(db.tables.order_line_items[0].total_discount, 2);
  assert.equal(db.tables.order_line_items[0].unit_cost, 4);
  await upsertOrders(ctx, orders, new Map([["v", 5]]));
  assert.equal(db.tables.orders.length, 250);
  assert.equal(db.tables.order_line_items.length, 1250);
  assert.equal(db.tables.order_line_items[0].unit_cost, 5);
});

test("A recent sync also refreshes historical and moved order dates in the account timezone", () => {
  const recent = { from: "2026-09-13", to: "2026-09-15" };
  const changed = [
    "2026-06-30T21:00:00Z",
    "2026-06-30T23:00:00Z",
    "2026-09-14T12:00:00Z",
  ];
  assert.deepEqual(
    shopifySyncRanges(recent, changed, "Europe/Budapest", true),
    [
      { from: "2026-06-30", to: "2026-06-30" },
      { from: "2026-07-01", to: "2026-07-01" },
    ],
  );
  assert.deepEqual(shopifySyncRanges(recent, changed, "Europe/Budapest"), [
    { from: "2026-06-30", to: "2026-06-30" },
    { from: "2026-07-01", to: "2026-07-01" },
    recent,
  ]);
});

test("Supplier: headerless sheet, subtotal and blank price follow the provided layout", () => {
  const sheet = parseSupplierCsv(
    '"1001","€17.00","paid"\n"1002","€10.80",""\n"","€27.80","paid"\n"1003","",""',
  );
  assert.equal(sheet.byOrder.size, 2);
  assert.equal(sheet.currency, "EUR");
  assert.equal(sheet.paidTotal, 17);
  assert.equal(sheet.unpaidTotal, 10.8);
  assert.deepEqual(sheet.unpricedOrders, ["1003"]);
});
test("Supplier: identical duplicate counted once; conflicting duplicate blocks import", () => {
  const sheet = parseSupplierCsv("order,cost,state\n1,12,paid\n1,12,paid");
  assert.equal(sheet.paidTotal, 12);
  assert.equal(sheet.paidCount, 1);
  const bad = parseSupplierCsv("order,cost,state\n1,12,paid\n1,13,paid");
  assert.equal(bad.errors.length, 1);
  assert.throws(() => buildSupplierPlan(bad, [], [], "s", "UTC"), /repetida/);
});
test("Supplier: decimal formats are parsed fully, including zero", () => {
  for (const [input, n] of [
    ["€1.234,56", 1234.56],
    ["€1,234.56", 1234.56],
    ["12,70", 12.7],
    ["€0.00", 0],
  ])
    assert.equal(parseSupplierAmount(input), n);
  for (const input of ["12oops", "-12", "12.2.3", ""])
    assert.equal(parseSupplierAmount(input), null);
  assert.equal(parseSupplierCsv("<html>Sign in</html>"), null);
  assert.equal(parseSheetRef("https://evil.test/spreadsheets/d/abc"), null);
});
test("Supplier: mixed currencies and malformed priced rows remain visible errors", () => {
  assert.ok(parseSupplierCsv("1,€12,paid\n2,$12,paid").errors.length);
  assert.ok(parseSupplierCsv("1,12garbage,paid").errors.length);
});
test("Supplier: matching is store scoped and bundles do not invent unit prices", () => {
  const orders = [
    {
      id: "a",
      shopify_connection_id: "s1",
      order_number: "#1001",
      processed_at: "2026-09-01T12:00:00Z",
    },
    {
      id: "b",
      shopify_connection_id: "s2",
      order_number: "#1001",
      processed_at: "2026-09-01T12:00:00Z",
    },
  ];
  const sheet = parseSupplierCsv("1001,€18,paid");
  const plan = buildSupplierPlan(
    sheet,
    orders,
    [{ order_id: "b", shopify_product_id: "p", quantity: 2 }],
    "s2",
    "UTC",
  );
  assert.equal(plan.exact[0].orderId, "b");
  assert.equal(plan.productCosts.length, 0);
  const single = buildSupplierPlan(
    sheet,
    orders,
    [{ order_id: "b", shopify_product_id: "p", quantity: 1 }],
    "s2",
    "UTC",
  );
  assert.equal(single.productCosts[0].effective_from, "2026-09-01");
});
test("COGS: exact sheet amount wins, including zero, in the correct currency", () => {
  const options = cfg(raw(), {
    storeToDisplay: 1 / 354,
    currencyToBase: new Map([
      ["EUR", 354],
      ["USD", 300],
    ]),
  });
  const priced = costOrder([item()], "2026-09-01", {
    ...options,
    supplierCost: { cost: 18, currency: "EUR" },
  });
  assert.equal(priced.cost, 6372);
  const zero = costOrder([item()], "2026-09-01", {
    ...options,
    supplierCost: { cost: 0, currency: "EUR" },
  });
  assert.deepEqual(allocateOrderCost([item()], zero), [0]);
  assert.throws(
    () =>
      costOrder([item()], "2026-09-01", {
        ...options,
        supplierCost: { cost: 10, currency: "GBP" },
      }),
    /Câmbio/,
  );
});
test("COGS: dated costs use the order date and stored currency, even after display changes", () => {
  const r = raw();
  r.productCosts = [
    {
      shopify_product_id: "p",
      cost: 10,
      currency: "EUR",
      effective_from: "2026-08-01",
    },
    {
      shopify_product_id: "p",
      cost: 12,
      currency: "USD",
      effective_from: "2026-09-01",
    },
  ];
  const c = cfg(r, {
    currencyToBase: new Map([
      ["EUR", 354],
      ["USD", 300],
    ]),
  });
  assert.equal(costOrder([item()], "2026-08-31", c).cost, 3540);
  assert.equal(costOrder([item()], "2026-09-01", c).cost, 3600);
});
test("COGS: a collection prices the combined basket and allocation conserves the invoice", () => {
  const r = raw();
  r.collections = [{ id: "c", base_unit_cost: 12, currency: null }];
  r.collectionProducts = [
    { collection_id: "c", shopify_product_id: "p" },
    { collection_id: "c", shopify_product_id: "q" },
  ];
  r.collectionTiers = [
    { collection_id: "c", min_qty: 2, total_cost: 18, currency: null },
  ];
  const items = [item(), item({ shopify_product_id: "q" })];
  const c = cfg(r);
  assert.equal(costOrder(items, "2026-09-01", c).cost, 18);
  const priced = costOrder(items, "2026-09-01", {
    ...c,
    supplierCost: { cost: 17, currency: null },
  });
  assert.deepEqual(allocateOrderCost(items, priced), [8.5, 8.5]);
});
test("COGS: unknown product ids retain their own share; missing collection does not erase cost", () => {
  const items = [item(), item({ shopify_product_id: null, unit_cost: 20 })];
  const priced = costOrder(items, "2026-09-01", cfg());
  assert.deepEqual(allocateOrderCost(items, priced), [10, 20]);
  const r = raw();
  r.collectionProducts = [
    { collection_id: "missing", shopify_product_id: "p" },
  ];
  assert.equal(costOrder([item()], "2026-09-01", cfg(r)).cost, 10);
});
test("Refunds: discount follows remaining quantity; supplier expense survives a full refund", () => {
  assert.equal(
    lineNetRevenue({
      price: 30,
      quantity: 2,
      current_quantity: 1,
      total_discount: 10,
    }),
    25,
  );
  const items = [item({ current_quantity: 0 })];
  const priced = costOrder(items, "2026-09-01", {
    ...cfg(),
    supplierCost: { cost: 12, currency: null },
  });
  assert.equal(priced.units, 0);
  assert.equal(sum(allocateOrderCost(items, priced)), 12);
});
test("Pagination: more than 1,000 orders and more than 1,000 lines in one chunk are complete", async () => {
  const data = Array.from({ length: 1250 }, (_, i) => ({
    id: String(i).padStart(4, "0"),
    user_id: "u",
    order_id: "o",
  }));
  const db = memoryDb({ orders: data, order_line_items: data });
  assert.equal((await selectAllByUser(db, "orders", "*", "u")).length, 1250);
  assert.equal(
    (await selectAllIn(db, "order_line_items", "*", "u", "order_id", ["o"]))
      .length,
    1250,
  );
});
test("Pagination: supplier table uses its composite key", async () => {
  const db = memoryDb({
    order_supplier_costs: Array.from({ length: 1005 }, (_, i) => ({
      user_id: "u",
      shopify_connection_id: "s",
      order_number: String(i),
    })),
  });
  assert.equal(
    (await selectAllByUser(db, "order_supplier_costs", "*", "u")).length,
    1005,
  );
});
test("P&L: store-specific FX, zero COGS and cost-only update preserve inputs and notes", async () => {
  const db = memoryDb({
    settings: [{ user_id: "u", currency: "EUR", fx_rate_override: 354 }],
    pnl_settings: [{ user_id: "u", currency: "€" }],
    shopify_connections: [
      { id: "h", user_id: "u" },
      { id: "e", user_id: "u" },
    ],
    orders: [
      {
        id: "h1",
        user_id: "u",
        shopify_connection_id: "h",
        currency: "HUF",
        processed_at: "2026-09-01",
      },
      {
        id: "e1",
        user_id: "u",
        shopify_connection_id: "e",
        currency: "EUR",
        processed_at: "2026-09-01",
      },
    ],
    daily_metrics: [
      {
        id: "1",
        user_id: "u",
        date: "2026-09-01",
        shopify_connection_id: "h",
        product_cost: 3540,
        gross_revenue: 35400,
        shipping_revenue: 0,
        refunds: 0,
        ad_spend_meta: 354,
        ad_spend_google: 0,
        orders_count: 1,
      },
      {
        id: "2",
        user_id: "u",
        date: "2026-09-01",
        shopify_connection_id: "e",
        product_cost: 5,
        gross_revenue: 20,
        shipping_revenue: 0,
        refunds: 0,
        ad_spend_meta: 0,
        ad_spend_google: 2,
        orders_count: 1,
      },
    ],
    pnl_days: [
      {
        id: "p",
        user_id: "u",
        year: 2026,
        month: 9,
        day: 1,
        gross_revenue: 999,
        cogs: 88,
        notes: "keep",
      },
    ],
  });
  await projectPnlMonth(db, "u", 2026, 9, { costsOnly: true });
  assert.equal(db.tables.pnl_days[0].cogs, 15);
  assert.equal(db.tables.pnl_days[0].gross_revenue, 999);
  assert.equal(db.tables.pnl_days[0].notes, "keep");
  await projectPnlMonth(db, "u", 2026, 9);
  assert.equal(db.tables.pnl_days[0].gross_revenue, 120);
  assert.equal(db.tables.pnl_days[0].adspend_fb, 1);
  assert.equal(db.tables.pnl_days[0].adspend_google, 2);
});
test("P&L includes unconfirmed Google spend in its own currency and replaces estimates with paid imports, including zero credits", async () => {
  const a = "11111111-1111-4111-8111-111111111111", b = "22222222-2222-4222-8222-222222222222";
  const campaign = (store, day, amount, kind = "script-gross") => ({ user_id: "u", campaign_id: `${kind}:${store}:123:456`, date: `2026-09-${day}`, gross_spend: amount, spend: 0, updated_at: "2026-09-24" });
  const db = memoryDb({
    settings: [{ user_id: "u", currency: "EUR", fx_rate_override: 354 }],
    shopify_connections: [{ user_id: "u", id: a, shop_name: "EUR store", shop_domain: "eur.myshopify.com" }, { user_id: "u", id: b, shop_name: "HUF store", shop_domain: "huf.myshopify.com" }],
    orders: [{ user_id: "u", shopify_connection_id: a, currency: "EUR" }, { user_id: "u", shopify_connection_id: b, currency: "HUF" }],
    google_campaigns: [campaign(a, 20, 90), campaign(a, 23, 80), campaign(a, 24, 100), campaign(b, 24, 3540), { ...campaign(a, 24, 999), user_id: "other" }],
    manual_entries: [{ user_id: "u", date: "2026-09-20", kind: "expense", label: "Google EUR store 0,00", amount: 0 }, { user_id: "u", date: "2026-09-23", kind: "expense", label: "Google EUR store 40,00", amount: 40 }],
    pnl_days: [{ user_id: "u", year: 2026, month: 9, day: 24, adspend_google: 0, notes: "keep" }],
  });
  const range = { from: "2026-09-01", to: "2026-09-30" };
  const read = () => getPnlGoogleEstimates(db, "u", range, "€");
  assert.deepEqual(await read(), { "2026-09-24": 110 });
  assert.equal(db.tables.pnl_days[0].adspend_google, 0);
  assert.equal(db.tables.pnl_days[0].notes, "keep");
  // A funded-zero snapshot suppresses the first store's full estimate.
  db.tables.google_campaigns.push(campaign(a, 24, 100, "script"));
  assert.deepEqual(await read(), { "2026-09-24": 10 });
  // A confirmed net cost also suppresses gross, instead of adding both.
  db.tables.manual_entries.push({ user_id: "u", date: "2026-09-24", kind: "expense", label: "Google HUF store 3,00", amount: 3 });
  assert.deepEqual(await read(), {});
  assert.equal(db.writes.length, 0);
});

test("P&L estimates affect daily costs, fees, profit, ROAS and cumulative totals without changing editable booked inputs", () => {
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const { PnlSheet } = require("../src/components/trackers/pnl-sheet.tsx");
  const initialDays = [
    { day: 20, gross_revenue: 100, refunds: 0, cogs: 30, adspend_fb: 10, adspend_google: 0, orders: 1, notes: "keep" },
    { day: 24, gross_revenue: 500, refunds: 0, cogs: 150, adspend_fb: 20, adspend_google: 12, orders: 1 },
  ];
  const original = structuredClone(initialDays);
  const estimates = pnlMonthGoogleEstimates({ "2026-09-24": 100, "2026-09-25": 5, "2026-08-24": 999, "2025-09-24": 999 }, 2026, 9);
  assert.deepEqual(estimates, { 24: 100, 25: 5 });
  const props = { year: 2026, month: 9, currency: "€", defaultFees: { feeFb: 0, feeGoogle: 0.1, txFee: 0, paymentPct: 0 }, override: null, initialDays };
  const html = renderToStaticMarkup(React.createElement(PnlSheet, { ...props, googleEstimates: estimates }));
  const row = (day) => html.match(new RegExp(`<tr[^>]*><td[^>]*>${day} · [\\s\\S]*?</tr>`))[0];
  assert.match(row("24"), />112\.00<\/span>/);
  assert.match(row("24"), /€11\.20/); // Google fee includes the estimated cost.
  assert.match(row("24"), /€206\.80/);
  assert.match(row("24"), /3\.79x/);
  assert.doesNotMatch(row("20"), /est\./); // Confirmed credit-funded day is untouched.
  assert.match(row("20"), /€60\.00/);
  assert.match(row("25"), /-€5\.50/); // Ad-only date without a stored P&L row.
  const footer = html.slice(html.indexOf("<tfoot>"));
  assert.match(footer, /€117\.00/);
  assert.match(footer, /€261\.30/);
  assert.deepEqual(initialDays, original);
  const confirmed = renderToStaticMarkup(React.createElement(PnlSheet, props));
  assert.doesNotMatch(confirmed, />est\.</);
  assert.match(confirmed, /€376\.80/); // Estimates disappear when replaced by confirmed imports.
});

test("Local date windows include the final instant and respect timezone boundaries", () => {
  const range = zonedRangeUtc(
    { from: "2026-09-01", to: "2026-09-01" },
    "Europe/Budapest",
  );
  assert.equal(
    new Date(range.startUtc).toISOString(),
    "2026-08-31T22:00:00.000Z",
  );
  assert.equal(
    new Date(range.endUtc).toISOString(),
    "2026-09-01T22:00:00.000Z",
  );
});

function storeFixture() {
  return {
    settings: [
      {
        user_id: "u",
        currency: "EUR",
        timezone: "UTC",
        fx_rate_override: null,
        default_product_cost_pct: 30,
        payment_fee_pct: 0,
        payment_fee_fixed: 0,
        default_shipping_cost: 0,
      },
    ],
    shopify_connections: [
      { id: "s", user_id: "u", shop_name: "Test", shop_domain: "test.invalid" },
    ],
    meta_connections: [
      { id: "meta", user_id: "u", shopify_connection_id: "s" },
    ],
    products: [
      {
        id: "p1",
        user_id: "u",
        shopify_connection_id: "s",
        shopify_product_id: "p",
        shopify_variant_id: "v",
        title: "Shirt",
        handle: "shirt",
        price: 30,
        cost: 12,
      },
    ],
    orders: [
      {
        id: "o",
        user_id: "u",
        shopify_connection_id: "s",
        order_number: "#1",
        processed_at: "2026-09-01T12:00:00Z",
        currency: "EUR",
        test: false,
        cancelled_at: null,
        financial_status: "paid",
        landing_site: null,
        subtotal_price: 60,
        total_price: 60,
        total_shipping: 0,
        total_refunded: 0,
        total_discounts: 0,
      },
    ],
    order_line_items: [
      {
        id: "l",
        user_id: "u",
        order_id: "o",
        ...item({
          quantity: 2,
          current_quantity: 2,
          total_discount: 0,
          title: "Shirt",
        }),
      },
    ],
    order_supplier_costs: [
      {
        user_id: "u",
        shopify_connection_id: "s",
        order_number: "1",
        cost: 18,
        currency: "EUR",
        paid: false,
      },
    ],
    campaign_links: [
      { id: "cl1", user_id: "u", campaign_id: "a", product_handle: "shirt" },
      { id: "cl2", user_id: "u", campaign_id: "b", product_handle: "shirt" },
    ],
    campaigns: ["a", "b"].map((id) => ({
      id,
      user_id: "u",
      meta_connection_id: "meta",
      campaign_id: id,
      campaign_name: "Same campaign name",
      date: "2026-09-01",
      spend: 5,
      clicks: 10,
      purchases: 1,
      purchase_value: 30,
      atc: 2,
    })),
    roas_settings: [{ user_id: "u", currency: "€" }],
  };
}
test("End-to-end: sheet bundle cost matches daily metrics, P&L and ROAS allocations", async () => {
  const source = storeFixture();
  source.pnl_settings = [{ user_id: "u", currency: "€" }];
  const db = memoryDb(source);
  await recomputeDailyMetrics(db, "u", {
    from: "2026-09-01",
    to: "2026-09-01",
  });
  assert.equal(db.tables.daily_metrics[0].product_cost, 18);
  assert.equal(db.tables.daily_metrics[0].profit, 32);
  await projectPnlMonth(db, "u", 2026, 9);
  assert.equal(db.tables.pnl_days[0].cogs, 18);
  await projectRoasMonth(db, "u", 2026, 9);
  assert.equal(db.tables.roas_entries.length, 2);
  close(sum(db.tables.roas_entries.map((r) => r.cog * r.units_sold)), 18);
  await projectRoasMonth(db, "u", 2026, 9);
  assert.equal(
    db.tables.roas_entries.length,
    2,
    "Repeated imports must not duplicate equal campaign names",
  );
  db.tables.roas_entries[0].price = 77;
  db.tables.roas_entries[0].total_spend = 88;
  db.tables.order_supplier_costs[0].cost = 0;
  await projectRoasMonth(db, "u", 2026, 9, { costsOnly: true });
  assert.equal(db.tables.roas_entries[0].cog, 0);
  assert.equal(db.tables.roas_entries[0].price, 77);
  assert.equal(db.tables.roas_entries[0].total_spend, 88);
});
test("End-to-end: metrics count every order above the response cap", async () => {
  const source = storeFixture();
  source.orders = Array.from({ length: 1205 }, (_, i) => ({
    ...source.orders[0],
    id: "o" + i,
    order_number: "#" + (i + 1),
  }));
  source.order_line_items = source.orders.map((o, i) => ({
    ...source.order_line_items[0],
    id: "l" + i,
    order_id: o.id,
    quantity: 1,
    current_quantity: 1,
  }));
  source.order_supplier_costs = [];
  source.campaigns = [];
  const db = memoryDb(source);
  await recomputeDailyMetrics(db, "u", {
    from: "2026-09-01",
    to: "2026-09-01",
  });
  assert.equal(db.tables.daily_metrics[0].orders_count, 1205);
  assert.equal(db.tables.daily_metrics[0].product_cost, 1205 * 12);
});
test("Campaign product handles resolve within the mapped store", () => {
  const products = [
    {
      productId: "a",
      storeId: "s1",
      handle: "shirt",
      title: "Shirt",
      price: 1,
      cost: 1,
    },
    {
      productId: "b",
      storeId: "s2",
      handle: "shirt",
      title: "Shirt",
      price: 2,
      cost: 2,
    },
  ];
  const map = new Map([
    ["c", { product: "shirt", collection: null, kind: "product" }],
  ]);
  assert.equal(buildResolver(products, map, "s2")("c", "Shirt").productId, "b");
});
test("Sales repair refreshes tracker sales and costs while preserving spending and notes", async () => {
  const db = memoryDb(storeFixture());
  await recomputeDailyMetrics(db, "u", {
    from: "2026-09-01",
    to: "2026-09-01",
  });
  await projectPnlMonth(db, "u", 2026, 9);
  await projectRoasMonth(db, "u", 2026, 9);
  const pnl = db.tables.pnl_days.find((r) => r.day === 1);
  Object.assign(pnl, {
    gross_revenue: 999,
    cogs: 999,
    adspend_fb: 123,
    adspend_google: 456,
    notes: "My note",
  });
  const roas = db.tables.roas_entries[0];
  assert.ok(roas);
  Object.assign(roas, {
    pur: 999,
    units_sold: 999,
    price: 999,
    cog: 999,
    total_spend: 123,
    cpc: 4.56,
    atc: 78,
  });
  await projectPnlMonth(db, "u", 2026, 9, { salesOnly: true });
  await projectRoasMonth(db, "u", 2026, 9, { salesOnly: true });
  assert.notEqual(pnl.gross_revenue, 999);
  assert.notEqual(pnl.cogs, 999);
  assert.equal(pnl.adspend_fb, 123);
  assert.equal(pnl.adspend_google, 456);
  assert.equal(pnl.notes, "My note");
  assert.notEqual(roas.pur, 999);
  assert.notEqual(roas.units_sold, 999);
  assert.notEqual(roas.price, 999);
  assert.notEqual(roas.cog, 999);
  assert.equal(roas.total_spend, 123);
  assert.equal(roas.cpc, 4.56);
  assert.equal(roas.atc, 78);
});

test("Unpaid AfterSell orders never enter dashboard, products, campaign sheets or COGS; settled and refunded orders remain", async () => {
  const { isPaidOrder } = require("../src/lib/shopify/paid-orders.ts");
  const { fetchTrackerOrderSales } = require("../src/lib/trackers/sales.ts");
  const { getProductPerformance } = require("../src/lib/queries.ts");
  for (const status of ["pending", "authorized", "partially_paid", "voided", "expired", "unpaid", "unknown", null, undefined]) {
    assert.equal(isPaidOrder({ financial_status: status }), false);
  }
  for (const status of ["paid", "partially_refunded", "refunded"]) {
    assert.equal(isPaidOrder({ financial_status: status }), true);
    assert.equal(isPaidOrder({ financial_status: status, test: true }), false);
    assert.equal(isPaidOrder({ financial_status: status, cancelled_at: "2026-09-01" }), false);
  }
  const source = storeFixture();
  const original = source.orders[0];
  const line = source.order_line_items[0];
  const statuses = ["pending", "authorized", "partially_paid", "voided", null];
  statuses.forEach((status, i) => {
    source.orders.push({ ...original, id: "unpaid-" + i, order_number: "#unpaid-" + i,
      financial_status: status, subtotal_price: 999, total_price: 999 });
    source.order_line_items.push({ ...line, id: "unpaid-line-" + i, order_id: "unpaid-" + i, price: 999 });
  });
  const db = memoryDb(source);
  const range = { from: "2026-09-01", to: "2026-09-01" };
  await recomputeDailyMetrics(db, "u", range);
  const day = db.tables.daily_metrics.find(r => r.shopify_connection_id === "s");
  assert.equal(day.orders_count, 1);
  assert.equal(day.gross_revenue, 60);
  assert.equal(day.product_cost, 18);
  for (const channel of ["all", "meta"]) {
    const orders = await fetchTrackerOrderSales(db, "u", range, "UTC", channel);
    assert.deepEqual(orders.map(o => o.id), [original.id]);
  }
  const products = await getProductPerformance(db, "u", range, "best", "UTC");
  assert.equal(products.length, 1);
  assert.equal(products[0].revenue, 60);
  // A later successful capture makes the same order eligible exactly once.
  db.tables.orders.find(o => o.id === "unpaid-0").financial_status = "paid";
  const settled = await fetchTrackerOrderSales(db, "u", range, "UTC", "all");
  assert.equal(settled.length, 2);
  assert.equal(settled.filter(o => o.id === "unpaid-0").length, 1);
});

test("Historical Meta expenses from every page reach the dashboard and P&L in euros", async (t) => {
  const source = storeFixture();
  source.settings[0].fx_rate_override = 354;
  source.orders[0].currency = "HUF";
  source.campaigns = [];
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    calls.push(String(url));
    const next = String(url).includes("after=second");
    return new Response(
      JSON.stringify({
        data: [
          {
            campaign_id: next ? "august" : "june",
            campaign_name: "Shirt",
            date_start: next ? "2026-08-01" : "2026-06-01",
            spend: next ? "12590.54" : "1630.43",
            clicks: "1",
          },
        ],
        ...(next
          ? {}
          : {
              paging: {
                next: "https://graph.facebook.com/test/insights?after=second",
              },
            }),
      }),
      { status: 200 },
    );
  });
  const db = memoryDb(source);
  const range = { from: "2026-06-01", to: "2026-09-15" };
  await syncMetaCampaigns(
    {
      supabase: db,
      userId: "u",
      connectionId: "meta",
      adAccountId: "act_test",
      token: "test-only",
      fxToStore: 354,
    },
    range,
  );
  assert.equal(calls.length, 2);
  assert.deepEqual(
    JSON.parse(new URL(calls[0]).searchParams.get("time_range")),
    { since: range.from, until: range.to },
  );
  await recomputeDailyMetrics(db, "u", range);
  const summary = await getRangeComparison(
    db,
    "u",
    range,
    { from: "2025-01-01", to: "2025-12-31" },
    new Map([["s", 1 / 354]]),
    "s",
  );
  assert.equal(summary.current.adSpendMeta, 14220.97);
  await projectPnlMonth(db, "u", 2026, 6);
  await projectPnlMonth(db, "u", 2026, 8);
  assert.equal(
    db.tables.pnl_days.find((r) => r.month === 6 && r.day === 1).adspend_fb,
    1630.43,
  );
  assert.equal(
    db.tables.pnl_days.find((r) => r.month === 8 && r.day === 1).adspend_fb,
    12590.54,
  );
});

test("Missing Google configuration cannot replace real advertising history with demo expenses", async (t) => {
  const keys = [
    "TOKEN_ENCRYPTION_KEY",
    "GOOGLE_ADS_CLIENT_ID",
    "GOOGLE_ADS_CLIENT_SECRET",
    "GOOGLE_ADS_DEVELOPER_TOKEN",
  ];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  t.after(() => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  process.env.TOKEN_ENCRYPTION_KEY = "11".repeat(32);
  for (const key of keys.slice(1)) delete process.env[key];
  const db = memoryDb(storeFixture());
  await assert.rejects(
    syncGoogleConnection(db, {
      id: "g",
      user_id: "u",
      shopify_connection_id: "s",
      access_token: encryptToken("real-refresh-token"),
    }),
    /não está configurado/,
  );
  assert.equal(db.writes.length, 0);
});

test("Shopify imports: edits and monetary refunds each reduce revenue exactly once", () => {
  const order = {
    id: 1,
    subtotal_price: "100",
    total_price: "100",
    refunds: [{ transactions: [], refund_line_items: [{ subtotal: "50" }] }],
  };
  const edited = mapOrder("u", "s", order);
  assert.equal(edited.subtotal_price, 50);
  assert.equal(edited.total_refunded, 0);
  order.refunds[0].transactions = [
    { kind: "refund", status: "success", amount: "50" },
  ];
  const refunded = mapOrder("u", "s", order);
  assert.equal(refunded.subtotal_price, 100);
  assert.equal(refunded.total_refunded, 50);
  assert.equal(refunded.subtotal_price - refunded.total_refunded, 50);
});

function partialPaymentFixture() {
  const money = (value, currency = 'EUR') => ({ shopMoney: { amount: String(value), currencyCode: currency } });
  const sale = (id, amount, quantity = 1, tax = 0) => ({ actionType: 'ORDER', lineType: id ? 'PRODUCT' : 'SHIPPING', quantity: id ? quantity : null,
    totalAmount: money(amount), totalTaxAmount: money(tax), ...(id ? { lineItem: { id: 'gid://shopify/LineItem/' + id } } : {}) });
  const agreement = (time, sales) => ({ happenedAt: time, sales: { nodes: sales, pageInfo: { hasNextPage: false } } });
  const order = { id: 1121, name: '#1121', processed_at: '2026-09-01T12:00:00Z', currency: 'EUR', financial_status: 'partially_paid',
    subtotal_price: '69.92', total_price: '69.92', current_total_price: '69.92', total_outstanding: '29.97', total_discounts: '9.98',
    total_tax: '0', total_shipping_price_set: money(0), test: false, cancelled_at: null, refunds: [],
    line_items: [
      { id: 1, product_id: 'p', variant_id: 'v', title: 'Original', quantity: 1, current_quantity: 1, price: '39.95', discount_allocations: [] },
      { id: 2, product_id: 'extra', variant_id: 'extra-v', title: 'Extra', quantity: 1, current_quantity: 1, price: '39.95', discount_allocations: [{ amount: '9.98' }] },
    ] };
  const evidence = { totalReceivedSet: money(39.95), totalRefundedSet: money(0), currentTotalPriceSet: money(69.92), totalOutstandingSet: money(29.97),
    agreements: { pageInfo: { hasNextPage: false }, nodes: [
      agreement('2026-09-01T12:00:00Z', [sale(1, 39.95), sale(null, 0)]),
      agreement('2026-09-01T12:01:00Z', [sale(2, 29.97)]),
    ] } };
  return { order, evidence, money, sale, agreement };
}

test('A failed AfterSell charge preserves only the captured basket across dashboard, products, COGS and collection sheets; later payment counts once', async (t) => {
  const { upsertOrder } = require('../src/lib/shopify/sync.ts');
  const { fetchTrackerOrderSales } = require('../src/lib/trackers/sales.ts');
  const { getProductPerformance } = require('../src/lib/queries.ts');
  const { buildGeneralCollections } = require('../src/lib/trackers/general-sheet.ts');
  const { order, evidence } = partialPaymentFixture();
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => { requests++; return Response.json({ data: { order: evidence } }); });
  const source = storeFixture();
  source.orders = []; source.order_line_items = []; source.order_supplier_costs = [];
  source.settings[0].payment_fee_pct = 3; source.settings[0].payment_fee_fixed = 0.3;
  const db = memoryDb(source), range = { from: '2026-09-01', to: '2026-09-01' };
  const ctx = { supabase: db, userId: 'u', connectionId: 's', shop: 'test.invalid', token: 'test-only' };
  const costs = new Map([['v', 12], ['extra-v', 7]]);
  // Import twice, with the REST lines reversed: array position cannot identify paid units.
  await upsertOrders(ctx, [{ ...order, line_items: [...order.line_items].reverse() }], costs);
  await upsertOrder(ctx, order, costs);
  assert.equal(requests, 2);
  assert.equal(db.tables.orders.length, 1);
  assert.equal(db.tables.orders[0].financial_status, 'partially_paid');
  assert.equal(db.tables.orders[0].total_price, 39.95);
  assert.equal(db.tables.orders[0].raw.revflow_paid_portion.order_total, 69.92);
  const extra = db.tables.order_line_items.find(l => l.shopify_line_item_id === '2');
  assert.equal(extra.quantity, 0); assert.equal(extra.current_quantity, 0);
  await recomputeDailyMetrics(db, 'u', range);
  let day = db.tables.daily_metrics.find(d => d.shopify_connection_id === 's');
  assert.equal(day.orders_count, 1); assert.equal(day.units_sold, 1);
  close(day.gross_revenue, 39.95); close(day.product_cost, 12); close(day.payment_fees, 1.5);
  let tracker = await fetchTrackerOrderSales(db, 'u', range, 'UTC', 'all');
  assert.equal(tracker.length, 1); close(tracker[0].grossRevenue, 39.95); close(tracker[0].cost, 12);
  const definition = (id) => ({ key: id, handle: id, name: id, storeId: 's', storeName: 'Store', productIds: [id], rate: 1, campaigns: [] });
  let collections = buildGeneralCollections([definition('p'), definition('extra')], [], tracker, range);
  assert.equal(collections[0].days[0].orders, 1); close(collections[0].days[0].grossRevenue, 39.95);
  assert.equal(collections[1].days.length, 0);
  let products = await getProductPerformance(db, 'u', range, 'best', 'UTC');
  assert.equal(products.length, 1); assert.equal(products[0].unitsSold, 1); close(products[0].revenue, 39.95);
  // The same order becomes fully paid: no second order, stale proof or zeroed extra.
  const settled = { ...order, financial_status: 'paid', total_outstanding: '0' };
  await upsertOrder(ctx, settled, costs);
  await upsertOrders(ctx, [settled], costs);
  assert.equal(requests, 2); assert.equal(db.tables.orders.length, 1);
  assert.equal(db.tables.orders[0].raw, null);
  await recomputeDailyMetrics(db, 'u', range);
  day = db.tables.daily_metrics.find(d => d.shopify_connection_id === 's');
  assert.equal(day.orders_count, 1); assert.equal(day.units_sold, 2);
  close(day.gross_revenue, 69.92); close(day.product_cost, 19); close(day.payment_fees, 2.4);
  tracker = await fetchTrackerOrderSales(db, 'u', range, 'UTC', 'all');
  collections = buildGeneralCollections([definition('p'), definition('extra')], [], tracker, range);
  assert.equal(collections[1].days[0].orders, 1);
  close(collections[1].days[0].grossRevenue, 29.97);
  close(collections[1].days[0].cogs, 7);
  close(collections[0].days[0].grossRevenue, 39.95);
  close(collections[0].days[0].cogs, 12);
  close(sum(collections.map(c => c.days[0].grossRevenue)), day.gross_revenue);
  products = await getProductPerformance(db, 'u', range, 'best', 'UTC');
  close(sum(products.map(p => p.revenue)), 69.92);
});

test('Paid baskets require reconciled captured money and complete supported sales history', () => {
  const { buildPaidPortion } = require('../src/lib/shopify/paid-portion.ts');
  const { isPaidOrder } = require('../src/lib/shopify/paid-orders.ts');
  const { order, evidence, money } = partialPaymentFixture();
  const portion = buildPaidPortion(order, evidence);
  close(portion.captured, 39.95);
  assert.deepEqual(portion.lines, { '1': { quantity: 1, discount: 0 } });
  assert.equal(isPaidOrder(mapOrder('u', 's', order, portion)), true);
  assert.equal(isPaidOrder({ ...mapOrder('u', 's', order, portion), total_price: 69.92 }), false);
  for (const mutate of [
    (o, e) => { e.totalReceivedSet = money(0); },
    (o, e) => { e.totalReceivedSet = money(20); e.totalOutstandingSet = money(49.92); o.total_outstanding = '49.92'; },
    (o, e) => { e.totalReceivedSet = money(39.95, 'USD'); },
    (o, e) => { e.totalRefundedSet = money(5); },
    (o) => { o.test = true; },
    (o) => { o.cancelled_at = '2026-09-01'; },
    (o) => { o.refunds = [{ transactions: [] }]; },
    (o) => { o.current_total_price = '90'; },
    (o, e) => { e.agreements.pageInfo.hasNextPage = true; },
    (o, e) => { e.agreements.nodes[0].sales.pageInfo.hasNextPage = true; },
    (o, e) => { e.agreements.nodes[0].sales.nodes[0].actionType = 'RETURN'; },
    (o, e) => { e.agreements.nodes[0].sales.nodes[0].lineType = 'TIP'; },
    (o, e) => { e.agreements.nodes[0].sales.nodes[0].lineItem.id = 'missing'; },
    (o, e) => { e.agreements.nodes[0].sales.nodes[0].quantity = 2; },
  ]) {
    const o = structuredClone(order), e = structuredClone(evidence); mutate(o, e);
    assert.equal(buildPaidPortion(o, e), null);
  }
});

test('Paid portion separates discounts, shipping and exclusive/inclusive tax without counting unpaid extras', () => {
  const { buildPaidPortion } = require('../src/lib/shopify/paid-portion.ts');
  const { order, evidence, money, sale } = partialPaymentFixture();
  order.line_items[0].price = '50';
  order.total_price = order.current_total_price = '83.97'; order.total_outstanding = '29.97';
  evidence.totalReceivedSet = money(54); evidence.currentTotalPriceSet = money(83.97);
  evidence.agreements.nodes[0].sales.nodes = [sale(1, 48, 1, 8), sale(null, 6, 1, 1)];
  let portion = buildPaidPortion(order, evidence);
  close(portion.subtotal, 40); close(portion.shipping, 5); close(portion.tax, 9); close(portion.discounts, 10);
  close(portion.subtotal + portion.shipping + portion.tax, portion.captured);
  order.taxes_included = true;
  portion = buildPaidPortion(order, evidence);
  close(portion.subtotal, 48); close(portion.shipping, 6); close(portion.discounts, 2);
  close(portion.subtotal + portion.shipping, portion.captured);
});

test('Payment-history failures leave the previous complete accounting snapshot intact', async (t) => {
  const { order } = partialPaymentFixture();
  const db = memoryDb({ orders: [{ id: 'o', user_id: 'u', shopify_order_id: '1121', financial_status: 'paid', total_price: 39.95 }], order_line_items: [] });
  t.mock.method(globalThis, 'fetch', async () => Response.json({ errors: [{ message: 'Throttled' }] }));
  await assert.rejects(upsertOrders({ supabase: db, userId: 'u', connectionId: 's', shop: 'test.invalid', token: 'test-only' }, [order], new Map()), /payment history unavailable/);
  assert.equal(db.writes.length, 0);
  assert.equal(db.tables.orders[0].total_price, 39.95);
});

test('Paid basket evidence follows agreement pagination before reconciling the captured amount', async (t) => {
  const { fetchPaidPortion } = require('../src/lib/shopify/paid-portion.ts');
  const { order, evidence } = partialPaymentFixture();
  const cursors = [];
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const after = JSON.parse(options.body).variables.after; cursors.push(after);
    return Response.json({ data: { order: { ...evidence, agreements: { nodes: [evidence.agreements.nodes[after ? 1 : 0]],
      pageInfo: { hasNextPage: !after, endCursor: after ? 'last' : 'page-2' } } } } });
  });
  const portion = await fetchPaidPortion('test.invalid', 'test-only', order);
  assert.deepEqual(cursors, [null, 'page-2']);
  close(portion.captured, 39.95);
  assert.deepEqual(Object.keys(portion.lines), ['1']);
});
