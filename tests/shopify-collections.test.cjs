process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.invalid';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-only';
process.env.SHOPIFY_API_VERSION = '2026-04';
require('../scripts/register-ts.cjs');
const test = require('node:test'), assert = require('node:assert/strict');
const { collectionApiVersion } = require('../src/lib/shopify/collections-api.ts');
const { fetchCollectionProducts } = require('../src/lib/shopify/collection-products.ts');
const { fetchProductCollections } = require('../src/lib/shopify/product-collections.ts');

test('Collection reads support the new Shopify model without downgrading newer configured APIs', () => {
  for (const version of ['2025-01', '2026-04', '2026-07']) assert.equal(collectionApiVersion(version), '2026-07');
  for (const version of ['2026-10', '2027-01', 'unstable']) assert.equal(collectionApiVersion(version), version);
});

test('Both directions read new-model collections even when the rest of the app uses an older API', async (t) => {
  const urls = [];
  t.mock.method(global, 'fetch', async (url, options) => {
    urls.push(url);
    const { query } = JSON.parse(options.body);
    const compatible = url.includes('/2026-07/');
    const pageInfo = { hasNextPage: false, endCursor: null };
    const data = query.includes('CampaignCollectionProducts')
      ? { collectionByHandle: compatible ? { products: { nodes: [{ id: 'gid://shopify/Product/42', handle: 'coat' }], pageInfo } } : null }
      : { product: { collections: { nodes: compatible ? [{ handle: 'coats', title: 'Coats' }] : [], pageInfo } } };
    return { ok: true, json: async () => ({ data }) };
  });
  assert.deepEqual(await fetchCollectionProducts('store.myshopify.com', 'fixture', 'coats'), [{ id: '42', handle: 'coat' }]);
  assert.deepEqual(await fetchProductCollections('store.myshopify.com', 'fixture', '42'), [{ handle: 'coats', title: 'Coats' }]);
  assert.equal(urls.length, 2);
  assert.ok(urls.every(url => url === 'https://store.myshopify.com/admin/api/2026-07/graphql.json'));
});

test('An unavailable collection remains unknown, including errors on later pages', async (t) => {
  for (const response of [{ data: { collectionByHandle: null } }, { errors: [{ message: 'Access denied' }] }]) {
    const mock = t.mock.method(global, 'fetch', async () => ({ ok: true, json: async () => response }));
    assert.equal(await fetchCollectionProducts('store.myshopify.com', 'fixture', 'coats'), null);
    mock.mock.restore();
  }
  let calls = 0;
  t.mock.method(global, 'fetch', async () => ({ ok: true, json: async () => ++calls === 1
    ? { data: { collectionByHandle: { products: { nodes: [{ id: 'gid://shopify/Product/42', handle: 'coat' }], pageInfo: { hasNextPage: true, endCursor: 'next' } } } } }
    : { errors: [{ message: 'Throttled' }] } }));
  assert.equal(await fetchCollectionProducts('store.myshopify.com', 'fixture', 'coats'), null);
  assert.equal(calls, 2);
});
