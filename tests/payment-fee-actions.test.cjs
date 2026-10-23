process.env.NEXT_PUBLIC_SUPABASE_URL='https://test.invalid';process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='test';
require('../scripts/register-ts.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),Module=require('node:module');
const {memoryDb}=require('./helpers/memory-db.cjs');
let db,user,fail;const calls=[];const original=Module._load;
const record=phase=>async(...args)=>{calls.push({phase,args:args.slice(1)});if(fail)throw Error('secret');};
Module._load=function(request,...args){
 if(request==='@/lib/supabase/server')return{getCurrentUser:async()=>user,createClient:async()=>db};
 if(request==='next/cache')return{revalidatePath:()=>{}};
 if(request==='@/lib/metrics')return{recomputeDailyMetrics:record('metrics')};
 if(request==='@/lib/trackers/pnl-import')return{projectPnlMonth:record('pnl')};
 if(request==='@/lib/trackers/roas-import')return{projectRoasMonth:record('roas')};
 return original.call(this,request,...args);
};
const {saveStorePaymentFees,refreshStorePaymentFees}=require('../src/lib/settings/payment-fee-actions.ts');Module._load=original;
const {paymentFeeRefreshSteps}=require('../src/lib/settings/payment-fee-refresh.ts');
const own='00000000-0000-4000-8000-000000000001',foreign='00000000-0000-4000-8000-000000000002';
const values={storeId:own,mode:'shopify',percent:2.5,fixed:.3,currency:'USD'};
const step={storeId:own,phase:'metrics',from:'2026-10-01',to:'2026-10-07'};
function setup(){user={id:'u'};fail=false;calls.length=0;db=memoryDb({shopify_connections:[{id:own,user_id:'u'},{id:foreign,user_id:'other'}],settings:[{user_id:'u',timezone:'Europe/Lisbon'}],pnl_settings:[{user_id:'u'}],roas_settings:[{user_id:'u'}],orders:[{user_id:'u',shopify_connection_id:own,processed_at:'2026-10-11T12:00:00Z'},{user_id:'other',shopify_connection_id:foreign,processed_at:'2015-01-01T00:00:00Z'}]});}
test('Only owned settings are saved, saving does not run the heavy history, and invalid inputs cannot change fees',async()=>{
 setup();const result=await saveStorePaymentFees(values);assert.equal(result.ok,true);assert.equal(result.steps[0].from,'2026-10-01');
 assert.equal(db.tables.shopify_connections[0].payment_fee_pct,.025);assert.equal(db.tables.shopify_connections[0].payment_fee_currency,'USD');
 assert.deepEqual(calls,[]);assert.deepEqual(db.tables.shopify_connections[1],{id:foreign,user_id:'other'});
 for(const patch of [{storeId:foreign},{storeId:'bad'},{percent:NaN},{fixed:-1},{mode:'fake'},{currency:'XXX'},{user_id:'other'}]){
  setup();assert.equal((await saveStorePaymentFees({...values,...patch})).ok,false);assert.equal(calls.length,0);
  assert.ok(db.tables.shopify_connections.every(s=>s.payment_fee_mode===undefined));
 }
 setup();user=null;assert.equal((await saveStorePaymentFees(values)).ok,false);assert.equal(db.writes.length,0);
});
test('Zero is preserved, inheritance clears store overrides, and a failed history step can be retried',async()=>{
 setup();await saveStorePaymentFees({...values,percent:0,fixed:0});assert.equal(db.tables.shopify_connections[0].payment_fee_pct,0);
 fail=true;const r=await refreshStorePaymentFees(step);assert.equal(r.ok,false);assert.match(r.error,/guardadas/);assert.doesNotMatch(r.error,/secret/);
 fail=false;assert.equal((await refreshStorePaymentFees(step)).ok,true);
 assert.equal((await saveStorePaymentFees({...values,mode:'inherit'})).ok,true);assert.equal(db.tables.shopify_connections[0].payment_fee_pct,null);
});
test('Every bounded step rechecks ownership and rejects unbounded or malformed dates before reading financial data',async()=>{
 for(const patch of [{storeId:foreign},{from:'2026-10-01',to:'2026-10-31'},{from:'2026-09-30',to:'2026-10-01'},{from:'2026-02-30',to:'2026-02-30'},{from:'bad'},{phase:'pnl',from:'2026-10-02',to:'2026-10-02'},{user_id:'other'}]){
  setup();assert.equal((await refreshStorePaymentFees({...step,...patch})).ok,false);assert.equal(calls.length,0);
 }
 setup();user=null;assert.equal((await refreshStorePaymentFees(step)).ok,false);assert.equal(calls.length,0);
 setup();await refreshStorePaymentFees(step);await refreshStorePaymentFees({...step,phase:'roas'});await refreshStorePaymentFees({...step,phase:'pnl',to:'2026-10-01'});
 assert.deepEqual(calls,[{phase:'metrics',args:['u',{from:step.from,to:step.to},{storeId:own}]},{phase:'roas',args:['u',2026,10,{fromDay:1,toDay:7,costsOnly:true}]},{phase:'pnl',args:['u',2026,10,{costsOnly:true}]}]);
});
test('History is covered exactly once per metrics/ROAS phase across leap days and months, then each month is projected',()=>{
 const steps=paymentFeeRefreshSteps('2024-02-14','2024-03-03');
 for(const phase of ['metrics','roas']){
  const selected=steps.filter(s=>s.phase===phase);let expected='2024-02-01';
  for(const s of selected){assert.equal(s.from,expected);assert.equal(s.from.slice(0,7),s.to.slice(0,7));assert.ok((Date.parse(s.to)-Date.parse(s.from))/86400000<=6);expected=new Date(Date.parse(s.to)+86400000).toISOString().slice(0,10);}
  assert.equal(expected,'2024-03-04');assert.ok(selected.some(s=>s.to==='2024-02-29'));
 }
 assert.deepEqual(steps.filter(s=>s.phase==='pnl').map(s=>s.from),['2024-02-01','2024-03-01']);
});
