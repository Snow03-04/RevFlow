require('../scripts/register-ts.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const {memoryDb} = require('./helpers/memory-db.cjs');
const {getDashboardStoreActivity} = require('../src/lib/dashboard/store-activity.ts');
const now = new Date('2026-11-03T17:00:00.000Z');
const order = (id, store, processed_at, extra = {}) => ({id,user_id:'u',shopify_connection_id:store,
  processed_at,test:false,cancelled_at:null,...extra});

test('activity expires after 72 hours and a new order automatically reactivates the store', async () => {
  const db = memoryDb({orders:[order('1','a','2026-10-31T17:00:00.000Z')]});
  assert.deepEqual([...await getDashboardStoreActivity(db,'u',['a','empty'],now)], [['a','active'],['empty','inactive']]);
  assert.equal((await getDashboardStoreActivity(db,'u',['a'],new Date(now.getTime()+1))).get('a'),'inactive');
  db.tables.orders.push(order('2','a',now.toISOString()));
  assert.equal((await getDashboardStoreActivity(db,'u',['a'],now)).get('a'),'active');
  assert.deepEqual(db.writes,[]);
});

test('foreign, test, cancelled, future and unowned orders cannot activate a store', async () => {
  const db = memoryDb({orders:[
    order('1','a',now.toISOString(),{user_id:'other'}),
    order('2','b',now.toISOString(),{test:true}),
    order('3','c',now.toISOString(),{cancelled_at:now.toISOString()}),
    order('4','d','2026-11-03T17:00:00.001Z'),
    order('5','foreign',now.toISOString()),
    order('6','real',now.toISOString(),{financial_status:'pending'}),
  ]});
  assert.deepEqual([...await getDashboardStoreActivity(db,'u',['a','b','c','d','real'],now)],
    [['a','inactive'],['b','inactive'],['c','inactive'],['d','inactive'],['real','active']]);
});

test('a busy store cannot hide activity from another store past the default response limit', async () => {
  const orders = Array.from({length:1001},(_,i)=>order(String(i).padStart(4,'0'),'busy',now.toISOString()));
  orders.push(order('9999','quiet',now.toISOString()));
  const db = memoryDb({orders},{projectColumns:true});
  assert.equal((await getDashboardStoreActivity(db,'u',['busy','quiet'],now)).get('quiet'),'active');
  assert.equal(db.reads.length,2);
  assert.deepEqual(db.writes,[]);
});

test('a read failure is never presented as inactivity and no-store views need no read', async () => {
  const db = {from(){const q={select:()=>q,eq:()=>q,range:()=>q,in:()=>q,gte:()=>q,lte:()=>q,is:()=>q,order:()=>q,
    then:resolve=>Promise.resolve({data:null,error:new Error('read unavailable')}).then(resolve)};return q;}};
  await assert.rejects(getDashboardStoreActivity(db,'u',['a'],now),/read unavailable/);
  assert.deepEqual([...await getDashboardStoreActivity(db,'u',[],now)],[]);
});
