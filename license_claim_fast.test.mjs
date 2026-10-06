import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assignEntry,
  toClaimPayload,
  validateEmailAccess,
} from './api/_lib/licenseClaim.mjs';

test('a key already assigned to this email opens without a rewrite', () => {
  const entry = {
    id: 'v1',
    key: 'LUMO-MS3H-VZ7G-WEL2',
    status: 'assigned',
    assignedEmail: 'client@example.com',
    assignedAt: '2026-10-06T18:00:00.000Z',
    ownerAdminId: 'LM-004821',
    eaName: 'Test EA',
  };
  assert.equal(validateEmailAccess(entry, 'client@example.com', [entry], {}), null);
  const again = assignEntry(entry, 'client@example.com');
  assert.equal(again, entry);
  const payload = toClaimPayload(again);
  assert.equal(payload.key, 'LUMO-MS3H-VZ7G-WEL2');
  assert.equal(payload.assignedEmail, 'client@example.com');
  assert.equal(payload.status, 'assigned');
});

test('a key assigned to someone else is blocked', () => {
  const entry = {
    key: 'LUMO-MS3H-VZ7G-WEL2',
    status: 'assigned',
    assignedEmail: 'owner@example.com',
    ownerAdminId: 'LM-004821',
  };
  const error = validateEmailAccess(entry, 'other@example.com', [entry], {});
  assert.match(error, /already used by another account/i);
});

test('an open key binds to the logged-in email', () => {
  const entry = {
    key: 'LUMO-AAAA-BBBB-CCCC',
    status: 'active',
    clientEmail: 'client@example.com',
    ownerAdminId: 'LM-004821',
  };
  assert.equal(validateEmailAccess(entry, 'client@example.com', [entry], {}), null);
  const assigned = assignEntry(entry, 'client@example.com');
  assert.equal(assigned.status, 'assigned');
  assert.equal(assigned.assignedEmail, 'client@example.com');
  assert.ok(assigned.assignedAt);
});
