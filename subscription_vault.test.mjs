import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applySubscriptionPatch,
  subscriptionEntryFromBody,
  upsertSubscription,
} from './api/_lib/subscriptionVault.mjs';

test('tapping I have paid stores a pending paid subscriber', () => {
  const entry = subscriptionEntryFromBody(
    {
      email: 'payer@example.com',
      status: 'pending',
      paymentClaimed: true,
      paymentClaimedAt: '2026-10-06T18:00:00.000Z',
    },
    '2026-10-06T18:00:00.000Z',
  );
  const saved = upsertSubscription({ clients: {}, version: 0 }, entry);
  const row = saved.clients['payer@example.com'];
  assert.equal(row.status, 'pending');
  assert.equal(row.paymentClaimed, true);
  assert.equal(row.paymentClaimedAt, '2026-10-06T18:00:00.000Z');
  assert.equal(saved.version, 1);
});

test('a later unpaid copy cannot clear a saved payment or approval', () => {
  const first = upsertSubscription(
    { clients: {}, version: 0 },
    subscriptionEntryFromBody({
      email: 'payer@example.com',
      status: 'approved',
      paymentClaimed: true,
      paymentClaimedAt: '2026-10-06T18:00:00.000Z',
      firstName: 'Akhona',
    }),
  );
  const second = upsertSubscription(first, {
    email: 'payer@example.com',
    status: 'pending',
    paymentClaimed: false,
    id: 'cli-new',
  });
  const row = second.clients['payer@example.com'];
  assert.equal(row.status, 'approved');
  assert.equal(row.paymentClaimed, true);
  assert.notEqual(row.id, 'cli-new');
});

test('save as approved marks that email approved even if it was only pending', () => {
  const pending = upsertSubscription(
    { clients: {}, version: 2 },
    subscriptionEntryFromBody({
      email: 'payer@example.com',
      status: 'pending',
      paymentClaimed: true,
    }),
  );
  const approved = subscriptionEntryFromBody({
    email: 'payer@example.com',
    firstName: 'Akhona',
    lastName: 'Jr',
    status: 'approved',
    paymentClaimed: true,
  });
  const saved = upsertSubscription(pending, approved);
  const row = saved.clients['payer@example.com'];
  assert.equal(row.status, 'approved');
  assert.equal(row.paymentClaimed, true);
  assert.equal(row.firstName, 'Akhona');
  assert.equal(row.id, pending.clients['payer@example.com'].id);
});

test('approving by email updates the saved row', () => {
  const store = upsertSubscription(
    { clients: {}, version: 0 },
    subscriptionEntryFromBody({
      email: 'payer@example.com',
      status: 'pending',
      paymentClaimed: true,
      paymentClaimedAt: '2026-10-06T18:00:00.000Z',
    }),
  );
  const patched = applySubscriptionPatch(store, 'payer@example.com', { status: 'approved' });
  assert.equal(patched.row.status, 'approved');
  assert.equal(patched.row.paymentClaimed, true);
  assert.equal(patched.row.paymentClaimedAt, '2026-10-06T18:00:00.000Z');
  assert.equal(applySubscriptionPatch(store, 'missing@example.com', { status: 'approved' }), null);
});
