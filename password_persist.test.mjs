import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashPassword, mergeAdminsLive, passwordsMatch, publicDbSnapshot, verifyMentorLogin } from './api/_lib/clientMerge.mjs';
import { mergeDatabases } from './api/_lib/mergeDb.mjs';
import { completePasswordReset, requestPasswordReset } from './api/_lib/passwordReset.mjs';
import { resetMentorPassword } from './api/_lib/mentorPassword.mjs';

function createIo(admins = []) {
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

function memoryAccounts(admins = []) {
  const state = { admins: admins.map((row) => ({ ...row })), resets: {}, limits: {} };
  return {
    state,
    async list() {
      return state.admins.map((row) => ({ ...row }));
    },
    async save(admin) {
      const email = String(admin?.email || '').trim().toLowerCase();
      const idx = state.admins.findIndex((row) => String(row.email || '').toLowerCase() === email);
      if (idx >= 0) state.admins[idx] = { ...state.admins[idx], ...admin, email };
      else state.admins.push({ ...admin, email });
      return { ...admin, email };
    },
    async listResets() {
      return { ...state.resets };
    },
    async saveReset(id, row) {
      state.resets[id] = { ...row };
      return true;
    },
    async listLimit(id) {
      return state.limits[id] || { requests: [] };
    },
    async saveLimit(id, bucket) {
      state.limits[id] = bucket;
      return true;
    },
  };
}

test('an older portal password cannot replace a later reset', () => {
  const current = hashPassword('current-pass');
  const older = hashPassword('older-pass');
  const merged = mergeDatabases(
    {
      auth: {
        admins: [
          {
            id: 'LM-1',
            email: 'mentor@example.com',
            role: 'admin',
            password: current,
            passwordResetAt: '2026-10-04T08:00:00.000Z',
          },
        ],
      },
    },
    {
      auth: {
        admins: [
          {
            id: 'LM-1',
            email: 'mentor@example.com',
            role: 'admin',
            password: older,
            passwordResetAt: '2026-10-03T08:00:00.000Z',
          },
        ],
      },
    },
  );
  assert.equal(passwordsMatch(merged.auth.admins[0].password, 'current-pass'), true);
  assert.equal(merged.auth.admins[0].passwordResetAt, '2026-10-04T08:00:00.000Z');

  const unstamped = mergeAdminsLive(
    [{ id: 'LM-1', email: 'mentor@example.com', role: 'admin', password: current, passwordResetAt: '2026-10-04T08:00:00.000Z' }],
    [{ id: 'LM-1', email: 'mentor@example.com', role: 'admin', password: older }],
  );
  assert.equal(passwordsMatch(unstamped[0].password, 'current-pass'), true);
});

test('login accepts the newer private password and rejects the old one', async () => {
  const oldHash = hashPassword('old-pass');
  const newHash = hashPassword('new-pass');
  const io = createIo([
    {
      id: 'LM-1',
      email: 'mentor@example.com',
      role: 'admin',
      password: oldHash,
      passwordResetAt: '2026-10-03T08:00:00.000Z',
    },
  ]);
  const backup = [
    {
      id: 'LM-1',
      email: 'mentor@example.com',
      role: 'admin',
      password: newHash,
      passwordResetAt: '2026-10-04T08:00:00.000Z',
      passwordResetBy: 'self-reset',
    },
  ];
  const ok = await verifyMentorLogin('mentor@example.com', 'new-pass', backup, io);
  assert.equal(ok.ok, true);
  assert.equal(ok.admin.password, undefined);
  const stale = await verifyMentorLogin('mentor@example.com', 'old-pass', backup, io);
  assert.equal(stale.ok, false);
  assert.equal(stale.error, 'invalid_credentials');
});

test('reset survives when Firebase cannot store the new password', async () => {
  const accounts = memoryAccounts([
    { id: 'LM-1', email: 'mentor@example.com', role: 'admin', password: hashPassword('old-pass'), fullName: 'Mentor' },
  ]);
  const io = {
    store: {},
    async read() {
      return null;
    },
    async write() {
      return false;
    },
  };
  const sent = [];
  await requestPasswordReset('mentor@example.com', {
    io,
    accounts,
    now: 50_000,
    code: '333333',
    notify: async (payload) => sent.push(payload.resetCode),
  });
  assert.equal(sent[0], '333333');
  const done = await completePasswordReset(
    { email: 'mentor@example.com', code: '333333', password: 'kept-pass-1', confirm: 'kept-pass-1' },
    { io, accounts, now: 51_000 },
  );
  assert.equal(done.ok, true);
  assert.equal(passwordsMatch(accounts.state.admins[0].password, 'kept-pass-1'), true);
  assert.equal(accounts.state.admins[0].passwordResetBy, 'self-reset');
  const reused = await completePasswordReset(
    { email: 'mentor@example.com', code: '333333', password: 'other-pass', confirm: 'other-pass' },
    { io, accounts, now: 52_000 },
  );
  assert.equal(reused.ok, false);
});

test('a failed save does not report the password as reset', async () => {
  const io = createIo([
    { id: 'LM-1', email: 'mentor@example.com', role: 'admin', password: hashPassword('old-pass') },
  ]);
  io.write = async () => false;
  await requestPasswordReset('mentor@example.com', {
    io: createIo([{ id: 'LM-1', email: 'mentor@example.com', role: 'admin', password: 'x' }]),
    now: 60_000,
    code: '444444',
    notify: async () => {},
  });
  const failed = await completePasswordReset(
    { email: 'mentor@example.com', code: '444444', password: 'not-saved-1', confirm: 'not-saved-1' },
    {
      io: {
        async read(path) {
          if (path === 'lumo/passwordResets') {
            return {
              'rst-1': {
                email: 'mentor@example.com',
                codeHash: (await import('./api/_lib/passwordReset.mjs')).hashResetCode('444444'),
                expiresAt: 70_000,
                usedAt: '',
              },
            };
          }
          if (path === 'lumo/auth') {
            return { admins: [{ id: 'LM-1', email: 'mentor@example.com', role: 'admin', password: hashPassword('old-pass') }] };
          }
          return null;
        },
        async write() {
          return false;
        },
      },
      now: 61_000,
    },
  );
  assert.equal(failed.ok, false);
  assert.equal(failed.error, 'save_failed');
});

test('super admin reset keeps the new password when Firebase write fails', async () => {
  const saved = [];
  const result = await resetMentorPassword('LM-111111', {
    actorId: 'LM-004821',
    resetAt: '2026-10-04T09:00:00.000Z',
    io: {
      async read() {
        return {
          admins: [{ id: 'LM-111111', email: 'mentor@example.com', password: hashPassword('old-pass'), role: 'admin' }],
          admin: null,
        };
      },
      async write() {
        return false;
      },
    },
    savePrivate: async (admin) => {
      saved.push(admin);
      return admin;
    },
  });
  assert.equal(result.ok, true);
  assert.equal(saved.length, 1);
  assert.equal(passwordsMatch(saved[0].password, result.password), true);
  assert.equal(saved[0].passwordResetAt, '2026-10-04T09:00:00.000Z');
  assert.equal(result.admin.password, undefined);
});

test('public database responses omit reset codes', () => {
  const view = publicDbSnapshot({
    auth: { admins: [{ email: 'mentor@example.com', password: 'sha256$x$y', role: 'admin' }], admin: null },
    passwordResets: { 'rst-1': { email: 'mentor@example.com', codeHash: 'abc' } },
    passwordResetLimits: { mentor_example_com: { requests: [{ at: 1 }] } },
  });
  assert.equal(view.auth.admins[0].password, undefined);
  assert.equal(view.passwordResets, undefined);
  assert.equal(view.passwordResetLimits, undefined);
});
