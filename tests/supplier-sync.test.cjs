process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.invalid';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-only';
require('../scripts/register-ts.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const {memoryDb} = require('./helpers/memory-db.cjs');
const {parseSupplierCsv,parseSheetRef} = require('../src/lib/supplier/sheet.ts');
const {supplierConnection,supplierConnections,supplierConnectionUrl,upsertSupplierConnection,removeSupplierConnection} = require('../src/lib/supplier/connection.ts');
const {syncSupplierCosts} = require('../src/lib/supplier/sync.ts');
const {buildSupplierPlan} = require('../src/lib/supplier/plan.ts');
const {buildOrderCostConfig,costOrder} = require('../src/lib/cogs/order-cost.ts');
const {buildQuantityQuotes} = require('../src/lib/supplier/quantity-quotes.ts');
const {loadCostData} = require('../src/lib/cogs/data.ts');
const refresh = require('../src/lib/cogs/refresh.ts');
const url = 'https://docs.google.com/spreadsheets/d/test-sheet/edit#gid=7';
const binding = supplierConnectionUrl(url,'s');
const order = (id,day,product='p',extra={}) => ({id,user_id:'u',shopify_connection_id:'s',order_number:`#${id}`,processed_at:`2026-10-${day}T12:00:00Z`,financial_status:'paid',total_refunded:0,...extra});
const line = (order_id,product='p',quantity=1,extra={}) => ({id:order_id,user_id:'u',order_id,shopify_product_id:product,quantity,current_quantity:quantity,...extra});
const source = () => ({settings:[{user_id:'u',supplier_sheet_url:binding,currency:'EUR',timezone:'UTC'}],shopify_connections:[{id:'s',user_id:'u'}],orders:[order('1','01'),order('2','02'),order('3','03'),order('4','04')],order_line_items:[line('1'),line('2'),line('3'),line('4')],product_costs:[],order_supplier_costs:[]});

test('Supplier binding preserves the Google tab and requires an explicit owned store', async () => {
  assert.deepEqual(parseSheetRef(binding),{id:'test-sheet',gid:'7'});
  assert.equal(supplierConnection(binding).storeId,'s');
  const fixture=source();fixture.settings[0].supplier_sheet_url=url;
  const db=memoryDb(fixture);
  assert.deepEqual(await syncSupplierCosts(db,'u',{automatic:true,costs:parseSupplierCsv('1,€12,paid')}),{skipped:true});
  assert.equal(db.writes.length,0);
  await assert.rejects(syncSupplierCosts(db,'u',{storeId:'foreign',costs:parseSupplierCsv('1,€12,paid')}),/não está disponível/);
  assert.equal(db.writes.length,0);
});

test('Multiple supplier tabs survive updates, retries and individual removal without duplicate ownership', () => {
  let saved = upsertSupplierConnection(url, url, 's');
  saved = upsertSupplierConnection(saved, url.replace('gid=7', 'gid=8'), 'b', true);
  saved = upsertSupplierConnection(saved, url.replace('gid=7', 'gid=9'), 'c');
  assert.equal(supplierConnections(saved).length, 3);
  saved = upsertSupplierConnection(saved, url, 's', false);
  assert.equal(supplierConnection(saved, 'b').pendingRefresh, true);
  assert.equal(parseSheetRef(supplierConnection(saved, 'c').url).gid, '9');
  const removed = removeSupplierConnection(saved, 'b');
  assert.deepEqual(supplierConnections(removed).map(c => c.storeId), ['s', 'c']);
  saved = upsertSupplierConnection(saved, url.replace('gid=7', 'gid=8'), 's');
  assert.equal(supplierConnection(saved, 'b'), null);
  assert.equal(supplierConnections(saved).length, 2);
});

test('Sync reads the tab bound to the requested store and preserves all other stores with overlapping order numbers', async (t) => {
  t.mock.method(refresh, 'refreshCostDependents', async () => {});
  const sheet = require('../src/lib/supplier/sheet.ts');
  const calls = [];
  t.mock.method(sheet, 'fetchSupplierCosts', async requested => {
    calls.push(parseSheetRef(requested).gid);
    return parseSupplierCsv('1,€' + (parseSheetRef(requested).gid === '8' ? '25' : '12') + ',');
  });
  const f = source();
  f.settings[0].supplier_sheet_url = upsertSupplierConnection(binding, url.replace('gid=7', 'gid=8'), 'b');
  f.shopify_connections.push({ id: 'b', user_id: 'u' });
  f.orders.push(order('b1', '01', 'bp', { shopify_connection_id: 'b', order_number: '#1' }));
  f.order_line_items.push(line('b1', 'bp'));
  const db = memoryDb(f);
  await syncSupplierCosts(db, 'u', { storeId: 'b', automatic: true });
  await syncSupplierCosts(db, 'u', { storeId: 's', automatic: true });
  assert.deepEqual(calls, ['8', '7']);
  assert.equal(supplierConnections(db.tables.settings[0].supplier_sheet_url).length, 2);
  assert.equal(db.tables.order_supplier_costs.find(r => r.shopify_connection_id === 'b').cost, 25);
  assert.equal(db.tables.order_supplier_costs.find(r => r.shopify_connection_id === 's').cost, 12);
  assert.deepEqual(await syncSupplierCosts(db, 'u', { storeId: 'unbound', automatic: true }), { skipped: true });
});

test('Confirmed supplier quotes price later orders and never backdate future prices', () => {
  const f=source();
  const plan=buildSupplierPlan(parseSupplierCsv('1,€12,paid\n3,€15,'),f.orders,f.order_line_items,'s','UTC');
  const cfg=buildOrderCostConfig({productCosts:plan.productCosts.map(p=>({...p,currency:'EUR',source:'sheet'})),tiers:[],collections:[],collectionProducts:[],collectionTiers:[]},{storeToDisplay:1,fallbackCostPct:30,costByVariant:new Map()});
  const item={shopify_product_id:'p',shopify_variant_id:null,quantity:1,current_quantity:1,price:100,unit_cost:null};
  assert.equal(costOrder([item],'2026-09-30',cfg).cost,30);
  assert.equal(costOrder([item],'2026-10-02',cfg).cost,12);
  const latest=costOrder([{...item,quantity:2,current_quantity:2}],'2026-10-04',cfg);
  assert.equal(latest.cost,30);
  assert.equal(latest.lines[0].source,'supplier_quote');
  assert.equal(costOrder([item],'2026-10-04',{...cfg,supplierCost:{cost:7,currency:'EUR'}}).cost,7);
});

test('Edits, refunds, unpaid orders and mixed baskets never teach a misleading unit price', () => {
  const f=source();
  f.orders[0].total_refunded=10;
  f.order_line_items[1].current_quantity=0;
  f.orders[2].financial_status='pending';
  f.order_line_items.push(line('4','another-product'));
  const plan=buildSupplierPlan(parseSupplierCsv('1,€12,paid\n2,€15,paid\n3,€16,paid\n4,€40,paid'),f.orders,f.order_line_items,'s','UTC');
  assert.equal(plan.exact.length,4);
  assert.deepEqual(plan.productCosts,[]);
});

test('Automatic sync updates unpaid quotes, keeps manual costs and retains blank/missing invoices', async (t) => {
  const calls=[];t.mock.method(refresh,'refreshCostDependents',async (...args)=>{calls.push(args.slice(1));});
  const f=source();
  f.product_costs=[{id:'manual',user_id:'u',shopify_product_id:'p',effective_from:'2026-10-01',cost:18,currency:'EUR',source:'manual'}];
  f.order_supplier_costs=[{user_id:'u',shopify_connection_id:'s',order_number:'2',cost:22,currency:'EUR',paid:true}];
  const db=memoryDb(f),costs=parseSupplierCsv('1,€12,\n2,,\n3,€15,paid');
  const result=await syncSupplierCosts(db,'u',{automatic:true,storeId:'s',costs});
  assert.equal(result.changed,true);
  assert.equal(db.tables.order_supplier_costs.find(r=>r.order_number==='1').cost,12);
  assert.equal(db.tables.order_supplier_costs.find(r=>r.order_number==='1').paid,false);
  assert.equal(db.tables.order_supplier_costs.find(r=>r.order_number==='2').cost,22);
  assert.equal(db.tables.product_costs.find(r=>r.id==='manual').cost,18);
  assert.equal(db.tables.product_costs.find(r=>r.effective_from==='2026-10-03').cost,15);
  assert.equal(supplierConnection(db.tables.settings[0].supplier_sheet_url).pendingRefresh,false);
  assert.deepEqual(calls,[['u',{storeId:'s'}]]);
  const count=db.writes.length;
  assert.equal((await syncSupplierCosts(db,'u',{automatic:true,storeId:'s',costs})).changed,false);
  assert.equal(db.writes.length,count);
});

test('A failed recompute is retried even after costs were saved; another store is never synced', async (t) => {
  let fail=true,calls=0;
  t.mock.method(refresh,'refreshCostDependents',async ()=>{calls++;if(fail)throw new Error('recompute failed');});
  const db=memoryDb(source()),costs=parseSupplierCsv('1,€12,paid');
  await assert.rejects(syncSupplierCosts(db,'u',{automatic:true,costs}),/recompute failed/);
  assert.equal(supplierConnection(db.tables.settings[0].supplier_sheet_url).pendingRefresh,true);
  const count=db.writes.length;
  assert.deepEqual(await syncSupplierCosts(db,'u',{automatic:true,storeId:'another',costs}),{skipped:true});
  assert.equal(db.writes.length,count);
  fail=false;
  await syncSupplierCosts(db,'u',{automatic:true,costs});
  assert.equal(calls,2);
  assert.equal(supplierConnection(db.tables.settings[0].supplier_sheet_url).pendingRefresh,false);
});

test('Invalid sheets fail before changing the binding or confirmed costs', async () => {
  const db=memoryDb(source());
  await assert.rejects(syncSupplierCosts(db,'u',{automatic:true,costs:parseSupplierCsv('1,€12,paid\n1,€13,paid')}),/repetida/);
  assert.equal(db.writes.length,0);
  await assert.rejects(syncSupplierCosts(db,'u',{automatic:true,costs:parseSupplierCsv('1,,')}),/não tem encomendas com custo/);
  assert.equal(db.writes.length,0);
});

test('A Shopify refresh picks up new supplier quotes even without changed orders', async (t) => {
  const supplierSheet=require('../src/lib/supplier/sheet.ts');
  const shopify=require('../src/lib/shopify/sync.ts');
  const auth=require('../src/lib/shopify/auth.ts');
  const names=require('../src/lib/shopify/store-name.ts');
  const log=require('../src/lib/sync-log.ts');
  const metrics=require('../src/lib/metrics.ts');
  const {syncShopifyConnection}=require('../src/lib/jobs.ts');
  t.mock.method(auth,'resolveShopifyToken',async ()=>'test-token');
  t.mock.method(names,'syncStoreName',async ()=>{});
  t.mock.method(shopify,'syncShopifyOrders',async ()=>0);
  t.mock.method(require('../src/lib/shopify/payments.ts'),'syncShopifyPayments',async ()=>({changed:false,available:false}));
  t.mock.method(log,'withSyncLog',async (_db,_config,fn)=>fn());
  t.mock.method(metrics,'recomputeDailyMetrics',async ()=>0);
  t.mock.method(refresh,'refreshCostDependents',async ()=>{});
  let fetched;
  t.mock.method(supplierSheet,'fetchSupplierCosts',async (url)=>{fetched=url;return parseSupplierCsv('1,€18.40,');});
  const db=memoryDb(source());
  await syncShopifyConnection(db,{id:'s',user_id:'u',shop_domain:'test.myshopify.com'},{skipProducts:true,skipRecompute:true});
  assert.equal(parseSheetRef(fetched).gid,'7');
  assert.equal(db.tables.order_supplier_costs[0].cost,18.4);
  assert.equal(db.tables.product_costs[0].cost,18.4);
  assert.equal(db.tables.shopify_connections[0].status,'active');
});

function quantityFixture(entries) {
  const orders=[],items=[],invoices=[];
  for(const [id,day,basket,cost,extra={}] of entries) {
    orders.push(order(id,day,'p',extra));
    items.push(...basket.map(([pid,qty])=>line(id,pid,qty)));
    invoices.push({shopify_connection_id:extra.shopify_connection_id??'s',order_number:id,cost,currency:'EUR'});
  }
  const quotes=buildQuantityQuotes(orders,items,invoices,{storeId:'s',timezone:'UTC',toBase:cost=>cost});
  const cfg=buildOrderCostConfig({productCosts:[{shopify_product_id:'p',cost:18.4,effective_from:'2026-09-01',currency:'EUR',source:'sheet'}],tiers:[],collections:[],collectionProducts:[],collectionTiers:[]},{storeToDisplay:1,fallbackCostPct:30,costByVariant:new Map()});
  return {orders,items,invoices,cfg:{...cfg,supplierBasketQuoteFor:quotes.basket,supplierProductQuoteFor:quotes.product}};
}
const costItem=(pid='p',qty=1,extra={})=>({shopify_product_id:pid,shopify_variant_id:null,quantity:qty,current_quantity:qty,price:100,unit_cost:null,...extra});

test('Quantity estimates sum variants, keep bulk totals separate from unit prices and date every quote', () => {
  const {cfg}=quantityFixture([['10','02',[['p',1],['p',1]],30]]);
  assert.equal(costOrder([costItem('p',2)],'2026-10-01',cfg).cost,36.8);
  assert.equal(costOrder([costItem('p',2)],'2026-10-03',cfg).cost,30);
  const split=costOrder([costItem('p',1,{shopify_variant_id:'size-s'}),costItem('p',1,{shopify_variant_id:'size-m'})],'2026-10-03',cfg);
  assert.equal(split.cost,30);
  assert.equal(split.lines[0].source,'supplier_bundle');
  assert.match(split.lines[0].note,/#10/);
  assert.equal(split.lines.reduce((s,l)=>s+l.lineCost,0),30);
  assert.equal(costOrder([costItem()],'2026-10-03',cfg).cost,18.4);
  assert.equal(costOrder([costItem('p',3)],'2026-10-03',cfg).cost,48.4);
  assert.equal(costOrder([costItem('new',2)],'2026-10-03',cfg).cost,60);
});

test('Matching mixed baskets reuse their total; other baskets only reuse known per-product quantities', () => {
  const {cfg}=quantityFixture([['10','01',[['p',2]],30],['11','02',[['p',1],['q',1]],25]]);
  const basket=[costItem('q'),costItem('p')];
  const result=costOrder(basket,'2026-10-03',cfg);
  assert.equal(result.cost,25);
  assert.equal(result.lines.every(l=>l.source==='supplier_bundle'),true);
  const {allocateOrderCost}=require('../src/lib/cogs/order-cost.ts');
  assert.ok(Math.abs(allocateOrderCost(basket,result).reduce((s,c)=>s+c,0)-25)<1e-9);
  assert.equal(costOrder([costItem('q')],'2026-10-03',cfg).cost,30);
  assert.equal(costOrder([costItem('p',2),costItem('q')],'2026-10-03',cfg).cost,60);
  assert.equal(costOrder([costItem('q',2)],'2026-10-03',cfg).cost,60);
});

test('An isolated lower bundle quote cannot inflate later profits; repeated changes and exact invoices apply', () => {
  const {cfg}=quantityFixture([
    ['10','01',[['p',2]],30],['11','02',[['p',2]],18.4],
    ['12','03',[['p',2]],18.4],['13','04',[['p',2]],32],
  ]);
  const items=[costItem('p',2)];
  const disputed=costOrder(items,'2026-10-02',cfg);
  assert.equal(disputed.cost,30);
  assert.match(disputed.lines[0].note,/#11.*aguarda/);
  assert.equal(costOrder(items,'2026-10-03',cfg).cost,18.4);
  assert.equal(costOrder(items,'2026-10-04',cfg).cost,32);
  assert.equal(costOrder(items,'2026-10-02',{...cfg,supplierCost:{cost:18.4,currency:'EUR'}}).cost,18.4);
  assert.equal(costOrder(items,'2026-10-04',{...cfg,supplierCost:{cost:0,currency:'EUR'}}).cost,0);
});

test('Refunds, edits, unpaid orders, other stores and zero costs cannot teach a quantity discount', () => {
  const f=quantityFixture([
    ['10','01',[['p',2]],30],['11','02',[['p',2]],2,{total_refunded:10}],
    ['12','02',[['p',2]],2,{financial_status:'pending'}],
    ['13','02',[['p',2]],2,{shopify_connection_id:'another-store'}],
    ['14','02',[['p',2]],2,{test:true}],['15','02',[['p',2]],2,{cancelled_at:'2026-10-02'}],
    ['16','02',[['p',2]],0],['17','02',[['p',3]],15],
  ]);
  f.items.find(l=>l.order_id==='17').current_quantity=2;
  const quotes=buildQuantityQuotes(f.orders,f.items,f.invoices,{storeId:'s',timezone:'UTC',toBase:cost=>cost});
  const cfg={...f.cfg,supplierBasketQuoteFor:quotes.basket,supplierProductQuoteFor:quotes.product};
  assert.equal(costOrder([costItem('p',2)],'2026-10-03',cfg).cost,30);
  assert.equal(costOrder([costItem('p',3)],'2026-10-03',cfg).cost,48.4);
});

test('Explicit product and collection prices retain priority over learned discounts', () => {
  const {cfg}=quantityFixture([['10','01',[['p',2]],30],['11','01',[['p',1],['q',1]],25]]);
  const manual={...cfg,manualCostFor:()=>20,manualCostSourceFor:()=> 'manual'};
  assert.equal(costOrder([costItem('p',2)],'2026-10-03',manual).cost,40);
  assert.equal(costOrder([costItem('p',2)],'2026-10-03',{...cfg,productTiers:new Map([['p',[{minQty:2,total:22}]]])}).cost,22);
  const collection={...cfg,collectionByProduct:new Map([['p','c'],['q','c']]),collectionInfo:new Map([['c',{baseUnit:18,tiers:[{minQty:2,total:21}]}]])};
  assert.equal(costOrder([costItem('p'),costItem('q')],'2026-10-03',collection).cost,21);
});

test('Shared cost loader paginates quantity history, converts currencies and reloads corrected invoices', async () => {
  const f=source();
  f.settings[0].fx_rate_override=354; f.settings[0].fx_override_currency="HUF";
  f.product_costs=[{id:'pc',user_id:'u',shopify_product_id:'p',effective_from:'2026-10-01',cost:18.4,currency:'EUR',source:'sheet'}];
  // 1,001 irrelevant rows put the useful history beyond the default page.
  f.orders=Array.from({length:1001},(_,i)=>order(`filler-${i}`,'01','q',{currency:'HUF'}));
  f.orders.push(order('z-10','02','p',{currency:'HUF'}));
  f.order_line_items=[line('z-10','p',1),line('z-10','p',1,{id:'second',shopify_variant_id:'different-size'})];
  f.order_supplier_costs=[{user_id:'u',shopify_connection_id:'s',order_number:'10',cost:30,currency:'EUR'}];
  const db=memoryDb(f);
  let costs=await loadCostData(db,'u');
  let cfg=await costs.forStore('s',[costItem('p',2)],f.settings[0]);
  assert.equal(costOrder([costItem('p',2)],'2026-10-03',cfg).cost,30*354);
  db.tables.order_supplier_costs[0].cost=28;
  costs=await loadCostData(db,'u');cfg=await costs.forStore('s',[costItem('p',2)],f.settings[0]);
  assert.equal(costOrder([costItem('p',2)],'2026-10-03',cfg).cost,28*354);
  assert.equal(db.writes.length,0);
});

const batchCsv='order,cost,state\n1,€20,paid\n2,€30,paid\n,€50,paid\n3,€10,\n4,€10,\n5,€10,\n6,€10,\n7,€10,\n8,€50,\n9,,';
test('Payment totals are excluded even when a numbered row contains the exact batch sum', () => {
  const costs=parseSupplierCsv(batchCsv);
  assert.equal(costs.byOrder.size,7);
  assert.equal(costs.paidTotal,50);
  assert.equal(costs.unpaidTotal,50);
  assert.equal(costs.byOrder.has('8'),false);
  assert.deepEqual(costs.unpricedOrders,['8','9']);
  assert.equal(costs.summaryRows.length,2);
  assert.deepEqual(costs.summaryRows[1],{order:'8',cost:50,matchedOrders:5,componentOrders:['3','4','5','6','7']});
  // Subsequent quoted orders do not turn a preceding subtotal into an invoice.
  const later=parseSupplierCsv(batchCsv.replace('9,,','9,€12,'));
  assert.equal(later.byOrder.has('8'),false);
  assert.equal(later.unpaidTotal,62);
});

test('High real invoices, small coincidental sums and ordinary layouts retain their costs', () => {
  assert.equal(parseSupplierCsv(batchCsv.replace('8,€50,','8,€2500,')).byOrder.get('8').cost,2500);
  const noEstablishedBatch=parseSupplierCsv('1,10,\n2,10,\n3,10,\n4,10,\n5,10,\n6,50,');
  assert.equal(noEstablishedBatch.byOrder.get('6').cost,50);
  const small=parseSupplierCsv('1,10,\n2,10,\n,20,\n3,10,\n4,10,\n5,20,');
  assert.equal(small.byOrder.get('5').cost,20);
  const labelled=parseSupplierCsv('1,10,\n2,20,\nTotal 1-2,30,\nSaldo a pagar 2026,30,');
  assert.equal(labelled.byOrder.size,2);
  assert.equal(labelled.unpaidTotal,30);
});

function contaminatedBatch(oldSummaryCost=50,componentCost=10) {
  const f=source();
  f.orders=Array.from({length:9},(_,i)=>order(String(i+1),String(i+1).padStart(2,'0')));
  f.order_line_items=f.orders.map(o=>line(o.id,o.id==='8'?'summary-product':'p'));
  f.order_supplier_costs=[
    ...[3,4,5,6,7].map(n=>({user_id:'u',shopify_connection_id:'s',order_number:String(n),cost:componentCost,currency:'EUR',paid:false})),
    {user_id:'u',shopify_connection_id:'s',order_number:'8',cost:oldSummaryCost,currency:'EUR',paid:false},
    {user_id:'u',shopify_connection_id:'foreign',order_number:'8',cost:50,currency:'EUR',paid:false},
  ];
  f.product_costs=[{user_id:'u',shopify_product_id:'summary-product',cost:oldSummaryCost,currency:'EUR',effective_from:'2026-10-08',source:'sheet'}];
  return f;
}

test('Sync repairs a previously imported batch total and learned cost, scoped to the store and idempotently', async (t) => {
  let refreshes=0;t.mock.method(refresh,'refreshCostDependents',async()=>{refreshes++;});
  const db=memoryDb(contaminatedBatch()),costs=parseSupplierCsv(batchCsv);
  assert.equal((await syncSupplierCosts(db,'u',{automatic:true,costs})).changed,true);
  assert.equal(db.tables.order_supplier_costs.some(r=>r.shopify_connection_id==='s'&&r.order_number==='8'),false);
  assert.equal(db.tables.order_supplier_costs.find(r=>r.shopify_connection_id==='foreign').cost,50);
  assert.equal(db.tables.product_costs.some(r=>r.shopify_product_id==='summary-product'),false);
  assert.equal(refreshes,1);
  const writes=db.writes.length;
  assert.equal((await syncSupplierCosts(db,'u',{automatic:true,costs})).changed,false);
  assert.equal(db.writes.length,writes);
});

test('Batch repair preserves a genuine previous invoice, but removes an older batch sum after prices change', async (t) => {
  t.mock.method(refresh,'refreshCostDependents',async()=>{});
  const genuine=memoryDb(contaminatedBatch(18));
  await syncSupplierCosts(genuine,'u',{automatic:true,costs:parseSupplierCsv(batchCsv)});
  assert.equal(genuine.tables.order_supplier_costs.find(r=>r.shopify_connection_id==='s'&&r.order_number==='8').cost,18);
  const stale=memoryDb(contaminatedBatch(60,12));
  await syncSupplierCosts(stale,'u',{automatic:true,costs:parseSupplierCsv(batchCsv)});
  assert.equal(stale.tables.order_supplier_costs.some(r=>r.shopify_connection_id==='s'&&r.order_number==='8'),false);
});

test('A failed recompute after subtotal removal is retried without restoring the invalid invoice', async (t) => {
  let fail=true;t.mock.method(refresh,'refreshCostDependents',async()=>{if(fail)throw new Error('recompute failed');});
  const db=memoryDb(contaminatedBatch()),costs=parseSupplierCsv(batchCsv);
  await assert.rejects(syncSupplierCosts(db,'u',{automatic:true,costs}),/recompute failed/);
  assert.equal(supplierConnection(db.tables.settings[0].supplier_sheet_url).pendingRefresh,true);
  assert.equal(db.tables.order_supplier_costs.some(r=>r.shopify_connection_id==='s'&&r.order_number==='8'),false);
  fail=false;
  await syncSupplierCosts(db,'u',{automatic:true,costs});
  assert.equal(supplierConnection(db.tables.settings[0].supplier_sheet_url).pendingRefresh,false);
});
