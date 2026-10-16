require('../scripts/register-ts.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),React=require('react'),Module=require('node:module');
let shared,project,reads=0;
const load=Module._load;
Module._load=function(request,...args){
  if(request==='next/navigation')return {useRouter:()=>({refresh:()=>reads++})};
  if(request==='@/components/dashboard/data-refresh-provider')return {useDataRefresh:()=>shared};
  if(request==='@/lib/trackers/actions')return {reprojectRoasDay:(...args)=>project(...args)};
  return load.call(this,request,...args);
};
const {RoasLive}=require('../src/components/trackers/roas-live.tsx');
Module._load=load;

test('Tracker joins the shared refresh, never starts a timer, and projects only after imports finish',async t=>{
  const slots=[];let position=0,release,calls=0,projections=0;
  t.mock.method(React,'useState',initial=>{const index=position++;if(!(index in slots))slots[index]=initial;return [slots[index],value=>slots[index]=value];});
  t.mock.method(React,'useRef',initial=>{const index=position++;return slots[index]??={current:initial};});
  t.mock.method(React,'useEffect',()=>assert.fail('No second automatic refresh loop'));
  shared={refreshing:false,online:true,error:null,refresh:async force=>{assert.equal(force,true);calls++;await new Promise(r=>release=r);}};
  project=async(...args)=>{assert.deepEqual(args,[2026,9,30]);projections++;return {ok:true};};
  const view=()=>{position=0;return RoasLive({year:2026,month:9,day:30});};
  assert.equal(view().props.disabled,false);assert.equal(calls,0);
  const pending=view().props.onClick();await view().props.onClick();
  assert.equal(calls,1);assert.equal(projections,0);assert.equal(view().props.disabled,true);
  release();await pending;
  assert.equal(projections,1);assert.equal(reads,1);assert.equal(view().props.disabled,false);
  shared.refreshing=true;assert.equal(view().props.disabled,true);
  shared.refreshing=false;shared.online=false;assert.equal(view().props.disabled,true);
  shared.online=true;shared.error='A Meta está indisponível';assert.equal(view().props.title,shared.error);
  shared.error=null;shared.refresh=async()=>{};project=async()=>{throw Error('offline');};
  await view().props.onClick();assert.equal(view().props.disabled,false);assert.match(view().props.title,/incompleta/);
});

test('Scale timestamps have deterministic separators and respect Lisbon summer/winter time',()=>{
 const {formatRoasScaleDate}=require('../src/lib/trackers/roas-window.ts');
 assert.equal(formatRoasScaleDate('2026-10-15T21:58:56Z','Europe/Lisbon'),'15/10, 22:58');
 assert.equal(formatRoasScaleDate('2026-12-15T21:58:56Z','Europe/Lisbon'),'15/12, 21:58');
});
