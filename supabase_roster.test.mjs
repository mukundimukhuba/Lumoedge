import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  approvePrivateMentor,
  combineSubscriptions,
  nextAdminRecord,
  visibleClient,
} from './api/_lib/supabaseRoster.mjs';
import { prepareLicensePatch } from './api/_lib/phoneRecover.mjs';

test('subscription approval stays paid when another pending copy arrives', () => {
  const rows = combineSubscriptions(
    [{ id: 'cli-1', email: 'student@example.com', status: 'pending', paymentClaimed: false }],
    [
      {
        id: 'cli-1',
        email: 'student@example.com',
        status: 'approved',
        paymentClaimed: true,
        paymentClaimedAt: '2026-10-03T12:00:00.000Z',
      },
    ],
    [{ id: 'cli-9', email: 'student@example.com', status: 'pending', paymentClaimed: false }],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'approved');
  assert.equal(rows[0].paymentClaimed, true);
  assert.equal(rows[0].id, 'cli-1');
});

test('mentor approval keeps the password hash and does not publish it', () => {
  const roster = nextAdminRecord(
    [{ id: 'LM-200001', email: 'mentor@example.com', role: 'pending', password: 'sha256$salt$digest' }],
    'LM-200001',
    'admin',
  );
  assert.equal(roster.hit.role, 'admin');
  assert.equal(roster.hit.password, 'sha256$salt$digest');
  const stored = prepareLicensePatch({
    auth: { admins: [roster.hit] },
    clients: [{ email: 'student@example.com', status: 'approved', paymentClaimed: true, licenseKey: 'LUMO-TEST-0099' }],
  });
  assert.equal(stored.auth.admins[0].password, 'sha256$salt$digest');
  assert.equal(stored.auth.admins[0].role, 'admin');
  assert.equal(stored.clients[0].paymentClaimed, true);
  const visible = visibleClient(stored.clients[0]);
  assert.equal(visible.licenseKey, undefined);
  assert.equal(JSON.stringify(visible).includes('LUMO-TEST-0099'), false);
});

test('approvePrivateMentor returns null when Supabase is not configured', async () => {
  const saved = await approvePrivateMentor('LM-missing', 'admin', {
    id: 'LM-missing',
    email: 'new.mentor@example.com',
    role: 'pending',
    password: 'sha256$salt$digest',
  });
  assert.equal(saved, null);
});
