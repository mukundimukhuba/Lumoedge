import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isPortalSuperAdminRequest,
  SUPER_LOGIN,
} from './api/_lib/adminSession.mjs';
import { generateMentorPassword, applyMentorPassword } from './api/_lib/mentorPassword.mjs';
import { hashPassword, passwordsMatch } from './api/_lib/clientMerge.mjs';

test('super admin header unlocks mentor password routes without a session token', () => {
  assert.equal(
    isPortalSuperAdminRequest(
      { headers: { 'x-lumo-admin-id': SUPER_LOGIN.user.id } },
      { ok: false },
    ),
    true,
  );
  assert.equal(
    isPortalSuperAdminRequest({ headers: { 'x-lumo-admin-id': 'LM-999999' } }, { ok: false }),
    false,
  );
  assert.equal(
    isPortalSuperAdminRequest({ headers: {} }, { ok: true, role: 'super', adminId: SUPER_LOGIN.user.id }),
    true,
  );
});

test('reset applies a readable password hash for the mentor', () => {
  const password = generateMentorPassword();
  assert.match(password, /^LE-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  const { hit } = applyMentorPassword(
    [{ id: 'LM-604830', email: 'mentor@example.com', role: 'admin', password: hashPassword('old') }],
    'LM-604830',
    password,
    { actorId: 'LM-004821' },
  );
  assert.ok(hit);
  assert.equal(passwordsMatch(hit.password, password), true);
});
