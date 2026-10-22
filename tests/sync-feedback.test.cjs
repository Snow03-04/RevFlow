process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.invalid';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-only';
require('../scripts/register-ts.cjs');
const test = require('node:test'), assert = require('node:assert/strict');
const { syncFeedback, metaNeedsReconnect } = require('../src/lib/sync/feedback.ts');
const { syncMetaConnection } = require('../src/lib/jobs.ts');

test('The reported mixed failure becomes two short, actionable notices without provider diagnostics', () => {
  const expired = 'Meta Graph error 190: Error validating access token: The session has been invalidated because the user changed their password';
  const error = `Meta · Elena Sibiu: ${expired} · Agnes Vancouver: canceling statement due to statement timeout · Meta · Anna Műhely: ${expired} · Totais · Anna Műhely: canceling statement due to statement timeout · Pagamentos · Anna Műhely: canceling statement due to statement timeout`;
  const result = syncFeedback(error);
  assert.equal(result.notices.length, 2);
  assert.equal(result.reconnect, true);
  assert.match(result.notices[0].detail, /Elena Sibiu e Anna Műhely/);
  assert.match(result.notices[1].detail, /guardados continuam disponíveis/);
  assert.doesNotMatch(JSON.stringify(result), /Graph error|access token|statement timeout|password/);
});

test('Unknown diagnostics stay private; offline and expired app sessions keep distinct remedies', () => {
  assert.doesNotMatch(JSON.stringify(syncFeedback('query failed: private SQL diagnostic')), /private SQL/);
  assert.equal(syncFeedback('Sessão expirada. Inicia sessão novamente.').session, true);
  assert.equal(syncFeedback('Sem ligação à Internet').notices[0].title, 'Ligação interrompida');
  assert.equal(metaNeedsReconnect('Meta Graph error 17: rate limited'), false);
  assert.equal(metaNeedsReconnect(null), false);
  const mixed = syncFeedback('Meta · Loja: Meta Graph error 190: invalid · Outra loja: HTTP 500');
  assert.equal(mixed.notices.length,2,'a Meta warning must not hide independent server failures');
});

test('An invalidated Meta token is not retried or used to overwrite saved campaign data', async () => {
  const db = { from() { throw new Error('No database writes or reads expected'); } };
  await assert.rejects(syncMetaConnection(db, { last_sync_error: 'Meta Graph error 190: session invalidated' }), /precisa de ser renovada/);
  await assert.rejects(syncMetaConnection(db, { last_sync_error: 'Meta Graph error 102: session invalidated' }), /precisa de ser renovada/);
});
