import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeClientRecord, mergeClientsLive } from './api/_lib/clientMerge.mjs';
import { combineSubscriptions } from './api/_lib/supabaseRoster.mjs';

test('a pending copy cannot cancel an approved paid subscriber', () => {
  const rows = mergeClientsLive(
    [{ email: 'student@example.com', status: 'pending', paymentClaimed: false }],
    [
      {
        email: 'student@example.com',
        status: 'approved',
        paymentClaimed: true,
        paymentClaimedAt: '2026-10-01T00:00:00.000Z',
      },
    ],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'approved');
  assert.equal(rows[0].paymentClaimed, true);
  assert.equal(rows[0].paymentClaimedAt, '2026-10-01T00:00:00.000Z');
});

test('merge keeps paid and approved when the incoming row is unpaid', () => {
  const row = mergeClientRecord(
    {
      email: 'student@example.com',
      status: 'approved',
      paymentClaimed: true,
      paymentClaimedAt: '2026-10-01T00:00:00.000Z',
    },
    { email: 'student@example.com', status: 'pending', paymentClaimed: false },
  );
  assert.equal(row.status, 'approved');
  assert.equal(row.paymentClaimed, true);
  assert.equal(row.paymentClaimedAt, '2026-10-01T00:00:00.000Z');
});

test('someone who just tapped I have paid stays pending and paid', () => {
  const rows = combineSubscriptions(
    [{ id: 'cli-2', email: 'payer@example.com', status: 'pending', paymentClaimed: false }],
    [
      {
        id: 'cli-2',
        email: 'payer@example.com',
        status: 'pending',
        paymentClaimed: true,
        paymentClaimedAt: '2026-10-04T10:00:00.000Z',
      },
    ],
  );
  assert.equal(rows[0].status, 'pending');
  assert.equal(rows[0].paymentClaimed, true);
});
