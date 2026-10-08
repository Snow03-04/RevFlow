process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test";
require("../scripts/register-ts.cjs");
const test = require("node:test");
const assert = require("node:assert/strict");
const { memoryDb } = require("./helpers/memory-db.cjs");
const { normalizePayments, reconcilePayments, orderPaymentEffect, isProfitAdjustment } = require("../src/lib/shopify/payments-model.ts");
const { computeProfit } = require("../src/lib/profit.ts");
const { calcPnlDay, addOrderPayments } = require("../src/lib/trackers/pnl.ts");
const { projectPnlMonth } = require("../src/lib/trackers/pnl-import.ts");
const { recomputeDailyMetrics } = require("../src/lib/metrics.ts");
const { fetchTrackerOrderSales } = require("../src/lib/trackers/sales.ts");
const { resolveFx } = require("../src/lib/fx.ts");
const { getStoreCurrency } = require("../src/lib/queries.ts");
const { fetchPaymentSnapshot, syncShopifyPayments, loadPaymentSnapshots } = require("../src/lib/shopify/payments.ts");
const { encryptToken } = require("../src/lib/crypto.ts");
const { collectionOrderShare } = require("../src/lib/trackers/collection-sales.ts");
const { buildGoogleCollections, summariseCollection } = require("../src/lib/trackers/google-collections.ts");
const raw = (extra = {}) => ({ id: 1, type: "charge", currency: "EUR", amount: "100", fee: "4", net: "96", source_order_id: 10,
  source_order_transaction_id: 11, payout_id: 20, test: false, processed_at: "2026-09-01T12:00:00Z", ...extra });
const payout = (extra = {}) => ({ id: 20, date: "2026-09-03", status: "paid", currency: "EUR", amount: "96", ...extra });
const check = (extra = {}) => ({ updatedAt: "2026-09-01T12:00:00Z", transactionIds: ["11"], captured: 35400, refunded: 0, currency: "HUF", mixed: false, ...extra });
const order = (extra = {}) => ({ shopify_order_id: "10", total_price: 35400, total_refunded: 0, currency: "HUF", financial_status: "paid", ...extra });
const close = (a,b) => assert.ok(Math.abs(a-b)<0.00001, `${a} != ${b}`);
const fees = { feeFb: 0, feeGoogle: 0, paymentPct: .025, txFee: .3 };

test("Cash retains EUR/USD and reconciles payouts once, including negative bank debits", () => {
  const snapshot = normalizePayments([raw(), raw({id:2,type:"payout",source_order_id:null,payout_id:null,amount:"-96",fee:"0",net:"-96"}),
    raw({id:3,currency:"USD",payout_id:21,amount:"50",fee:"3",net:"47"}),
    raw({id:4,currency:"USD",type:"refund",payout_id:22,amount:"-20",fee:"0",net:"-20"}),
    raw({id:5,payout_id:null,amount:"10",fee:"1",net:"9"}), raw({id:6,test:true,payout_id:null})],
    [payout(),payout({id:21,currency:"USD",amount:"47"}),payout({id:22,currency:"USD",amount:"-20",status:"in_transit"})], [{currency:"EUR",amount:"9"}]);
  const r = reconcilePayments(snapshot); assert.equal(r.unreconciled,0);
  assert.equal(r.totals.find(t=>t.currency==="EUR").toArrive,9);
  const usd=r.totals.find(t=>t.currency==="USD"); assert.equal(usd.paid,47); assert.equal(usd.toArrive,-20); assert.equal(usd.net,27);
});
test("Failed/cancelled payouts never count as paid or money on its way", () => {
  const r=reconcilePayments(normalizePayments([raw()], [payout({status:"failed"}),payout({id:21,status:"canceled"})],[]));
  assert.equal(r.totals[0].paid,0); assert.equal(r.totals[0].toArrive,0); assert.equal(r.unreconciled,1);
});
test("Dispute debit and reversal net correctly; fees stay costs and reserves are not expenses", () => {
  const s=normalizePayments([raw({type:"dispute",amount:"-60",fee:"15",net:"-75"}),raw({id:2,type:"dispute",amount:"60",fee:"-15",net:"75"})],[],[]);
  assert.equal(reconcilePayments(s).totals[0].net,0); assert.ok(s.transactions.every(isProfitAdjustment));
  assert.equal(isProfitAdjustment({...s.transactions[0],type:"reserve"}),false);
  assert.equal(isProfitAdjustment({...s.transactions[0],type:"payout"}),false);
});
test("Bad money/FX data cannot overwrite a valid ledger; duplicate IDs count only once", () => {
  assert.throws(()=>normalizePayments([raw({amount:"unknown"})],[],[]));
  assert.throws(()=>normalizePayments([raw({net:"97"})],[],[]));
  assert.throws(()=>normalizePayments([raw({currency:null})],[],[]));
  assert.equal(normalizePayments([raw(),raw()],[],[]).transactions.length,1);
});
test("Real settlement replaces assumed fees and captures actual exchange once without a fictional bank conversion", () => {
  const tx=normalizePayments([raw({amount:"95",fee:"4",net:"91"})],[],[]).transactions;
  const e=orderPaymentEffect(order(),tx,()=>354,990,1,check()); assert.ok(e.actual);
  assert.equal(e.fees,1416); assert.equal(e.adjustment,-1770);
  const p=computeProfit({grossRevenue:35400,shippingRevenue:0,refunds:0,productCost:0,ordersTotalValue:35400,ordersCount:1,adSpend:0,paymentFees:e.fees,paymentAdjustment:e.adjustment},{payment_fee_pct:50,payment_fee_fixed:999,default_shipping_cost:0});
  assert.equal(p.profit/354,91);
});
test("Missing capture, stale order proof and mixed gateways retain a clearly estimated fee", () => {
  const tx=normalizePayments([raw()],[],[]).transactions;
  for(const proof of [undefined,check({transactionIds:["11","12"]}),check({mixed:true}),check({currency:"CAD"})])
    assert.deepEqual(orderPaymentEffect(order(),tx,()=>354,7,1,proof),{fees:7,adjustment:0,actual:false});
  assert.equal(orderPaymentEffect(order({raw:{updated_at:"2026-10-01T00:00:00Z"}}),tx,()=>354,7,1,check()).actual,false);
});
test("Several captures, refunds and changes in payout currency preserve net settlement; authorizations are not captures", () => {
  const tx=normalizePayments([raw(),raw({id:2,source_order_transaction_id:12,currency:"USD",amount:"20",fee:"1",net:"19"}),
    raw({id:3,type:"refund",source_order_transaction_id:13,amount:"-10",fee:"0",net:"-10"})],[],[]).transactions;
  const e=orderPaymentEffect(order({currency:"EUR",total_price:120,total_refunded:10}),tx,c=>c==="USD"?.9:1,20,1,check({currency:"EUR",transactionIds:["11","12","13"]}));
  assert.equal(e.actual,true); close(e.fees,4.9); close(e.adjustment,-2);
});
test("Mixed actual/estimated campaign fees conserve allocation and keep monthly assumptions for the unverified portion", () => {
  const input={grossRevenue:200,refunds:0,cogs:0,adspendFb:0,adspendGoogle:0,orders:2};
  addOrderPayments(input,{grossRevenue:100},1,1);
  addOrderPayments(input,{grossRevenue:100,paymentFees:5,paymentAdjustment:-2},1,1);
  const c=calcPnlDay(input,fees); close(c.paymentFee,7.8); close(c.profit,190.2);
  const share=collectionOrderShare({grossRevenue:100,refunds:0,paymentFees:5,paymentAdjustment:-2,items:[{productId:"a",units:1,revenue:40,weight:40,cost:10},{productId:"b",units:1,revenue:60,weight:60,cost:15}]},new Set(["a"]));
  close(share.paymentFees,2); close(share.paymentAdjustment,-.8);
});
test("Shopify coverage and actual fees flow into metrics, P&L, costs-only repair and campaign sales, isolated by store", async () => {
  const snapshot=normalizePayments([raw(),raw({id:2,type:"dispute",processed_at:"2026-09-02T10:00:00Z",amount:"-10",fee:"15",net:"-25"})],[],[]);
  snapshot.orders={"10":check({currency:"EUR",captured:100})};
  const db=memoryDb({settings:[{user_id:"u",currency:"EUR",timezone:"UTC",payment_fee_pct:2.5,payment_fee_fixed:.3,default_product_cost_pct:30,default_shipping_cost:0}],
    shopify_connections:[{user_id:"u",id:"s",reporting_base_currency:"EUR"}],
    shopify_payment_accounts:[{user_id:"u",shopify_connection_id:"s",snapshot},{user_id:"other",shopify_connection_id:"foreign",snapshot}],
    orders:[{...order({currency:"EUR",total_price:100}),id:"o",user_id:"u",shopify_connection_id:"s",order_number:"#10",processed_at:"2026-09-01T12:00:00Z",subtotal_price:100,total_shipping:0,total_discounts:0,test:false,cancelled_at:null}],
    order_line_items:[{id:"l",user_id:"u",order_id:"o",shopify_product_id:"p",quantity:1,current_quantity:1,price:100,unit_cost:30}],pnl_settings:[{user_id:"u",currency:"€"}]});
  await recomputeDailyMetrics(db,"u",{from:"2026-09-01",to:"2026-09-02"});
  const [a,b]=db.tables.daily_metrics; assert.equal(a.profit,66); assert.equal(a.payment_fees,4); assert.equal(a.payment_orders_actual,1);
  assert.equal(b.orders_count,0);assert.equal(b.payment_fees,15);assert.equal(b.payment_adjustment,-10);assert.equal(b.profit,-25);
  await projectPnlMonth(db,"u",2026,9); assert.equal(db.tables.pnl_days[0].payment_fees,4);assert.equal(db.tables.pnl_days[1].payment_adjustment,-10);
  db.tables.pnl_days[0].notes="Keep";db.tables.pnl_days[0].gross_revenue=999;
  await projectPnlMonth(db,"u",2026,9,{costsOnly:true});assert.equal(db.tables.pnl_days[0].gross_revenue,999);assert.equal(db.tables.pnl_days[0].notes,"Keep");
  const sales=await fetchTrackerOrderSales(db,"u",{from:"2026-09-01",to:"2026-09-01"},"UTC","all");assert.equal(sales[0].paymentFees,4);
  assert.deepEqual([...(await loadPaymentSnapshots(db,"u")).keys()],["s"]);
});
test("A currency change never reinterprets historical store totals; HUF override cannot apply to USD", async () => {
  const db=memoryDb({shopify_connections:[{id:"s",user_id:"u",reporting_base_currency:"HUF"}],orders:[{user_id:"u",shopify_connection_id:"s",currency:"CAD",processed_at:"2026-10-01"}]});
  assert.equal(await getStoreCurrency(db,"u","s"),"HUF");
  const original=global.fetch;global.fetch=async()=>new Response(JSON.stringify({rates:{EUR:.92}}),{status:200});
  try {assert.equal(await resolveFx("HUF","EUR",{storeCurrency:"HUF",displayCurrency:"EUR",override:354,overrideCurrency:"HUF",required:true}),1/354);
    assert.equal(await resolveFx("USD","EUR",{storeCurrency:"USD",displayCurrency:"EUR",override:354,overrideCurrency:"HUF",required:true}),.92);
  } finally {global.fetch=original;}
});
test("A failed page or permission error keeps the last successful snapshot and exposes an error", async () => {
  process.env.TOKEN_ENCRYPTION_KEY="11".repeat(32);
  const saved=normalizePayments([raw()],[payout()],[]);
  const conn={id:"s",user_id:"u",shop_domain:"store.myshopify.com",auth_type:"token",access_token:encryptToken("test-only")};
  const db=memoryDb({shopify_payment_accounts:[{shopify_connection_id:"s",user_id:"u",snapshot:saved,synced_at:"2026-09-01",refresh_pending:true}]});
  const original=global.fetch;global.fetch=async()=>new Response("forbidden",{status:403});
  try {const result=await syncShopifyPayments(db,conn);assert.equal(result.available,true);assert.equal(result.changed,true);
    assert.deepEqual(db.tables.shopify_payment_accounts[0].snapshot,saved);assert.equal(db.tables.shopify_payment_accounts[0].synced_at,"2026-09-01");assert.match(db.tables.shopify_payment_accounts[0].last_error,/permissão/);
  } finally {global.fetch=original;}
});
test("Ledger pagination imports all pages and missing payloads fail instead of erasing history", async () => {
  const original=global.fetch;
  global.fetch=async(url)=>{
    const u=new URL(url);const resource=u.pathname;
    if(resource.includes("transactions")) return u.searchParams.has("page_info") ? Response.json({transactions:[raw({id:2})]})
      : new Response(JSON.stringify({transactions:[raw()]}),{headers:{Link:'<https://store.myshopify.com/admin/api/2026-07/shopify_payments/balance/transactions.json?page_info=second>; rel="next"'}});
    if(resource.includes("payouts"))return Response.json({payouts:[payout()]});
    return Response.json({balance:[]});
  };
  try {assert.equal((await fetchPaymentSnapshot("store.myshopify.com","test")).transactions.length,2);
    global.fetch=async()=>Response.json({});await assert.rejects(()=>fetchPaymentSnapshot("store.myshopify.com","test"),/incompleto/);
  } finally {global.fetch=original;}
});
test("Google collection profit deducts actual payment fees and settlement changes exactly once for mixed baskets", () => {
  const campaign={key:"k",campaignId:"1",name:"Test",storeId:"s",rate:1,collectionHandle:"a"};
  const order={id:"o",storeId:"s",date:"2026-09-01",collectionHandle:null,grossRevenue:100,refunds:0,cost:25,
    paymentFees:5,paymentAdjustment:-2,items:[{productId:"p",units:1,revenue:40,weight:40,cost:10},{productId:"q",units:1,revenue:60,weight:60,cost:15}]};
  const groups=buildGoogleCollections([campaign],[{key:"k",date:"2026-09-01",spend:2,grossSpend:2,conversions:1,conversionValue:40,clicks:1,impressions:1}],
    [order],[{id:"s",name:"S",rate:1}],[],new Map([["s:a",["p"]]]));
  const s=summariseCollection(groups[0].days,true);close(s.paymentFees,2);close(s.paymentAdjustment,-.8);close(s.profit,25.2);
});
test("Repeated automatic refresh is idempotent; changing only the transfer status does not rebuild profit", async () => {
  process.env.TOKEN_ENCRYPTION_KEY="11".repeat(32);
  const saved=normalizePayments([raw()],[payout()],[]);saved.orders={"10":check()};
  // jsonb does not preserve insertion order. Round-trip through the database's
  // reordered representation before comparing with a freshly parsed API result.
  saved.transactions=saved.transactions.map(t=>Object.fromEntries(Object.entries(t).reverse()));
  saved.orders["10"]=Object.fromEntries(Object.entries(saved.orders["10"]).reverse());
  const conn={id:"s",user_id:"u",shop_domain:"store.myshopify.com",auth_type:"token",access_token:encryptToken("test-only")};
  const db=memoryDb({shopify_payment_accounts:[{shopify_connection_id:"s",user_id:"u",snapshot:saved,refresh_pending:false}],
    orders:[{user_id:"u",shopify_connection_id:"s",shopify_order_id:"10",source_updated_at:check().updatedAt}]});
  const original=global.fetch;global.fetch=async(url)=>url.includes("transactions")?Response.json({transactions:[raw()]}):url.includes("payouts")?Response.json({payouts:[payout({status:"in_transit"})]}):Response.json({balance:[]});
  try {assert.deepEqual(await syncShopifyPayments(db,conn),{changed:false,available:true});
    assert.equal(db.tables.shopify_payment_accounts[0].snapshot.payouts[0].status,"in_transit");
    assert.deepEqual(await syncShopifyPayments(db,conn),{changed:false,available:true});
    db.tables.shopify_payment_accounts[0].refresh_pending=true;
    assert.equal((await syncShopifyPayments(db,conn)).changed,true);
  } finally {global.fetch=original;}
});

test("Pending-cash card renders native currencies, negative debits and selected-store coverage without exposing another user", async () => {
  const { renderToStaticMarkup } = require("react-dom/server");
  const server = require("../src/lib/supabase/server.ts");
  const { PendingPayments } = require("../src/components/dashboard/pending-payments.tsx");
  const eur = normalizePayments([raw()], [payout({status:"in_transit"})], []);
  const usd = normalizePayments([raw({currency:"USD",type:"refund",amount:"-20",fee:"0",net:"-20"})], [payout({currency:"USD",amount:"-20",status:"in_transit"})], []);
  const db = memoryDb({shopify_payment_accounts:[
    {user_id:"u",shopify_connection_id:"a",snapshot:eur,synced_at:new Date().toISOString()},
    {user_id:"u",shopify_connection_id:"b",snapshot:usd,synced_at:new Date().toISOString()},
    {user_id:"other",shopify_connection_id:"foreign",snapshot:eur,synced_at:new Date().toISOString()},
  ]});
  const original = server.createClient; server.createClient = async () => db;
  const render = async props => renderToStaticMarkup(await PendingPayments({userId:"u",storeCount:2,...props})).replace(/\s+/g," ");
  try {
    const all = await render({});
    assert.match(all,/96,00 €/); assert.match(all,/-20,00/); assert.match(all,/USD · a debitar/);
    assert.match(all,/independente do período de vendas/); assert.doesNotMatch(all,/192,00|Algumas lojas/);
    const selected = await render({storeId:"a"});
    assert.match(selected,/96,00 €/); assert.doesNotMatch(selected,/USD|-20,00|Algumas lojas/);
    assert.match(await render({storeCount:3}),/Algumas lojas/);
    db.tables.shopify_payment_accounts[0].last_error="Unavailable";
    assert.match(await render({storeId:"a"}),/dados por atualizar/);
    assert.match(await render({storeId:"missing"}),/Recebimentos ainda por sincronizar/);
  } finally { server.createClient = original; }
});
