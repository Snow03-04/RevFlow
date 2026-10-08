process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test";
require("../scripts/register-ts.cjs");
const test = require("node:test"), assert = require("node:assert/strict");
const React = require("react"), Module = require("node:module");
let refreshReads = 0;
const load = Module._load;
Module._load = function(request, ...args) {
  if (request === "next/navigation") return { useRouter: () => ({ refresh: () => { refreshReads++; } }) };
  return load.call(this, request, ...args);
};
const { DataRefreshProvider } = require("../src/components/dashboard/data-refresh-provider.tsx");
Module._load = load;

test("Update unlocks after success, timeout and retry even while the page transition stays pending", async (t) => {
  const slots=[]; let position=0;
  t.mock.method(React,"useState",initial=>{
    const index=position++; if(!(index in slots))slots[index]=initial;
    return [slots[index],v=>{slots[index]=v;}];
  });
  t.mock.method(React,"useRef",initial=>{const index=position++; return slots[index]??=( {current:initial} );});
  t.mock.method(React,"useCallback",fn=>fn);
  t.mock.method(React,"useEffect",()=>{});
  t.mock.method(React,"useTransition",()=>[true,fn=>fn()]); // Simulate a slow page read.
  const descriptor=Object.getOwnPropertyDescriptor(global,"navigator");
  Object.defineProperty(global,"navigator",{configurable:true,value:{onLine:true}});
  t.after(()=>{if(descriptor)Object.defineProperty(global,"navigator",descriptor);else delete global.navigator;});
  t.mock.timers.enable({apis:["setTimeout"]});
  const view=()=>{position=0;return DataRefreshProvider({children:null}).props.value;};
  let finish, requests=0;
  t.mock.method(global,"fetch",async(_url,{signal})=>{
    requests++;
    return new Promise((resolve,reject)=>{
      finish=()=>resolve(Response.json({ok:true,completedAt:"2026-10-08T10:00:00Z"}));
      signal.addEventListener("abort",()=>reject(new DOMException("Aborted","AbortError")),{once:true});
    });
  });
  assert.equal(view().refreshing,false);
  const first=view().refresh(true);
  assert.equal(view().refreshing,true);
  await view().refresh(true); assert.equal(requests,1);
  finish(); await first;
  assert.equal(view().refreshing,false); assert.equal(view().error,null); assert.equal(refreshReads,1);
  const second=view().refresh(true);
  t.mock.timers.tick(65_000); await second;
  assert.equal(view().refreshing,false); assert.match(view().error,/demorou demasiado/);
  const retry=view().refresh(true); finish(); await retry;
  assert.equal(view().refreshing,false); assert.equal(view().error,null); assert.equal(requests,3);
});
