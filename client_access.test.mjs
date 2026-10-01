import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  clientEntryPatch,
  sessionDeviceKeys,
  sessionEmailKey,
  preferSessionDevice,
  sessionWithoutDevice,
} from './api/_lib/clientMerge.mjs';

test('a payment on an existing client is saved as paid and still pending approval', () => {
  const patch = clientEntryPatch(
    { email: 'juniorzaine28@gmail.com', status: 'pending', paymentClaimed: false, firstName: 'Endinako' },
    { paymentClaimed: true, paymentClaimedAt: '2026-10-01T16:35:00.000Z', firstName: 'Endinako', lastName: 'Somacala' },
  );
  assert.equal(patch.status, 'pending');
  assert.equal(patch.paymentClaimed, true);
  assert.equal(patch.paymentClaimedAt, '2026-10-01T16:35:00.000Z');
  assert.equal(patch.lastName, 'Somacala');
});

test('adding an email as approved keeps that approval', () => {
  const patch = clientEntryPatch(
    { status: 'pending', paymentClaimed: false },
    { status: 'approved', paymentClaimed: true, firstName: 'Endinako', lastName: 'Somacala' },
  );
  assert.equal(patch.status, 'approved');
  assert.equal(patch.paymentClaimed, true);
  assert.equal(patch.firstName, 'Endinako');
});

test('unlinking a phone drops the device and keeps the session', () => {
  const email = 'juniorzaine28@gmail.com';
  assert.equal(sessionEmailKey(email), 'juniorzaine28@gmail_com');
  assert.deepEqual(sessionDeviceKeys(email), ['juniorzaine28@gmail_com', 'juniorzaine28@gmail']);
  const released = sessionWithoutDevice({
    accessStatus: 'approved',
    device: { id: 'phone-1', label: 'Android phone', lastSeenAt: '2026-10-01T16:00:00.000Z' },
    bot: { licenseKey: 'LUMO-KEEP' },
  });
  assert.equal(released.previousLabel, 'Android phone');
  assert.equal(released.session.device, undefined);
  assert.equal(released.session.accessStatus, 'approved');
  assert.equal(released.session.bot.licenseKey, 'LUMO-KEEP');
  assert.ok(released.session.deviceReleasedAt);
});

test('a new sign-in takes the email and an older phone heartbeat does not', () => {
  const android = { id: 'android-1', label: 'Android phone', claimedAt: '2026-08-29T10:00:00.000Z', lastSeenAt: '2026-10-01T18:20:00.000Z' };
  const phone = { id: 'phone-2', label: 'Android phone', claimedAt: '2026-10-01T18:26:00.000Z', lastSeenAt: '2026-10-01T18:26:00.000Z' };
  assert.equal(preferSessionDevice(android, phone).id, 'phone-2');
  const heartbeat = { ...android, lastSeenAt: '2026-10-01T18:27:00.000Z' };
  assert.equal(preferSessionDevice(phone, heartbeat).id, 'phone-2');
  assert.equal(preferSessionDevice(phone, { ...phone, lastSeenAt: '2026-10-01T18:30:00.000Z' }).lastSeenAt, '2026-10-01T18:30:00.000Z');
});
