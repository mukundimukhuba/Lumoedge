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
    async sendOrder(input) {
      this.orders.push(input);
      if (this.failOrder) return { ok: false, error: 'rejected by broker' };
      return { ok: true, ticket: `T${this.orders.length}` };
    },
  };
}

async function seedLicenses(io) {
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
  assert.match(other.error, /EA\/Bot/i);
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
