import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  connectMt5Broker,
  DEFAULT_MT5_API_BASE,
  mapMt5Operation,
  rewriteMt5Path,
} from './api/_lib/mt5Bridge.mjs';
import { handleApi } from './api/_lib/handlers.mjs';

test('MT5 connect requires login, password, and server', async () => {
  const missing = await connectMt5Broker({ user: '', password: 'x', server: 'RazorMarkets-Live' });
  assert.equal(missing.ok, false);
  assert.match(missing.error, /login|password|server/i);
});

test('POST /api/mt5/connect is handled locally instead of proxying a 405', async () => {
  const res = {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(key, value) {
      this.headers[key] = value;
    },
    end(chunk) {
      this.body = String(chunk || '');
    },
  };
  const req = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify({ user: '', password: '', server: '' }));
    },
  };
  const handled = await handleApi(req, res, '/api/mt5/connect');
  assert.equal(handled, true);
  assert.notEqual(res.statusCode, 405);
  const payload = JSON.parse(res.body || '{}');
  assert.equal(payload.error != null, true);
});

test('new MT5 host keeps the old Lumo routes working', () => {
  assert.equal(DEFAULT_MT5_API_BASE, 'http://159.203.191.196');
  assert.equal(mapMt5Operation('Buy'), '0');
  assert.equal(mapMt5Operation('SELL'), '1');
  assert.equal(mapMt5Operation('0'), '0');
  assert.equal(
    rewriteMt5Path('/OrderSend?id=abc&symbol=XAUUSD&operation=Buy&volume=0.01'),
    '/OrderSendSafe?id=abc&symbol=XAUUSD&operation=0&volume=0.01',
  );
  assert.equal(rewriteMt5Path('/CheckConnect?id=abc'), '/CheckConnect?id=abc');
  assert.equal(rewriteMt5Path('/OrderClose?id=abc&ticket=1'), '/OrderCloseSafe?id=abc&ticket=1');
});
