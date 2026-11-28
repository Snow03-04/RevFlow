process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.invalid';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-only';
require('../scripts/register-ts.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { compile, patchHostedSupplierCurrencies } = require('../scripts/patch-hosted-supplier-currencies.cjs');
const { memoryDb } = require('./helpers/memory-db.cjs');

test('Hosted patch is idempotent, rejects unfamiliar deployed modules and preserves unrelated code', () => {
  const source = '// src/first.ts\nconst untouched = 123;\n\n' + ['sheet','plan','sync'].map(compile).join('\n') + '\n// src/last.ts\nconst tail = 456;\n';
  const patched = patchHostedSupplierCurrencies(source);
  assert.equal(patchHostedSupplierCurrencies(patched), patched);
  assert.ok(patched.startsWith('// src/first.ts\nconst untouched = 123;\n\n'));
  assert.ok(patched.endsWith('\n// src/last.ts\nconst tail = 456;\n'));
  assert.throws(()=>patchHostedSupplierCurrencies(source.replace('function parseSheetRef(', 'function changedParser(')), /review before patching/);
});

test('Emitted worker imports mixed invoices and retains its existing durable refresh queue', async () => {
  const paginate = require('../src/lib/supabase/paginate.ts');
  const connection = require('../src/lib/supplier/connection.ts');
  const dependencies = {...paginate, ...connection,
    ...require('../src/lib/date.ts'), ...require('../src/lib/cogs/eu-order-fee.ts'),
    ...require('../src/lib/shopify/paid-orders.ts'), ORDER_EVIDENCE_COLUMNS:'raw',
    resolveFx:async()=>1, refreshCostDependents:async()=>{throw Error('Must use hosted queue');}};
  const code = ['sheet','currency','plan','sync'].map(compile).join('\n');
  const {parseSupplierCsv, syncSupplierCosts} = Function(...Object.keys(dependencies), code+'\nreturn {parseSupplierCsv, syncSupplierCosts};')(...Object.values(dependencies));
  const url=connection.supplierConnectionUrl('https://docs.google.com/spreadsheets/d/test/edit#gid=0','s');
  const db=memoryDb({settings:[{user_id:'u',currency:'EUR',timezone:'UTC',supplier_sheet_url:url}],
    shopify_connections:[{id:'s',user_id:'u',eu_order_fee_enabled:false}],
    orders:[1,2].map(n=>({id:String(n),user_id:'u',shopify_connection_id:'s',order_number:String(n),processed_at:'2026-11-27T12:00:00Z'})),
    order_line_items:[],product_costs:[],order_supplier_costs:[]});
  const costs=parseSupplierCsv('order number,total cost(USD),payment status\n1,€13,paid\n2,$35.15,');
  await assert.rejects(syncSupplierCosts(db,'u',{storeId:'s',costs,deferRefresh:async()=>{throw Error('Queue unavailable');}}),/Queue unavailable/);
  assert.equal(connection.supplierConnection(db.tables.settings[0].supplier_sheet_url).pendingRefresh,true);
  let queued=0;
  await syncSupplierCosts(db,'u',{storeId:'s',costs,deferRefresh:async()=>{queued++;}});
  assert.equal(queued,1);
  assert.equal(connection.supplierConnection(db.tables.settings[0].supplier_sheet_url).pendingRefresh,false);
  assert.deepEqual(db.tables.order_supplier_costs.map(r=>[r.cost,r.currency]),[[13,'EUR'],[35.15,'USD']]);
});
