process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test";
require("../scripts/register-ts.cjs");
const test = require("node:test"), assert = require("node:assert/strict");
const { memoryDb } = require("./helpers/memory-db.cjs");
const { planRefresh, runRefreshStep } = require("../src/lib/sync/steps.ts");
const jobs = require("../src/lib/jobs.ts"), metrics = require("../src/lib/metrics.ts");
const source = () => ({
  shopify_connections: [
    {id:"a",user_id:"u",shop_domain:"a.myshopify.com",shop_name:"A",status:"active",last_synced_at:new Date().toISOString(),access_token:"private"},
    {id:"b",user_id:"u",shop_domain:"b.myshopify.com",shop_name:"B",status:"error",last_synced_at:null},
    {id:"revoked",user_id:"u",shop_domain:"c.myshopify.com",status:"revoked",last_synced_at:null},
    {id:"foreign",user_id:"other",shop_domain:"other.myshopify.com",status:"active",last_synced_at:null},
  ],
  meta_connections:[{id:"m",user_id:"u",ad_account_id:"act_123",ad_account_name:"Meta A",status:"active",last_synced_at:null}],
  google_connections:[], settings:[{user_id:"u",timezone:"Europe/Lisbon"}],
  pnl_settings:[{user_id:"u"}], roas_settings:[{user_id:"u"}],
});

test("Plans expose only owned IDs and labels, skip fresh/revoked imports and still repair every store's totals", async () => {
  const db = memoryDb(source());
  const plan = await planRefresh(db,"u",false);
  assert.deepEqual(plan.stages[0].tasks.map(t=>t.step.id),["b","m"]);
  assert.deepEqual(plan.stages[1].tasks.map(t=>t.step.id),["a","b","revoked"]);
  assert.deepEqual(plan.stages[2].tasks.map(t=>t.step.kind),["pnl","roas"]);
  assert.doesNotMatch(JSON.stringify(plan),/private|foreign|access_token/);
  assert.deepEqual(db.writes,[]);
  assert.deepEqual((await planRefresh(db,"u",true)).stages[0].tasks.map(t=>t.step.id),["a","b","m"]);
});

test("Steps preserve complete Shopify work and never use another user's connection or fall back to all stores", async t => {
  const calls=[];
  t.mock.method(jobs,"syncShopifyConnection",async(_db,conn,opts)=>calls.push({conn,opts}));
  t.mock.method(metrics,"recomputeDailyMetrics",async(...args)=>calls.push({metrics:args}));
  const db=memoryDb(source());
  assert.equal((await runRefreshStep(db,"u",{kind:"shopify",id:"foreign"},true)).ok,false);
  assert.equal((await runRefreshStep(db,"u",{kind:"metrics",id:"foreign"},true)).ok,false);
  assert.equal((await runRefreshStep(db,"u",{kind:"shopify",id:"revoked"},true)).ok,false);
  assert.equal(calls.length,0);
  assert.deepEqual(await runRefreshStep(db,"u",{kind:"shopify",id:"a"},false),{ok:true,synced:false});
  await runRefreshStep(db,"u",{kind:"shopify",id:"a"},true);
  assert.deepEqual(calls[0].opts,{sinceDays:3,skipProducts:true,skipRecompute:true,incremental:true});
  await runRefreshStep(db,"u",{kind:"metrics",id:"a"},false);
  assert.equal(calls[1].metrics[1],"u");
  assert.equal(calls[1].metrics[3].storeId,"a");
});

test("Duplicate requests share a unit of work but never share it with another user or a later retry", async t => {
  const db=memoryDb(source());
  let calls=0,finish;
  t.mock.method(jobs,"syncMetaConnection",async()=>{calls++;await new Promise(resolve=>{finish=resolve;});});
  const a=runRefreshStep(db,"u",{kind:"meta",id:"m"},true);
  const b=runRefreshStep(db,"u",{kind:"meta",id:"m"},true);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls,1);
  assert.equal((await runRefreshStep(db,"other",{kind:"meta",id:"m"},true)).ok,false);
  finish(); assert.deepEqual(await a,await b);
  const c=runRefreshStep(db,"u",{kind:"meta",id:"m"},true);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls,2); finish(); await c;
});

test("Plain database errors retain their cause and a failed plan never pretends no stores exist", async t => {
  const db=memoryDb(source());
  t.mock.method(jobs,"syncMetaConnection",async()=>{throw {message:"database unavailable"};});
  assert.deepEqual(await runRefreshStep(db,"u",{kind:"meta",id:"m"},true),{ok:false,error:"database unavailable"});
  const broken={from(){const q={select:()=>q,eq:()=>q,maybeSingle:()=>q,then:resolve=>Promise.resolve({data:null,error:{message:"permission denied"}}).then(resolve)};return q;}};
  await assert.rejects(planRefresh(broken,"u",false),error=>error.message==="permission denied");
});

test("Progressive refresh publishes sales and P&L before reconciling payments, preserving old clients", async t => {
  const db = memoryDb(source());
  const plan = await planRefresh(db,"u",true,true);
  assert.deepEqual(plan.stages.map(s=>s.kind),["imports","totals","reports","publish","reconcile","reports"]);
  assert.equal(plan.stages[0].tasks[0].step.kind,"shopify-sales");
  assert.deepEqual(plan.stages[2].tasks.map(t=>t.step.kind),["pnl"]);
  assert.deepEqual(plan.stages[4].tasks.map(t=>t.step.id),["a","b"]);
  const calls=[];
  t.mock.method(jobs,"syncShopifyConnection",async(_db,c,opts)=>calls.push(opts));
  t.mock.method(jobs,"syncShopifyFinancials",async(_db,c,force)=>calls.push({payment:c.id,force}));
  await runRefreshStep(db,"u",{kind:"shopify-sales",id:"a"},true);
  await runRefreshStep(db,"u",{kind:"payments",id:"a"},true);
  assert.equal(calls[0].deferPayments,true);
  assert.deepEqual(calls[1],{payment:"a",force:true});
  assert.equal((await runRefreshStep(db,"other",{kind:"payments",id:"a"},true)).ok,false);
});
