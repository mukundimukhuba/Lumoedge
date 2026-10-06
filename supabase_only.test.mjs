import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { mergeSessionPreferLicense } from './api/_lib/clientMerge.mjs';
import { findPhoneSession } from './api/_lib/phoneSessions.mjs';
import { adminToken } from './api/_lib/adminSessionStore.mjs';

test('phone sessions stay in Supabase and keep the license when the phone checks in', () => {
  const next = mergeSessionPreferLicense(
    {
      accessStatus: 'licensed',
      bot: { licenseKey: 'LUMO-KEEP' },
      device: { id: 'old', label: 'Android phone', claimedAt: '2026-10-01T00:00:00.000Z' },
    },
    {
      accessStatus: 'licensed',
      bot: {},
      device: { id: 'new', label: 'Android phone', claimedAt: '2026-10-06T00:00:00.000Z' },
    },
  );
  assert.equal(next.bot.licenseKey, 'LUMO-KEEP');
  assert.equal(next.accessStatus, 'licensed');
  assert.equal(next.device.id, 'new');
});

test('a phone session can be found by email', () => {
  const store = {
    sessions: {
      'payer@example.com': { accessStatus: 'pending', device: { id: 'phone-1', label: 'Android phone' } },
    },
  };
  assert.equal(findPhoneSession(store, 'payer@example.com').device.id, 'phone-1');
  assert.equal(findPhoneSession(store, 'payer@gmail_com'), null);
});

test('admin session tokens are stored without a Firebase path', () => {
  assert.equal(adminToken('lumo/adminSessions/abc123'), 'abc123');
  assert.equal(adminToken('abc123'), 'abc123');
});

test('the API client does not call Firebase', () => {
  const source = readFileSync(new URL('./api/_lib/clientMerge.mjs', import.meta.url), 'utf8');
  assert.equal(source.includes('firebaseio.com'), false);
  assert.equal(source.includes('readStoredPath'), true);
});
