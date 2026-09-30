import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import {
  SPECIAL_PRICE_CENTS,
  findSpecialLicense,
  grantSpecialAccess,
  paystackChargeGrantsSpecial,
  verifyPaystackSignature,
} from './api/_lib/specialAccess.mjs';

function charge(overrides = {}) {
  return {
    event: 'charge.success',
    data: {
      status: 'success',
      currency: 'ZAR',
      amount: SPECIAL_PRICE_CENTS,
      reference: 'ref-1',
      customer: { email: 'Buyer@Example.com', first_name: 'Aya', last_name: 'Ndlovu' },
      ...overrides,
    },
  };
}

test('only a confirmed R350 ZAR charge can unlock the special', () => {
  assert.equal(paystackChargeGrantsSpecial(charge()).ok, true);
  assert.equal(paystackChargeGrantsSpecial(charge()).email, 'buyer@example.com');
  assert.equal(paystackChargeGrantsSpecial(charge({ amount: 60000 })).ok, false);
  assert.equal(paystackChargeGrantsSpecial(charge({ currency: 'NGN' })).ok, false);
  assert.equal(paystackChargeGrantsSpecial(charge({ status: 'failed' })).ok, false);
  assert.equal(paystackChargeGrantsSpecial({ event: 'charge.failed', data: {} }).ok, false);
});

test('Paystack signature must match the raw body', () => {
  const raw = '{"event":"charge.success"}';
  const secret = 'special-secret';
  const signature = createHmac('sha512', secret).update(raw).digest('hex');
  assert.equal(verifyPaystackSignature(raw, signature, secret), true);
  assert.equal(verifyPaystackSignature(raw, signature, 'other'), false);
  assert.equal(verifyPaystackSignature(raw, '', secret), false);
});

test('a paid email gets one included license and a second payment reuses it', async () => {
  const store = new Map();
  store.set('lumo/vault', []);
  store.set('lumo/store/workspaces/LM-004821', { id: 'LM-004821', licenses: [], eas: [{ id: 'ea' }] });
  const emails = [];
  const io = {
    read: async (path) => (store.has(path) ? store.get(path) : null),
    write: async (path, value) => {
      store.set(path, value);
      return true;
    },
    postClient: async (input) => ({ id: 'cli-1', ...input }),
    patchClient: async (_id, patch) => ({ id: 'cli-1', status: patch.status, paymentVerified: true }),
    makeKey: () => 'LUMO-TEST-SPEC-0001',
    now: '2026-09-30T22:00:00.000Z',
    notify: async (license) => {
      emails.push(license.email);
      return { ok: true };
    },
  };
  const first = await grantSpecialAccess({
    email: 'buyer@example.com',
    firstName: 'Aya',
    lastName: 'Ndlovu',
    reference: 'ref-1',
    deps: io,
  });
  const second = await grantSpecialAccess({
    email: 'buyer@example.com',
    firstName: 'Aya',
    lastName: 'Ndlovu',
    reference: 'ref-2',
    deps: io,
  });
  assert.equal(first.ok, true);
  assert.equal(first.license.key, 'LUMO-TEST-SPEC-0001');
  assert.equal(first.license.eaName, 'Unlimited bull');
  assert.equal(second.license.key, first.license.key);
  assert.equal(findSpecialLicense(store.get('lumo/vault'), 'buyer@example.com').key, first.license.key);
  assert.equal(store.get('lumo/vault').length, 1);
  assert.equal(store.get('lumo/store/workspaces/LM-004821').eas.length, 1);
  assert.equal(emails.length, 2);
});
