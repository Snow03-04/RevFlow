require('../scripts/register-ts.cjs');
const test = require('node:test'), assert = require('node:assert/strict'), Module = require('node:module');
const uid = '10000000-0000-4000-8000-000000000001', other = '10000000-0000-4000-8000-000000000002';
const sid = '20000000-0000-4000-8000-000000000001', subid = '30000000-0000-4000-8000-000000000001';
let user, tables, invalidations, inserts;
const base = { id: subid, user_id: uid, shopify_connection_id: sid, name:'Shopify',amount:30,currency:'EUR',
  billing_cycle:'monthly',status:'trial',next_due_date:'2026-01-31',anchor_day:31,reminder_days:7,management_url:'',notes:'',
  read_alert_key:null,updated_at:'2026-01-01T00:00:00Z',created_at:'2026-01-01T00:00:00Z' };
function reset() { user={ id:uid }; invalidations=0; inserts=0; tables={ store_subscriptions:[{...base}], shopify_connections:[{id:sid,user_id:uid}],settings:[{user_id:uid,timezone:'Europe/Lisbon'}] }; }
const db = { from(table) {
  const filters=[]; let changes, insert;
  const q={ select(){return q}, eq(k,v){filters.push(r=>r[k]===v);return q}, update(v){changes=v;return q},
    insert(v){insert=v;return q}, async maybeSingle(){return run()}, async single(){return run()} };
  function run(){
    if(insert){ inserts++; const row={...insert,id:'created'};tables[table].push(row);return {data:row,error:null}; }
    const row=tables[table].find(r=>filters.every(f=>f(r)));
    if(row&&changes)Object.assign(row,changes);
    return {data:row?{...row}:null,error:null};
  }
  return q;
} };
const original=Module._load;
Module._load=function(name,...args){
  if(name==='@/lib/supabase/server')return {getCurrentUser:async()=>user,createClient:async()=>db};
  if(name==='next/cache')return {revalidatePath(){invalidations++}};
  return original.call(this,name,...args);
};
const { saveSubscription, confirmSubscriptionRenewal, readSubscriptionAlert }=require('../src/lib/subscriptions/actions.ts');
Module._load=original;
function input(){const {id,user_id,anchor_day,read_alert_key,updated_at,created_at,...v}=base;return v;}

test('actions require membership and never accept a client-supplied owner',async()=>{
  reset();user=null;
  assert.equal((await saveSubscription(input())).ok,false);
  assert.equal((await confirmSubscriptionRenewal({id:subid,expectedUpdatedAt:base.updated_at})).ok,false);
  assert.equal(inserts,0);user={id:uid};
  assert.equal((await saveSubscription({...input(),user_id:other})).ok,false);
});
test('creation validates store ownership and uses the current user',async()=>{
  reset();tables.shopify_connections[0].user_id=other;
  assert.equal((await saveSubscription(input())).ok,false);assert.equal(inserts,0);
  tables.shopify_connections[0].user_id=uid;
  assert.equal((await saveSubscription(input())).ok,true);assert.equal(inserts,1);
  assert.equal(tables.store_subscriptions[1].user_id,uid);assert.equal(tables.store_subscriptions[1].anchor_day,31);
});
test('renewal preserves the billing day, activates trials and rejects replay and foreign IDs',async()=>{
  reset();const request={id:subid,expectedUpdatedAt:base.updated_at};
  assert.equal((await confirmSubscriptionRenewal(request)).ok,true);
  assert.equal(tables.store_subscriptions[0].next_due_date,'2026-02-28');assert.equal(tables.store_subscriptions[0].status,'active');
  assert.equal(tables.store_subscriptions[0].anchor_day,31);
  assert.equal((await confirmSubscriptionRenewal(request)).ok,false);
  assert.equal(tables.store_subscriptions[0].next_due_date,'2026-02-28');
  user={id:other};assert.equal((await confirmSubscriptionRenewal({id:subid,expectedUpdatedAt:tables.store_subscriptions[0].updated_at})).ok,false);
});
test('edits reject stale data, retain original billing day, and allow pausing reminders',async()=>{
  reset();tables.store_subscriptions[0].next_due_date='2026-02-28';
  const payload={...input(),id:subid,expectedUpdatedAt:base.updated_at,next_due_date:'2026-02-28',status:'paused'};
  assert.equal((await saveSubscription(payload)).ok,true);assert.equal(tables.store_subscriptions[0].anchor_day,31);
  assert.equal(tables.store_subscriptions[0].status,'paused');
  assert.equal((await saveSubscription({...payload,name:'stale'})).ok,false);assert.equal(tables.store_subscriptions[0].name,'Shopify');
});
test('marking read accepts only the current alert and never changes another user record',async()=>{
  reset();
  assert.equal((await readSubscriptionAlert({id:subid,key:'trial:2026-01-31:upcoming'})).ok,false);
  const key='trial:2026-01-31:overdue';
  assert.equal((await readSubscriptionAlert({id:subid,key})).ok,true);assert.equal(tables.store_subscriptions[0].read_alert_key,key);
  user={id:other};assert.equal((await readSubscriptionAlert({id:subid,key})).ok,false);
});
