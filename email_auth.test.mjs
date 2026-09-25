import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashPassword, passwordsMatch, loginResultFor } from './api/_lib/clientMerge.mjs';
import {
  activityFieldsOnApprove,
  applyMentorActivitySweep,
  isMentorInactive,
  mentorHasSatisfiedActivity,
} from './api/_lib/mentorActivity.mjs';
import {
  completePasswordReset,
  generateResetCode,
  hashResetCode,
  requestPasswordReset,
  resetCodesMatch,
} from './api/_lib/passwordReset.mjs';
import { mentorApprovedEmail, registrationConfirmationEmail, licenseKeyEmail, passwordResetEmail } from './api/_lib/email/messages.mjs';
import { parseMt5SymbolNames } from './api/_lib/mt5Bridge.mjs';
import { describeEmailConfig, describeSecret, sendLumoEmail } from './api/_lib/email/send.mjs';
import { buildMime, encodeSubject } from './api/_lib/email/smtp.mjs';
import { listEmailLogs } from './api/_lib/email/log.mjs';

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

test('password hashes never store the raw secret', () => {
  const hashed = hashPassword('secret-pass');
  assert.equal(hashed.startsWith('sha256$'), true);
  assert.equal(hashed.includes('secret-pass'), false);
  assert.equal(passwordsMatch(hashed, 'secret-pass'), true);
  assert.equal(passwordsMatch(hashed, 'wrong'), false);
  assert.equal(passwordsMatch('plain-legacy', 'plain-legacy'), true);
});

test('registration and approval emails use the required Lumo Edge copy', () => {
  const received = registrationConfirmationEmail({ firstName: 'Thabo', email: 't@x.com' });
  assert.equal(received.subject, 'Welcome to Lumo Edge — Registration Received');
  assert.match(received.html, /Hi Thabo/);
  assert.match(received.html, /© Lumo Edge. All rights reserved./);
  const approved = mentorApprovedEmail({
    firstName: 'Thabo',
    approvalDate: '2026-09-25',
    deadlineDate: '2026-11-04',
    portalUrl: 'https://lumoedge.com/admin/login',
  });
  assert.equal(approved.subject, "You're Approved — Welcome to Lumo Edge");
  assert.match(approved.html, /40 days/);
  assert.match(approved.html, /2026-11-04/);
  const license = licenseKeyEmail({
    firstName: 'Aisha',
    licenseKey: 'LUMO-TEST-KEY1-ABCD',
    eaName: 'Gold Bot',
    licenseDuration: '1 Year',
  });
  assert.equal(license.subject, 'Your Lumo Edge License Key');
  assert.match(license.html, /LUMO-TEST-KEY1-ABCD/);
  assert.match(license.html, /Gold Bot/);
  const reset = passwordResetEmail({ firstName: 'Aisha', resetCode: '123456' });
  assert.equal(reset.subject, 'Reset Your Lumo Edge Password');
  assert.match(reset.html, /123456/);
  assert.match(reset.html, /15 minutes/);
});

test('40-day inactivity deactivates only after the deadline without license or client', () => {
  const now = new Date('2026-11-05T00:00:00.000Z');
  const fields = activityFieldsOnApprove(new Date('2026-09-25T00:00:00.000Z'));
  const idle = { id: 'LM-1', email: 'm@x.com', role: 'admin', ...fields };
  assert.equal(isMentorInactive(idle, now), true);
  assert.equal(mentorHasSatisfiedActivity({ ...idle, activitySatisfiedAt: '2026-09-26T00:00:00.000Z' }), true);
  const swept = applyMentorActivitySweep([idle], now);
  assert.equal(swept.changed, true);
  assert.equal(swept.admins[0].activityStatus, 'inactive');
  assert.match(swept.admins[0].inactiveReason, /40-day inactivity/);
  const blocked = loginResultFor(swept.admins[0], 'm@x.com');
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error, 'inactive');
});

test('password reset codes are hashed, single-use, and expire', async () => {
  const io = createIo([
    { id: 'LM-1', email: 'mentor@example.com', role: 'admin', password: hashPassword('old-pass'), fullName: 'Mentor One' },
  ]);
  const sent = [];
  const first = await requestPasswordReset('mentor@example.com', {
    io,
    now: 1_000,
    code: '111111',
    notify: async (payload) => sent.push(payload),
  });
  assert.equal(first.ok, true);
  assert.equal(sent[0].resetCode, '111111');
  const stored = Object.values(io.store['lumo/passwordResets'] || {}).find((row) => row?.codeHash);
  assert.equal(stored.resetCode, undefined);
  assert.equal(stored.codeHash, hashResetCode('111111'));
  assert.equal(resetCodesMatch(hashResetCode('111111'), '111111'), true);

  const reusedUnknown = await requestPasswordReset('nobody@example.com', { io, now: 2_000 });
  assert.equal(reusedUnknown.message.includes('If that email is registered'), true);

  const expired = await completePasswordReset(
    { email: 'mentor@example.com', code: '111111', password: 'new-password', confirm: 'new-password' },
    { io, now: 1_000 + 16 * 60 * 1000 },
  );
  assert.equal(expired.ok, false);

  await requestPasswordReset('mentor@example.com', { io, now: 20_000, code: '222222', notify: async () => {} });
  const ok = await completePasswordReset(
    { email: 'mentor@example.com', code: '222222', password: 'brand-new-9', confirm: 'brand-new-9' },
    { io, now: 21_000 },
  );
  assert.equal(ok.ok, true);
  assert.equal(passwordsMatch(io.store['lumo/auth'].admins[0].password, 'brand-new-9'), true);
  assert.equal(passwordsMatch(io.store['lumo/auth'].admins[0].password, 'old-pass'), false);

  const again = await completePasswordReset(
    { email: 'mentor@example.com', code: '222222', password: 'another-one', confirm: 'another-one' },
    { io, now: 22_000 },
  );
  assert.equal(again.ok, false);
});

test('Brevo key shape is classified without exposing the secret', () => {
  const api = describeSecret(`  "xkeysib-${'ab'.repeat(40)}"  `);
  assert.equal(api.kind, 'api');
  assert.equal(api.prefix, 'xkeysib-');
  assert.equal(api.truncated, false);
  assert.equal(Object.hasOwn(api, 'apiKey'), false);
  const smtp = describeSecret(`xsmtpsib-${'cd'.repeat(40)}`);
  assert.equal(smtp.kind, 'smtp');
  assert.equal(smtp.truncated, false);
  const short = describeSecret(`xsmtpsib-${'e'.repeat(20)}`);
  assert.equal(short.kind, 'smtp');
  assert.equal(short.truncated, true);
  const mime = buildMime({
    fromName: 'Lumo Edge',
    fromEmail: 'lumoedge08@gmail.com',
    to: 'mukundimukhuba8@gmail.com',
    subject: 'Lumo Edge email test',
    html: '<p>Hi</p>',
    text: 'Hi',
  });
  assert.match(mime, /Subject: Lumo Edge email test/);
  assert.match(encodeSubject('Lumo — test'), /UTF-8/);
});

test('Brevo failure does not throw from sendLumoEmail', async () => {
  const prev = process.env.BREVO_API_KEY;
  process.env.BREVO_API_KEY = `xkeysib-${'a'.repeat(80)}`;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('network down');
  };
  try {
    const result = await sendLumoEmail({
      to: 'user@example.com',
      subject: 'Test',
      html: '<p>Hi</p>',
      text: 'Hi',
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /network down/i);
  } finally {
    globalThis.fetch = originalFetch;
    if (prev == null) delete process.env.BREVO_API_KEY;
    else process.env.BREVO_API_KEY = prev;
  }
});

test('rejected or truncated Brevo keys stay off Resend and never leak credentials', async () => {
  const prev = process.env.BREVO_API_KEY;
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return { ok: false, json: async () => ({ message: 'Key not found' }) };
  };
  try {
    process.env.BREVO_API_KEY = 'xsmtpsib-short';
    const truncated = await sendLumoEmail({
      to: 'mukundimukhuba8@gmail.com',
      subject: 'Test',
      html: '<p>Hi</p>',
      text: 'Hi',
    });
    assert.equal(truncated.ok, false);
    assert.equal(called, false);
    assert.match(truncated.error, /incomplete/i);

    process.env.BREVO_API_KEY = `xkeysib-${'b'.repeat(80)}`;
    process.env.BREVO_SENDER_EMAIL = 'lumoedge08@gmail.com';
    process.env.BREVO_SENDER_NAME = 'Lumo Edge';
    const rejected = await sendLumoEmail({
      to: 'mukundimukhuba8@gmail.com',
      subject: 'Test',
      html: '<p>Hi</p>',
      text: 'Hi',
    });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.provider, 'brevo');
    assert.match(rejected.error, /rejected this key/i);
    const config = await describeEmailConfig();
    assert.equal(config.provider, 'brevo');
    assert.equal(config.keyKind, 'api');
    assert.equal(config.senderName, 'Lumo Edge');
    assert.equal(config.apiKey, undefined);
    assert.equal(JSON.stringify(config).includes('xkeysib-bbbb'), false);
  } finally {
    globalThis.fetch = originalFetch;
    if (prev == null) delete process.env.BREVO_API_KEY;
    else process.env.BREVO_API_KEY = prev;
  }
});

test('email logs never include credentials', () => {
  const rows = listEmailLogs({
    'log-1': {
      to: 'a@b.com',
      type: 'license_key',
      subject: 'Your Lumo Edge License Key',
      status: 'sent',
      createdAt: '2026-09-25T00:00:00.000Z',
      relatedUserId: 'LM-1',
      relatedLicenseId: 'lic-1',
      apiKey: 'should-not-copy',
    },
  });
  assert.equal(rows[0].status, 'SENT');
  assert.equal(rows[0].to, 'a@b.com');
  assert.equal(rows[0].apiKey, undefined);
  assert.ok(generateResetCode().length === 6);
  assert.ok(parseMt5SymbolNames);
});
