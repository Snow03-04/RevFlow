process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.invalid';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test';
require('../scripts/register-ts.cjs');
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const { PGlite } = require('@electric-sql/pglite');
const { memoryDb } = require('./helpers/memory-db.cjs');
const originalLoad = Module._load;
Module._load = function(request, ...args) {
  if (request === '@/lib/queries') return { getStoreFxRates: async () => new Map([['s1', 1], ['s2', 2]]) };
  return originalLoad.call(this, request, ...args);
};
const { fetchMatcherProducts, fetchMatcherCatalogue } = require('../src/lib/trackers/match.ts');
Module._load = originalLoad;
const { buildVariantCostMap } = require('../src/lib/shopify/sync.ts');
const uid = '10000000-0000-4000-8000-000000000001', other = '10000000-0000-4000-8000-000000000002';

test('SQL catalogue preserves matching, prices, zero costs, fallback titles and store FX while obeying RLS', async t => {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    create table products(id text, user_id uuid, shopify_product_id text, shopify_connection_id text, handle text, title text, price numeric, cost numeric);
    create table orders(id text, user_id uuid, shopify_connection_id text);
    create table order_line_items(id text, user_id uuid, order_id text, shopify_product_id text, title text, price numeric);
    grant select on products, orders, order_line_items to authenticated, service_role;
    alter table products enable row level security; alter table orders enable row level security; alter table order_line_items enable row level security;
    create policy owner on products using (user_id = nullif(current_setting('request.jwt.claim.sub',true),'')::uuid);
    create policy owner on orders using (user_id = nullif(current_setting('request.jwt.claim.sub',true),'')::uuid);
    create policy owner on order_line_items using (user_id = nullif(current_setting('request.jwt.claim.sub',true),'')::uuid);
    insert into products values
    ('01','${uid}','p1','s1',null,'',50,null), ('02','${uid}','p1','s1','handle','Walking shoes',99,0),
    ('03','${uid}','p1','s1','different','Later title',150,20), ('04','${uid}','p2','s2','bag','',60,null),
    ('05','${other}','private','s3','private','Private',999,999);
    insert into orders values ('o1','${uid}','s1'),('o2','${uid}','s2'),('foreign','${other}','s3');
    insert into order_line_items values ('01','${uid}','o2','p2','Bag',90),
    ('02','${uid}','o1','sold',null,40),('03','${uid}','o1','sold','Sold only',80),
    ('04','${other}','foreign','private','Private',999);
    insert into products select 'x'||lpad(n::text,4,'0'),'${uid}','bulk'||n,'s1',null,'Item '||n,10,null from generate_series(1,1005) n;`);
  const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/0042_compact_matcher_catalogue.sql'), 'utf8');
  await db.exec(migration); await db.exec(migration);
  async function compact(user, role = 'authenticated', requestedUser = user) {
    return db.transaction(async tx => {
      await tx.exec(`set local role ${role}`);
      await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [user]);
      return (await tx.query('select public.matcher_catalogue($1) as result', [requestedUser])).rows[0].result;
    });
  }
  const result = await compact(uid);
  assert.equal(result.products.length,1007, 'scalar results must retain more than 1000 products');
  assert.deepEqual(await compact(uid, 'authenticated', other), { products: [], lineItems: [] });
  assert.equal((await compact(other)).products[0].title,'Private');
  await assert.rejects(compact(uid, 'anon'), e => e.code === '42501');
  assert.equal((await compact(uid, 'service_role')).products.length,1007);
  const products = (await db.query('select * from products where user_id=$1 order by id',[uid])).rows;
  const lineItems = (await db.query(`select li.*,json_build_object('shopify_connection_id',o.shopify_connection_id) as orders
    from order_line_items li left join orders o on o.id=li.order_id where li.user_id=$1 order by li.id`,[uid])).rows;
  const source = { products, order_line_items: lineItems, orders:(await db.query('select * from orders')).rows,
    settings:[{user_id:uid,currency:'EUR'}], product_costs:[{user_id:uid,shopify_product_id:'p2',cost:30,currency:'EUR',effective_from:'2026-01-01'}] };
  const legacyDb = memoryDb(source), compactDb = memoryDb(source);
  compactDb.rpc = async () => ({data:result,error:null});
  const before = await fetchMatcherProducts(legacyDb,uid), after = await fetchMatcherProducts(compactDb,uid);
  assert.deepEqual(after,before);
  assert.deepEqual(after.find(p=>p.productId==='p1'),{productId:'p1',storeId:'s1',handle:'handle',title:'Walking shoes',price:50,cost:0});
  assert.equal(after.find(p=>p.productId==='p2').cost,15);
  assert.equal(after.find(p=>p.productId==='sold').price,40);
  assert.equal(compactDb.reads.filter(r=>['products','order_line_items'].includes(r.table)).length,0);
});

test('Compact catalogue never treats permission failures or malformed results as an empty catalogue',async()=>{
  const db=memoryDb(); db.rpc=async()=>({data:null,error:{code:'42501',message:'denied'}});
  await assert.rejects(fetchMatcherCatalogue(db,'u'),e=>e.code==='42501'); assert.equal(db.reads.length,0);
  db.rpc=async()=>({data:null,error:null}); await assert.rejects(fetchMatcherCatalogue(db,'u'),/incompleto/);
});

test('Variant lookups read only requested products, preserve zero costs and isolate users',async()=>{
  const db=memoryDb({products:[
    ...Array.from({length:1200},(_,i)=>({id:String(i),user_id:'u',shopify_variant_id:String(i),cost:i})),
    {id:'foreign',user_id:'other',shopify_variant_id:'0',cost:999},
    {id:'unset',user_id:'u',shopify_variant_id:'unset',cost:null},
  ]},{projectColumns:true});
  assert.deepEqual([...(await buildVariantCostMap(db,'u',['0','1199','0','unset']))],[['0',0],['1199',1199]]);
  assert.ok(db.reads.reduce((n,r)=>n+r.bytes,0)<200);
  const count=db.reads.length;
  assert.equal((await buildVariantCostMap(db,'u',[])).size,0); assert.equal(db.reads.length,count);
});
