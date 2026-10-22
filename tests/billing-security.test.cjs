const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const {PGlite}=require('@electric-sql/pglite');
const migration=fs.readFileSync(path.join(__dirname,'../supabase/migrations/0043_revflow_memberships.sql'),'utf8');
const admin='7a1f9015-64dc-4af4-89cd-a92bf67118bf',legacy='10000000-0000-4000-8000-000000000001',fresh='10000000-0000-4000-8000-000000000002';
async function setup(){const db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;grant usage on schema public to anon,authenticated,service_role;create schema auth;grant usage on schema auth to anon,authenticated,service_role;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;create table public.sales(id integer primary key,user_id uuid,amount integer);alter table public.sales enable row level security;create policy own on public.sales to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());grant select,insert,update,delete on public.sales to authenticated,service_role;insert into auth.users(id,email) values('${admin}','admin@example.invalid'),('${legacy}','legacy@example.invalid');insert into public.sales values(1,'${admin}',100),(2,'${legacy}',200);`);await db.exec(migration);await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[fresh,'new@example.invalid',JSON.stringify({role:'admin',is_admin:true,paid:true})]);await db.query('insert into public.sales values(3,$1,300)',[fresh]);return db;}
async function role(db,r,id,sql,args=[]){return db.transaction(async tx=>{await tx.exec(`set local role ${r}`);await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[id??'']);return tx.query(sql,args);});}
test('Paid access and admin rights are server-owned; administrators cannot see another merchant',async()=>{const db=await setup();try{
 assert.deepEqual((await role(db,'authenticated',admin,'select amount from public.sales')).rows,[{amount:100}]);
 assert.deepEqual((await role(db,'authenticated',legacy,'select amount from public.sales')).rows,[{amount:200}]);
 assert.deepEqual((await role(db,'authenticated',fresh,'select amount from public.sales')).rows,[]);
 assert.equal((await role(db,'authenticated',fresh,'select public.revflow_has_access() ok')).rows[0].ok,false);
 assert.equal((await role(db,'authenticated',fresh,'select public.revflow_my_access() state')).rows[0].state.role,'member');
 for(const r of ['anon','authenticated']){
  await assert.rejects(role(db,r,fresh,'select * from revflow_private.memberships'),e=>e.code==='42501');
  await assert.rejects(role(db,r,fresh,'select public.revflow_admin_overview()'),e=>e.code==='42501');
  await assert.rejects(role(db,r,fresh,"select public.revflow_admin_update($1,$2,'grant_access')",[admin,fresh]),e=>e.code==='42501');
  await assert.rejects(role(db,r,fresh,'select public.revflow_account($1)',[admin]),e=>e.code==='42501');
 }
 await assert.rejects(role(db,'authenticated',fresh,'insert into public.sales values(4,$1,999)',[fresh]),e=>e.code==='42501');
 await role(db,'service_role',null,'select public.revflow_account($1)',[fresh]);
 await assert.rejects(role(db,'service_role',null,"select public.revflow_admin_update($1,$2,'grant_access')",[fresh,fresh]),e=>e.code==='42501');
 await role(db,'service_role',null,"select public.revflow_admin_update($1,$2,'grant_access')",[admin,fresh]);
 assert.deepEqual((await role(db,'authenticated',fresh,'select amount from public.sales')).rows,[{amount:300}]);
 await role(db,'service_role',null,"select public.revflow_admin_update($1,$2,'revoke_access')",[admin,fresh]);
 assert.equal((await role(db,'authenticated',fresh,'select public.revflow_has_access() ok')).rows[0].ok,false);
 await assert.rejects(role(db,'service_role',null,"select public.revflow_admin_update($1,$2,'revoke_access')",[admin,admin]));
}finally{await db.close();}});
test('Stripe snapshots are idempotent, ordered and expire; a client cannot forge payment state',async()=>{const db=await setup();try{
 await role(db,'service_role',null,'select public.revflow_account($1)',[fresh]);
 const sql="select public.revflow_apply_subscription($1,$2,$3,'sub_test','monthly',$4,$5,false)";
 const end=new Date(Date.now()+86400000).toISOString();
 await role(db,'service_role',null,sql,[fresh,'evt_paid','2026-10-22T12:00:00Z','active',end]);
 assert.equal((await role(db,'authenticated',fresh,'select public.revflow_has_access() ok')).rows[0].ok,true);
 await role(db,'service_role',null,sql,[fresh,'evt_old','2026-10-22T11:00:00Z','past_due',null]);
 await role(db,'service_role',null,sql,[fresh,'evt_paid','2026-10-22T13:00:00Z','canceled',null]);
 assert.equal((await role(db,'authenticated',fresh,'select public.revflow_has_access() ok')).rows[0].ok,true);
 await assert.rejects(role(db,'authenticated',fresh,sql,[fresh,'evt_fake','2026-10-23T12:00:00Z','active',end]),e=>e.code==='42501');
 await role(db,'service_role',null,sql,[fresh,'evt_expired','2026-10-24T12:00:00Z','active','2020-01-01T00:00:00Z']);
 assert.equal((await role(db,'authenticated',fresh,'select public.revflow_has_access() ok')).rows[0].ok,false);
}finally{await db.close();}});
test('Checkout leases and contact limits are atomic and enforce ownership',async()=>{const db=await setup();try{
 await role(db,'service_role',null,'select public.revflow_account($1)',[fresh]);
 const a='20000000-0000-4000-8000-000000000001',b='20000000-0000-4000-8000-000000000002';
 const lock=async(token,release=false)=>(await role(db,'service_role',null,'select public.revflow_checkout_lock($1,$2,$3) ok',[fresh,token,release])).rows[0].ok;
 assert.equal(await lock(a),true);assert.equal(await lock(b),false);assert.equal(await lock(b,true),false);assert.equal(await lock(b),false);assert.equal(await lock(a,true),true);assert.equal(await lock(b),true);
 for(let i=0;i<7;i++){const r=await role(db,'service_role',null,"select public.revflow_rate_limit('test',5,3600) ok");assert.equal(r.rows[0].ok,i<5);}
}finally{await db.close();}});

require('../scripts/register-ts.cjs');
const {safeRedirect}=require('../src/lib/auth/redirect.ts');
const {PLANS}=require('../src/lib/billing/plans.ts');
test('Redirects cannot leave the application, including encoded backslashes and protocol-relative URLs',()=>{for(const input of ['https://evil.invalid','//evil.invalid','/\\evil.invalid','/%5c/evil.invalid','/%2fexample.invalid','/\n/evil.invalid','/%00evil'])assert.equal(safeRedirect(input),'/dashboard',input);assert.equal(safeRedirect('/subscribe?plan=yearly'),'/subscribe?plan=yearly');});
test('Prices represent the full recurring charge in cents, not the monthly equivalent',()=>{assert.deepEqual(PLANS.map(p=>[p.id,p.amount,p.months]),[['monthly',695,1],['quarterly',1495,3],['yearly',4495,12]]);});
