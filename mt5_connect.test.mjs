import assert from 'node:assert/strict';
import { test } from 'node:test';
import { connectMt5Broker } from './api/_lib/mt5Bridge.mjs';
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
