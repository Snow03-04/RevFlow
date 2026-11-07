require('../scripts/register-ts.cjs');
const test = require('node:test'), assert = require('node:assert/strict');
const { alertKey, daysUntil, nextRenewalDate, subscriptionAlerts, monthlyTotals, subscriptionSchema } = require('../src/lib/subscriptions/model.ts');
const { ymdInTz } = require('../src/lib/date.ts');
const base = { id: '10000000-0000-4000-8000-000000000001', shopify_connection_id: '20000000-0000-4000-8000-000000000001',
  name: 'Shopify', amount: 30, currency: 'EUR', billing_cycle: 'monthly', status: 'active', next_due_date: '2026-11-14',
  anchor_day: 14, reminder_days: 7, management_url: '', notes: '', read_alert_key: null };

test('reminders include their exact boundary, today, and overdue dates without hiding missed trials', () => {
  assert.equal(alertKey(base, '2026-11-06'), null);
  assert.equal(alertKey(base, '2026-11-07'), 'active:2026-11-14:upcoming');
  assert.equal(alertKey(base, '2026-11-14'), 'active:2026-11-14:today');
  assert.equal(alertKey(base, '2026-11-15'), 'active:2026-11-14:overdue');
  assert.equal(alertKey({ ...base, reminder_days: 0 }, '2026-11-13'), null);
  for (const status of ['paused','cancelled']) assert.equal(alertKey({ ...base, status }, '2027-01-01'), null);
  const [a] = subscriptionAlerts([{ ...base, status: 'trial' }], new Map([[base.shopify_connection_id, 'Anna']]), '2026-11-15');
  assert.equal(a.label, 'Período gratuito terminou há 1 dia'); assert.equal(a.store, 'Anna'); assert.equal(a.overdue, true);
});
test('read status is scoped to the due date and alert severity, and alerts are ordered by urgency', () => {
  const read = { ...base, read_alert_key: alertKey(base, '2026-11-07') };
  assert.equal(subscriptionAlerts([read], new Map(), '2026-11-08')[0].unread, false);
  assert.equal(subscriptionAlerts([read], new Map(), '2026-11-14')[0].unread, true);
  assert.equal(subscriptionAlerts([{ ...read, next_due_date: '2026-12-14' }], new Map(), '2026-12-07')[0].unread, true);
  const urgent = { ...base, id: 'urgent', next_due_date: '2026-11-01' };
  assert.deepEqual(subscriptionAlerts([base, urgent], new Map(), '2026-11-07').map(a=>a.id), ['urgent', base.id]);
});
test('renewal advances one cycle only and retains the billing day across February and leap years', () => {
  const jan = { ...base, next_due_date: '2027-01-31', anchor_day: 31 };
  assert.equal(nextRenewalDate(jan), '2027-02-28');
  assert.equal(nextRenewalDate({ ...jan, next_due_date: '2027-02-28' }), '2027-03-31');
  assert.equal(nextRenewalDate({ ...jan, billing_cycle: 'quarterly' }), '2027-04-30');
  assert.equal(nextRenewalDate({ ...jan, next_due_date: '2024-02-29', anchor_day: 29, billing_cycle: 'yearly' }), '2025-02-28');
  assert.equal(nextRenewalDate({ ...jan, next_due_date: '2026-12-29', billing_cycle: 'weekly' }), '2027-01-05');
});
test('calendar days respect the account timezone and DST instead of the browser timezone', () => {
  assert.equal(ymdInTz(new Date('2026-11-07T01:00:00Z'), 'America/Vancouver'), '2026-11-06');
  assert.equal(daysUntil('2026-03-30','2026-03-28'), 2);
});
test('monthly estimates normalize cycles and never combine currencies or paused subscriptions', () => {
  assert.deepEqual(monthlyTotals([base, { ...base, amount: 120, billing_cycle: 'yearly' },
    { ...base, currency: 'USD', amount: 90, billing_cycle: 'quarterly', status: 'trial' },
    { ...base, amount: 999, status: 'paused' }]), [['EUR',40],['USD',30]]);
});
test('invalid dates, unsafe links, fractional days, identity injection and stale edits are rejected', () => {
  const { id, anchor_day, read_alert_key, ...input } = base;
  assert.equal(subscriptionSchema.safeParse(input).success, true);
  for (const patch of [{ next_due_date:'2026-02-30' }, { next_due_date:'1999-01-01' }, { management_url:'javascript:alert(1)' },
    { management_url:'https://name:password@example.com' }, { reminder_days:1.5 }, { reminder_days:91 }, { amount:Infinity },
    { amount:1.123 }, { user_id:'other' }, { id }]) assert.equal(subscriptionSchema.safeParse({ ...input, ...patch }).success, false, JSON.stringify(patch));
});
