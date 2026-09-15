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
const { pnlUrl } = require("../src/lib/trackers/pnl-navigation.ts");
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
