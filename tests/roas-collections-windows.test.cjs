process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.invalid';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-only';
process.env.TOKEN_ENCRYPTION_KEY = '11'.repeat(32);
require('../scripts/register-ts.cjs');
const test = require('node:test'), assert = require('node:assert/strict');
const { memoryDb } = require('./helpers/memory-db.cjs');
const { attributeRoasSales, roasCampaignDayKey } = require('../src/lib/trackers/roas-attribution.ts');
const { evaluateRoasWindow } = require('../src/lib/trackers/roas-window.ts');
const { roasDecision } = require('../src/lib/trackers/roas.ts');
const { parseBudgetIncrease, syncMetaBudgetHistory } = require('../src/lib/meta/budget-history.ts');
// Mirrors trackerFxByMetaConnection's shape, rates keyed by Meta connection.
const fxMock = (rates, stores, fallback = 1) => ({ rates, stores, fallback,
  storeOf: (r) => r.shopify_connection_id ?? stores.get(r.meta_connection_id) ?? null,
  rateOf: (r) => rates.get(r.meta_connection_id) ?? fallback });

const date = '2026-10-15';
const collection = { productId: null, collectionHandle: 'shoes', via: 'collection', score: 1000, price: 0, cog: 0 };
const campaign = { key: 'meta:c1', campaignId: 'c1', name: 'Shoes', storeId: 's', date, target: collection, purchases: 1, spend: 10 };
const item = { productId: 'different-purchase', units: 2, revenue: 80, weight: 80, cost: 20 };
const order = { id: 'o', storeId: 's', date, landingSite: '/products/landing-shoe?fbclid=click', collectionHandle: null,
  grossRevenue: 80, refunds: 0, cost: 20, sheetCost: true, items: [item] };
const memberships = new Map([['s:shoes', [{ id: 'landing-id', handle: 'landing-shoe' }]]]);
const total = (result, field) => [...result.values()].reduce((n, row) => n + row[field], 0);

test('Collection attribution accepts its page, member product and nested/localized URL, even if the purchased product differs', () => {
  const landings = ['/collections/shoes?fbclid=x', '/products/landing-shoe', '/hu/collections/shoes/products/landing-shoe?fbclid=x'];
  const orders = landings.map((landingSite, i) => ({ ...order, id: String(i), landingSite }));
  const result = attributeRoasSales([campaign], orders, [], memberships);
  assert.deepEqual(result.get(roasCampaignDayKey(campaign.key, date)), { orders: 3, units: 6, revenue: 240, cost: 60 });
});

test('Purchased membership alone, an unrelated landing, another store and Google paid clicks cannot create collection sales', () => {
  const rows = [null, '/products/unrelated', '/products/landing-shoe?gclid=google'].map((landingSite, i) => ({ ...order, id: String(i), landingSite, items: [{ ...item, productId: 'landing-id' }] }));
  rows.push({ ...order, id: 'foreign', storeId: 'other' });
  const result = attributeRoasSales([campaign], rows, [], memberships);
  assert.equal(total(result, 'revenue'), 0);
});

test('Exact campaign tags win over landing inference, and overlapping collections never duplicate money or units', () => {
  const second = { ...campaign, key: 'meta:c2', campaignId: 'c2', name: 'Winter', target: { ...collection, collectionHandle: 'winter' } };
  const members = new Map([...memberships, ['s:winter', [{ id: 'landing-id', handle: 'landing-shoe' }]]]);
  const tagged = { ...order, landingSite: '/collections/shoes?utm_campaign=c2' };
  const explicit = attributeRoasSales([campaign, second], [tagged, tagged], [], members);
  assert.equal(explicit.get('meta:c1:'+date).revenue, 0);
  assert.equal(explicit.get('meta:c2:'+date).revenue, 80);
  const ambiguous = attributeRoasSales([campaign, second], [order, order], [], members);
  assert.equal(total(ambiguous, 'revenue'), 80); assert.equal(total(ambiguous, 'cost'), 20);
  assert.equal(total(ambiguous, 'units'), 2); assert.equal(total(ambiguous, 'orders'), 1);
  assert.equal(ambiguous.get('meta:c1:'+date).revenue, 40);
});

test('Collection and product campaigns share one landing sale; product-only fallback preserves actual purchased units', () => {
  const product = { ...campaign, key: 'meta:p', campaignId: 'p', target: { productId: 'landing-id', via: 'handle', price: 40, cog: 10 } };
  const catalogue = [{ productId: 'landing-id', storeId: 's', handle: 'landing-shoe' }];
  const result = attributeRoasSales([campaign, product], [order], catalogue, memberships);
  assert.equal(total(result, 'revenue'), 80); assert.equal(total(result, 'cost'), 20);
  const fallback = attributeRoasSales([product], [{ ...order, items: [{ ...item, productId: 'landing-id' }] }], catalogue, memberships);
  assert.equal(total(fallback, 'revenue'), 80);
  assert.equal(total(fallback, 'units'), 2);
});

test('Fresh Google links cannot throttle new or stale Meta campaign destinations', async (t) => {
  const client = require('../src/lib/meta/client.ts');
  const crypto = require('../src/lib/crypto.ts');
  const { refreshCampaignLinks } = require('../src/lib/jobs.ts');
  const calls = [];
  t.mock.method(crypto, 'decryptToken', () => 'fixture');
  t.mock.method(client, 'graphPaginate', async function* (path) {
    calls.push(path); yield [{ effective_status: 'ACTIVE', creative: { link_url: 'https://example.test/collections/shoes' } }];
  });
  const db = memoryDb({ meta_connections: [{ id: 'm', user_id: 'u', status: 'active', access_token: 'encrypted' }],
    campaign_links: [{ user_id: 'u', campaign_id: 'google:fresh', link_kind: 'collection', updated_at: new Date().toISOString() },
      { user_id: 'u', campaign_id: 'fresh', link_kind: 'collection', updated_at: new Date().toISOString() },
      { user_id: 'u', campaign_id: 'stale', link_kind: 'product', updated_at: '2025-01-01' }],
    campaigns: ['new', 'fresh', 'stale'].map(campaign_id => ({ user_id: 'u', meta_connection_id: 'm', campaign_id, date: new Date().toISOString().slice(0,10), spend: 10 })) });
  assert.equal(await refreshCampaignLinks(db, 'u'), 2);
  assert.deepEqual(calls.sort(), ['new/ads', 'stale/ads']);
  assert.equal(db.tables.campaign_links.find(c => c.campaign_id === 'new').collection_handle, 'shoes');
});

test('ROAS projection respects manual collection mappings and preserves old data when Shopify membership is unavailable', async (t) => {
  const match = require('../src/lib/trackers/match.ts'), sales = require('../src/lib/trackers/sales.ts');
  const members = require('../src/lib/trackers/collection-memberships.ts');
  const { projectRoasMonth } = require('../src/lib/trackers/roas-import.ts');
  t.mock.method(match, 'trackerFxByMetaConnection', async () => fxMock(new Map([['meta', 2]]), new Map([['meta', 's']])));
  t.mock.method(match, 'fetchMatcherProducts', async () => []);
  t.mock.method(match, 'fetchCampaignTargetMap', async () => new Map([['general:meta:meta:c1', { collection: 'shoes', product: null, kind: 'collection' }]]));
  t.mock.method(sales, 'fetchTrackerOrderSales', async () => [order]);
  let unavailable = false;
  t.mock.method(members, 'getCollectionLandingProducts', async (_db, user, scopes) => {
    assert.equal(user, 'u'); assert.deepEqual(scopes, [{ storeId: 's', handle: 'shoes' }]);
    return unavailable ? new Map([['s:shoes', null]]) : memberships;
  });
  const db = memoryDb({ settings: [{user_id:'u',timezone:'Europe/Lisbon'}], campaigns: [{user_id:'u',campaign_id:'c1',campaign_name:'First name',meta_connection_id:'meta',date,spend:10,purchases:1,clicks:5,atc:2}] });
  await projectRoasMonth(db, 'u', 2026, 10);
  const row = db.tables.roas_entries[0];
  assert.equal(row.campaign_key, 'meta:c1'); assert.equal(row.price * row.units_sold, 160);
  db.tables.campaigns[0].campaign_name = 'New name';
  await projectRoasMonth(db, 'u', 2026, 10);
  assert.equal(db.tables.roas_entries.length, 1); assert.equal(db.tables.roas_entries[0].id, row.id);
  const before = { ...db.tables.roas_entries[0] };
  unavailable = true;
  await projectRoasMonth(db, 'u', 2026, 10);
  for (const key of ['pur','price','cog','units_sold']) assert.equal(db.tables.roas_entries[0][key], before[key]);
  assert.match(db.tables.roas_entries[0].attribution_warning, /Valores anteriores mantidos/);
  unavailable = false;
  await projectRoasMonth(db, 'u', 2026, 10, { salesOnly: true });
  assert.equal(db.tables.roas_entries[0].attribution_warning, null);
  assert.equal(db.tables.roas_entries[0].price * db.tables.roas_entries[0].units_sold, 160);
  assert.equal(db.tables.roas_entries[0].total_spend, before.total_spend);
});

const activity = (old = 2500, next = 3500) => ({ event_type: 'update_campaign_budget', event_time: '2026-10-15T21:58:56+0000', object_id: 'c1',
  extra_data: JSON.stringify({ old_value: { old_value: old, currency: 'EUR', additional_value: 'Por dia' }, new_value: { new_value: next, currency: 'EUR', additional_value: 'Por dia' } }) });
test('Only actual budget increases reset a window, including ad-set budgets mapped to their campaign', () => {
  const campaigns = new Set(['c1']);
  const parsed = parseBudgetIncrease(activity(), campaigns, new Map());
  assert.equal(parsed.new_budget, 3500); assert.equal(parsed.changed_at, '2026-10-15T21:58:56.000Z');
  for (const [before, after] of [[3500,2500], [2500,2500], [0,2500], [null,2500], ['',2500], [2500,NaN]])
    assert.equal(parseBudgetIncrease(activity(before,after), campaigns, new Map()), null);
  assert.equal(parseBudgetIncrease({...activity(),event_type:'ad_account_billing_charge'},campaigns,new Map()),null);
  assert.equal(parseBudgetIncrease({...activity(),object_id:'foreign'},campaigns,new Map()),null);
  const adset = parseBudgetIncrease({...activity(),event_type:'update_ad_set_budget',object_id:'as'},campaigns,new Map([['as','c1']]));
  assert.equal(adset.campaign_id,'c1');
  const mixed = JSON.parse(activity().extra_data); mixed.new_value.currency = 'USD';
  assert.equal(parseBudgetIncrease({...activity(),extra_data:mixed},campaigns,new Map()),null);
  mixed.new_value.currency='EUR'; mixed.new_value.additional_value='Lifetime';
  assert.equal(parseBudgetIncrease({...activity(),extra_data:mixed},campaigns,new Map()),null);
});

test('Budget sync saves only increases, deduplicates overlap, throttles reads and preserves evidence when an API page fails', async (t) => {
  const client=require('../src/lib/meta/client.ts'); let fail=false,reads=0;
  t.mock.method(client,'graphPaginate',async function*(path){reads++;
    if(path.endsWith('/campaigns')){yield [{id:'c1'}];return;}
    yield [activity(),activity(35,20),{...activity(),event_type:'ad_account_billing_charge'}];
    if(fail)throw Error('Page failed');
  });
  const db=memoryDb({meta_connections:[{id:'m',user_id:'u',budget_synced_at:null}]});
  const ctx={userId:'u',connectionId:'m',adAccountId:'act_1',token:'fixture'};
  await syncMetaBudgetHistory(db,ctx);
  assert.equal(db.tables.meta_budget_changes.length,1); const saved=db.tables.meta_connections[0].budget_synced_at;
  await syncMetaBudgetHistory(db,ctx);assert.equal(reads,2);
  await syncMetaBudgetHistory(db,ctx,true);assert.equal(db.tables.meta_budget_changes.length,1);
  fail=true;await assert.rejects(syncMetaBudgetHistory(db,ctx,true),/Page failed/);
  assert.ok(db.tables.meta_connections[0].budget_sync_error);
  assert.equal(db.tables.meta_budget_changes.length,1); assert.ok(saved);
});

const entry = (day, extra={}) => ({campaign_key:'m:c',campaign_name:'Campaign',year:2026,month:10,day,
  total_spend:20,cpc:1,atc:3,pur:2,price:50,cog:20,units_sold:2,...extra});
const options = (date='2026-10-07') => ({date,today:'2026-10-08',timezone:'Europe/Lisbon',historyKnown:true});

test('After six or seven unscaled days, every day evaluates only the latest pair using the existing margin thresholds', () => {
  const history=Array.from({length:7},(_,i)=>entry(i+1,{total_spend:i<4?200:20}));
  for(const day of [6,7]){
    const result=evaluateRoasWindow(history[day-1],history,[],options(`2026-10-0${day}`));
    assert.equal(result.decision.kind,'scale');assert.equal(result.counter,day);
    assert.equal(result.from,`2026-10-0${day-1}`);assert.equal(result.to,`2026-10-0${day}`);
  }
  assert.equal(roasDecision(7,20,.4,{active:true,marginPct:.4,counter:6}).kind,'scale');
  assert.equal(roasDecision(7,20,.12,{active:true,marginPct:-.2,counter:6}).kind,'monitor');
  assert.equal(roasDecision(7,20,-.4,{active:true,marginPct:-.2,counter:6}).kind,'kill');
});

test('A mid-day scale waits for two complete post-change days and the next increase restarts again', () => {
  const history=Array.from({length:7},(_,i)=>entry(i+1));
  const events=[{campaignKey:'m:c',changedAt:'2026-10-04T21:00:00.000Z'}];
  const waiting=evaluateRoasWindow(history[4],history,events,options('2026-10-05'));
  assert.equal(waiting.counter,1);assert.equal(waiting.decision.kind,'window');
  const ready=evaluateRoasWindow(history[5],history,events,options('2026-10-06'));
  assert.equal(ready.counter,2);assert.equal(ready.decision.kind,'scale');assert.equal(ready.from,'2026-10-05');
  events.push({campaignKey:'m:c',changedAt:'2026-10-07T00:00:00.000Z'});
  assert.equal(evaluateRoasWindow(history[6],history,events,options()).decision.kind,'window');
});

test('Today is partial, Lisbon midnight is respected, equal names are isolated and month/year boundaries do not reset the window', () => {
  const history=[entry(31,{year:2025,month:12}),entry(1,{year:2026,month:1}),entry(2,{year:2026,month:1,total_spend:9999}),
    entry(1,{year:2026,month:1,campaign_key:'other:c',total_spend:900})];
  const result=evaluateRoasWindow(history[2],history,[],{...options(),date:'2026-01-02',today:'2026-01-02'});
  assert.equal(result.decision.kind,'scale');assert.equal(result.from,'2025-12-31');assert.equal(result.to,'2026-01-01');
  const local=Array.from({length:6},(_,i)=>entry(i+1));
  const reset=evaluateRoasWindow(local[5],local,[{campaignKey:'m:c',changedAt:'2026-10-04T23:00:00.000Z'}],options('2026-10-06'));
  assert.equal(reset.from,'2026-10-05'); assert.equal(reset.decision.kind,'scale');
});

test('Unknown budgets, missing dates and days with no spend cannot recommend scaling', () => {
  const history=[entry(5),entry(6)];
  assert.equal(evaluateRoasWindow(history[1],history,[],{...options('2026-10-06'),historyKnown:false}).decision.kind,'window');
  assert.equal(evaluateRoasWindow(entry(7),history,[],options()).decision.kind,'window');
  history[0].total_spend=0;
  assert.equal(evaluateRoasWindow(history[1],history,[],options('2026-10-06')).decision.kind,'window');
});

test('Incomplete collection sales block advice even when the saved margins look profitable', () => {
  const history=[entry(5,{attribution_warning:'Collection unavailable'}),entry(6)];
  const result=evaluateRoasWindow(history[1],history,[],options('2026-10-06'));
  assert.equal(result.decision.kind,'window');
  assert.match(result.decision.label,/Vendas por confirmar/);
});

test('The previous window differs from the current closed-day pair while viewing today', () => {
  const history=[entry(4,{total_spend:200}),entry(5),entry(6),entry(7)];
  const result=evaluateRoasWindow(history[3],history,[],{...options(),today:'2026-10-07'});
  assert.equal(result.from,'2026-10-05');assert.equal(result.decision.kind,'scale');
  assert.equal(result.previous.kind,'monitor');
});

test('Budget history pagination uses its composite primary key, not a nonexistent id column', async () => {
  const {selectAllByUser}=require('../src/lib/supabase/paginate.ts');
  const orders=[];
  const query={select(){return this;},eq(){return this;},range(){return this;},order(column){orders.push(column);return this;},then(resolve){resolve({data:[],error:null});}};
  await selectAllByUser({from:()=>query},'meta_budget_changes','changed_at','u');
  assert.deepEqual(orders,['meta_connection_id','event_id']);
});

test('Refreshing a day projects its decision history across a year boundary without reading the whole month', async (t) => {
  const match=require('../src/lib/trackers/match.ts'), sales=require('../src/lib/trackers/sales.ts');
  const {projectRoasDecisionDays}=require('../src/lib/trackers/roas-import.ts');
  const ranges=[];
  t.mock.method(match,'trackerFxByMetaConnection',async()=>fxMock(new Map(),new Map()));
  t.mock.method(match,'fetchMatcherProducts',async()=>[]);
  t.mock.method(match,'fetchCampaignTargetMap',async()=>new Map());
  t.mock.method(sales,'fetchTrackerOrderSales',async(_db,_user,range)=>{ranges.push(range);return [];});
  const db=memoryDb({settings:[{user_id:'u',timezone:'Europe/Lisbon'}]});
  await projectRoasDecisionDays(db,'u','2026-01-02');
  assert.deepEqual(ranges,[{from:'2025-12-30',to:'2025-12-31'},{from:'2026-01-01',to:'2026-01-02'}]);
});
