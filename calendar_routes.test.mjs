import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleCalendarRoutes, parseAdminSignalPath } from './api/_lib/calendarRoutes.mjs';

function json(res, status, body) {
  res.statusCode = status;
  res.body = body;
}

function createEngineSpy() {
  const calls = [];
  return {
    calls,
    async listStudentCalendar(email, licenseKey) {
      calls.push(['listStudentCalendar', email, licenseKey]);
      if (email === 'bull@student.com') {
        return { ok: true, signals: [{ id: 'sig-1', symbol: 'XAUUSD' }], events: [] };
      }
      if (email === 'other@student.com') {
        return { ok: true, signals: [], events: [] };
      }
      return { ok: false, error: 'User does not have an active license' };
    },
    async executeSignal(body) {
      calls.push(['executeSignal', body]);
      if (body?.email === 'other@student.com') {
        return { ok: false, error: 'Signal does not belong to your EA/Bot' };
      }
      if (body?.expired) return { ok: false, error: 'Signal has expired' };
      return { ok: true, execution: { id: 'ex-1' } };
    },
    async listBots() {
      calls.push(['listBots']);
      return [{ id: 'ea-unlimited-bull', name: 'Unlimited Bull' }];
    },
    async createSignal(body, actorId) {
      calls.push(['createSignal', body, actorId]);
      return { ok: true, signal: { id: 'sig-1', ...body } };
    },
    async listAdminSignals(query) {
      calls.push(['listAdminSignals', query]);
      return [{ id: 'sig-1', botName: 'Unlimited Bull' }];
    },
    async setSignalStatus(id, status, actorId) {
      calls.push(['setSignalStatus', id, status, actorId]);
      return { ok: true, signal: { id, status } };
    },
  };
}

async function callRoute({ method, path, session, body, engine }) {
  const res = { statusCode: 0, body: null };
  const handled = await handleCalendarRoutes(
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

test('admin signal path parsing keeps ids intact', () => {
  assert.deepEqual(parseAdminSignalPath('/api/calendar/admin/signals/sig-1'), {
    id: 'sig-1',
    action: '',
  });
  assert.equal(parseAdminSignalPath('/api/calendar/admin/signals/sig-1/publish').action, 'publish');
  assert.equal(parseAdminSignalPath('/api/calendar/admin/signals/sig-1/deactivate').action, 'deactivate');
});

test('students can load their calendar but mentors cannot manage signals', async () => {
  const engine = createEngineSpy();
  const student = await callRoute({
    method: 'GET',
    path: '/api/calendar?email=bull@student.com&licenseKey=LUMO-BULL-TEST-AAAA',
    engine,
  });
  assert.equal(student.statusCode, 200);
  assert.equal(student.body.signals.length, 1);

  const mentor = await callRoute({
    method: 'POST',
    path: '/api/calendar/admin/signals',
    session: { ok: true, role: 'admin', adminId: 'LM-111111' },
    body: { eventName: 'NFP' },
    engine,
  });
  assert.equal(mentor.statusCode, 403);
  assert.equal(engine.calls.some((call) => call[0] === 'createSignal'), false);
});

test('only Super Admin can create and publish a signal', async () => {
  const engine = createEngineSpy();
  const unauth = await callRoute({
    method: 'POST',
    path: '/api/calendar/admin/signals',
    session: { ok: false, error: 'unauthorized' },
    body: { eventName: 'NFP' },
    engine,
  });
  assert.equal(unauth.statusCode, 401);

  const created = await callRoute({
    method: 'POST',
    path: '/api/calendar/admin/signals',
    session: { ok: true, role: 'super', adminId: 'LM-004821' },
    body: { eventName: 'NFP', botId: 'Unlimited Bull', symbol: 'XAUUSD', direction: 'BUY' },
    engine,
  });
  assert.equal(created.statusCode, 201);
  const published = await callRoute({
    method: 'POST',
    path: '/api/calendar/admin/signals/sig-1/publish',
    session: { ok: true, role: 'super', adminId: 'LM-004821' },
    engine,
  });
  assert.equal(published.statusCode, 200);
  assert.deepEqual(engine.calls.find((call) => call[0] === 'setSignalStatus'), [
    'setSignalStatus',
    'sig-1',
    'published',
    'LM-004821',
  ]);
});

test('backend rejects unauthorized execute and isolation bypass', async () => {
  const engine = createEngineSpy();
  const other = await callRoute({
    method: 'POST',
    path: '/api/calendar/execute',
    body: {
      email: 'other@student.com',
      licenseKey: 'LUMO-OTHR-TEST-BBBB',
      signalId: 'sig-1',
      mt5Id: 'mt5',
    },
    engine,
  });
  assert.equal(other.statusCode, 403);
  assert.match(other.body.error, /EA\/Bot/i);

  const noLicense = await callRoute({
    method: 'GET',
    path: '/api/calendar?email=ghost@student.com&licenseKey=NOPE',
    engine,
  });
  assert.equal(noLicense.statusCode, 403);
});
