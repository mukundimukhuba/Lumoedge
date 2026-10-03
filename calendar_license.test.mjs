import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCalendarEngine, acceptStudentLicense, findStudentLicenseRecord } from './api/_lib/calendarEngine.mjs';

test('a recovered active license opens the calendar for its student', () => {
  const records = {
    vault: [
      {
        key: 'LUMO-TEST-0001',
        status: 'active',
        email: 'student@example.com',
        clientEmail: 'student@example.com',
        eaName: 'GHOSTFANG PRIME AI',
      },
    ],
  };
  const found = findStudentLicenseRecord(records, 'student@example.com', 'LUMO-TEST-0001');
  assert.equal(found.entry.eaName, 'GHOSTFANG PRIME AI');
  const accepted = acceptStudentLicense(found.entry, 'student@example.com');
  assert.equal(accepted.ok, true);
  assert.equal(accepted.botName, 'GHOSTFANG PRIME AI');
  assert.equal(acceptStudentLicense(found.entry, 'other@example.com').ok, false);
});

test('a phone session license is recognized when the vault row has no robot name', () => {
  const records = {
    vault: [{ key: 'LUMO-TEST-0002', status: 'active', email: 'student@example.com' }],
    sessions: {
      'student@example.com': {
        bot: { licenseKey: 'LUMO-TEST-0002', displayName: 'Ea bulls vpro' },
      },
    },
  };
  const found = findStudentLicenseRecord(records, 'student@example.com', 'lumo-test-0002');
  assert.equal(found.entry.eaName, 'Ea bulls vpro');
  assert.equal(acceptStudentLicense(found.entry, 'student@example.com').ok, true);
});

test('someone else cannot use an assigned license', () => {
  const entry = {
    key: 'LUMO-TEST-0003',
    status: 'assigned',
    assignedEmail: 'student@example.com',
    eaName: 'Robot',
  };
  assert.equal(acceptStudentLicense(entry, 'student@example.com').ok, true);
  assert.equal(
    acceptStudentLicense(entry, 'other@example.com').error,
    'License does not belong to this account',
  );
});

test('calendar loads from the private license when the old database is empty', async () => {
  const io = {
    nowMs: () => Date.parse('2026-10-03T12:00:00.000Z'),
    nowIso: () => '2026-10-03T12:00:00.000Z',
    read: async () => null,
    write: async () => false,
    id: () => 'cal_test',
    fetch: async () => ({ ok: false }),
    loadLicenseDb: async () => ({
      vault: [
        {
          key: 'LUMO-TEST-0004',
          status: 'active',
          email: 'student@example.com',
          eaId: 'ea-1',
          eaName: 'GHOSTFANG PRIME AI',
        },
      ],
      store: { workspaces: {} },
      sessions: {},
    }),
  };
  const engine = createCalendarEngine(io);
  const result = await engine.listStudentCalendar('student@example.com', 'LUMO-TEST-0004');
  assert.equal(result.ok, true);
  assert.equal(result.license.botName, 'GHOSTFANG PRIME AI');
  assert.equal(JSON.stringify(result).includes('LUMO-TEST-0004'), false);
  assert.equal(result.events.some((event) => event.name === 'CPI' && event.date === '2026-10-14'), true);
  const denied = await engine.listStudentCalendar('other@example.com', 'LUMO-TEST-0004');
  assert.equal(denied.ok, false);
  assert.equal(denied.error, 'User does not have an active license');
});
