process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.invalid';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-only';
require('../scripts/register-ts.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { memoryDb } = require('./helpers/memory-db.cjs');
const sheet = require('../src/lib/supplier/sheet.ts');
const { parseSupplierCsv } = sheet;
const { buildSupplierPlan } = require('../src/lib/supplier/plan.ts');
const { syncSupplierCosts, relearnSupplierPrices } = require('../src/lib/supplier/sync.ts');
const { supplierConnectionUrl } = require('../src/lib/supplier/connection.ts');
const { supplierRates, supplierTotals } = require('../src/lib/supplier/currency.ts');
const { getSupplierPayables, summarizeSupplierPayables } = require('../src/lib/supplier/payables.ts');
const url = 'https://docs.google.com/spreadsheets/d/test-sheet/edit#gid=7';
const csv = 'order number,total cost(USD),payment status,tracking number\n1001,€13.00,paid,\n1033,€13.00,paid,\n1034,$35.15,paid,\n1035,$50,,\n1036,$20.95,,';
const order = (n, day) => ({id:String(n), user_id:'u', shopify_connection_id:'s', order_number:'#'+n,
  processed_at:`2026-11-${day}T12:00:00Z`, financial_status:'paid', total_refunded:0, country:'IT'});
const item = n => ({user_id:'u', order_id:String(n), shopify_product_id:'p', quantity:1, current_quantity:1});
const fixture = () => ({settings:[{user_id:'u', currency:'EUR', timezone:'UTC', fx_rate_override:2, fx_override_currency:'USD', supplier_sheet_url:supplierConnectionUrl(url,'s')}],
  shopify_connections:[{id:'s',user_id:'u',reporting_base_currency:'EUR',eu_order_fee_enabled:false}],
  orders:[order(1,'25'),order(2,'26'),order(3,'27')], order_line_items:[item(1),item(2),item(3)],
  product_costs:[], order_supplier_costs:[]});

test('The supplied mixed sheet layout retains each cell currency and payment status despite its USD header', () => {
  const costs = parseSupplierCsv(csv);
  assert.deepEqual(costs.errors, []);
  assert.deepEqual([...costs.byOrder.values()].map(r=>[r.order,r.cost,r.currency,r.paid]),
    [['1001',13,'EUR',true],['1033',13,'EUR',true],['1034',35.15,'USD',true],['1035',50,'USD',false],['1036',20.95,'USD',false]]);
  assert.equal(costs.currency,null);
  assert.equal(costs.paidTotal,null);
  assert.equal(costs.unpaidTotal,null);
  assert.equal(costs.paidCount,3);
  assert.equal(costs.unpaidCount,2);
});

test('Codes, symbols and header fallback resolve per row, while ambiguous rows and conflicting duplicates fail', () => {
  const costs=parseSupplierCsv('order,total cost(USD),payment status\n1,13,paid\n2,EUR 13,paid\n3,20.95 USD,\n4,US$50,');
  assert.deepEqual(costs.errors,[]);
  assert.deepEqual([...costs.byOrder.values()].map(r=>r.currency),['USD','EUR','USD','USD']);
  assert.equal(parseSupplierCsv('1,€12,\n2,12,').byOrder.get('2').currency,'EUR');
  assert.match(parseSupplierCsv('1,€12,\n2,$12,\n3,12,').errors.join(' '),/Falta a moeda/);
  assert.match(parseSupplierCsv('1,€12,\n1,$12,').errors.join(' '),/repetida/);
  assert.ok(parseSupplierCsv('1,USD €12,').errors.length);
  assert.ok(parseSupplierCsv('order,cost,currency\n1,$12,EUR').errors.length);
  assert.equal(parseSupplierCsv('order,cost,currency\n1,12,USD').byOrder.get('1').currency,'USD');
});

test('Mixed-currency batches cannot be mistaken for payment subtotal rows', () => {
  const costs=parseSupplierCsv('1,€20,paid\n2,€30,paid\n,€50,paid\n3,€10,\n4,€10,\n5,$10,\n6,$10,\n7,$10,\n8,$50,');
  assert.equal(costs.byOrder.get('8').cost,50);
  assert.equal(costs.summaryRows.length,1);
});

test('Paid totals and debt convert each currency once, preserve shares, and reject unavailable FX', async t => {
  const costs=parseSupplierCsv(csv);
  const rates=await supplierRates(costs,'EUR',{displayCurrency:'EUR',override:2,overrideCurrency:'USD'});
  assert.deepEqual(supplierTotals(costs,'EUR',rates),{paidTotal:43.58,unpaidTotal:35.48});
  assert.equal(summarizeSupplierPayables(costs,rates,50,false,'EUR').amount,17.7375);
  assert.throws(()=>summarizeSupplierPayables(costs,1,100),/inválidos/);
  assert.throws(()=>summarizeSupplierPayables(costs,new Map([['EUR',1]]),100),/indisponível/);
  t.mock.method(sheet,'fetchSupplierCosts',async()=>costs);
  const options={stores:[{id:'s',shop_name:'Shop',shop_domain:'shop.myshopify.com'}],sheetUrl:supplierConnectionUrl(url,'s'),
    currency:'EUR',percentages:new Map([['s',50]]),fxOverride:2,fxOverrideCurrency:'USD'};
  assert.equal((await getSupplierPayables(options)).amount,17.74);
  assert.equal((await getSupplierPayables({...options,storeId:'s'})).amount,35.48);
  const fx=require('../src/lib/fx.ts');
  t.mock.method(fx,'resolveFx',async()=>{throw new Error('No verified FX');});
  await assert.rejects(getSupplierPayables(options),/No verified FX/);
});

test('Sync stores original currency, repairs equal-number currency changes and retains older EUR quotes after switching to USD', async () => {
  const db=memoryDb(fixture());
  await syncSupplierCosts(db,'u',{storeId:'s',refresh:false,costs:parseSupplierCsv('1,€20,paid\n2,$20,')});
  const invoices=()=>db.tables.order_supplier_costs.map(r=>[r.order_number,r.cost,r.currency]).sort();
  assert.deepEqual(invoices(),[['1',20,'EUR'],['2',20,'USD']]);
  assert.deepEqual(db.tables.product_costs.map(r=>[r.effective_from,r.cost,r.currency]),
    [['2026-11-25',20,'EUR'],['2026-11-26',20,'USD']]);
  await syncSupplierCosts(db,'u',{storeId:'s',refresh:false,costs:parseSupplierCsv('2,€20,\n3,$30,')});
  assert.deepEqual(invoices(),[['1',20,'EUR'],['2',20,'EUR'],['3',30,'USD']]);
  assert.equal(db.tables.product_costs.find(r=>r.effective_from==='2026-11-25').currency,'EUR');
  assert.equal(db.tables.product_costs.find(r=>r.effective_from==='2026-11-27').currency,'USD');
  const rerun=await syncSupplierCosts(db,'u',{storeId:'s',refresh:false,automatic:true,costs:parseSupplierCsv('3,$30,')});
  assert.equal(rerun.changed,false);
  assert.deepEqual(invoices(),[['1',20,'EUR'],['2',20,'EUR'],['3',30,'USD']]);
  db.tables.shopify_connections[0].eu_order_fee_enabled=true;
  await relearnSupplierPrices(db,'u','s');
  assert.deepEqual(db.tables.product_costs.map(r=>[r.effective_from,r.cost,r.currency]),
    [['2026-11-25',15,'EUR'],['2026-11-27',20,'USD']]);
});

test('A mixed transition day keeps exact invoices without inventing a common unit price', () => {
  const plan=buildSupplierPlan(parseSupplierCsv('1,€20,\n2,$20,'),[order(1,'25'),order(2,'25')],[item(1),item(2)],'s','UTC');
  assert.equal(plan.exact.length,2);
  assert.deepEqual(plan.productCosts,[]);
});

test('Supplier screen, range calculator and comparison keep original currencies and convert only totals', async t => {
  const server=require('../src/lib/supabase/server.ts');
  const { getSupplierData,getSupplierDiff }=require('../src/lib/supplier/actions.ts');
  const db=memoryDb(fixture(),{projectColumns:true});
  db.tables.order_supplier_costs=[{user_id:'u',shopify_connection_id:'s',order_number:'2',cost:20,currency:'EUR',paid:false}];
  t.mock.method(server,'getCurrentUser',async()=>({id:'u'}));
  t.mock.method(server,'createClient',async()=>db);
  t.mock.method(sheet,'fetchSupplierCosts',async()=>parseSupplierCsv('1,€20,paid\n2,$20,\n3,$10,'));
  t.mock.method(sheet,'listSheetTabs',async()=>[]);
  const data=await getSupplierData('s');
  assert.equal(data.currency,'EUR');
  assert.equal(data.paidTotal,20);
  assert.equal(data.unpaidTotal,15);
  assert.deepEqual(data.unpaidOrders.map(r=>[r.cost,r.currency]),[[10,'USD'],[20,'USD']]);
  const diff=await getSupplierDiff('s');
  assert.equal(diff.changed[0].sheetCurrency,'USD');
  assert.equal(diff.changed[0].appliedCurrency,'EUR');
  assert.equal(diff.changed[0].sheetCost,diff.changed[0].appliedCost);
  const React=require('react');
  const {renderToStaticMarkup}=require('react-dom/server');
  const {RangeCalculator}=require('../src/components/supplier/range-calculator.tsx');
  const html=renderToStaticMarkup(React.createElement(RangeCalculator,{orders:data.orders,currency:data.currency}));
  assert.match(html,/€35\.00/);
  assert.match(html,/€15\.00/);
});
