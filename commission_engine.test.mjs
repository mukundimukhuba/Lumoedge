import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createCommissionEngine,
  commissionEventId,
  withdrawalProgress,
  rankEarners,
  filterEarners,
} from './api/_lib/commissionEngine.mjs';
import { mentorGuard } from './api/_lib/commissionRoutes.mjs';

function createMemoryIo(now = '2026-09-14T12:00:00.000Z') {
  const root = {};
  let n = 0;
  return {
    now: () => now,
    setNow(value) {
      now = value;
    },
    id: () => `id_${(++n).toString(16)}`,
    _root: root,
    async read(path) {
      const parts = String(path).split('/').filter(Boolean);
      let cur = root;
      for (const part of parts) {
        if (cur == null || typeof cur !== 'object') return null;
        cur = cur[part];
      }
      return cur == null ? null : JSON.parse(JSON.stringify(cur));
    },
    async write(path, value) {
      const parts = String(path).split('/').filter(Boolean);
      let cur = root;
      for (let i = 0; i < parts.length - 1; i += 1) {
        const part = parts[i];
        if (!cur[part] || typeof cur[part] !== 'object') cur[part] = {};
        cur = cur[part];
      }
      const last = parts[parts.length - 1];
      if (value === null) delete cur[last];
      else cur[last] = JSON.parse(JSON.stringify(value));
      return true;
    },
  };
}

async function seedBase(io, extras = {}) {
  await io.write('lumo/commissionSettings', {
    commissionPerReferral: 50,
    minimumQualifyingReferrals: 5,
    withdrawalEnabled: true,
    holdHours: 0,
    currency: 'ZAR',
    launchedAt: '2026-06-01T00:00:00.000Z',
    ...extras.settings,
  });
  await io.write('lumo/clients', extras.clients || []);
  await io.write('lumo/vault', extras.vault || []);
  await io.write('lumo/store/workspaces', extras.workspaces || {});
  await io.write('lumo/auth', extras.auth || { admins: [] });
}

function paidClient(email, at = '2026-09-01T10:00:00.000Z') {
  return {
    id: `cli-${email.split('@')[0]}`,
    email,
    firstName: 'New',
    lastName: 'Client',
    status: 'approved',
    paymentClaimed: true,
    paymentClaimedAt: at,
  };
}

function assignedLicense(email, mentorId = 'LM-111111', key = 'LUMO-TEST-KEY1-AAAA') {
  return {
    key,
    status: 'assigned',
    assignedEmail: email,
    assignedAt: '2026-09-02T10:00:00.000Z',
    ownerAdminId: mentorId,
    eaId: 'ea-1',
    eaName: 'Pulse',
  };
}

test('A. New client pays and activates mentor key → R50 commission', async () => {
  const io = createMemoryIo();
  const engine = createCommissionEngine(io);
  const email = 'new.a@example.com';
  await seedBase(io, {
    clients: [paidClient(email)],
    vault: [assignedLicense(email)],
  });
  const first = await engine.tryQualify({ email, source: 'claim' });
  assert.equal(first.created, true);
  assert.equal(first.commission.amount, 50);
  assert.equal(first.commission.status, 'available');
  assert.equal(first.commission.mentorId, 'LM-111111');
  assert.equal(first.commission.eventId, commissionEventId(email));
  const summary = await engine.getMentorSummary('LM-111111');
  assert.equal(summary.totals.totalEarned, 50);
  assert.equal(summary.totals.available, 50);
  assert.equal(summary.totals.qualifyingReferrals, 1);
});

test('B. Client generates key but does not pay → R0 commission', async () => {
  const io = createMemoryIo();
  const engine = createCommissionEngine(io);
  const email = 'unpaid.b@example.com';
  await seedBase(io, {
    clients: [{ id: 'cli-b', email, status: 'pending', paymentClaimed: false }],
    vault: [
      {
        key: 'LUMO-TEST-KEY1-BBBB',
        status: 'active',
        ownerAdminId: 'LM-111111',
        clientEmail: email,
      },
    ],
  });
  const result = await engine.tryQualify({ email, source: 'claim' });
  assert.equal(result.created, false);
  assert.equal(result.reason, 'not_paid');
  const summary = await engine.getMentorSummary('LM-111111');
  assert.equal(summary.totals.totalEarned, 0);
});

test('C. Client pays but does not activate key → R0 commission', async () => {
  const io = createMemoryIo();
  const engine = createCommissionEngine(io);
  const email = 'paid.no.key@example.com';
  await seedBase(io, {
    clients: [paidClient(email)],
    vault: [
      {
        key: 'LUMO-TEST-KEY1-CCCC',
        status: 'active',
        ownerAdminId: 'LM-111111',
      },
    ],
  });
  const result = await engine.tryQualify({ email, source: 'payment' });
  assert.equal(result.created, false);
  assert.equal(result.reason, 'no_license');
  const summary = await engine.getMentorSummary('LM-111111');
  assert.equal(summary.totals.totalEarned, 0);
});

test('D. Existing paid client activates another key → R0 new commission', async () => {
  const io = createMemoryIo();
  const engine = createCommissionEngine(io);
  const email = 'legacy.d@example.com';
  await seedBase(io, {
    clients: [paidClient(email, '2026-01-15T00:00:00.000Z')],
    vault: [assignedLicense(email, 'LM-111111', 'LUMO-TEST-KEY1-DDDD')],
  });
  const result = await engine.tryQualify({ email, source: 'claim' });
  assert.equal(result.created, false);
  assert.equal(result.reason, 'previously_paid');
  const summary = await engine.getMentorSummary('LM-111111');
  assert.equal(summary.totals.totalEarned, 0);
  assert.equal(summary.totals.qualifyingReferrals, 0);
});

test('E. Same payment callback happens twice → only one commission', async () => {
  const io = createMemoryIo();
  const engine = createCommissionEngine(io);
  const email = 'dup.e@example.com';
  await seedBase(io, {
    clients: [paidClient(email)],
    vault: [assignedLicense(email)],
  });
  const first = await engine.tryQualify({ email, source: 'payment' });
  const second = await engine.tryQualify({ email, source: 'payment' });
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.reason, 'already_exists');
  assert.equal(first.commission.eventId, second.commission.eventId);
  const summary = await engine.getMentorSummary('LM-111111');
  assert.equal(summary.totals.totalEarned, 50);
  assert.equal(summary.commissions.length, 1);
});

test('F. Same key is activated twice → no duplicate commission', async () => {
  const io = createMemoryIo();
  const engine = createCommissionEngine(io);
  const email = 'dup.f@example.com';
  await seedBase(io, {
    clients: [paidClient(email)],
    vault: [assignedLicense(email, 'LM-111111', 'LUMO-TEST-KEY1-FFFF')],
  });
  await engine.tryQualify({ email, source: 'claim' });
  const again = await engine.tryQualify({ email, source: 'claim' });
  assert.equal(again.created, false);
  const summary = await engine.getMentorSummary('LM-111111');
  assert.equal(summary.totals.qualifyingReferrals, 1);
});

test('G. Five qualifying referrals unlock withdrawals', async () => {
  const io = createMemoryIo();
  const engine = createCommissionEngine(io);
  const clients = [];
  const vault = [];
  for (let i = 1; i <= 5; i += 1) {
    const email = `ref${i}@example.com`;
    clients.push(paidClient(email, `2026-09-0${i}T10:00:00.000Z`));
    vault.push(assignedLicense(email, 'LM-111111', `LUMO-TEST-KEY${i}-GGGG`));
  }
  await seedBase(io, { clients, vault });
  for (const client of clients) {
    const result = await engine.tryQualify({ email: client.email, source: 'claim' });
    assert.equal(result.created, true);
  }
  const summary = await engine.getMentorSummary('LM-111111');
  assert.equal(summary.totals.qualifyingReferrals, 5);
  assert.equal(summary.progress.unlocked, true);
  assert.equal(summary.progress.message, 'Withdrawal unlocked');
  assert.equal(summary.totals.available, 250);
  await engine.savePayoutDetails('LM-111111', {
    accountHolderName: 'Ada Mentor',
    bankName: 'Capitec',
    accountNumber: '1234567890',
    branchCode: '470010',
    accountType: 'Savings',
  });
  const requested = await engine.requestPayout('LM-111111');
  assert.equal(requested.ok, true);
  assert.equal(requested.payout.amount, 250);
  const after = await engine.getMentorSummary('LM-111111');
  assert.equal(after.canRequestPayout, false);
  assert.match(after.requestBlockedReason, /already in progress/i);
});

test('H. Refunded / cancelled payment reverses the commission', async () => {
  const io = createMemoryIo();
  const engine = createCommissionEngine(io);
  const email = 'refund.h@example.com';
  await seedBase(io, {
    clients: [paidClient(email)],
    vault: [assignedLicense(email)],
  });
  await engine.tryQualify({ email, source: 'payment' });
  const reversed = await engine.tryReverse({
    email,
    reason: 'Subscription cancelled or payment rejected',
    actorId: 'system:client-patch',
  });
  assert.equal(reversed.reversed, true);
  assert.equal(reversed.commission.status, 'reversed');
  const summary = await engine.getMentorSummary('LM-111111');
  assert.equal(summary.totals.totalEarned, 0);
  assert.equal(summary.totals.qualifyingReferrals, 0);
  const again = await engine.tryReverse({ email });
  assert.equal(again.reversed, false);
  assert.equal(again.reason, 'already_reversed');
});

test('I. Mentor cannot access another mentor’s commissions by changing an ID', async () => {
  const io = createMemoryIo();
  const engine = createCommissionEngine(io);
  await seedBase(io, {
    clients: [paidClient('own@example.com'), paidClient('other@example.com')],
    vault: [
      assignedLicense('own@example.com', 'LM-111111', 'LUMO-TEST-KEY1-IIII'),
      assignedLicense('other@example.com', 'LM-222222', 'LUMO-TEST-KEY2-IIII'),
    ],
  });
  await engine.tryQualify({ email: 'own@example.com' });
  await engine.tryQualify({ email: 'other@example.com' });
  const own = await engine.getMentorSummary('LM-111111');
  assert.equal(own.totals.qualifyingReferrals, 1);
  assert.ok(own.commissions.every((row) => row.mentorId === 'LM-111111'));
  const denied = mentorGuard({ ok: true, adminId: 'LM-111111', role: 'admin' }, 'LM-222222');
  assert.equal(denied.ok, false);
  assert.equal(denied.error, 'Access denied');
  const allowedSelf = mentorGuard({ ok: true, adminId: 'LM-111111', role: 'admin' }, 'LM-111111');
  assert.equal(allowedSelf.ok, true);
  const superOk = mentorGuard({ ok: true, adminId: 'LM-004821', role: 'super' }, 'LM-222222');
  assert.equal(superOk.ok, true);
  assert.equal(superOk.mentorId, 'LM-222222');
});

test('J. Admin changes commission amount — future uses new rate, history keeps original', async () => {
  const io = createMemoryIo();
  const engine = createCommissionEngine(io);
  await seedBase(io, {
    clients: [paidClient('old.rate@example.com')],
    vault: [assignedLicense('old.rate@example.com', 'LM-111111', 'LUMO-TEST-KEY1-JJJJ')],
  });
  const first = await engine.tryQualify({ email: 'old.rate@example.com' });
  assert.equal(first.commission.amount, 50);
  await engine.writeSettings({ commissionPerReferral: 80 }, 'LM-004821');
  await io.write('lumo/clients', [
    paidClient('old.rate@example.com'),
    paidClient('new.rate@example.com'),
  ]);
  const vault = await io.read('lumo/vault');
  vault.push(assignedLicense('new.rate@example.com', 'LM-111111', 'LUMO-TEST-KEY2-JJJJ'));
  await io.write('lumo/vault', vault);
  const second = await engine.tryQualify({ email: 'new.rate@example.com' });
  assert.equal(second.commission.amount, 80);
  const summary = await engine.getMentorSummary('LM-111111');
  assert.equal(summary.totals.totalEarned, 130);
  assert.equal(summary.commissions.find((row) => row.eventId === first.commission.eventId).amount, 50);
});

test('Withdrawal copy uses the configurable minimum, never a hardcoded 5', () => {
  assert.equal(withdrawalProgress(0, 7).message, '7 more qualifying subscriptions to unlock withdrawals');
  assert.equal(withdrawalProgress(3, 7).remaining, 4);
  assert.equal(withdrawalProgress(7, 7).message, 'Withdrawal unlocked');
  assert.equal(withdrawalProgress(0, 5).message, '5 more qualifying subscriptions to unlock withdrawals');
});

test('Payout details stay masked and amount cannot be chosen by the mentor', async () => {
  const io = createMemoryIo();
  const engine = createCommissionEngine(io);
  const clients = [];
  const vault = [];
  for (let i = 1; i <= 5; i += 1) {
    const email = `mask${i}@example.com`;
    clients.push(paidClient(email));
    vault.push(assignedLicense(email, 'LM-111111', `LUMO-MASK-${i}EEE`));
  }
  await seedBase(io, { clients, vault });
  for (const client of clients) await engine.tryQualify({ email: client.email });
  const saved = await engine.savePayoutDetails('LM-111111', {
    accountHolderName: 'Ada Mentor',
    bankName: 'FNB',
    accountNumber: '1122334455',
    branchCode: '250655',
    accountType: 'Cheque',
  });
  assert.equal(saved.payoutDetails.accountNumberMasked, '••••4455');
  assert.equal(saved.payoutDetails.accountNumber, undefined);
  const payout = await engine.requestPayout('LM-111111');
  assert.equal(payout.payout.amount, 250);
  assert.equal(payout.payout.payoutDetails.accountNumberMasked, '••••4455');
  assert.equal(payout.payout.payoutDetailsFull, undefined);
});

test('Default ranking is highest total earnings first, never alphabetical', () => {
  const ranked = rankEarners([
    { mentorId: 'LM-SARAH', fullName: 'Sarah', totals: { totalEarned: 4200, qualifyingReferrals: 10 } },
    { mentorId: 'LM-JOHN', fullName: 'John', totals: { totalEarned: 12500, qualifyingReferrals: 25 } },
    { mentorId: 'LM-MIKE', fullName: 'Mike', totals: { totalEarned: 8400, qualifyingReferrals: 18 } },
  ]);
  assert.deepEqual(
    ranked.map((row) => [row.rank, row.fullName, row.totals.totalEarned]),
    [
      [1, 'John', 12500],
      [2, 'Mike', 8400],
      [3, 'Sarah', 4200],
    ],
  );
});

test('Earner filters cover mentors, admins, active, inactive, highest, and pending payouts', () => {
  const rows = [
    {
      mentorId: 'A',
      accountType: 'mentor',
      status: 'active',
      totals: { totalEarned: 100, pending: 0 },
      openPayout: null,
    },
    {
      mentorId: 'B',
      accountType: 'admin',
      status: 'inactive',
      totals: { totalEarned: 0, pending: 40 },
      openPayout: { payoutId: 'po_1' },
    },
  ];
  assert.equal(filterEarners(rows, 'mentors').length, 1);
  assert.equal(filterEarners(rows, 'admins')[0].mentorId, 'B');
  assert.equal(filterEarners(rows, 'active')[0].mentorId, 'A');
  assert.equal(filterEarners(rows, 'inactive')[0].mentorId, 'B');
  assert.equal(filterEarners(rows, 'highest earners').length, 1);
  assert.equal(filterEarners(rows, 'pending payouts').length, 1);
});

test('Regular admin join stays pending, does not grant Super Admin, and cannot earn until approved', async () => {
  const io = createMemoryIo();
  const engine = createCommissionEngine(io);
  await seedBase(io, {
    auth: {
      admins: [
        { id: 'LM-999001', email: 'regular@example.com', fullName: 'Rita Admin', role: 'admin' },
      ],
    },
    clients: [paidClient('ref.join@example.com')],
    vault: [assignedLicense('ref.join@example.com', 'LM-999001', 'LUMO-JOIN-KEY1-AAAA')],
  });
  const joined = await engine.joinProgram(
    { adminId: 'LM-999001', role: 'admin', email: 'regular@example.com' },
    {
      firstName: 'Rita',
      lastName: 'Admin',
      email: 'regular@example.com',
      phone: '0820000000',
      adminId: 'LM-999001',
      source: 'portal',
      acceptTerms: true,
    },
  );
  assert.equal(joined.ok, true);
  assert.equal(joined.profile.status, 'pending');
  assert.equal(joined.profile.accountType, 'admin');
  assert.equal(joined.roleUnchanged, true);
  const authAfter = await io.read('lumo/auth');
  assert.equal(authAfter.admins[0].role, 'admin');
  const skipped = await engine.tryQualify({ email: 'ref.join@example.com', source: 'payment' });
  assert.equal(skipped.created, false);
  assert.equal(skipped.reason, 'not_enrolled');
  const approved = await engine.reviewApplication('LM-999001', 'approve', { actorId: 'LM-004821' });
  assert.equal(approved.ok, true);
  assert.equal(approved.profile.status, 'active');
  const created = await engine.tryQualify({ email: 'ref.join@example.com', source: 'payment' });
  assert.equal(created.created, true);
  assert.equal(created.commission.amount, 50);
  assert.equal(created.commission.mentorId, 'LM-999001');
  const summary = await engine.getMentorSummary('LM-999001');
  assert.equal(summary.totals.totalEarned, 50);
  assert.equal(summary.totals.qualifyingReferrals, 1);
  assert.equal(summary.enrollment.status, 'active');
  const overview = await engine.getAdminOverview();
  assert.equal(overview.sort, 'totalEarned_desc');
  assert.equal(overview.earners[0].mentorId, 'LM-999001');
  assert.equal(overview.earners[0].rank, 1);
  assert.equal(overview.dashboard.topEarner.mentorId, 'LM-999001');
  assert.equal(overview.dashboard.totalEarners, 1);
});

test('Join cannot spoof another Admin ID and cannot write earnings', async () => {
  const io = createMemoryIo();
  const engine = createCommissionEngine(io);
  await seedBase(io, {
    auth: {
      admins: [{ id: 'LM-111111', email: 'me@example.com', fullName: 'Me Mentor', role: 'admin' }],
    },
  });
  const spoof = await engine.joinProgram(
    { adminId: 'LM-111111', role: 'admin', email: 'me@example.com' },
    {
      firstName: 'Me',
      lastName: 'Mentor',
      email: 'me@example.com',
      phone: '0821111111',
      adminId: 'LM-004821',
      acceptTerms: true,
      totalEarned: 999999,
    },
  );
  assert.equal(spoof.ok, false);
  const joined = await engine.joinProgram(
    { adminId: 'LM-111111', role: 'admin', email: 'me@example.com' },
    {
      firstName: 'Me',
      lastName: 'Mentor',
      email: 'me@example.com',
      phone: '0821111111',
      adminId: 'LM-111111',
      acceptTerms: true,
      totalEarned: 999999,
    },
  );
  assert.equal(joined.profile.status, 'pending');
  assert.equal(joined.profile.totalEarned, undefined);
  assert.equal(joined.profile.rateOverride, null);
  const profile = await io.read('lumo/commissionProfiles/LM-111111');
  assert.equal(profile.totalEarned, undefined);
  assert.equal(profile.status, 'pending');
  assert.equal(profile.rateOverride, null);
});

test('Manage All ranks multiple earners by earnings after commissions are recorded', async () => {
  const io = createMemoryIo();
  const engine = createCommissionEngine(io);
  const clients = [
    paidClient('john1@example.com'),
    paidClient('john2@example.com'),
    paidClient('mike1@example.com'),
  ];
  const vault = [
    assignedLicense('john1@example.com', 'LM-JOHN', 'LUMO-JOHN-KEY1-AAAA'),
    assignedLicense('john2@example.com', 'LM-JOHN', 'LUMO-JOHN-KEY2-AAAA'),
    assignedLicense('mike1@example.com', 'LM-MIKE', 'LUMO-MIKE-KEY1-AAAA'),
  ];
  await seedBase(io, {
    auth: {
      admins: [
        { id: 'LM-JOHN', email: 'john@example.com', fullName: 'John', role: 'admin' },
        { id: 'LM-MIKE', email: 'mike@example.com', fullName: 'Mike', role: 'admin' },
        { id: 'LM-SARAH', email: 'sarah@example.com', fullName: 'Sarah', role: 'admin' },
      ],
    },
    clients,
    vault,
  });
  await engine.setProfileStatus('LM-JOHN', 'active', { actorId: 'LM-004821' });
  await engine.setProfileStatus('LM-MIKE', 'active', { actorId: 'LM-004821' });
  await engine.setProfileStatus('LM-SARAH', 'active', { actorId: 'LM-004821' });
  await engine.tryQualify({ email: 'john1@example.com' });
  await engine.tryQualify({ email: 'john2@example.com' });
  await engine.tryQualify({ email: 'mike1@example.com' });
  const overview = await engine.getAdminOverview();
  assert.deepEqual(
    overview.earners.map((row) => row.fullName),
    ['John', 'Mike', 'Sarah'],
  );
  assert.equal(overview.earners[0].totals.totalEarned, 100);
  assert.equal(overview.earners[1].totals.totalEarned, 50);
  assert.equal(overview.earners[2].totals.totalEarned, 0);
  assert.equal(overview.dashboard.topEarner.fullName, 'John');
  const duplicate = await engine.tryQualify({ email: 'john1@example.com' });
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.reason, 'already_exists');
  const after = await engine.getMentorSummary('LM-JOHN');
  assert.equal(after.totals.totalEarned, 100);
  assert.equal(after.commissions.length, 2);
});

test('Inactive earners stop qualifying and Super Admin can change a personal rate', async () => {
  const io = createMemoryIo();
  const engine = createCommissionEngine(io);
  await seedBase(io, {
    clients: [paidClient('rate.a@example.com'), paidClient('rate.b@example.com')],
    vault: [
      assignedLicense('rate.a@example.com', 'LM-111111', 'LUMO-RATE-KEY1-AAAA'),
      assignedLicense('rate.b@example.com', 'LM-111111', 'LUMO-RATE-KEY2-AAAA'),
    ],
  });
  const first = await engine.tryQualify({ email: 'rate.a@example.com' });
  assert.equal(first.created, true);
  assert.equal(first.commission.amount, 50);
  await engine.setProfileRate('LM-111111', 80, { actorId: 'LM-004821' });
  await engine.setProfileStatus('LM-111111', 'inactive', { actorId: 'LM-004821' });
  const blocked = await engine.tryQualify({ email: 'rate.b@example.com' });
  assert.equal(blocked.created, false);
  await engine.setProfileStatus('LM-111111', 'active', { actorId: 'LM-004821' });
  const second = await engine.tryQualify({ email: 'rate.b@example.com' });
  assert.equal(second.created, true);
  assert.equal(second.commission.amount, 80);
  const paid = await engine.markCommissionPaid(second.commission.eventId, { actorId: 'LM-004821' });
  assert.equal(paid.commission.status, 'paid');
  const summary = await engine.getMentorSummary('LM-111111');
  assert.equal(summary.totals.paidOut, 80);
});

test('Super Admin can edit a commission amount a person already has', async () => {
  const io = createMemoryIo();
  const engine = createCommissionEngine(io);
  await seedBase(io, {
    clients: [paidClient('edit.me@example.com')],
    vault: [assignedLicense('edit.me@example.com', 'LM-111111', 'LUMO-EDIT-KEY1-AAAA')],
  });
  const created = await engine.tryQualify({ email: 'edit.me@example.com' });
  assert.equal(created.commission.amount, 50);
  const missingReason = await engine.updateCommissionAmount(created.commission.eventId, 120, {
    actorId: 'LM-004821',
  });
  assert.equal(missingReason.ok, false);
  const updated = await engine.updateCommissionAmount(created.commission.eventId, 120, {
    actorId: 'LM-004821',
    reason: 'Corrected Super Admin dashboard amount',
  });
  assert.equal(updated.ok, true);
  assert.equal(updated.commission.amount, 120);
  const summary = await engine.getMentorSummary('LM-111111');
  assert.equal(summary.totals.totalEarned, 120);
});

test('Regular admin cannot read another earner via mentorGuard', () => {
  const denied = mentorGuard({ ok: true, adminId: 'LM-111111', role: 'admin' }, 'LM-222222');
  assert.equal(denied.ok, false);
});

test('Existing earners stay enrolled and cannot pending-lock themselves via Join', async () => {
  const io = createMemoryIo();
  const engine = createCommissionEngine(io);
  await seedBase(io, {
    clients: [paidClient('keep.earning@example.com')],
    vault: [assignedLicense('keep.earning@example.com', 'LM-111111', 'LUMO-KEEP-KEY1-AAAA')],
  });
  await engine.tryQualify({ email: 'keep.earning@example.com' });
  const summary = await engine.getMentorSummary('LM-111111');
  assert.equal(summary.enrollment.status, 'active');
  assert.equal(summary.enrollment.canJoin, false);
  assert.equal(summary.enrollment.canEarn, true);
  const joined = await engine.joinProgram(
    { adminId: 'LM-111111', role: 'admin', email: 'keep@example.com' },
    {
      firstName: 'Keep',
      lastName: 'Earning',
      email: 'keep@example.com',
      phone: '0822222222',
      adminId: 'LM-111111',
      acceptTerms: true,
      status: 'pending',
      rateOverride: 999,
    },
  );
  assert.equal(joined.ok, false);
  const still = await engine.getMentorSummary('LM-111111');
  assert.equal(still.totals.totalEarned, 50);
  assert.equal(still.enrollment.canEarn, true);
});

test('Join uses the applicant mentor name automatically, not Super Admin names', async () => {
  const io = createMemoryIo();
  const engine = createCommissionEngine(io);
  await seedBase(io, {
    auth: {
      admins: [
        {
          id: 'LM-585290',
          email: 'mentor.m@example.com',
          fullName: 'M',
          mentorName: 'M Signals',
          phone: '0825550000',
          role: 'admin',
        },
      ],
    },
  });
  const joined = await engine.joinProgram(
    { adminId: 'LM-585290', role: 'admin', email: 'mentor.m@example.com' },
    {
      adminId: 'LM-585290',
      acceptTerms: true,
    },
  );
  assert.equal(joined.ok, true);
  assert.equal(joined.profile.mentorName, 'M Signals');
  assert.equal(joined.profile.fullName, 'M Signals');
  assert.notEqual(joined.profile.fullName, 'Mukundi');
  assert.equal(joined.profile.email, 'mentor.m@example.com');
});

test('Join body cannot self-activate or set a personal rate', async () => {
  const io = createMemoryIo();
  const engine = createCommissionEngine(io);
  await seedBase(io, {
    auth: { admins: [{ id: 'LM-777777', email: 'new@example.com', fullName: 'New Admin', role: 'admin' }] },
  });
  const joined = await engine.joinProgram(
    { adminId: 'LM-777777', role: 'admin', email: 'new@example.com' },
    {
      firstName: 'New',
      lastName: 'Admin',
      email: 'new@example.com',
      phone: '0830000000',
      adminId: 'LM-777777',
      acceptTerms: true,
      status: 'active',
      rateOverride: 5000,
      commissionPerReferral: 5000,
    },
  );
  assert.equal(joined.ok, true);
  assert.equal(joined.profile.status, 'pending');
  assert.equal(joined.profile.rateOverride, null);
  const auth = await io.read('lumo/auth');
  assert.equal(auth.admins[0].role, 'admin');
});
