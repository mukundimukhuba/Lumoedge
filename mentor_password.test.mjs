import assert from 'node:assert/strict';
import { test } from 'node:test';
import { passwordsMatch, publicAdminRecord } from './api/_lib/clientMerge.mjs';
import {
  applyMentorPassword,
  generateMentorPassword,
  handleMentorPasswordRoutes,
  isProtectedSuperAdmin,
  matchAdminRow,
  parseResetPasswordPath,
} from './api/_lib/mentorPassword.mjs';

function json(res, status, body) {
  res.statusCode = status;
  res.body = body;
}

async function callRoute({ method, path, session, resetPassword }) {
  const res = { statusCode: 0, body: null };
  const handled = await handleMentorPasswordRoutes(
    { method, url: path, headers: {} },
    res,
    {
      json,
      pathname: path.split('?')[0],
      verifySession: async () => session,
      resetPassword,
    },
  );
  return { handled, ...res };
}

test('generated mentor passwords are readable and unique enough to hand over', () => {
  const a = generateMentorPassword();
  const b = generateMentorPassword();
  assert.match(a, /^LE-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  assert.match(b, /^LE-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  assert.equal(a.length, 12);
  assert.notEqual(a, b);
});

test('applyMentorPassword writes the new password onto the matching mentor only', () => {
  const admins = [
    { id: 'LM-111111', email: 'mentor@example.com', password: 'old-pass', role: 'admin' },
    { id: 'LM-222222', email: 'other@example.com', password: 'keep-me', role: 'admin' },
  ];
  const byId = applyMentorPassword(admins, 'LM-111111', 'LE-ABCD-EFGH', {
    actorId: 'LM-004821',
    resetAt: '2026-09-16T12:00:00.000Z',
  });
  assert.equal(passwordsMatch(byId.hit.password, 'LE-ABCD-EFGH'), true);
  assert.equal(byId.hit.password.startsWith('sha256$'), true);
  assert.equal(byId.hit.passwordResetBy, 'LM-004821');
  assert.equal(byId.admins[1].password, 'keep-me');
  assert.equal(publicAdminRecord(byId.hit).password, undefined);

  const byEmail = applyMentorPassword(admins, 'mentor@example.com', 'LE-WXYZ-2345');
  assert.equal(byEmail.hit.id, 'LM-111111');
  assert.equal(passwordsMatch(byEmail.hit.password, 'LE-WXYZ-2345'), true);

  const missing = applyMentorPassword(admins, 'LM-999999', 'LE-NOPE-NOPE');
  assert.equal(missing.hit, null);
});

test('Super Admin account cannot be reset through this tool', () => {
  assert.equal(
    isProtectedSuperAdmin({ id: 'LM-004821', email: 'anyone@example.com' }),
    true,
  );
  assert.equal(
    isProtectedSuperAdmin({ id: 'LM-111111', email: 'mukundimukhuba8@gmail.com' }),
    true,
  );
  assert.equal(
    isProtectedSuperAdmin({ id: 'LM-111111', email: 'mentor@example.com' }),
    false,
  );
  assert.equal(matchAdminRow({ id: 'LM-111111', email: 'a@b.com' }, 'a@b.com'), true);
});

test('reset-password path parsing keeps mentor IDs intact', () => {
  assert.equal(
    parseResetPasswordPath('/api/auth/admins/LM-111111/reset-password'),
    'LM-111111',
  );
  assert.equal(
    parseResetPasswordPath('/api/auth/admins/mentor%40example.com/reset-password/'),
    'mentor@example.com',
  );
  assert.equal(parseResetPasswordPath('/api/auth/admins/LM-111111'), '');
});

test('Regular admin and missing session cannot reset a mentor password', async () => {
  const calls = [];
  const resetPassword = async (id) => {
    calls.push(id);
    return { ok: true, password: 'LE-FAKE-FAKE', email: 'm@x.com', mentorId: id, admin: { id } };
  };

  const anon = await callRoute({
    method: 'POST',
    path: '/api/auth/admins/LM-111111/reset-password',
    session: { ok: false, error: 'unauthorized' },
    resetPassword,
  });
  assert.equal(anon.statusCode, 401);
  assert.equal(calls.length, 0);

  const regular = await callRoute({
    method: 'POST',
    path: '/api/auth/admins/LM-111111/reset-password',
    session: { ok: true, adminId: 'LM-777777', role: 'admin', email: 'a@example.com' },
    resetPassword,
  });
  assert.equal(regular.statusCode, 403);
  assert.equal(regular.body.error, 'Access denied');
  assert.equal(calls.length, 0);
});

test('resetMentorPassword writes the generated password into the mentor record', async () => {
  const { resetMentorPassword } = await import('./api/_lib/mentorPassword.mjs');
  const store = {
    'lumo/auth': {
      admins: [
        { id: 'LM-111111', email: 'mentor@example.com', password: 'old-secret', role: 'admin' },
      ],
      admin: null,
    },
  };
  const io = {
    async read(path) {
      return store[path] ?? null;
    },
    async write(path, value) {
      store[path] = value;
      return true;
    },
  };
  const result = await resetMentorPassword('LM-111111', { io, actorId: 'LM-004821' });
  assert.equal(result.ok, true);
  assert.match(result.password, /^LE-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  assert.equal(passwordsMatch(store['lumo/auth'].admins[0].password, result.password), true);
  assert.equal(store['lumo/auth'].admins[0].passwordResetBy, 'LM-004821');
  assert.equal(result.admin.password, undefined);

  const blocked = await resetMentorPassword('LM-004821', {
    io: {
      async read() {
        return {
          admins: [{ id: 'LM-004821', email: 'mukundimukhuba8@gmail.com', role: 'super' }],
        };
      },
      async write() {
        return true;
      },
    },
    actorId: 'LM-004821',
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error, 'protected_super');
});

test('Super Admin reset writes a new password the UI can show once', async () => {
  const resetPassword = async (id, opts) => {
    assert.equal(id, 'LM-111111');
    assert.equal(opts.actorId, 'LM-004821');
    return {
      ok: true,
      password: 'LE-K7M2-P9QX',
      email: 'mentor@example.com',
      mentorId: 'LM-111111',
      admin: { id: 'LM-111111', email: 'mentor@example.com', role: 'admin' },
    };
  };

  const superOk = await callRoute({
    method: 'POST',
    path: '/api/auth/admins/LM-111111/reset-password',
    session: { ok: true, adminId: 'LM-004821', role: 'super', email: 'mukundimukhuba8@gmail.com' },
    resetPassword,
  });
  assert.equal(superOk.statusCode, 200);
  assert.equal(superOk.body.ok, true);
  assert.equal(superOk.body.password, 'LE-K7M2-P9QX');
  assert.equal(superOk.body.mentorId, 'LM-111111');
  assert.equal(superOk.body.admin.password, undefined);

  const missing = await callRoute({
    method: 'POST',
    path: '/api/auth/admins/LM-999999/reset-password',
    session: { ok: true, adminId: 'LM-004821', role: 'super', email: 'mukundimukhuba8@gmail.com' },
    resetPassword: async () => ({ ok: false, error: 'not_found' }),
  });
  assert.equal(missing.statusCode, 404);

  const protectedSuper = await callRoute({
    method: 'POST',
    path: '/api/auth/admins/LM-004821/reset-password',
    session: { ok: true, adminId: 'LM-004821', role: 'super', email: 'mukundimukhuba8@gmail.com' },
    resetPassword: async () => ({ ok: false, error: 'protected_super' }),
  });
  assert.equal(protectedSuper.statusCode, 400);
});
