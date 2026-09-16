import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  mergeAdminsLive,
  passwordsMatch,
  verifyMentorLogin,
} from './api/_lib/clientMerge.mjs';

function createIo(admins) {
  const store = { 'lumo/auth': { admins, admin: null } };
  return {
    store,
    async read(path) {
      return store[path] ? JSON.parse(JSON.stringify(store[path])) : null;
    },
    async write(path, value) {
      store[path] = JSON.parse(JSON.stringify(value));
      return true;
    },
  };
}

test('password-stripped roster merge keeps the live Firebase password', () => {
  const merged = mergeAdminsLive(
    [{ id: 'LM-1', email: 'mentor@example.com', role: 'admin', password: 'secret-live' }],
    [{ id: 'LM-1', email: 'mentor@example.com', role: 'admin' }],
  );
  assert.equal(merged[0].password, 'secret-live');
});

test('empty live password can be healed from backup, but a Super reset is not overwritten', async () => {
  const io = createIo([
    { id: 'LM-1', email: 'mentor@example.com', role: 'admin', password: '' },
  ]);
  const healed = await verifyMentorLogin(
    'mentor@example.com',
    'original-pass',
    [{ id: 'LM-1', email: 'mentor@example.com', role: 'admin', password: 'original-pass' }],
    io,
  );
  assert.equal(healed.ok, true);
  assert.equal(io.store['lumo/auth'].admins[0].password, 'original-pass');
  assert.equal(healed.admin.password, undefined);

  const resetIo = createIo([
    { id: 'LM-1', email: 'mentor@example.com', role: 'admin', password: 'LE-NEW-PASS' },
  ]);
  const blocked = await verifyMentorLogin(
    'mentor@example.com',
    'original-pass',
    [{ id: 'LM-1', email: 'mentor@example.com', role: 'admin', password: 'original-pass' }],
    resetIo,
  );
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error, 'invalid_credentials');
  assert.equal(resetIo.store['lumo/auth'].admins[0].password, 'LE-NEW-PASS');
});

test('wiped Firebase password without a backup asks for a Super Admin reset', async () => {
  const io = createIo([
    { id: 'LM-1', email: 'mentor@example.com', role: 'admin' },
  ]);
  const result = await verifyMentorLogin('mentor@example.com', 'anything', [], io);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'password_reset_required');
  assert.equal(passwordsMatch('', 'anything'), false);
});
