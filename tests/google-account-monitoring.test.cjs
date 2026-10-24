process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.invalid';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-only';
require('../scripts/register-ts.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { memoryDb } = require('./helpers/memory-db.cjs');
const { googleAccountStateKey, readGoogleAccountState } = require('../src/lib/google/account-monitoring.ts');
const { getGoogleScriptWarnings } = require('../src/lib/google/script-health.ts');
const { getGoogleSpendEstimates } = require('../src/lib/google/spend-estimates.ts');
const store = { id: '11111111-1111-4111-8111-111111111111', shop_name: 'Store', shop_domain: 'example.myshopify.com' };
const accountA = '1234567890', accountB = '9876543210';
const range = { from: '2026-10-24', to: '2026-10-24' };
const row = (account, date, gross = false) => ({ id: `${account}:${date}:${gross}`, user_id: 'u',
  campaign_id: `script${gross ? '-gross' : ''}:${store.id}:${account}:1`, date,
  spend: gross ? 0 : 25, gross_spend: 50, updated_at: `${date}T15:00:00Z` });
const read = (db, metadata = {}, dates = range) => getGoogleScriptWarnings(db, 'u', [store], dates, range.to, undefined, metadata);

test('Suspended and inactive accounts stop stale prompts; reactivation restores them without touching costs', async () => {
  const db = memoryDb({ google_campaigns: [row(accountA, '2026-10-02')] });
  const before = structuredClone(db.tables);
  for (const state of ['suspended', 'inactive']) {
    assert.deepEqual(await read(db, { [googleAccountStateKey(store.id, accountA)]: state }), []);
  }
  assert.equal((await read(db, { [googleAccountStateKey(store.id, accountA)]: 'active' }))[0].reason, 'stale');
  assert.deepEqual(db.tables, before);
  assert.deepEqual(db.writes, []);
});

test('One suspended account cannot hide another active account, even if its report or expense is newer', async () => {
  const db = memoryDb({ google_campaigns: [row(accountA, '2026-10-24'), row(accountB, '2026-10-22')],
    manual_entries: [{ user_id: 'u', kind: 'expense', label: `Google Store · conta ${accountA} · script`, date: '2026-10-24' }] });
  const warnings = await read(db, { [googleAccountStateKey(store.id, accountA)]: 'suspended' });
  assert.deepEqual(warnings.map(w => [w.customerId, w.lastReport, w.reason]), [[accountB, '2026-10-22', 'stale']]);
  db.tables.google_campaigns.push({ ...row(accountB, '2026-10-24'), user_id: 'other' });
  assert.equal((await read(db))[0].customerId, accountB);
});

test('Suspension preserves received gross costs and historical billing warnings, without warnings outside that period', async () => {
  const db = memoryDb({ google_campaigns: [row(accountA, '2026-10-02', true)] });
  const metadata = { [googleAccountStateKey(store.id, accountA)]: 'suspended' };
  const month = { from: '2026-10-01', to: '2026-10-24' };
  const warnings = await read(db, metadata, month);
  assert.equal(warnings[0].reason, 'billing');
  assert.deepEqual(await read(db, metadata), []);
  assert.deepEqual(await getGoogleSpendEstimates(db, 'u', [store], month, new Map()),
    [{ storeId: store.id, date: '2026-10-02', amount: 50 }]);
  assert.deepEqual(db.writes, []);
});

test('Malformed preferences default to active and account/store identity is exact', () => {
  const metadata = { [googleAccountStateKey(store.id, accountA)]: 'suspended' };
  assert.equal(readGoogleAccountState(metadata, store.id, accountA), 'suspended');
  assert.equal(readGoogleAccountState(metadata, store.id, accountB), 'active');
  assert.equal(readGoogleAccountState(metadata, 'other-store', accountA), 'active');
  assert.equal(readGoogleAccountState({ [googleAccountStateKey(store.id, accountA)]: { state: 'suspended' } }, store.id, accountA), 'active');
});

let currentDb, currentUser, saveError;
const invalidated = [], authWrites = [];
const load = Module._load;
Module._load = function(request, ...args) {
  if (request === '@/lib/supabase/server') return { createClient: async () => currentDb, getCurrentUser: async () => currentUser };
  if (request === 'next/cache') return { revalidatePath: path => invalidated.push(path) };
  return load.call(this, request, ...args);
};
const { saveGoogleAccountState } = require('../src/lib/google/account-monitoring-actions.ts');
Module._load = load;
function setup() {
  currentUser = { id: 'u' }; saveError = null; invalidated.length = 0; authWrites.length = 0;
  currentDb = memoryDb({ shopify_connections: [{ ...store, user_id: 'u' }], google_campaigns: [row(accountA, '2026-10-02')] });
  currentDb.auth = { updateUser: async input => { authWrites.push(input); return { error: saveError }; } };
}
test('Saving merges only the owned account preference and refreshes the dashboard and connections', async () => {
  setup();
  assert.equal((await saveGoogleAccountState(store.id, accountA, 'suspended')).ok, true);
  assert.deepEqual(authWrites, [{ data: { [googleAccountStateKey(store.id, accountA)]: 'suspended' } }]);
  assert.deepEqual(invalidated, ['/connections', '/dashboard']);
  assert.deepEqual(currentDb.writes, []);
});
test('Expired sessions, foreign stores/accounts and malformed input cannot save state', async () => {
  setup(); currentUser = null;
  assert.equal((await saveGoogleAccountState(store.id, accountA, 'suspended')).ok, false);
  setup(); currentDb.tables.shopify_connections[0].user_id = 'other';
  assert.equal((await saveGoogleAccountState(store.id, accountA, 'suspended')).ok, false);
  setup(); currentDb.tables.google_campaigns[0].user_id = 'other';
  assert.equal((await saveGoogleAccountState(store.id, accountA, 'suspended')).ok, false);
  assert.equal((await saveGoogleAccountState(store.id, accountB, 'suspended')).ok, false);
  assert.equal((await saveGoogleAccountState(store.id, accountA, 'unknown')).ok, false);
  assert.equal((await saveGoogleAccountState('invalid', accountA, 'suspended')).ok, false);
  assert.deepEqual(authWrites, []); assert.deepEqual(invalidated, []);
});
test('A failed preference save never claims success or invalidates views', async () => {
  setup(); saveError = { message: 'private backend error' };
  const result = await saveGoogleAccountState(store.id, accountA, 'suspended');
  assert.equal(result.ok, false); assert.doesNotMatch(result.error, /private backend/);
  assert.deepEqual(invalidated, []);
});
