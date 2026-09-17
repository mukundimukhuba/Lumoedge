import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  botsMatch,
  createCalendarEngine,
  deriveSignalStatus,
  isValidSymbol,
  mt5Operation,
  normalizeDirection,
  optionalPrice,
} from './api/_lib/calendarEngine.mjs';
import {
  bakedNewsEvents,
  classifyUsdNewsTitle,
  detectUpcomingNews,
  fetchLiveNewsRows,
  newsFromLiveRows,
  TRACKED_NEWS,
} from './api/_lib/economicNews.mjs';

function createMemoryIo(now = '2026-09-16T14:00:00.000Z') {
  const root = {};
  let n = 0;
  let nowMs = Date.parse(now);
  return {
    nowMs: () => nowMs,
    nowIso: () => new Date(nowMs).toISOString(),
    setNow(value) {
      nowMs = typeof value === 'number' ? value : Date.parse(value);
    },
    id: () => `id_${(++n).toString(16)}`,
    orders: [],
    connectOk: true,
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
    async checkConnect() {
      return this.connectOk
        ? { ok: true }
        : { ok: false, error: 'Broker/MT5 connection is not active' };
    },
    async fetch() {
      return { ok: false, json: async () => [] };
    },
    async sendOrder(input) {
      this.orders.push(input);
      if (this.failOrder) return { ok: false, error: 'rejected by broker' };
      return { ok: true, ticket: `T${this.orders.length}` };
    },
  };
}

async function seedLicenses(io) {
  await io.write('lumo/store/workspaces/LM-004821', {
    eas: [{ id: 'ea-unlimited-bull', name: 'Unlimited Bull' }],
    profile: { eaDisplayName: 'Unlimited Bull' },
  });
  await io.write('lumo/vault', [
    {
      id: 'lic-bull',
      key: 'LUMO-BULL-TEST-AAAA',
      status: 'assigned',
      assignedEmail: 'bull@student.com',
      eaId: 'ea-unlimited-bull',
      eaName: 'Unlimited Bull',
      ownerAdminId: 'LM-111111',
    },
    {
      id: 'lic-other',
      key: 'LUMO-OTHR-TEST-BBBB',
      status: 'assigned',
      assignedEmail: 'other@student.com',
      eaId: 'ea-other',
      eaName: 'Other Bot',
      ownerAdminId: 'LM-222222',
    },
  ]);
}

test('direction, symbol, and optional TP/SL stay market-order safe', () => {
  assert.equal(normalizeDirection('buy'), 'BUY');
  assert.equal(normalizeDirection('SELL'), 'SELL');
  assert.equal(normalizeDirection('hold'), '');
  assert.equal(mt5Operation('BUY'), 'Buy');
  assert.equal(mt5Operation('SELL'), 'Sell');
  assert.equal(isValidSymbol('XAUUSD'), true);
  assert.equal(isValidSymbol('..'), false);
  assert.equal(optionalPrice('NONE'), null);
  assert.equal(optionalPrice(''), null);
  assert.equal(optionalPrice(0), null);
  assert.equal(optionalPrice(12.5), 12.5);
  assert.equal(botsMatch({ eaId: 'ea-unlimited-bull', eaName: 'Unlimited Bull' }, 'Unlimited Bull'), true);
  assert.equal(botsMatch({ eaId: 'ea-other', eaName: 'Other Bot' }, 'Unlimited Bull'), false);
});

test('published signals expire on server time without being deleted', async () => {
  const io = createMemoryIo('2026-09-16T14:30:00.000Z');
  const engine = createCalendarEngine(io);
  await seedLicenses(io);
  const created = await engine.createSignal(
    {
      eventName: 'NFP',
      date: '2026-09-16',
      time: '14:30',
      currency: 'USD',
      impact: 'HIGH',
      botId: 'ea-unlimited-bull',
      botName: 'Unlimited Bull',
      symbol: 'XAUUSD',
      direction: 'BUY',
      message: 'NFP BUY — Execute the news trade when the signal becomes active.',
      activationAt: '2026-09-16T14:30:00.000Z',
      expirationHours: 5,
      status: 'published',
    },
    'LM-004821',
  );
  assert.equal(created.ok, true);
  assert.equal(created.signal.takeProfit, null);
  assert.equal(created.signal.stopLoss, null);
  assert.equal(deriveSignalStatus(created.signal, Date.parse('2026-09-16T14:29:00.000Z')), 'upcoming');
  assert.equal(deriveSignalStatus(created.signal, Date.parse('2026-09-16T14:31:00.000Z')), 'active');

  io.setNow('2026-09-16T20:00:00.000Z');
  const listed = await engine.listAdminSignals({ view: 'expired' });
  assert.equal(listed.length, 1);
  assert.equal(listed[0].status, 'EXPIRED');
  const stored = await engine.getSignal(created.signal.id);
  assert.equal(stored.status, 'EXPIRED');
});

test('Unlimited Bull students see the signal and other EA students do not', async () => {
  const io = createMemoryIo('2026-09-16T14:31:00.000Z');
  const engine = createCalendarEngine(io);
  await seedLicenses(io);
  await engine.createSignal(
    {
      eventName: 'NFP',
      date: '2026-09-16',
      time: '14:30',
      currency: 'USD',
      impact: 'HIGH',
      botId: 'Unlimited Bull',
      botName: 'Unlimited Bull',
      symbol: 'XAUUSD',
      direction: 'BUY',
      activationAt: '2026-09-16T14:30:00.000Z',
      expirationAt: '2026-09-16T19:30:00.000Z',
      status: 'published',
    },
    'LM-004821',
  );

  const bull = await engine.listStudentCalendar('bull@student.com', 'LUMO-BULL-TEST-AAAA');
  assert.equal(bull.ok, true);
  assert.equal(bull.signals.length, 1);
  assert.equal(bull.signals[0].symbol, 'XAUUSD');
  assert.equal(bull.signals[0].direction, 'BUY');
  assert.equal(bull.events.some((event) => event.name === 'NFP'), true);

  const other = await engine.listStudentCalendar('other@student.com', 'LUMO-OTHR-TEST-BBBB');
  assert.equal(other.ok, true);
  assert.equal(other.signals.length, 0);
  assert.equal(other.events.some((event) => event.name === 'NFP'), true);
});

test('expired signals disappear from the student calendar and cannot execute', async () => {
  const io = createMemoryIo('2026-09-16T14:31:00.000Z');
  const engine = createCalendarEngine(io);
  await seedLicenses(io);
  const created = await engine.createSignal(
    {
      eventName: 'NFP',
      date: '2026-09-16',
      time: '14:30',
      currency: 'USD',
      botId: 'ea-unlimited-bull',
      botName: 'Unlimited Bull',
      symbol: 'XAUUSD',
      direction: 'SELL',
      activationAt: '2026-09-16T14:30:00.000Z',
      expirationAt: '2026-09-16T15:00:00.000Z',
      status: 'published',
    },
    'LM-004821',
  );
  io.setNow('2026-09-16T15:01:00.000Z');
  const calendar = await engine.listStudentCalendar('bull@student.com', 'LUMO-BULL-TEST-AAAA');
  assert.equal(calendar.signals.length, 0);
  const exec = await engine.executeSignal({
    email: 'bull@student.com',
    licenseKey: 'LUMO-BULL-TEST-AAAA',
    signalId: created.signal.id,
    mt5Id: 'mt5-token',
  });
  assert.equal(exec.ok, false);
  assert.match(exec.error, /expired/i);
});

test('BUY and SELL market orders omit TP/SL when none are set', async () => {
  const io = createMemoryIo('2026-09-16T14:31:00.000Z');
  const engine = createCalendarEngine(io);
  await seedLicenses(io);
  const buy = await engine.createSignal(
    {
      eventName: 'NFP',
      date: '2026-09-16',
      time: '14:30',
      botId: 'ea-unlimited-bull',
      botName: 'Unlimited Bull',
      symbol: 'XAUUSD',
      direction: 'BUY',
      activationAt: '2026-09-16T14:30:00.000Z',
      expirationAt: '2026-09-16T19:30:00.000Z',
      status: 'published',
    },
    'LM-004821',
  );
  const sell = await engine.createSignal(
    {
      eventName: 'CPI',
      date: '2026-09-16',
      time: '14:30',
      botId: 'ea-unlimited-bull',
      botName: 'Unlimited Bull',
      symbol: 'XAUUSD',
      direction: 'SELL',
      activationAt: '2026-09-16T14:30:00.000Z',
      expirationAt: '2026-09-16T19:30:00.000Z',
      status: 'published',
    },
    'LM-004821',
  );
  const buyExec = await engine.executeSignal({
    email: 'bull@student.com',
    licenseKey: 'LUMO-BULL-TEST-AAAA',
    signalId: buy.signal.id,
    mt5Id: 'mt5-token',
    volume: 0.01,
  });
  const sellExec = await engine.executeSignal({
    email: 'bull@student.com',
    licenseKey: 'LUMO-BULL-TEST-AAAA',
    signalId: sell.signal.id,
    mt5Id: 'mt5-token',
  });
  assert.equal(buyExec.ok, true);
  assert.equal(sellExec.ok, true);
  assert.equal(io.orders[0].operation, 'Buy');
  assert.equal(io.orders[1].operation, 'Sell');
  assert.equal(io.orders[0].takeProfit, null);
  assert.equal(io.orders[0].stopLoss, null);
  assert.equal(io.orders[0].symbol, 'XAUUSD');
});

test('duplicate execution is blocked and another EA cannot execute the signal', async () => {
  const io = createMemoryIo('2026-09-16T14:31:00.000Z');
  const engine = createCalendarEngine(io);
  await seedLicenses(io);
  const created = await engine.createSignal(
    {
      eventName: 'FOMC',
      date: '2026-09-16',
      time: '14:30',
      botId: 'ea-unlimited-bull',
      botName: 'Unlimited Bull',
      symbol: 'XAUUSD',
      direction: 'BUY',
      activationAt: '2026-09-16T14:30:00.000Z',
      expirationAt: '2026-09-16T19:30:00.000Z',
      status: 'published',
    },
    'LM-004821',
  );
  const first = await engine.executeSignal({
    email: 'bull@student.com',
    licenseKey: 'LUMO-BULL-TEST-AAAA',
    signalId: created.signal.id,
    mt5Id: 'mt5-token',
  });
  assert.equal(first.ok, true);
  const dup = await engine.executeSignal({
    email: 'bull@student.com',
    licenseKey: 'LUMO-BULL-TEST-AAAA',
    signalId: created.signal.id,
    mt5Id: 'mt5-token',
  });
  assert.equal(dup.ok, false);
  assert.equal(dup.error, 'TRADE ALREADY EXECUTED FOR THIS SIGNAL');
  const other = await engine.executeSignal({
    email: 'other@student.com',
    licenseKey: 'LUMO-OTHR-TEST-BBBB',
    signalId: created.signal.id,
    mt5Id: 'mt5-token',
  });
  assert.equal(other.ok, false);
  assert.match(other.error, /EA/i);
});

test('students without an active license or MT5 connection cannot execute', async () => {
  const io = createMemoryIo('2026-09-16T14:31:00.000Z');
  const engine = createCalendarEngine(io);
  await seedLicenses(io);
  const created = await engine.createSignal(
    {
      eventName: 'NFP',
      date: '2026-09-16',
      time: '14:30',
      botId: 'ea-unlimited-bull',
      botName: 'Unlimited Bull',
      symbol: 'XAUUSD',
      direction: 'BUY',
      activationAt: '2026-09-16T14:30:00.000Z',
      expirationAt: '2026-09-16T19:30:00.000Z',
      status: 'published',
    },
    'LM-004821',
  );
  const noLicense = await engine.executeSignal({
    email: 'ghost@student.com',
    licenseKey: 'LUMO-FAKE-TEST-ZZZZ',
    signalId: created.signal.id,
    mt5Id: 'mt5-token',
  });
  assert.equal(noLicense.ok, false);
  io.connectOk = false;
  const noMt5 = await engine.executeSignal({
    email: 'bull@student.com',
    licenseKey: 'LUMO-BULL-TEST-AAAA',
    signalId: created.signal.id,
    mt5Id: 'mt5-token',
  });
  assert.equal(noMt5.ok, false);
  assert.match(noMt5.error, /MT5|Broker/i);
});

test('calendar uses Super Admin EA only and publishes without choosing a bot', async () => {
  const io = createMemoryIo('2026-09-16T14:31:00.000Z');
  const engine = createCalendarEngine(io);
  await seedLicenses(io);
  const bots = await engine.listBots();
  assert.deepEqual(bots, [{ id: 'ea-unlimited-bull', name: 'Unlimited Bull' }]);
  const created = await engine.createSignal(
    {
      eventName: 'NFP',
      date: '2026-09-16',
      time: '14:30',
      symbol: 'XAUUSD',
      direction: 'BUY',
      botId: 'Other Bot',
      botName: 'Other Bot',
    },
    'LM-004821',
  );
  assert.equal(created.ok, true);
  assert.equal(created.signal.botId, 'ea-unlimited-bull');
  assert.equal(created.signal.botName, 'Unlimited Bull');
  assert.equal(created.signal.status, 'published');
  const bull = await engine.listStudentCalendar('bull@student.com', 'LUMO-BULL-TEST-AAAA');
  assert.equal(bull.signals.length, 1);
  const other = await engine.listStudentCalendar('other@student.com', 'LUMO-OTHR-TEST-BBBB');
  assert.equal(other.signals.length, 0);
});

test('Super-owned license becomes the calendar EA without a bot picker', async () => {
  const io = createMemoryIo('2026-09-16T14:31:00.000Z');
  const engine = createCalendarEngine(io);
  await io.write('lumo/vault', [
    {
      id: 'lic-super',
      key: 'LUMO-MINE-TEST-AAAA',
      status: 'assigned',
      assignedEmail: 'mine@student.com',
      eaId: 'ea-mine',
      eaName: 'My Private EA',
      ownerAdminId: 'LM-004821',
    },
  ]);
  const created = await engine.createSignal(
    {
      eventName: 'CPI',
      date: '2026-09-16',
      time: '14:30',
      symbol: 'XAUUSD',
      direction: 'SELL',
    },
    'LM-004821',
  );
  assert.equal(created.signal.botName, 'My Private EA');
  assert.equal(created.signal.status, 'published');
  const mine = await engine.listStudentCalendar('mine@student.com', 'LUMO-MINE-TEST-AAAA');
  assert.equal(mine.ok, true);
  assert.equal(mine.signals.length, 1);
});

test('fallback Super EA publishes when Super has no licenses yet', async () => {
  const io = createMemoryIo('2026-09-16T14:31:00.000Z');
  const engine = createCalendarEngine(io);
  const created = await engine.createSignal(
    {
      eventName: 'GDP',
      date: '2026-09-16',
      time: '14:30',
      symbol: 'XAUUSD',
      direction: 'BUY',
    },
    'LM-004821',
  );
  assert.equal(created.ok, true);
  assert.equal(created.signal.botId, 'ea-lumo-edge');
  assert.equal(created.signal.botName, 'Lumo Edge');
  assert.equal(created.signal.status, 'published');
  const bots = await engine.listBots();
  assert.equal(bots.length, 1);
  assert.equal(bots[0].name, 'Lumo Edge');
});

test('only USD NFP, CPI, PPI, and FOMC titles count as tracked news', () => {
  assert.equal(classifyUsdNewsTitle('Non-Farm Employment Change', 'USD'), 'NFP');
  assert.equal(classifyUsdNewsTitle('CPI m/m', 'USD'), 'CPI');
  assert.equal(classifyUsdNewsTitle('Producer Price Index', 'USD'), 'PPI');
  assert.equal(classifyUsdNewsTitle('FOMC Statement', 'USD'), 'FOMC');
  assert.equal(classifyUsdNewsTitle('Federal Funds Rate', 'USD'), 'FOMC');
  assert.equal(classifyUsdNewsTitle('CPI m/m', 'CAD'), '');
  assert.equal(classifyUsdNewsTitle('FOMC Member Bowman Speaks', 'USD'), '');
  assert.equal(classifyUsdNewsTitle('FOMC Minutes', 'USD'), '');
  assert.equal(classifyUsdNewsTitle('GDP', 'USD'), '');
  assert.deepEqual(TRACKED_NEWS, ['NFP', 'CPI', 'PPI', 'FOMC']);
});

test('upcoming detector keeps those four news types and ignores other countries', () => {
  const nowMs = Date.parse('2026-09-17T06:50:00.000Z');
  const baked = bakedNewsEvents(nowMs);
  assert.ok(baked.some((row) => row.name === 'NFP' && row.date === '2026-10-02'));
  assert.ok(baked.some((row) => row.name === 'CPI' && row.date === '2026-10-14'));
  assert.ok(baked.some((row) => row.name === 'PPI' && row.date === '2026-10-15'));
  assert.ok(baked.some((row) => row.name === 'FOMC' && row.date === '2026-10-28'));
  assert.equal(baked.some((row) => row.date === '2026-09-16'), false);
  const live = newsFromLiveRows(
    [
      { title: 'CPI m/m', country: 'CAD', date: '2026-10-14T08:30:00-04:00' },
      { title: 'FOMC Press Conference', country: 'USD', date: '2026-10-28T14:30:00-04:00' },
      { title: 'GDP', country: 'USD', date: '2026-10-29T08:30:00-04:00' },
    ],
    nowMs,
  );
  assert.deepEqual(live.map((row) => row.name), ['FOMC']);
});

test('students see upcoming NFP CPI PPI FOMC with no signal until Super sends one', async () => {
  const io = createMemoryIo('2026-09-17T06:50:00.000Z');
  io.fetch = async () => ({
    ok: true,
    json: async () => [
      { title: 'CPI m/m', country: 'CAD', date: '2026-09-17T08:30:00-04:00' },
      { title: 'FOMC Member Speaks', country: 'USD', date: '2026-09-18T09:30:00-04:00' },
    ],
  });
  const engine = createCalendarEngine(io);
  await seedLicenses(io);
  const calendar = await engine.listStudentCalendar('bull@student.com', 'LUMO-BULL-TEST-AAAA');
  assert.equal(calendar.ok, true);
  assert.equal(calendar.signals.length, 0);
  const names = [...new Set(calendar.events.map((row) => row.name))];
  assert.deepEqual(names.sort(), ['CPI', 'FOMC', 'NFP', 'PPI']);
  assert.ok(calendar.events.every((row) => ['NFP', 'CPI', 'PPI', 'FOMC'].includes(row.name)));
  assert.ok(calendar.events.some((row) => row.name === 'NFP' && row.date === '2026-10-02'));
  await io.write('lumo/economicEvents/cal_leftover', {
    id: 'cal_leftover',
    name: 'Fomc',
    date: '2026-09-17',
    time: '14:30',
    at: '2026-09-17T14:30:00.000Z',
  });
  const cleaned = await engine.listStudentCalendar('bull@student.com', 'LUMO-BULL-TEST-AAAA');
  assert.equal(cleaned.events.some((row) => row.id === 'cal_leftover'), false);
  assert.equal(cleaned.events.some((row) => row.date === '2026-09-17'), false);
  const nfp = calendar.events.find((row) => row.name === 'NFP' && row.date === '2026-10-02');
  const signal = await engine.createSignal(
    {
      eventId: nfp.id,
      eventName: 'NFP',
      date: nfp.date,
      time: nfp.time,
      symbol: 'XAUUSD',
      direction: 'BUY',
    },
    'LM-004821',
  );
  assert.equal(signal.ok, true);
  assert.equal(signal.event.id, nfp.id);
  const after = await engine.listStudentCalendar('bull@student.com', 'LUMO-BULL-TEST-AAAA');
  assert.equal(after.signals.length, 1);
  assert.equal(after.signals[0].eventId, nfp.id);
  assert.equal(after.events.filter((row) => row.name === 'CPI').every((row) => row.id !== after.signals[0].eventId), true);
});

test('live calendar fetch failure still shows the official upcoming schedule', async () => {
  const detected = await detectUpcomingNews({
    nowMs: Date.parse('2026-09-17T06:50:00.000Z'),
    fetchFn: async () => {
      throw new Error('offline');
    },
  });
  assert.ok(detected.some((row) => row.name === 'NFP'));
  assert.ok(detected.every((row) => ['NFP', 'CPI', 'PPI', 'FOMC'].includes(row.name)));
});

test('live Forex Factory times win over the baked schedule for the same news day', async () => {
  const nowMs = Date.parse('2026-09-17T08:00:00.000Z');
  const live = newsFromLiveRows(
    [{ title: 'Non-Farm Employment Change', country: 'USD', date: '2026-10-02T08:30:00-04:00' }],
    nowMs,
  );
  assert.equal(live.length, 1);
  assert.equal(live[0].name, 'NFP');
  assert.equal(live[0].source, 'live');
  assert.equal(live[0].time, '08:30');
  assert.equal(live[0].at, '2026-10-02T12:30:00.000Z');

  const original = globalThis.fetch;
  let called = 0;
  globalThis.fetch = async (url) => {
    called += 1;
    assert.match(String(url), /ff_calendar_thisweek\.json/);
    return {
      ok: true,
      json: async () => [
        { title: 'CPI m/m', country: 'USD', date: '2026-10-14T08:30:00-04:00' },
      ],
    };
  };
  try {
    const rows = await fetchLiveNewsRows();
    const detected = await detectUpcomingNews({ nowMs });
    assert.equal(called >= 2, true);
    assert.equal(rows[0].title, 'CPI m/m');
    const cpi = detected.find((row) => row.name === 'CPI' && row.date === '2026-10-14');
    assert.equal(cpi.source, 'live');
    assert.equal(cpi.at, '2026-10-14T12:30:00.000Z');
  } finally {
    globalThis.fetch = original;
  }
});

test('Deleting a Super signal removes the leftover event card from the student calendar', async () => {
  const io = createMemoryIo('2026-09-17T06:50:00.000Z');
  const engine = createCalendarEngine(io);
  await seedLicenses(io);
  const created = await engine.createSignal(
    {
      eventName: 'Fomc',
      date: '2026-09-17',
      time: '14:30',
      symbol: 'XAUUSD',
      direction: 'BUY',
      activationAt: '2026-09-17T14:30:00.000Z',
      expirationAt: '2026-09-17T19:30:00.000Z',
    },
    'LM-004821',
  );
  assert.equal(created.ok, true);
  assert.equal(created.event.id.startsWith('news-'), false);
  const before = await engine.listStudentCalendar('bull@student.com', 'LUMO-BULL-TEST-AAAA');
  assert.equal(before.signals.length, 1);
  const deleted = await engine.deleteSignal(created.signal.id);
  assert.equal(deleted.ok, true);
  assert.equal(await io.read(`lumo/economicSignals/${created.signal.id}`), null);
  assert.equal(await io.read(`lumo/economicEvents/${created.event.id}`), null);
  const after = await engine.listStudentCalendar('bull@student.com', 'LUMO-BULL-TEST-AAAA');
  assert.equal(after.signals.length, 0);
  assert.equal(after.events.some((row) => row.date === '2026-09-17'), false);
  assert.equal(after.events.some((row) => String(row.name).toLowerCase() === 'fomc' && row.date === '2026-09-17'), false);
});

test('Deactivating a Super signal also removes the leftover unofficial event card', async () => {
  const io = createMemoryIo('2026-09-17T06:50:00.000Z');
  const engine = createCalendarEngine(io);
  await seedLicenses(io);
  const created = await engine.createSignal(
    {
      eventName: 'Fomc',
      date: '2026-09-17',
      time: '14:30',
      symbol: 'XAUUSD',
      direction: 'BUY',
      activationAt: '2026-09-17T14:30:00.000Z',
      expirationAt: '2026-09-17T19:30:00.000Z',
    },
    'LM-004821',
  );
  assert.equal(created.ok, true);
  const stopped = await engine.setSignalStatus(created.signal.id, 'inactive', 'LM-004821');
  assert.equal(stopped.ok, true);
  assert.equal(await io.read(`lumo/economicEvents/${created.event.id}`), null);
  const after = await engine.listStudentCalendar('bull@student.com', 'LUMO-BULL-TEST-AAAA');
  assert.equal(after.signals.length, 0);
  assert.equal(after.events.some((row) => String(row.name).toLowerCase() === 'fomc' && row.date === '2026-09-17'), false);
});

