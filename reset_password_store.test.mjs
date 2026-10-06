import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashPassword, passwordsMatch } from './api/_lib/clientMerge.mjs';
import {
  completePasswordReset,
  hashResetCode,
  requestPasswordReset,
} from './api/_lib/passwordReset.mjs';

function memoryIo(admins, resets = {}) {
  const state = {
    auth: { admins, admin: null },
    passwordResets: { ...resets },
    passwordResetLimits: {},
  };
  return {
    state,
    async read(path) {
      if (path === 'lumo/auth') return state.auth;
      if (path === 'lumo/passwordResets') return state.passwordResets;
      if (path.startsWith('lumo/passwordResetLimits/')) {
        return state.passwordResetLimits[path.split('/').pop()] || { requests: [] };
      }
      return null;
    },
    async write(path, value) {
      if (path === 'lumo/auth') state.auth = value;
      if (path === 'lumo/passwordResets') state.passwordResets = value;
      if (path.startsWith('lumo/passwordResetLimits/')) {
        state.passwordResetLimits[path.split('/').pop()] = value;
      }
      return true;
    },
  };
}

test('reset completes from the private database when the small reset file is empty', async () => {
  const code = '654321';
  const requestId = 'rst-private-1';
  const mentor = {
    id: 'LM-77',
    email: 'mentor@example.com',
    role: 'admin',
    password: hashPassword('old-pass-99'),
  };
  const accounts = {
    async list() {
      return [mentor];
    },
    async listResets() {
      return {
        [requestId]: {
          email: 'mentor@example.com',
          userId: 'LM-77',
          codeHash: hashResetCode(code),
          expiresAt: Date.now() + 60_000,
          usedAt: '',
          createdAt: new Date().toISOString(),
        },
      };
    },
    async listLimit() {
      return { requests: [] };
    },
    async saveReset() {
      return true;
    },
    async saveLimit() {
      return true;
    },
    async save(admin) {
      mentor.password = admin.password;
      mentor.passwordResetAt = admin.passwordResetAt;
      return true;
    },
  };
  const io = memoryIo([mentor]);
  const done = await completePasswordReset(
    {
      email: 'mentor@example.com',
      code,
      password: 'brand-new-88',
      confirm: 'brand-new-88',
    },
    { io, accounts, now: Date.now() },
  );
  assert.equal(done.ok, true);
  assert.equal(passwordsMatch(mentor.password, 'brand-new-88'), true);
});

test('a missing small reset file does not block sending a code when private save works', async () => {
  const sent = [];
  const resets = {};
  const mentor = {
    id: 'LM-88',
    email: 'mentor@example.com',
    role: 'admin',
    password: hashPassword('old-pass'),
    fullName: 'Mentor',
  };
  const accounts = {
    async list() {
      return [mentor];
    },
    async listResets() {
      return resets;
    },
    async listLimit() {
      return { requests: [] };
    },
    async saveReset(id, record) {
      resets[id] = record;
      return true;
    },
    async saveLimit() {
      return true;
    },
    async save() {
      return true;
    },
  };
  const result = await requestPasswordReset('mentor@example.com', {
    io: memoryIo([mentor]),
    accounts,
    now: Date.now(),
    code: '112233',
    notify: async (payload) => {
      sent.push(payload.resetCode);
      return { ok: true };
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(sent, ['112233']);
  assert.equal(Object.keys(resets).length, 1);
});
