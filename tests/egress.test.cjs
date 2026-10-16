process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.invalid';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test';
process.env.CRON_SECRET = 'test-only';
require('../scripts/register-ts.cjs');
const test = require('node:test'), assert = require('node:assert/strict'), Module = require('node:module');
const { memoryDb } = require('./helpers/memory-db.cjs');
const { ORDER_EVIDENCE_COLUMNS } = require('../src/lib/shopify/order-evidence.ts');
const { isPaidOrder } = require('../src/lib/shopify/paid-orders.ts');
const { orderAccountingKey } = require('../src/lib/shopify/order-changes.ts');
const { orderPaymentEffect } = require('../src/lib/shopify/payments-model.ts');
const { loadPaymentSnapshots } = require('../src/lib/shopify/payments.ts');
const { loadCostData } = require('../src/lib/cogs/data.ts');

test('Compact DB reads preserve captured AfterSell baskets, stale settlement checks and accounting changes', async () => {
  const original = { id: 'o', user_id: 'u', financial_status: 'partially_paid', total_price: 75, total_refunded: 0,
    shopify_order_id: '10', currency: 'EUR', raw: { updated_at: '2026-10-15T12:00:00Z',
      revflow_paid_portion: { version: 1, captured: 75 }, customer: { unused: 'x'.repeat(20_000) } } };
  const db = memoryDb({ orders: [original] }, { projectColumns: true });
  const { data: compact } = await db.from('orders').select(`id,financial_status,total_price,total_refunded,shopify_order_id,currency,${ORDER_EVIDENCE_COLUMNS}`).eq('user_id', 'u').single();
  assert.equal(compact.raw, undefined);
  assert.equal(isPaidOrder(compact), true);
  assert.equal(orderAccountingKey(original, []), orderAccountingKey(compact, []));
  assert.equal(isPaidOrder({ ...compact, paid_portion: null }), false);
  assert.equal(isPaidOrder({ ...compact, total_price: 100 }), false);
  const tx = [{ type: 'charge', orderId: '10', orderTransactionId: '11', currency: 'EUR', amount: 74, fee: 3, test: false }];
  const check = { mixed: false, currency: 'EUR', transactionIds: ['11'], updatedAt: original.raw.updated_at };
  assert.deepEqual(orderPaymentEffect(compact, tx, () => 1, 9, 1, check), { fees: 3, adjustment: -1, actual: true });
  assert.equal(orderPaymentEffect({ ...compact, source_updated_at: '2026-10-16T12:00:00Z' }, tx, () => 1, 9, 1, check).actual, false);
  assert.ok(db.reads[0].bytes < Buffer.byteLength(JSON.stringify(original)) / 20);
});

test('Store rollups read only the owned store payment ledger and invoices, with all-store reads still complete', async () => {
  const stores = ['a', 'b', 'c', 'd', 'e'];
  const snapshot = { version: 1, transactions: [{ id: '1', amount: 100 }], payouts: [], balances: [] };
  const db = memoryDb({
    shopify_payment_accounts: [...stores.map(shopify_connection_id => ({ user_id: 'u', shopify_connection_id, snapshot })),
      { user_id: 'other', shopify_connection_id: 'foreign', snapshot }],
    order_supplier_costs: stores.map(shopify_connection_id => ({ user_id: 'u', shopify_connection_id, order_number: '1', cost: 10, currency: 'EUR', paid: true })),
  }, { projectColumns: true });
  assert.equal((await loadPaymentSnapshots(db, 'u')).size, 5);
  const full = db.reads.at(-1).bytes;
  assert.deepEqual([...(await loadPaymentSnapshots(db, 'u', 'c')).keys()], ['c']);
  assert.ok(db.reads.at(-1).bytes < full / 4);
  assert.equal((await loadPaymentSnapshots(db, 'other', 'c')).size, 0);
  assert.equal((await loadCostData(db, 'u')).supplierRows.length, 5);
  const scoped = await loadCostData(db, 'u', 'c');
  assert.deepEqual([...scoped.supplierByOrder.keys()], ['c:1']);
  assert.equal(scoped.supplierByOrder.get('c:1').cost, 10);
});

test('Windowed payment reads pass exact timezone bounds and never hide RPC failures', async () => {
  const db = memoryDb(); const calls = [];
  const window = { startUtc: '2026-10-14T23:00:00.000Z', endUtc: '2026-10-15T23:00:00.000Z' };
  db.rpc = async (name, args) => {
    calls.push({ name, args });
    return { data: [{ shopify_connection_id: 's', snapshot: { version: 1, transactions: [], orders: {}, payouts: [], balances: [] } }], error: null };
  };
  assert.deepEqual([...(await loadPaymentSnapshots(db, 'u', 's', window)).keys()], ['s']);
  assert.deepEqual(calls, [{ name: 'financial_payment_snapshots', args: { p_user_id: 'u', p_store_id: 's', p_from: window.startUtc, p_to: window.endUtc } }]);
  assert.equal(db.reads.length, 0, 'must not read the full ledger after the RPC');
  db.rpc = async () => ({ data: null, error: { code: '42501', message: 'permission denied' } });
  await assert.rejects(loadPaymentSnapshots(db, 'u', 's', window), e => e.code === '42501');
  assert.equal(db.reads.length, 0);
});

let cronDb, cronCalls, failMetrics = false;
const load = Module._load;
Module._load = function(request, ...args) {
  if (request === '@/lib/supabase/admin') return { createAdminClient: () => cronDb };
  if (request === '@/lib/jobs') return Object.fromEntries(['syncShopifyConnection','syncMetaConnection','syncGoogleConnection','refreshCampaignLinks']
    .map(kind => [kind, async (_db, conn, opts) => cronCalls.push({ kind, user: conn.user_id, opts })]));
  if (request === '@/lib/metrics') return { recomputeDailyMetrics: async (_db, user, range) => {
    cronCalls.push({ kind: 'metrics', user, range }); if (failMetrics) throw Error('database unavailable');
  }};
  if (request === '@/lib/trackers/pnl-import') return { currentPnlMonth: async () => ({ year: 2026, month: 10 }), projectPnlMonth: async (_db, user) => cronCalls.push({ kind: 'pnl', user }) };
  if (request === '@/lib/trackers/roas-import') return { currentRoasMonth: async () => ({ year: 2026, month: 10 }), projectRoasMonth: async (_db, user) => cronCalls.push({ kind: 'roas', user }) };
  return load.call(this, request, ...args);
};
const { GET } = require('../src/app/api/cron/sync/route.ts');
Module._load = load;

test('Scheduled refresh recalculates once per account after all imports and retries failed rollups', async () => {
  cronDb = memoryDb({
    shopify_connections: ['a','b'].map(id => ({ id, user_id: 'u', status: 'active' })),
    meta_connections: [{ id: 'm', user_id: 'u', status: 'active' }],
    google_connections: [{ id: 'g', user_id: 'u', status: 'active' }],
    settings: [{ user_id: 'u', timezone: 'Europe/Lisbon' }], pnl_settings: [{ user_id: 'u' }], roas_settings: [{ user_id: 'u' }],
  });
  for (const failure of [false, true, false]) {
    failMetrics = failure; cronCalls = [];
    const response = await GET(new Request('https://test.invalid/api/cron/sync', { headers: { authorization: 'Bearer test-only' } }));
    const { summary } = await response.json();
    const imports = cronCalls.filter(c => c.kind.startsWith('sync'));
    assert.equal(imports.length, 4);
    assert.ok(imports.every(c => c.opts.skipRecompute === true && c.opts.sinceDays === 7));
    assert.equal(cronCalls.filter(c => c.kind === 'metrics').length, 1);
    assert.ok(cronCalls.findIndex(c => c.kind === 'metrics') > cronCalls.findIndex(c => c.kind === 'syncGoogleConnection'));
    assert.equal(summary.metrics.failed, failure ? 1 : 0);
    assert.equal(cronCalls.filter(c => ['pnl','roas'].includes(c.kind)).length, failure ? 0 : 2);
  }
  cronCalls = [];
  assert.equal((await GET(new Request('https://test.invalid/api/cron/sync'))).status, 401);
  assert.deepEqual(cronCalls, []);
});
