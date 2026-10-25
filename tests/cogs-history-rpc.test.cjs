const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const [user, other, store, otherStore] = [uid(1), uid(2), uid(3), uid(4)];
const canonical = value => Object.fromEntries(Object.entries(value).map(([key, rows]) => [key, rows.sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))]));

test('Optimized cost history preserves eligibility, duplicate-number handling and RLS', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role authenticated; create role anon; create role service_role bypassrls;
      create schema auth; grant usage on schema auth,public to authenticated,anon,service_role;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create table orders(id uuid primary key,user_id uuid,shopify_connection_id uuid,order_number text,processed_at timestamptz default now(),financial_status text default 'paid',test boolean default false,cancelled_at timestamptz,total_refunded numeric default 0);
      create table order_supplier_costs(user_id uuid,shopify_connection_id uuid,order_number text,cost numeric);
      create table order_line_items(user_id uuid,order_id uuid,shopify_product_id text,quantity integer,current_quantity integer);
      grant select on all tables in schema public to authenticated,service_role;`);
    for (const table of ['orders','order_supplier_costs','order_line_items']) await db.exec(`alter table ${table} enable row level security; create policy own_rows on ${table} for select to authenticated using(user_id=(select auth.uid()));
      create policy entitlement on ${table} as restrictive for select to authenticated using(current_setting('test.entitled',true)='yes');`);
    for (let n=10;n<20;n++) {
      await db.query('insert into orders(id,user_id,shopify_connection_id,order_number) values($1,$2,$3,$4)',[uid(n),n===19?other:user,n===18?otherStore:store,`#${n}`]);
      await db.query('insert into order_supplier_costs values($1,$2,$3,$4)',[n===19?other:user,n===18?otherStore:store,String(n),n===17?0:10]);
      await db.query('insert into order_line_items values($1,$2,$3,$4,$5)',[n===19?other:user,uid(n),'product',n===11?1:2,n===12?1:null]);
    }
    await db.query('insert into order_supplier_costs values($1,$2,$3,10)',[user,store,'#10']);
    await db.exec(`update orders set financial_status='pending' where order_number='#13'; update orders set cancelled_at=now() where order_number='#14'; update orders set test=true where order_number='#15'; update orders set total_refunded=1 where order_number='#16';`);
    const original = fs.readFileSync('supabase/migrations/0039_financial_read_windows.sql','utf8');
    await db.exec(original.slice(original.indexOf('create or replace function public.cogs_quantity_history'),original.indexOf('revoke all on function public.financial_payment_snapshots')));
    await db.exec('revoke all on function cogs_quantity_history(uuid,uuid) from public,anon; grant execute on function cogs_quantity_history(uuid,uuid) to authenticated,service_role;');
    async function read(owner=user,whichStore=store,entitled='yes') {
      return db.transaction(async tx => {
        await tx.exec('set local role authenticated');
        await tx.query("select set_config('request.jwt.claim.sub',$1,true),set_config('test.entitled',$2,true)",[user,entitled]);
        return canonical((await tx.query('select cogs_quantity_history($1,$2) as history',[owner,whichStore])).rows[0].history);
      });
    }
    const before = await read();
    assert.deepEqual(before.orders.map(o=>o.order_number),['#10']);
    assert.equal(before.items.length,1);
    await db.exec(fs.readFileSync('supabase/migrations/0044_cogs_history_set_based.sql','utf8'));
    assert.deepEqual(await read(),before);
    assert.deepEqual(await read(other),{orders:[],items:[]});
    assert.deepEqual(await read(user,store,'no'),{orders:[],items:[]});
    assert.deepEqual((await read(user,otherStore)).orders.map(o=>o.order_number),['#18']);
    const contract = (await db.query("select prosecdef,has_function_privilege('anon',oid,'execute') as anon_exec from pg_proc where proname='cogs_quantity_history'")).rows[0];
    assert.equal(contract.prosecdef,false); assert.equal(contract.anon_exec,false);
    await db.exec('alter table order_line_items add column title text;');
    await db.exec(fs.readFileSync('supabase/migrations/0049_supplier_family_history.sql','utf8'));
    async function supplierHistory(owner=user) {
      return db.transaction(async tx=>{
        await tx.exec('set local role authenticated');
        await tx.query("select set_config('request.jwt.claim.sub',$1,true),set_config('test.entitled','yes',true)",[user]);
        return (await tx.query('select cogs_supplier_history($1,$2) as history',[owner,store])).rows[0].history;
      });
    }
    const supplier=await supplierHistory();
    assert.deepEqual(supplier.orders.map(o=>o.order_number).sort(),['#10','#11']);
    assert.equal(supplier.items.length,2);
    assert.ok(supplier.items.every(i=>Object.hasOwn(i,'title')));
    assert.deepEqual(await supplierHistory(other),{orders:[],items:[]});
    const familyContract=(await db.query("select prosecdef,has_function_privilege('anon',oid,'execute') as anon_exec from pg_proc where proname='cogs_supplier_history'")).rows[0];
    assert.equal(familyContract.prosecdef,false);assert.equal(familyContract.anon_exec,false);
  } finally { await db.close(); }
});
