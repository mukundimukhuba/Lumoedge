/**
 * Offline + live smoke tests for license/subscription authority.
 * Usage: node scripts/audit_smoke_test.mjs [--live]
 */
import assert from 'node:assert/strict';
import {
  canActivateLicense,
  resolveSubscriptionStatus,
  SUBSCRIPTION_STATUS,
  approvalPatch,
  publicSubscriptionView,
} from '../api/_lib/subscriptionStatus.mjs';
import {
  keyFingerprint,
  keysMatch,
  normalizeLicenseKey,
  validateEmailAccess,
} from '../api/_lib/licenseClaim.mjs';

function testStatus() {
  assert.equal(
    resolveSubscriptionStatus({ status: 'approved', paymentVerified: true, paymentVerifiedSource: 'admin' }),
    SUBSCRIPTION_STATUS.APPROVED,
  );
  assert.equal(
    resolveSubscriptionStatus({ status: 'approved', paymentClaimed: true }),
    SUBSCRIPTION_STATUS.PENDING_PAYMENT,
  );
  assert.equal(
    resolveSubscriptionStatus({ status: 'approved', paymentVerified: true, paymentVerifiedSource: 'assigned_license' }),
    SUBSCRIPTION_STATUS.PENDING_PAYMENT,
  );
  assert.equal(resolveSubscriptionStatus({ status: 'rejected' }), SUBSCRIPTION_STATUS.DECLINED);
  assert.equal(canActivateLicense({ status: 'approved' }), false);
  assert.equal(
    canActivateLicense({ status: 'approved', paymentVerified: true, paymentVerifiedSource: 'admin' }),
    true,
  );
  const view = publicSubscriptionView({
    email: 'A@B.com',
    status: 'approved',
    paymentVerified: true,
    paymentVerifiedSource: 'admin',
  });
  assert.equal(view.canActivate, true);
  assert.equal(view.subscriptionStatus, SUBSCRIPTION_STATUS.APPROVED);
  const patch = approvalPatch('LM-004821');
  assert.equal(patch.paymentVerified, true);
  assert.equal(patch.approvedBy, 'LM-004821');
  console.log('OK subscriptionStatus');
}

function testKeys() {
  assert.equal(normalizeLicenseKey('lumo-abcd-efgh-ijkl'), 'LUMO-ABCD-EFGH-IJKL');
  assert.equal(keyFingerprint('LUMO-ABCD-EFGH-IJKL'), 'LUMOABCDEFGHIJKL');
  assert.equal(keysMatch('LUMO-ABCD-EFGH-IJKL', 'lumo abcd efgh ijkl'), true);
  assert.equal(
    validateEmailAccess(
      { status: 'active', clientEmail: 'client@x.com' },
      'client@x.com',
      [],
      {},
    ),
    null,
  );
  assert.ok(
    validateEmailAccess(
      { status: 'active', clientEmail: 'client@x.com' },
      'other@x.com',
      [],
      {},
    ),
  );
  assert.ok(
    validateEmailAccess(
      { status: 'assigned', assignedEmail: 'a@x.com' },
      'b@x.com',
      [],
      {},
    ),
  );
  console.log('OK licenseClaim helpers');
}

async function testLive() {
  const host = process.env.LUMO_HOST || 'https://lumoedge.vercel.app';
  const key = `LUMO-TEST-${Date.now().toString(36).toUpperCase()}-ZZZZ`;
  const email = 'mukundimukhuba8@gmail.com';
  const pub = await fetch(`${host}/api/licenses/publish`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-lumo-admin-id': 'LM-004821',
    },
    body: JSON.stringify({
      key,
      adminId: 'LM-004821',
      clientEmail: email,
      plan: 'Unlimited bull',
    }),
  }).then((r) => r.json());
  assert.equal(pub.ok, true, `publish failed ${JSON.stringify(pub)}`);
  const bad = await fetch(`${host}/api/licenses/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, email: 'wrong-email@example.com' }),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));
  assert.ok(bad.status === 400 || bad.status === 402 || bad.status === 403, JSON.stringify(bad));
  const claim = await fetch(`${host}/api/licenses/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, email }),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));
  assert.equal(claim.status, 200, JSON.stringify(claim));
  assert.equal(claim.body.ok, true);
  const verify = await fetch(`${host}/api/licenses/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, email }),
  }).then((r) => r.json());
  assert.equal(verify.valid, true, JSON.stringify(verify));
  const other = await fetch(`${host}/api/licenses/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, email: 'intruder@example.com' }),
  }).then((r) => r.json());
  assert.equal(other.valid, false);
  console.log('OK live publish/claim/verify', key);
}

testStatus();
testKeys();
if (process.argv.includes('--live')) {
  await testLive();
}
console.log('ALL SMOKE TESTS PASSED');
