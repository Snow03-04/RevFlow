require('../scripts/register-ts.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { getSupplierPayables, summarizeSupplierPayables } = require('../src/lib/supplier/payables.ts');
const { parseSupplierCsv } = require('../src/lib/supplier/sheet.ts');
const { upsertSupplierConnection } = require('../src/lib/supplier/connection.ts');
const stores = [{ id: 'a', shop_name: 'Anna', shop_domain: 'a.myshopify.com' },
  { id: 'b', shop_name: 'Agnes', shop_domain: 'b.myshopify.com' }];
const options = { stores, currency: 'EUR', percentages: new Map([['a', 50]]),
  sheetUrl: 'https://docs.google.com/spreadsheets/d/test/edit#gid=0&revflow_store=a' };
const csv = 'order,cost,states\n100,€100,\n101,€900,paid\n102,,';
function withSheet(text) {
  const original = global.fetch;
  const calls = [];
  global.fetch = async (url) => { calls.push(url); return { ok: true, text: async () => text }; };
  return { calls, restore: () => { global.fetch = original; } };
}

test('only currently unpaid sheet rows count; paid and unpriced orders are excluded', () => {
  assert.deepEqual(summarizeSupplierPayables(parseSupplierCsv(csv), 1, 50),
    { amount: 50, ordersCount: 1, unpricedCount: 1 });
});

test('zero and decimal shares round only at the end; currency conversion applies once', () => {
  const costs = parseSupplierCsv('order,cost,states\n1,0.01,\n2,0.01,\n3,0.01,');
  assert.deepEqual(summarizeSupplierPayables(costs, 1, 50), { amount: .02, ordersCount: 3, unpricedCount: 0 });
  assert.equal(summarizeSupplierPayables(parseSupplierCsv(csv), 2, 25).amount, 50);
  assert.deepEqual(summarizeSupplierPayables(costs, 1, 0), { amount: 0, ordersCount: 0, unpricedCount: 0 });
});

test('reader respects ownership, selected store and shares; individual store is always full amount', async () => {
  const mock = withSheet(csv);
  try {
    const all = await getSupplierPayables(options);
    assert.deepEqual(all, { status: 'ready', amount: 50, ordersCount: 1, unpricedCount: 1, storeName: 'Anna' });
    assert.equal((await getSupplierPayables({ ...options, storeId: 'a' })).amount, 100);
    const count = mock.calls.length;
    assert.deepEqual(await getSupplierPayables({ ...options, storeId: 'b' }), { status: 'not_connected' });
    assert.deepEqual(await getSupplierPayables({ ...options, stores: [stores[1]] }), { status: 'unassigned' });
    assert.equal(mock.calls.length, count);
    assert.ok(mock.calls.every(url => url.endsWith('gid=0')));
  } finally { mock.restore(); }
});

test('missing connections and unbound legacy tabs never claim a zero balance or guess a store', async () => {
  assert.deepEqual(await getSupplierPayables({ ...options, sheetUrl: null }), { status: 'not_connected' });
  assert.deepEqual(await getSupplierPayables({ ...options, sheetUrl: options.sheetUrl.split('&')[0] }), { status: 'unassigned' });
});

test('updates in the sheet replace old debt; more than 1000 rows are counted completely', async () => {
  let mock = withSheet('order,cost,states\n100,€100,paid');
  try { assert.equal((await getSupplierPayables(options)).amount, 0); } finally { mock.restore(); }
  mock = withSheet('order,cost,states\n' + Array.from({length: 1201}, (_, i) => (i + 1) + ',€1,').join('\n'));
  try { assert.equal((await getSupplierPayables({ ...options, storeId: 'a' })).amount, 1201); } finally { mock.restore(); }
});

test('unreadable sheets and invalid conversion rates do not silently become zero debt', async () => {
  const mock = withSheet('<html>Login required</html>');
  try { await assert.rejects(getSupplierPayables(options), /ler os valores/); } finally { mock.restore(); }
  assert.throws(() => summarizeSupplierPayables(parseSupplierCsv(csv), NaN, 100), /inválidos/);
});

test('All stores sum their own tabs and participation; one failed tab cannot masquerade as a complete total', async () => {
  const original = global.fetch;
  const sheetUrl = upsertSupplierConnection(options.sheetUrl, options.sheetUrl.split('#')[0] + '#gid=7', 'b');
  global.fetch = async url => ({ ok: true, text: async () => 'order,cost,states\n1,€' + (url.endsWith('gid=7') ? '80' : '100') + ',' });
  try {
    const result = await getSupplierPayables({ ...options, sheetUrl });
    assert.equal(result.amount, 130);
    assert.equal(result.ordersCount, 2);
    assert.equal((await getSupplierPayables({ ...options, sheetUrl, storeId: 'b' })).amount, 80);
    global.fetch = async url => ({ ok: true, text: async () => url.endsWith('gid=7') ? '<html>Login</html>' : csv });
    await assert.rejects(getSupplierPayables({ ...options, sheetUrl }), /ler os valores/);
  } finally { global.fetch = original; }
});
