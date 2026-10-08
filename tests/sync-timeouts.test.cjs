process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test";
process.env.GOOGLE_ADS_DEVELOPER_TOKEN = "test-only";
process.env.GOOGLE_ADS_CLIENT_ID = "test-only";
process.env.GOOGLE_ADS_CLIENT_SECRET = "test-only";
require("../scripts/register-ts.cjs");
const test=require("node:test"), assert=require("node:assert/strict");
const {shopifyGet}=require("../src/lib/shopify/client.ts");
const {exchangeClientCredentials}=require("../src/lib/shopify/oauth.ts");
const {graphPaginate}=require("../src/lib/meta/client.ts");
const {searchStream}=require("../src/lib/google/client.ts");
const {refreshAccessToken}=require("../src/lib/google/oauth.ts");

test("Unresponsive Shopify, Meta, Google and token reads abort rather than hold refresh forever", async(t)=>{
  let requests=0;
  t.mock.method(AbortSignal,"timeout",ms=>{
    assert.equal(ms,20_000);
    const controller=new AbortController();
    queueMicrotask(()=>controller.abort(new DOMException("Timed out","TimeoutError")));
    return controller.signal;
  });
  t.mock.method(global,"fetch",async(_url,options)=>{
    requests++;
    assert.ok(options.signal);
    return new Promise((_resolve,reject)=>options.signal.addEventListener("abort",()=>reject(options.signal.reason),{once:true}));
  });
  for(const task of [()=>shopifyGet("store.myshopify.com","test","orders"),
    ()=>exchangeClientCredentials("store.myshopify.com","test","test"),
    ()=>graphPaginate("test/insights",{access_token:"test"}).next(),
    ()=>searchStream("123","test","SELECT campaign.id"),()=>refreshAccessToken("test")])
    await assert.rejects(task,{name:"TimeoutError"});
  assert.equal(requests,5);
});
