import { requireSuper, verifyAdminSession } from './adminSession.mjs';
import { firebaseRead, firebaseWrite } from './clientMerge.mjs';
import { defaultEngine } from './commissionEngine.mjs';

function queryOf(req) {
  try {
    const host = req.headers?.host || 'localhost';
    const url = new URL(req.url || '/', `https://${host}`);
    return url.searchParams;
  } catch {
    return new URLSearchParams();
  }
}

async function sessionOrReject(req, res, json) {
  const session = await verifyAdminSession(req, { read: firebaseRead, write: firebaseWrite });
  if (!session.ok) {
    json(res, 401, { ok: false, error: session.error || 'unauthorized' });
    return null;
  }
  return session;
}

export function mentorGuard(session, requestedMentorId) {
  const requested = String(requestedMentorId || '').trim();
  if (!requested) return { ok: true, mentorId: session.adminId };
  if (session.role === 'super') return { ok: true, mentorId: requested };
  if (requested !== session.adminId) return { ok: false, error: 'Access denied' };
  return { ok: true, mentorId: session.adminId };
}

export async function handleCommissionRoutes(req, res, { json, readBody, pathname }) {
  const path = String(pathname || '').replace(/\/+$/, '') || '/';
  if (!path.startsWith('/api/commissions') && path !== '/api/auth/session') return false;

  if (path === '/api/auth/session' && req.method === 'POST') {
    return false;
  }

  const session = await sessionOrReject(req, res, json);
  if (!session) return true;

  if (path === '/api/commissions/me' && req.method === 'GET') {
    const q = queryOf(req);
    const guard = mentorGuard(session, q.get('mentorId'));
    if (!guard.ok) {
      json(res, 403, { ok: false, error: guard.error });
      return true;
    }
    const summary = await defaultEngine.getMentorSummary(guard.mentorId);
    json(res, 200, {
      ok: true,
      ...summary,
      role: session.role,
      canManageAll: session.role === 'super',
      viewerId: session.adminId,
    });
    return true;
  }

  if (path === '/api/commissions/join' && req.method === 'POST') {
    const body = await readBody(req);
    const result = await defaultEngine.joinProgram(session, body || {});
    json(res, result.ok ? 201 : 400, result);
    return true;
  }

  if (path === '/api/commissions/payout-details' && req.method === 'PUT') {
    const body = await readBody(req);
    const guard = mentorGuard(session, body?.mentorId);
    if (!guard.ok) {
      json(res, 403, { ok: false, error: guard.error });
      return true;
    }
    const result = await defaultEngine.savePayoutDetails(guard.mentorId, body || {});
    json(res, result.ok ? 200 : 400, result);
    return true;
  }

  if (path === '/api/commissions/payouts' && req.method === 'POST') {
    const body = await readBody(req);
    const guard = mentorGuard(session, body?.mentorId);
    if (!guard.ok) {
      json(res, 403, { ok: false, error: guard.error });
      return true;
    }
    const result = await defaultEngine.requestPayout(guard.mentorId);
    json(res, result.ok ? 201 : 400, result);
    return true;
  }

  if (path === '/api/commissions/settings' && req.method === 'GET') {
    const settings = await defaultEngine.ensureSettings();
    if (session.role !== 'super') {
      json(res, 200, {
        ok: true,
        settings: {
          commissionPerReferral: settings.commissionPerReferral,
          minimumQualifyingReferrals: settings.minimumQualifyingReferrals,
          withdrawalEnabled: settings.withdrawalEnabled,
          currency: settings.currency,
        },
      });
      return true;
    }
    json(res, 200, { ok: true, settings });
    return true;
  }

  if (path === '/api/commissions/settings' && req.method === 'PUT') {
    if (!requireSuper(session)) {
      json(res, 403, { ok: false, error: 'Access denied' });
      return true;
    }
    const body = await readBody(req);
    const settings = await defaultEngine.writeSettings(body || {}, session.adminId);
    json(res, 200, { ok: true, settings });
    return true;
  }

  if (path === '/api/commissions/admin' && req.method === 'GET') {
    if (!requireSuper(session)) {
      json(res, 403, { ok: false, error: 'Access denied' });
      return true;
    }
    const q = queryOf(req);
    const overview = await defaultEngine.getAdminOverview({
      mentorQuery: q.get('mentor') || q.get('q') || '',
      referenceQuery: q.get('reference') || q.get('ref') || '',
      status: q.get('status') || '',
      from: q.get('from') || '',
      to: q.get('to') || '',
      filter: q.get('filter') || 'all',
    });
    json(res, 200, { ok: true, ...overview });
    return true;
  }

  const profileGet = path.match(/^\/api\/commissions\/admin\/mentors\/([^/]+)$/);
  if (profileGet && req.method === 'GET') {
    if (!requireSuper(session)) {
      json(res, 403, { ok: false, error: 'Access denied' });
      return true;
    }
    const mentorId = decodeURIComponent(profileGet[1]);
    const result = await defaultEngine.getEarnerProfile(mentorId);
    json(res, result.ok ? 200 : 404, result);
    return true;
  }

  const applicationAction = path.match(
    /^\/api\/commissions\/admin\/applications\/([^/]+)\/(approve|reject)$/,
  );
  if (applicationAction && req.method === 'POST') {
    if (!requireSuper(session)) {
      json(res, 403, { ok: false, error: 'Access denied' });
      return true;
    }
    const mentorId = decodeURIComponent(applicationAction[1]);
    const action = applicationAction[2];
    const body = await readBody(req);
    const result = await defaultEngine.reviewApplication(mentorId, action, {
      actorId: session.adminId,
      reason: body?.reason,
    });
    json(res, result.ok ? 200 : 400, result);
    return true;
  }

  const profileStatus = path.match(
    /^\/api\/commissions\/admin\/profiles\/([^/]+)\/(activate|deactivate)$/,
  );
  if (profileStatus && req.method === 'POST') {
    if (!requireSuper(session)) {
      json(res, 403, { ok: false, error: 'Access denied' });
      return true;
    }
    const mentorId = decodeURIComponent(profileStatus[1]);
    const action = profileStatus[2];
    const body = await readBody(req);
    const result = await defaultEngine.setProfileStatus(
      mentorId,
      action === 'activate' ? 'active' : 'inactive',
      { actorId: session.adminId, reason: body?.reason },
    );
    json(res, result.ok ? 200 : 400, result);
    return true;
  }

  const profileRate = path.match(/^\/api\/commissions\/admin\/profiles\/([^/]+)\/rate$/);
  if (profileRate && req.method === 'PUT') {
    if (!requireSuper(session)) {
      json(res, 403, { ok: false, error: 'Access denied' });
      return true;
    }
    const mentorId = decodeURIComponent(profileRate[1]);
    const body = await readBody(req);
    const result = await defaultEngine.setProfileRate(mentorId, body?.rate ?? body?.commissionPerReferral, {
      actorId: session.adminId,
    });
    json(res, result.ok ? 200 : 400, result);
    return true;
  }

  const markPaid = path.match(/^\/api\/commissions\/admin\/commissions\/([^/]+)\/paid$/);
  if (markPaid && req.method === 'POST') {
    if (!requireSuper(session)) {
      json(res, 403, { ok: false, error: 'Access denied' });
      return true;
    }
    const eventId = decodeURIComponent(markPaid[1]);
    const result = await defaultEngine.markCommissionPaid(eventId, { actorId: session.adminId });
    json(res, result.ok ? 200 : 400, result);
    return true;
  }

  if (path === '/api/commissions/admin/audit' && req.method === 'GET') {
    if (!requireSuper(session)) {
      json(res, 403, { ok: false, error: 'Access denied' });
      return true;
    }
    json(res, 200, { ok: true, audit: await defaultEngine.getAudit() });
    return true;
  }

  if (path === '/api/commissions/admin/reverse' && req.method === 'POST') {
    if (!requireSuper(session)) {
      json(res, 403, { ok: false, error: 'Access denied' });
      return true;
    }
    const body = await readBody(req);
    const result = await defaultEngine.tryReverse({
      email: body?.email,
      eventId: body?.eventId || body?.commissionId,
      reason: body?.reason,
      actorId: session.adminId,
    });
    json(res, result.ok ? 200 : 400, result);
    return true;
  }

  if (path === '/api/commissions/admin/adjust' && req.method === 'POST') {
    if (!requireSuper(session)) {
      json(res, 403, { ok: false, error: 'Access denied' });
      return true;
    }
    const body = await readBody(req);
    const result = await defaultEngine.addAdjustment({
      mentorId: String(body?.mentorId || '').trim(),
      amount: body?.amount,
      reason: body?.reason,
      actorId: session.adminId,
    });
    json(res, result.ok ? 201 : 400, result);
    return true;
  }

  const payoutAction = path.match(/^\/api\/commissions\/admin\/payouts\/([^/]+)\/(approve|paid|reject)$/);
  if (payoutAction && req.method === 'POST') {
    if (!requireSuper(session)) {
      json(res, 403, { ok: false, error: 'Access denied' });
      return true;
    }
    const payoutId = decodeURIComponent(payoutAction[1]);
    const action = payoutAction[2];
    const body = await readBody(req);
    const result = await defaultEngine.processPayout(payoutId, action, {
      actorId: session.adminId,
      reason: body?.reason,
      notes: body?.notes || body?.adminNotes,
    });
    json(res, result.ok ? 200 : 400, result);
    return true;
  }

  return false;
}

export { requireSuper, verifyAdminSession };
