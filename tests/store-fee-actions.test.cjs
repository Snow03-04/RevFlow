process.env.NEXT_PUBLIC_SUPABASE_URL='https://test.invalid';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='test-only';
require('../scripts/register-ts.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),Module=require('node:module');
const {memoryDb}=require('./helpers/memory-db.cjs');
const owned='00000000-0000-4000-8000-000000000001',foreign='00000000-0000-4000-8000-000000000002';
let db,user,failRefresh;const refreshes=[],paths=[];
const load=Module._load;
Module._load=function(request,...args){
  if(request==='@/lib/supabase/server')return{getCurrentUser:async()=>user,createClient:async()=>db};
  if(request==='next/cache')return{revalidatePath:p=>paths.push(p)};
  if(request==='@/lib/cogs/refresh')return{refreshCostDependents:async(_db,id,opts)=>{refreshes.push({id,opts});if(failRefresh)throw Error('private backend detail')}};
  if(request==='@/lib/date')return{...load.call(this,request,...args),todayYmd:()=> '2026-10-24'};
  return load.call(this,request,...args);
};
const {updateStoreFeeAction}=require('../src/lib/settings/store-fee-actions.ts');Module._load=load;
function setup(){user={id:'u'};failRefresh=false;refreshes.length=0;paths.length=0;db=memoryDb({settings:[{user_id:'u',timezone:'Europe/Lisbon'}],shopify_connections:[{id:owned,user_id:'u',eu_order_fee_enabled:false},{id:foreign,user_id:'other',eu_order_fee_enabled:false}]});}
function form(id=owned,enabled='true'){const f=new FormData();f.set('store_id',id);f.set('enabled',enabled);return f;}
test('owner can save one store and recalculate only dates from 23 October inclusive',async()=>{
  setup();assert.deepEqual(await updateStoreFeeAction({},form()),{ok:true});
  assert.equal(db.tables.shopify_connections[0].eu_order_fee_enabled,true);assert.equal(db.tables.shopify_connections[1].eu_order_fee_enabled,false);
  assert.deepEqual(refreshes,[{id:'u',opts:{storeId:owned,dates:['2026-10-23','2026-10-24'],months:['2026-10']}}]);
  assert.ok(paths.includes('/dashboard'));assert.ok(paths.includes('/pnl'));
});
test('foreign stores, anonymous sessions and malformed inputs cannot change costs',async()=>{
  for(const scenario of ['foreign','anonymous','invalid-id','invalid-flag']){
    setup();if(scenario==='anonymous')user=null;
    const r=await updateStoreFeeAction({},form(scenario==='foreign'?foreign:scenario==='invalid-id'?'bad':owned,scenario==='invalid-flag'?'yes':'true'));
    assert.ok(r.error);assert.equal(db.writes.length,0);assert.equal(refreshes.length,0);
  }
});
test('failed recalculation is reported honestly and retry can finish the saved preference',async()=>{
  setup();failRefresh=true;const r=await updateStoreFeeAction({},form());
  assert.match(r.error,/Taxa guardada/);assert.doesNotMatch(r.error,/private/);assert.equal(r.ok,undefined);
  failRefresh=false;assert.equal((await updateStoreFeeAction({},form())).ok,true);
  assert.equal((await updateStoreFeeAction({},form(owned,'false'))).ok,true);
  assert.equal(db.tables.shopify_connections[0].eu_order_fee_enabled,false);
});
