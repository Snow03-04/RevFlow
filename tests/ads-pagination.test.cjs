process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.invalid';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-only';
require('../scripts/register-ts.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { memoryDb } = require('./helpers/memory-db.cjs');
const { getCampaignPerformance } = require('../src/lib/queries.ts');

const range = { from: '2026-10-01', to: '2026-10-31' };
function history() {
  return Array.from({ length: 40 }, (_, campaign) => Array.from({ length: 31 }, (_, day) => ({
    id: `${String(campaign).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    user_id: 'u', campaign_id: `campaign-${campaign}`, campaign_name: `Campaign ${campaign}`,
    date: `2026-10-${String(day + 1).padStart(2, '0')}`, google_connection_id: 'g',
    spend: 2, impressions: 100, clicks: 4, purchases: 1, purchase_value: 10,
  }))).flat();
}

for (const table of ['campaigns', 'google_campaigns']) {
  test(`${table}: Ads includes all campaigns and all days beyond 1,000 rows`, async () => {
    const data = history();
    const db = memoryDb({ [table]: [...data,
      { ...data[0], id: 'foreign', user_id: 'another-user', campaign_id: 'foreign', spend: 999 },
      { ...data[0], id: 'outside', date: '2026-09-30', spend: 999 },
      ...(table === 'google_campaigns' ? [{ ...data[0], id: 'script', google_connection_id: null, campaign_id: 'script', spend: 999 }] : []),
    ] });
    const rows = await getCampaignPerformance(db, 'u', range, undefined, 0.5, table);
    assert.equal(rows.length, 40);
    assert.equal(rows.reduce((sum, row) => sum + row.spend, 0), 1240);
    const last = rows.find(row => row.campaignId === 'campaign-39');
    assert.equal(last.spend, 31);
    assert.equal(last.revenue, 155);
    assert.equal(last.purchases, 31);
    assert.equal(last.impressions, 3100);
    assert.equal(last.roas, 5);
    assert.equal(last.cpa, 1);
  });
}

test('Ads reports a failed later page instead of publishing partial totals', async () => {
  const db = memoryDb({ campaigns: history() });
  const from = db.from;
  db.from = table => {
    const query = from(table), range = query.range;
    query.range = (start, end) => {
      if (start >= 1000) query.then = (resolve, reject) => Promise.resolve({ data: null, error: new Error('Page unavailable') }).then(resolve, reject);
      return range(start, end);
    };
    return query;
  };
  await assert.rejects(() => getCampaignPerformance(db, 'u', range), /Page unavailable/);
});
