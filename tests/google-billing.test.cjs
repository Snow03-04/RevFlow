const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../scripts/register-ts.cjs');
const { parseGoogleBilledCsv, billingDiscount, reconciledBilledCost } = require('../src/lib/google/billing-model.ts');
const header = 'Custo faturado\n1 de outubro\nNome do orçamento,Dia,Código da moeda,Custo de publicação,Custo faturado\n';
test('reads the actual localized report, aggregates budgets and respects quoted commas', () => {
  assert.deepEqual(parseGoogleBilledCsv(header+'"Campanha, A",2026-10-15,EUR,"110,19","40,00"\nB,2026-10-15,EUR,"8,83","8,82"'),
    [{date:'2026-10-15',currency:'EUR',served_cost:119.02,billed_cost:48.82}]);
});
test('rejects a missing billed value, repeated budgets, non-daily reports and impossible costs', () => {
  for (const csv of [header+'A,2026-10-15,EUR,"100,00", --', header+'A,2026-10-15,EUR,1,1\nA,2026-10-15,EUR,1,1',
    header+'A,Total,EUR,1,1',header+'A,2026-10-15,EUR,1,2',header+'A,2026-02-30,EUR,1,1']) assert.throws(()=>parseGoogleBilledCsv(csv));
});
test('real overdelivery is excluded, including when billing is newer than the script', () => {
  assert.equal(reconciledBilledCost(110.19,110.19,110.19,40),40);
  assert.equal(reconciledBilledCost(109.54,109.54,110.19,40),40);
});
test('later activity is retained pending confirmation, not silently frozen at a stale billed total', () => {
  assert.equal(reconciledBilledCost(120.19,120.19,110.19,40),50);
});
test('funded zero remains zero; partial promotional credit and existing billing credit are not deducted twice', () => {
  assert.equal(reconciledBilledCost(0,100,100,40),0);
  assert.equal(reconciledBilledCost(80,100,100,40),20);
  assert.equal(reconciledBilledCost(75,100,100,40,5),20);
  assert.equal(reconciledBilledCost(40,100,100,40,60),40);
  assert.equal(billingDiscount(10,100,40),10);
});
test('unknown gross falls back conservatively; currency conversion is applied outside the model', () => {
  assert.equal(reconciledBilledCost(80,null,100,40),20);
  assert.equal(reconciledBilledCost(0,null,100,40),0);
});

test('billing evidence survives repeated imports, respects currency, store/account ownership and funded zero', async t => {
  const { memoryDb } = require('./helpers/memory-db.cjs');
  const { withGoogleBillingCredits } = require('../src/lib/google/billing.ts');
  t.mock.method(require('../src/lib/fx.ts'),'resolveFx',async(from,to)=>from===to?1:from==='USD'?0.5:2);
  const store='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222';
  const stores=[{id:store,shop_name:'Test',shop_domain:'test.myshopify.com'},{id:other,shop_name:'Other',shop_domain:'other.myshopify.com'}];
  const report={id:'r',user_id:'u',shopify_connection_id:store,customer_id:'1234567890',date:'2026-10-15',currency:'EUR',served_cost:110.19,billed_cost:40};
  const db=memoryDb({google_billing_reports:[report,{...report,id:'foreign',user_id:'other'}],
    shopify_connections:[{...stores[0],user_id:'u',reporting_base_currency:'USD'}],
    google_campaigns:[{user_id:'u',campaign_id:`script:${store}:1234567890:99`,date:report.date,spend:220.38,gross_spend:220.38}],google_connections:[]});
  const raw=[{date:report.date,kind:'expense',amount:110.19,currency:'EUR',label:'Google Test · conta 1234567890 · 110,19'},
    {date:report.date,kind:'expense',amount:20,currency:'EUR',label:'Google Test · conta 9999999999 · 20,00'},
    {date:report.date,kind:'expense',amount:30,currency:'EUR',label:'Google Other · conta 1234567890 · 30,00'}];
  const range={from:report.date,to:report.date};
  const result=await withGoogleBillingCredits(db,'u',range,raw,stores,'EUR');
  assert.equal(result.length,4); assert.ok(Math.abs(result[3].amount-70.19)<1e-7);
  assert.equal(result[3].kind,'profit'); assert.equal(result[3].label,raw[0].label);
  assert.deepEqual(await withGoogleBillingCredits(db,'u',range,raw,stores,'EUR'),result);
  assert.deepEqual(db.writes,[]); assert.equal(raw.length,3);
  const funded=[{...raw[0],amount:0}];
  assert.deepEqual(await withGoogleBillingCredits(db,'u',range,funded,stores,'EUR'),funded);
});
