const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const userA = '10000000-0000-4000-8000-000000000001', userB = '10000000-0000-4000-8000-000000000002';
const storeA = '20000000-0000-4000-8000-000000000001', storeB = '20000000-0000-4000-8000-000000000002';
const id = '30000000-0000-4000-8000-000000000001';
test('database enforces owner visibility, store ownership, write restrictions and valid data', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      grant usage on schema public to anon, authenticated, service_role;
      create schema auth; grant usage on schema auth to authenticated;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create table auth.users(id uuid primary key);
      create table public.shopify_connections(id uuid primary key, user_id uuid not null references auth.users(id));
      grant select on public.shopify_connections to authenticated;
      alter table public.shopify_connections enable row level security;
      create policy owned_stores on public.shopify_connections for select to authenticated using (user_id=auth.uid());
      insert into auth.users values ('${userA}'),('${userB}');
      insert into public.shopify_connections values ('${storeA}','${userA}'),('${storeB}','${userB}');`);
    await db.exec(fs.readFileSync(require('node:path').join(__dirname,'../supabase/migrations/20261107020929_store_subscriptions.sql'),'utf8'));
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${userA}',false);
      insert into store_subscriptions(id,user_id,shopify_connection_id,name,next_due_date,anchor_day) values ('${id}','${userA}','${storeA}','Shopify','2026-11-14',14);`);
    assert.equal((await db.query('select * from store_subscriptions')).rows.length,1);
    await assert.rejects(db.exec(`insert into store_subscriptions(user_id,shopify_connection_id,name,next_due_date,anchor_day) values ('${userA}','${storeB}','Foreign','2026-11-14',14)`), /row-level security/);
    await assert.rejects(db.exec(`update store_subscriptions set user_id='${userB}' where id='${id}'`), /row-level security/);
    await assert.rejects(db.exec(`update store_subscriptions set shopify_connection_id='${storeB}' where id='${id}'`), /row-level security/);
    for (const change of ["amount=-1", "reminder_days=91", "anchor_day=0", "status='unknown'", "management_url='javascript:alert(1)'"])
      await assert.rejects(db.exec(`update store_subscriptions set ${change} where id='${id}'`), /check constraint/);
    await db.exec(`update store_subscriptions set status='cancelled' where id='${id}'`);
    assert.equal((await db.query('select status from store_subscriptions')).rows[0].status,'cancelled');
    await assert.rejects(db.exec('delete from store_subscriptions'), /permission denied/);
    await db.exec(`select set_config('request.jwt.claim.sub','${userB}',false)`);
    assert.equal((await db.query('select * from store_subscriptions')).rows.length,0);
    assert.equal((await db.query(`update store_subscriptions set name='Hacked' where id='${id}' returning id`)).rows.length,0);
    await db.exec('reset role; set role anon');
    await assert.rejects(db.exec('select * from store_subscriptions'),/permission denied/);
  } finally { await db.close(); }
});
