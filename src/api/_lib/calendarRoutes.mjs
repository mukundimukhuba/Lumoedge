import { requireSuper, verifyAdminSession } from './adminSession.mjs';
import { firebaseRead, firebaseWrite } from './clientMerge.mjs';
import { defaultEngine } from './calendarEngine.mjs';

function queryOf(req) {
  try {
    const host = req.headers?.host || 'localhost';
    const url = new URL(req.url || '/', `https://${host}`);
    return url.searchParams;
  } catch {
    return new URLSearchParams();
  }
}

function parseAdminSignalPath(path) {
  const m = String(path || '').match(
    /^\/api\/calendar\/admin\/signals\/([^/]+)(?:\/(publish|deactivate))?$/,
  );
  if (!m) return null;
  return { id: decodeURIComponent(m[1]), action: m[2] || '' };
}

export async function handleCalendarRoutes(req, res, ctx) {
  const {
    json,
    readBody,
    pathname,
    engine = defaultEngine,
    verifySession = verifyAdminSession,
  } = ctx || {};
  const path = String(pathname || '').replace(/\/+$/, '') || '/';
  if (!path.startsWith('/api/calendar')) return false;

  const method = String(req.method || 'GET').toUpperCase();

  if (path === '/api/calendar' && method === 'GET') {
    const q = queryOf(req);
    const result = await engine.listStudentCalendar(q.get('email'), q.get('licenseKey'));
    json(res, result.ok ? 200 : 403, result);
    return true;
  }

  if (path === '/api/calendar/execute' && method === 'POST') {
    const body = await readBody(req);
    const result = await engine.executeSignal(body || {});
    const status = result.ok ? 200 : result.alreadyExecuted ? 409 : 403;
    json(res, status, result);
    return true;
  }

  if (!path.startsWith('/api/calendar/admin')) {
    json(res, 404, { ok: false, error: 'Not found' });
    return true;
  }

  const session = await verifySession(req, { read: firebaseRead, write: firebaseWrite });
  if (!session?.ok) {
    json(res, 401, { ok: false, error: session?.error || 'unauthorized' });
    return true;
  }
  if (!requireSuper(session)) {
    json(res, 403, { ok: false, error: 'Access denied' });
    return true;
  }

  if (path === '/api/calendar/admin/bots' && method === 'GET') {
    const bots = await engine.listBots();
    json(res, 200, { ok: true, bots });
    return true;
  }

  if (path === '/api/calendar/admin/events' && method === 'GET') {
    const events = engine.listUpcomingNews
      ? await engine.listUpcomingNews()
      : await engine.listEvents();
    json(res, 200, { ok: true, events });
    return true;
  }

  if (path === '/api/calendar/admin/events' && method === 'POST') {
    const body = await readBody(req);
    const result = await engine.upsertEvent(body || {}, session.adminId);
    json(res, result.ok ? 200 : 400, result);
    return true;
  }

  if (path === '/api/calendar/admin/signals' && method === 'GET') {
    const q = queryOf(req);
    const signals = await engine.listAdminSignals({
      botId: q.get('botId') || q.get('eaId') || '',
      view: q.get('view') || 'all',
    });
    json(res, 200, { ok: true, signals, serverNow: new Date().toISOString() });
    return true;
  }

  if (path === '/api/calendar/admin/signals' && method === 'POST') {
    const body = await readBody(req);
    const result = await engine.createSignal(body || {}, session.adminId);
    json(res, result.ok ? 201 : 400, result);
    return true;
  }

  if (path === '/api/calendar/admin/executions' && method === 'GET') {
    const q = queryOf(req);
    const executions = await engine.listExecutions(q.get('signalId') || '');
    json(res, 200, { ok: true, executions });
    return true;
  }

  const parsed = parseAdminSignalPath(path);
  if (parsed) {
    if (parsed.action === 'publish' && method === 'POST') {
      const result = await engine.setSignalStatus(parsed.id, 'published', session.adminId);
      json(res, result.ok ? 200 : 400, result);
      return true;
    }
    if (parsed.action === 'deactivate' && method === 'POST') {
      const result = await engine.setSignalStatus(parsed.id, 'inactive', session.adminId);
      json(res, result.ok ? 200 : 400, result);
      return true;
    }
    if (!parsed.action && method === 'PUT') {
      const body = await readBody(req);
      const result = await engine.updateSignal(parsed.id, body || {}, session.adminId);
      json(res, result.ok ? 200 : 400, result);
      return true;
    }
    if (!parsed.action && method === 'DELETE') {
      const result = await engine.deleteSignal(parsed.id);
      json(res, result.ok ? 200 : 400, result);
      return true;
    }
    if (!parsed.action && method === 'GET') {
      const signal = await engine.getSignal(parsed.id);
      if (!signal) {
        json(res, 404, { ok: false, error: 'Signal not found' });
        return true;
      }
      json(res, 200, { ok: true, signal });
      return true;
    }
  }

  json(res, 404, { ok: false, error: 'Not found' });
  return true;
}

export { parseAdminSignalPath };
