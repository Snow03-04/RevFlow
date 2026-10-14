process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.invalid';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-only';
require('../scripts/register-ts.cjs');
const test = require('node:test'), assert = require('node:assert/strict');
const {memoryDb} = require('./helpers/memory-db.cjs');
const {calcPnlDay} = require('../src/lib/trackers/pnl.ts');
const {recomputeDailyMetrics} = require('../src/lib/metrics.ts');
const {fetchTrackerOrderSales} = require('../src/lib/trackers/sales.ts');
const {fetchReadWithRetry} = require('../src/lib/retry-read.ts');
const {mapOrder} = require('../src/lib/shopify/sync.ts');
const close = (a,b) => assert.ok(Math.abs(a-b)<.00001, `${a} != ${b}`);
function freshFx() { const name=require.resolve('../src/lib/fx.ts'); delete require.cache[name]; return require(name); }

test('Imported fees never override the common rate, and changing the rate recalculates the profit', () => {
  const input={grossRevenue:15792.42,refunds:0,cogs:5251.28,adspendFb:3760.42,adspendGoogle:970.05,
    orders:224,paymentFees:694.8,paymentAdjustment:-815.68};
  const fees={feeFb:0,feeGoogle:0,paymentPct:.04,txFee:.3};
  close(calcPnlDay(input,fees).profit,4296.0932);
  close(calcPnlDay({...input,paymentFees:9999},fees).profit,4296.0932);
  close(calcPnlDay(input,{...fees,paymentPct:.025}).profit,4532.9795);
  // Editing revenue/order count must also update the estimate immediately.
  close(calcPnlDay({...input,grossRevenue:100,orders:1},fees).paymentFee,4.3);
});

test('All stores use the P&L policy in its currency, including monthly zero and fixed overrides', async () => {
  const settings={user_id:'u',currency:'EUR',timezone:'UTC',fx_rate_override:354,fx_override_currency:'HUF',
    payment_fee_pct:99,payment_fee_fixed:99,default_product_cost_pct:0,default_shipping_cost:0};
  const orders=['huf','eur'].map((id,i)=>({id,user_id:'u',shopify_connection_id:id,shopify_order_id:String(i+1),
    order_number:'#'+(i+1),processed_at:'2026-09-01T12:00:00Z',currency:i?'EUR':'HUF',
    subtotal_price:i?100:35400,total_price:i?100:35400,total_shipping:0,total_discounts:0,total_refunded:0,
    financial_status:'paid',test:false,cancelled_at:null}));
  const db=memoryDb({settings:[settings],pnl_settings:[{user_id:'u',currency:'€',payment_fee_pct:.04,transaction_fee:.3},
    {user_id:'other',currency:'€',payment_fee_pct:.99,transaction_fee:99}],
    pnl_month_overrides:[{user_id:'u',year:2026,month:9,transaction_fee:.5}],
    shopify_connections:[{user_id:'u',id:'huf',reporting_base_currency:'HUF'},{user_id:'u',id:'eur',reporting_base_currency:'EUR'}],
    orders,order_line_items:orders.map(o=>({user_id:'u',id:o.id,order_id:o.id,shopify_product_id:'p',quantity:1,current_quantity:1,price:o.subtotal_price,unit_cost:0}))});
  const range={from:'2026-09-01',to:'2026-09-01'};
  await recomputeDailyMetrics(db,'u',range);
  const h=db.tables.daily_metrics.find(m=>m.shopify_connection_id==='huf'),e=db.tables.daily_metrics.find(m=>m.shopify_connection_id==='eur');
  close(h.payment_fees/354,4.5); close(e.payment_fees,4.5);
  const sales=await fetchTrackerOrderSales(db,'u',range,'UTC','all');
  close(sales.find(o=>o.storeId==='huf').paymentFees/354,4.5);
  close(sales.find(o=>o.storeId==='eur').paymentFees,4.5);
  db.tables.pnl_month_overrides[0].transaction_fee=0;
  await recomputeDailyMetrics(db,'u',range);
  close(db.tables.daily_metrics.find(m=>m.shopify_connection_id==='eur').payment_fees,4);
});

test('Removed unpaid AfterSell value never becomes a refund or a processing fee base', () => {
  const order=mapOrder('u','s',{id:1,financial_status:'paid',subtotal_price:'76.92',total_price:'76.92',
    refunds:[{transactions:[],refund_line_items:[{subtotal:'32.97'}]}]});
  close(order.subtotal_price,43.95); assert.equal(order.total_refunded,0);
  const c=calcPnlDay({grossRevenue:order.subtotal_price,refunds:order.total_refunded,cogs:0,adspendFb:0,adspendGoogle:0,orders:1},
    {feeFb:0,feeGoogle:0,paymentPct:.04,txFee:.3});
  close(c.paymentFee,2.058); close(c.profit,41.892);
});

test('Pinned HUF/EUR survives an intermediate CAD reporting currency in both directions', async t => {
  const fx=freshFx(),seen=[];
  t.mock.method(global,'fetch',async url=>{const u=new URL(url);seen.push(u.search);return Response.json({rates:{CAD:1.6,EUR:.625}});});
  const ctx={override:354,overrideCurrency:'HUF',displayCurrency:'EUR',required:true};
  const hufCad=await fx.resolveFx('HUF','CAD',ctx),cadEur=await fx.resolveFx('CAD','EUR',ctx);
  close(hufCad*cadEur,1/354);
  close(await fx.resolveFx('CAD','HUF',ctx),.625*354);
  assert.ok(seen.every(q=>!q.includes('from=HUF')));
});

test('FX cache coalesces calls, retries a transient failure and refuses expired or missing rates', async t => {
  const fx=freshFx(); let now=1_800_000_000_000,calls=0,offline=false;
  t.mock.method(Date,'now',()=>now);
  t.mock.method(global,'fetch',async()=>{calls++;return offline||calls===1?new Response('temporary',{status:503}):Response.json({rates:{RON:5}});});
  assert.deepEqual(await Promise.all([fx.getRequiredRate('EUR','RON'),fx.getRequiredRate('EUR','RON')]),[5,5]);
  assert.equal(calls,2);
  assert.equal(await fx.getRequiredRate('EUR','RON'),5);assert.equal(calls,2);
  offline=true;now+=13*60*60*1000;
  assert.equal(await fx.getRequiredRate('EUR','RON'),5);assert.equal(calls,4);
  now+=36*60*60*1000;
  await assert.rejects(()=>fx.getRequiredRate('EUR','RON'),/FX rate unavailable/);
  await assert.rejects(()=>fx.getRequiredRate('CAD','EUR'),/FX rate unavailable/);
});

test('Read retries recover 502, keep an upper bound and never replay writes or authorization failures', async t => {
  let calls=0;
  t.mock.method(global,'fetch',async()=>new Response('',{status:++calls===1?502:200}));
  assert.equal((await fetchReadWithRetry('https://example.test/data')).status,200);assert.equal(calls,2);
  for(const method of ['POST','PATCH','DELETE']) {calls=0;assert.equal((await fetchReadWithRetry('https://example.test/data',{method})).status,502);assert.equal(calls,1);}
  calls=0;t.mock.method(global,'fetch',async()=>{calls++;return new Response('',{status:403});});
  assert.equal((await fetchReadWithRetry('https://example.test/data')).status,403);assert.equal(calls,1);
  calls=0;t.mock.method(global,'fetch',async()=>{calls++;return new Response('',{status:503});});
  assert.equal((await fetchReadWithRetry('https://example.test/data')).status,503);assert.equal(calls,3);
});
