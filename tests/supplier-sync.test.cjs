process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.invalid';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-only';
require('../scripts/register-ts.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const {memoryDb} = require('./helpers/memory-db.cjs');
const {parseSupplierCsv,parseSheetRef} = require('../src/lib/supplier/sheet.ts');
const {supplierConnection,supplierConnectionUrl} = require('../src/lib/supplier/connection.ts');
const {syncSupplierCosts} = require('../src/lib/supplier/sync.ts');
const {buildSupplierPlan} = require('../src/lib/supplier/plan.ts');
const {buildOrderCostConfig,costOrder} = require('../src/lib/cogs/order-cost.ts');
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
