import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildTelegramTradeMessage,
  isTelegramAlertLicenseKey,
  normalizeTelegramBotToken,
  normalizeTelegramChatId,
  resolveTelegramConfig,
  sendTelegramMessage,
} from './api/_lib/telegramNotify.mjs';
import { postTelegramTrade, saveTelegramAlerts } from './api/_lib/telegramRoutes.mjs';

test('bot token and chat id are normalized', () => {
  assert.equal(
    normalizeTelegramBotToken('https://api.telegram.org/bot123:ABC/sendMessage'),
    '123:ABC',
  );
  assert.equal(normalizeTelegramBotToken('bot123:ABC'), '123:ABC');
  assert.equal(normalizeTelegramChatId(' -1002117297165 '), '-1002117297165');
});

test('allowlist still recognizes the super-admin scanner keys', () => {
  assert.equal(isTelegramAlertLicenseKey('LUMO-JSDZ-8MC4-P4R3'), true);
  assert.equal(isTelegramAlertLicenseKey('lumojsdz8mc4p4r3'), true);
  assert.equal(isTelegramAlertLicenseKey('LUMO-XXXX-XXXX-XXXX'), false);
});

test('trade message includes side, symbol, and levels', () => {
  const text = buildTelegramTradeMessage({
    source: 'Chart Scanner Auto Trade',
    eaName: 'Unlimited bull',
    side: 'buy',
    symbol: 'XAUUSD',
    entry: '2350',
    stopLoss: '2345',
    takeProfit: '2360',
    volume: '0.01',
    trades: 2,
    accuracy: 88,
  });
  assert.match(text, /BUY XAUUSD/);
  assert.match(text, /Unlimited bull/);
  assert.match(text, /Lot: 0\.01/);
  assert.match(text, /Trades: 2/);
  assert.match(text, /Confidence: 88%/);
});

test('notify is skipped when the client turned Telegram off', async () => {
  const result = await postTelegramTrade(async () => null, { notify: false, symbol: 'XAUUSD' });
  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'notify_off');
});

test('notify posts to the mentor channel after credentials resolve', async () => {
  const reads = [];
  const firebaseRead = async (path) => {
    reads.push(path);
    if (path === 'lumo/secrets/telegramAlerts') {
      return { mentorId: 'LM-004821', botToken: '111:TOKEN', chatId: '-1002117297165', enabled: true };
    }
    return null;
  };
  const sent = [];
  const send = async (token, chat, text) => {
    sent.push({ token, chat, text });
    return { ok: true };
  };
  const result = await postTelegramTrade(
    firebaseRead,
    { symbol: 'XAUUSD', side: 'buy', eaName: 'Unlimited bull', source: 'Chart Scanner Auto Trade' },
    send,
  );
  assert.equal(result.ok, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].chat, '-1002117297165');
  assert.match(sent[0].text, /BUY XAUUSD/);
  assert.ok(reads.includes('lumo/secrets/telegramAlerts'));
});

test('config save writes secret and workspace profile', async () => {
  const writes = {};
  const firebaseWrite = async (path, value) => {
    writes[path] = value;
    return true;
  };
  const result = await saveTelegramAlerts(firebaseWrite, {
    mentorId: 'LM-004821',
    botToken: 'bot880:AA',
    chatId: '-1002117297165',
    enabled: true,
  });
  assert.equal(result.ok, true);
  assert.equal(writes['lumo/secrets/telegramAlerts'].botToken, '880:AA');
  assert.equal(
    writes['lumo/store/workspaces/LM-004821/profile/telegramChatId'],
    '-1002117297165',
  );
});

test('resolveTelegramConfig prefers workspace profile over global secret', async () => {
  const cfg = await resolveTelegramConfig(
    async (path) => {
      if (path === 'lumo/secrets/telegramAlerts') {
        return { botToken: '1:GLOBAL', chatId: '-1', enabled: true };
      }
      if (path.endsWith('/profile')) {
        return { telegramBotToken: '2:MENTOR', telegramChatId: '-2', telegramAlertsEnabled: true };
      }
      return null;
    },
    { mentorId: 'LM-1' },
  );
  assert.equal(cfg.token, '2:MENTOR');
  assert.equal(cfg.chat, '-2');
});

test('sendTelegramMessage reports Telegram API errors', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 400,
    json: async () => ({ ok: false, description: 'chat not found' }),
  });
  try {
    const result = await sendTelegramMessage('1:TOKEN', '-100', 'hello');
    assert.equal(result.ok, false);
    assert.match(result.error, /chat not found/);
  } finally {
    globalThis.fetch = original;
  }
});
