import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  hashPassword,
  mergeAdminsLive,
  passwordsMatch,
  publicAdminRecord,
  verifyMentorLogin,
} from './api/_lib/clientMerge.mjs';
import { upsertMentor } from './api/_lib/mentorVault.mjs';

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
  assert.equal(passwordsMatch(io.store['lumo/auth'].admins[0].password, 'original-pass'), true);
  assert.equal(io.store['lumo/auth'].admins[0].password.includes('original-pass'), false);
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

test('a new signup with the right password is waiting for approval, not a wrong password', async () => {
  const hash = hashPassword('fresh-pass');
  const io = createIo([]);
  const pending = await verifyMentorLogin(
    'newmentor@example.com',
    'fresh-pass',
    [{ id: 'LM-22', email: 'newmentor@example.com', role: 'pending', password: hash, portalPassword: 'fresh-pass' }],
    io,
  );
  assert.equal(pending.ok, false);
  assert.equal(pending.error, 'pending');
  assert.equal(pending.admin.portalPassword, undefined);
  assert.equal(pending.admin.password, undefined);
  const missing = await verifyMentorLogin('nobody@example.com', 'fresh-pass', [], io);
  assert.equal(missing.error, 'not_registered');
  const stored = upsertMentor({ mentors: {}, version: 0 }, {
    email: 'newmentor@example.com',
    password: hash,
    portalPassword: 'fresh-pass',
    role: 'pending',
  });
  const again = upsertMentor(stored, { email: 'newmentor@example.com', role: 'admin' });
  assert.equal(again.mentors['newmentor@example.com'].portalPassword, 'fresh-pass');
  assert.equal(again.mentors['newmentor@example.com'].role, 'admin');
  assert.equal(publicAdminRecord(again.mentors['newmentor@example.com']).portalPassword, undefined);
});
