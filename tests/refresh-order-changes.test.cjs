process.env.NEXT_PUBLIC_SUPABASE_URL='https://test.invalid';process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='test';
require('../scripts/register-ts.cjs');
const test=require('node:test'),assert=require('node:assert/strict');
const {memoryDb}=require('./helpers/memory-db.cjs');
const {upsertOrders}=require('../src/lib/shopify/sync.ts');
const {orderSyncSince,orderAccountingKey}=require('../src/lib/shopify/order-changes.ts');
const order={id:1,name:'#1',processed_at:'2020-08-01T10:00:00Z',updated_at:'2020-08-01T10:00:00Z',currency:'EUR',financial_status:'paid',subtotal_price:'100',total_price:'100',line_items:[{id:11,product_id:2,variant_id:3,quantity:2,current_quantity:2,price:'50'}]};
async function setup(){const db=memoryDb({});const ctx={supabase:db,userId:'u',connectionId:'s',lastSuccessfulSync:'2020-10-01T10:00:00Z'};await upsertOrders(ctx,[order],new Map([['3',10]]));db.tables.orders[0].updated_at='2020-09-01T10:00:00Z';return{db,ctx};}

test('Unchanged accounting skips old rollups while fulfilment/contact metadata still updates',async()=>{
 const {db,ctx}=await setup();
 const dates=await upsertOrders(ctx,[{...order,updated_at:'2020-10-02T10:00:00Z',fulfillment_status:'fulfilled',email:'updated@example.com'}],new Map([['3',10]]));
 assert.deepEqual(dates,[]);assert.equal(db.tables.orders[0].fulfillment_status,'fulfilled');assert.equal(db.tables.orders[0].customer_email,'updated@example.com');assert.equal(db.tables.order_line_items.length,1);
});

test('Changed refunds, paid status, amounts, lines and costs still repair historical days',async()=>{
 for(const change of [o=>({...o,financial_status:'refunded'}),o=>({...o,subtotal_price:'90'}),o=>({...o,refunds:[{transactions:[{kind:'refund',status:'success',amount:'20'}]}]}),o=>({...o,line_items:[{...o.line_items[0],current_quantity:1}]}),o=>({...o,cancelled_at:'2020-10-02T10:00:00Z'})]){
 const {ctx}=await setup();assert.deepEqual(await upsertOrders(ctx,[change(order)],new Map([['3',10]])),[order.processed_at]);}
 const {ctx}=await setup();assert.deepEqual(await upsertOrders(ctx,[order],new Map([['3',12]])),[order.processed_at]);
});

test('Interrupted imports, missing lines, missing checkpoints and moved dates cannot skip repairs',async()=>{
 let {db,ctx}=await setup();db.tables.orders[0].updated_at='2020-10-02T10:00:00Z';assert.deepEqual(await upsertOrders(ctx,[order],new Map([['3',10]])),[order.processed_at]);
 ({db,ctx}=await setup());db.tables.order_line_items=[];assert.deepEqual(await upsertOrders(ctx,[order],new Map([['3',10]])),[order.processed_at]);
 ({db,ctx}=await setup());delete ctx.lastSuccessfulSync;assert.deepEqual(await upsertOrders(ctx,[order],new Map([['3',10]])),[order.processed_at]);
 ({db,ctx}=await setup());const moved='2020-08-02T10:00:00Z';assert.deepEqual((await upsertOrders(ctx,[{...order,processed_at:moved}],new Map([['3',10]]))).sort(),[order.processed_at,moved]);
});

test('Incremental windows overlap successful imports and retain wide recovery/backfill windows',()=>{
 const now=Date.parse('2020-10-14T12:00:00Z'),healthy={status:'active',last_synced_at:'2020-10-14T11:59:00Z'};
 assert.equal(orderSyncSince(3,healthy,true,now),'2020-10-14T11:54:00.000Z');
 assert.equal(orderSyncSince(3,healthy,false,now),'2020-10-11T12:00:00.000Z');
 for(const c of [{...healthy,status:'error'},{...healthy,last_synced_at:null},{...healthy,last_synced_at:'invalid'},{...healthy,last_synced_at:'2021-01-01'}])assert.equal(orderSyncSince(3,c,true,now),'2020-10-11T12:00:00.000Z');
 assert.equal(orderSyncSince(3,{...healthy,last_synced_at:'2020-09-01T12:00:00Z'},true,now),'2020-09-01T11:55:00.000Z');
});

test('Database JSON key order cannot force another historical repair of a paid basket',()=>{
 const first={financial_status:'partially_paid',total_price:50,raw:{revflow_paid_portion:{version:1,captured:50,currency:'EUR'}}};
 const same={...first,raw:{revflow_paid_portion:{currency:'EUR',captured:50,version:1}}};
 assert.equal(orderAccountingKey(first,[]),orderAccountingKey(same,[]));
 assert.notEqual(orderAccountingKey(first,[]),orderAccountingKey({...first,raw:{}},[]));
 assert.notEqual(orderAccountingKey(first,[]),orderAccountingKey({...first,raw:{revflow_paid_portion:{version:1,captured:60}}},[]));
});
