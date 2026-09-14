import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleCommissionRoutes, mentorGuard, requireSuper } from './api/_lib/commissionRoutes.mjs';

function json(res, status, body) {
  res.statusCode = status;
  res.body = body;
}

function createEngineSpy() {
  const calls = [];
  const engine = {
    calls,
    async getMentorSummary(mentorId) {
      calls.push(['getMentorSummary', mentorId]);
      return {
        mentorId,
        totals: { totalEarned: 10, paidOut: 0, pending: 0, qualifyingReferrals: 1 },
        commissions: [],
        payouts: [],
        enrollment: { canJoin: true, status: 'none' },
        settings: { currency: 'ZAR', commissionPerReferral: 50 },
      };
    },
    async getAdminOverview() {
      calls.push(['getAdminOverview']);
      return {
        earners: [
          { rank: 1, mentorId: 'LM-JOHN', fullName: 'John', totals: { totalEarned: 12500 } },
          { rank: 2, mentorId: 'LM-MIKE', fullName: 'Mike', totals: { totalEarned: 8400 } },
        ],
        dashboard: { totalEarners: 2, topEarner: { fullName: 'John', totalEarned: 12500 } },
        sort: 'totalEarned_desc',
      };
    },
    async joinProgram(session, body) {
      calls.push(['joinProgram', session.adminId, body]);
      return { ok: true, profile: { mentorId: session.adminId, status: 'pending' }, roleUnchanged: true };
    },
    async writeSettings() {
      calls.push(['writeSettings']);
      return { commissionPerReferral: 50 };
    },
    async ensureSettings() {
      return { commissionPerReferral: 50, currency: 'ZAR' };
    },
    async markCommissionPaid() {
      calls.push(['markCommissionPaid']);
      return { ok: true };
    },
    async getEarnerProfile(id) {
      calls.push(['getEarnerProfile', id]);
      return { ok: true, profile: { mentorId: id, totals: { totalEarned: 100 } } };
    },
  };
  return engine;
}

async function callRoute({ method, path, session, body, engine }) {
  const res = { statusCode: 0, body: null };
  const handled = await handleCommissionRoutes(
    { method, url: path, headers: {} },
    res,
    {
      json,
      readBody: async () => body || {},
      pathname: path.split('?')[0],
      engine,
      verifySession: async () => session,
    },
  );
  return { handled, ...res };
}

test('Regular admin can load My Earnings but cannot open Manage All data', async () => {
  const engine = createEngineSpy();
  const session = { ok: true, adminId: 'LM-111111', role: 'admin', email: 'a@example.com' };
  const me = await callRoute({ method: 'GET', path: '/api/commissions/me', session, engine });
  assert.equal(me.statusCode, 200);
  assert.equal(me.body.canManageAll, false);
  assert.equal(me.body.viewerId, 'LM-111111');
  assert.equal(me.body.role, 'admin');

  const admin = await callRoute({ method: 'GET', path: '/api/commissions/admin', session, engine });
  assert.equal(admin.statusCode, 403);
  assert.equal(admin.body.error, 'Access denied');
  assert.equal(engine.calls.some((row) => row[0] === 'getAdminOverview'), false);

  const other = await callRoute({
    method: 'GET',
    path: '/api/commissions/me?mentorId=LM-222222',
    session,
    engine,
  });
  assert.equal(other.statusCode, 403);

  const rate = await callRoute({
    method: 'PUT',
    path: '/api/commissions/admin/profiles/LM-111111/rate',
    session,
    engine,
    body: { rate: 9000 },
  });
  assert.equal(rate.statusCode, 403);

  const paid = await callRoute({
    method: 'POST',
    path: '/api/commissions/admin/commissions/fp:abc/paid',
    session,
    engine,
  });
  assert.equal(paid.statusCode, 403);
  assert.equal(engine.calls.some((row) => row[0] === 'markCommissionPaid'), false);
});

test('Regular admin can join without becoming Super Admin; Super Admin can rank earners', async () => {
  const engine = createEngineSpy();
  const regular = { ok: true, adminId: 'LM-777777', role: 'admin', email: 'new@example.com' };
  const joined = await callRoute({
    method: 'POST',
    path: '/api/commissions/join',
    session: regular,
    engine,
    body: { firstName: 'New', lastName: 'Admin', acceptTerms: true, adminId: 'LM-777777' },
  });
  assert.equal(joined.statusCode, 201);
  assert.equal(joined.body.roleUnchanged, true);
  assert.equal(joined.body.profile.status, 'pending');
  assert.equal(requireSuper(regular), false);

  const superSession = { ok: true, adminId: 'LM-004821', role: 'super', email: 'super@example.com' };
  const overview = await callRoute({
    method: 'GET',
    path: '/api/commissions/admin',
    session: superSession,
    engine,
  });
  assert.equal(overview.statusCode, 200);
  assert.equal(overview.body.sort, 'totalEarned_desc');
  assert.equal(overview.body.earners[0].fullName, 'John');
  assert.equal(overview.body.earners[0].totals.totalEarned, 12500);
  assert.ok(overview.body.earners[0].totals.totalEarned > overview.body.earners[1].totals.totalEarned);

  const profile = await callRoute({
    method: 'GET',
    path: '/api/commissions/admin/mentors/LM-JOHN',
    session: superSession,
    engine,
  });
  assert.equal(profile.statusCode, 200);
  assert.equal(profile.body.profile.mentorId, 'LM-JOHN');
});

test('Missing session is unauthorized and mentorGuard still blocks ID tampering', async () => {
  const engine = createEngineSpy();
  const res = await callRoute({
    method: 'GET',
    path: '/api/commissions/me',
    session: { ok: false, error: 'unauthorized' },
    engine,
  });
  assert.equal(res.statusCode, 401);
  const denied = mentorGuard({ ok: true, adminId: 'LM-111111', role: 'admin' }, 'LM-999999');
  assert.equal(denied.ok, false);
});
