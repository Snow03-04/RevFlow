process.env.NEXT_PUBLIC_SUPABASE_URL='https://test.invalid';process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='test';
require('../scripts/register-ts.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),Module=require('node:module');
const {memoryDb}=require('./helpers/memory-db.cjs');
let db,user,fail;const calls=[];const original=Module._load;
Module._load=function(request,...args){
 if(request==='@/lib/supabase/server')return{getCurrentUser:async()=>user,createClient:async()=>db};
 if(request==='next/cache')return{revalidatePath:()=>{}};
 if(request==='@/lib/cogs/refresh')return{refreshCostDependents:async(_db,id,opts)=>{calls.push({id,opts});if(fail)throw Error('secret');}};
 return original.call(this,request,...args);
};
const {saveStorePaymentFees}=require('../src/lib/settings/payment-fee-actions.ts');Module._load=original;
const own='00000000-0000-4000-8000-000000000001',foreign='00000000-0000-4000-8000-000000000002';
const values={storeId:own,mode:'shopify',percent:2.5,fixed:.3,currency:'USD'};
function setup(){user={id:'u'};fail=false;calls.length=0;db=memoryDb({shopify_connections:[{id:own,user_id:'u'},{id:foreign,user_id:'other'}]});}
test('Only owned store settings are saved and refreshed; foreign IDs and invalid inputs cannot change fees',async()=>{
 setup();assert.equal((await saveStorePaymentFees(values)).ok,true);
 assert.equal(db.tables.shopify_connections[0].payment_fee_pct,.025);assert.equal(db.tables.shopify_connections[0].payment_fee_currency,'USD');
 assert.deepEqual(calls,[{id:'u',opts:{storeId:own}}]);assert.deepEqual(db.tables.shopify_connections[1],{id:foreign,user_id:'other'});
 for(const patch of [{storeId:foreign},{storeId:'bad'},{percent:NaN},{fixed:-1},{mode:'fake'},{currency:'XXX'},{user_id:'other'}]){
  setup();assert.equal((await saveStorePaymentFees({...values,...patch})).ok,false);assert.equal(calls.length,0);
  assert.ok(db.tables.shopify_connections.every(s=>s.payment_fee_mode===undefined));
 }
 setup();user=null;assert.equal((await saveStorePaymentFees(values)).ok,false);assert.equal(db.writes.length,0);
});
test('Saving zero is preserved, inheritance clears store overrides, and a failed recalculation is retryable',async()=>{
 setup();fail=true;const r=await saveStorePaymentFees({...values,percent:0,fixed:0});assert.equal(r.ok,false);assert.match(r.error,/guardadas/);assert.doesNotMatch(r.error,/secret/);
 assert.equal(db.tables.shopify_connections[0].payment_fee_pct,0);fail=false;assert.equal((await saveStorePaymentFees({...values,percent:0,fixed:0})).ok,true);
 assert.equal((await saveStorePaymentFees({...values,mode:'inherit'})).ok,true);assert.equal(db.tables.shopify_connections[0].payment_fee_pct,null);
});
