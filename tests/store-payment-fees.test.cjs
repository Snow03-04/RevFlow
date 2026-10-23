process.env.NEXT_PUBLIC_SUPABASE_URL='https://test.invalid';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='test';
require('../scripts/register-ts.cjs');
const test=require('node:test'),assert=require('node:assert/strict');
const {memoryDb}=require('./helpers/memory-db.cjs');
const {recomputeDailyMetrics}=require('../src/lib/metrics.ts');
const {fetchTrackerOrderSales}=require('../src/lib/trackers/sales.ts');
const {getStorePnlDays,projectPnlDays}=require('../src/lib/trackers/pnl-projection.ts');
const {calcPnlDay}=require('../src/lib/trackers/pnl.ts');
const {loadPaymentPolicy}=require('../src/lib/trackers/payment-policy.ts');
const {normalizePayments}=require('../src/lib/shopify/payments-model.ts');
const close=(a,b)=>assert.ok(Math.abs(a-b)<.000001,`${a} != ${b}`);

test('Shopify fees, missing evidence and zero manual rates agree across metrics and P&L without mixing stores or users',async t=>{
 t.mock.method(global,'fetch',async url=>Response.json({rates:{EUR:.9,USD:1/.9}}));
 const date='2026-10-23',processed=date+'T12:00:00Z';
 const snapshot=normalizePayments([{id:1,type:'charge',amount:'100',fee:'3',net:'97',currency:'USD',source_order_id:10,
   source_order_transaction_id:11,processed_at:processed}],[],[]);
 snapshot.orders={'10':{updatedAt:processed,transactionIds:['11'],captured:100,refunded:0,currency:'EUR',mixed:false}};
 const order=(id,store)=>({user_id:'u',id:String(id),shopify_order_id:String(id),shopify_connection_id:store,
   order_number:'#'+id,processed_at:processed,currency:'EUR',subtotal_price:100,total_price:100,total_shipping:0,
   total_discounts:0,total_refunded:0,test:false,cancelled_at:null,financial_status:'paid'});
 const db=memoryDb({settings:[{user_id:'u',currency:'EUR',timezone:'UTC',default_product_cost_pct:0}],
  pnl_settings:[{user_id:'u',currency:'€',payment_fee_pct:.04,transaction_fee:.3}],
  shopify_connections:[{id:'auto',user_id:'u',reporting_base_currency:'EUR',payment_fee_mode:'shopify',payment_fee_pct:.025,payment_fee_fixed:.3,payment_fee_currency:'USD'},
   {id:'manual',user_id:'u',reporting_base_currency:'EUR',payment_fee_mode:'manual',payment_fee_pct:0,payment_fee_fixed:0,payment_fee_currency:'EUR'},
   {id:'general',user_id:'u',reporting_base_currency:'EUR',payment_fee_mode:'inherit'},
   {id:'foreign',user_id:'other',payment_fee_mode:'manual',payment_fee_pct:.99}],
  shopify_payment_accounts:[{user_id:'u',shopify_connection_id:'auto',snapshot}],
  orders:[order(10,'auto'),order(20,'auto'),order(30,'manual'),order(40,'general'),{...order(50,'foreign'),user_id:'other'}]});
 const range={from:date,to:date};
 await recomputeDailyMetrics(db,'u',range);
 const auto=db.tables.daily_metrics.find(r=>r.shopify_connection_id==='auto');
 close(auto.payment_fees,5.47);close(auto.payment_adjustment,-10);close(auto.profit,184.53);
 assert.equal(auto.payment_orders_actual,1);assert.equal(auto.payment_orders_estimated,1);
 close(db.tables.daily_metrics.find(r=>r.shopify_connection_id==='manual').payment_fees,0);
 close(db.tables.daily_metrics.find(r=>r.shopify_connection_id==='general').payment_fees,4.3);
 assert.equal(db.tables.daily_metrics.length,3);
 const sales=await fetchTrackerOrderSales(db,'u',range,'UTC','all');
 close(sales.filter(r=>r.storeId==='auto').reduce((n,r)=>n+r.paymentFees,0),5.47);
 const days=await getStorePnlDays(db,'u',range,'auto','EUR');
 const fees={feeFb:0,feeGoogle:0,paymentPct:.99,txFee:99};
 const pnl=calcPnlDay({grossRevenue:days[0].gross_revenue,refunds:0,cogs:0,adspendFb:0,adspendGoogle:0,orders:2,
  paymentFees:days[0].payment_fees,paymentAdjustment:days[0].payment_adjustment},fees);
 close(pnl.profit,auto.profit);close(pnl.paymentFee,auto.payment_fees);
 const total=projectPnlDays(db.tables.daily_metrics,new Map([['auto',1],['manual',1],['general',1]]));
 close(total[0].payment_fees,9.77);
 const previous=structuredClone(db.tables.daily_metrics);await recomputeDailyMetrics(db,'u',range);assert.deepEqual(db.tables.daily_metrics,previous);
 // A stale/mixed proof must return to the configured estimate, never a zero fee.
 snapshot.orders['10'].mixed=true;db.tables.shopify_payment_accounts[0].snapshot=snapshot;
 await recomputeDailyMetrics(db,'u',range);
 close(db.tables.daily_metrics.find(r=>r.shopify_connection_id==='auto').payment_fees,5.54);
});

test('Store rates override monthly general fees while inherited stores retain month-specific zero',async()=>{
 const db=memoryDb({pnl_settings:[{user_id:'u',currency:'€',payment_fee_pct:.04,transaction_fee:.3}],
  pnl_month_overrides:[{user_id:'u',year:2026,month:10,transaction_fee:0}],
  shopify_connections:[{user_id:'u',id:'s',payment_fee_mode:'manual',payment_fee_pct:0,payment_fee_fixed:1,payment_fee_currency:'USD'},
   {user_id:'other',id:'foreign',payment_fee_mode:'shopify',payment_fee_pct:.9}]});
 const policy=await loadPaymentPolicy(db,'u',null);
 assert.equal(policy.forStore('s').currency,'USD');assert.equal(policy.forStore('s').paymentPct,0);
 assert.equal(policy.forStore('s').fixedForDate('2026-10-23'),1);
 assert.equal(policy.forStore('foreign').actual,false);assert.equal(policy.forStore(null).fixedForDate('2026-10-23'),0);
 assert.equal(policy.forStore(null).fixedForDate('2026-09-23'),.3);
});
