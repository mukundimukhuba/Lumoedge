import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ANALYSIS_TTL_MS,
  AUTO_MARKETS,
  AUTO_SCAN_PROMPT,
  analysisKey,
  analysisStatus,
  canonicalSymbol,
  directionBlockedByOpenBook,
  openBookSide,
  positionSide,
  formatBarsForModel,
  isSymbolQuery,
  lockPayloadToAnalysis,
  normalizeBars,
  runAutoScan,
} from './api/_lib/autoScan.mjs';
import { resolveBrokerSymbol } from './api/_lib/mt5Bridge.mjs';

test('auto markets include the front-screen symbols', () => {
  assert.deepEqual(
    AUTO_MARKETS.map((item) => item.id),
    ['XAUUSD', 'US30', 'USTECH', 'GBPUSD', 'EURUSD', 'USDJPY', 'GBPJPY', 'XAGUSD'],
  );
  assert.match(AUTO_SCAN_PROMPT, /right edge/i);
  assert.match(AUTO_SCAN_PROMPT, /direction buy/);
  assert.equal(ANALYSIS_TTL_MS, 20 * 60 * 1000);
});

test('broker suffixes share one analysis key', () => {
  assert.equal(canonicalSymbol('XAUUSD.m'), 'XAUUSD');
  assert.equal(canonicalSymbol('XAUUSD.mic'), 'XAUUSD');
  assert.equal(canonicalSymbol('USTECH.mic'), 'USTECH');
  assert.equal(canonicalSymbol('GOLD'), 'XAUUSD');
  assert.equal(canonicalSymbol('NAS100'), 'USTECH');
  assert.equal(canonicalSymbol('US100.cash'), 'USTECH');
  assert.equal(analysisKey('USDJPY'), 'USDJPY');
  assert.equal(analysisKey('AUDUSD'), 'AUDUSD');
  assert.equal(resolveBrokerSymbol('USTECH', ['NAS100', 'EURUSD']), 'NAS100');
});

test('an active analysis expires or dies when TP1 or the stop is hit', () => {
  const now = Date.parse('2026-09-30T12:00:00Z');
  const active = {
    direction: 'buy',
    entryPrice: 157.331,
    stopLoss: 157.29,
    takeProfit1: 157.372,
    expiresAt: new Date(now + 60_000).toISOString(),
  };
  assert.equal(analysisStatus(active, now, 157.35).valid, true);
  assert.equal(analysisStatus(active, now, 157.375).reason, 'invalidated');
  assert.equal(analysisStatus(active, now, 157.28).reason, 'invalidated');
  assert.equal(analysisStatus({ ...active, expiresAt: new Date(now - 1000).toISOString() }, now, 157.35).reason, 'expired');
  const sell = { ...active, direction: 'sell', stopLoss: 157.4, takeProfit1: 157.29 };
  assert.equal(analysisStatus(sell, now, 157.28).reason, 'invalidated');
});

test('a manual scan keeps the stored direction and rebuilds 1:1 1:2 1:3', () => {
  const locked = lockPayloadToAnalysis(
    {
      symbol: 'XAUUSDm',
      direction: 'buy',
      accuracy: 61,
      entryPrice: 4161.76,
      stopLoss: 4140,
      tradeable: false,
      pricesValid: true,
    },
    {
      symbol: 'XAUUSD',
      direction: 'sell',
      accuracy: 78,
      entryPrice: 4180,
      stopLoss: 4200,
      takeProfit1: 4160,
    },
  );
  assert.equal(locked.held, true);
  assert.equal(locked.direction, 'sell');
  assert.equal(locked.accuracy, 78);
  assert.equal(locked.symbol, 'XAUUSDm');
  assert.ok(locked.stopLoss > locked.entryPrice);
  assert.ok(locked.takeProfit1 < locked.entryPrice);
  assert.ok(locked.takeProfit2 < locked.takeProfit1);
  assert.ok(locked.takeProfit3 < locked.takeProfit2);
  const risk = locked.stopLoss - locked.entryPrice;
  assert.equal(locked.takeProfit1, Number((locked.entryPrice - risk).toFixed(2)));
  const same = lockPayloadToAnalysis(
    { symbol: 'USDJPY', direction: 'sell', entryPrice: 157.2, stopLoss: 157.4, accuracy: 80 },
    { direction: 'sell', accuracy: 77, entryPrice: 157, stopLoss: 157.1 },
  );
  assert.equal(same.direction, 'sell');
  assert.equal(same.entryPrice, 157.2);
});

test('auto scan asks for a symbol and a connected account before calling the model', async () => {
  const missing = await runAutoScan({});
  assert.equal(missing.status, 400);
  assert.match(missing.payload.error, /symbol/i);
  const noAccount = await runAutoScan({ symbol: 'XAUUSD' });
  assert.equal(noAccount.status, 400);
  assert.match(noAccount.payload.error, /MetaTrader/i);
  const custom = await runAutoScan({ symbol: 'GER40.cash' });
  assert.equal(custom.status, 400);
  assert.match(custom.payload.error, /MetaTrader/i);
  assert.equal(isSymbolQuery('EURUSD.m'), true);
  assert.equal(isSymbolQuery('x'), false);
});

test('one symbol stays on the side already open', () => {
  const orders = [
    { symbol: '.USTECH.mic', orderType: 0 },
    { symbol: 'XAUUSD.mic', orderType: 1 },
    { symbol: 'XAUUSD', orderType: 100, comment: 'balance' },
  ];
  assert.equal(positionSide({ orderType: 101, comment: 'credit' }), '');
  assert.equal(openBookSide(orders, 'USTECH'), 'buy');
  assert.equal(openBookSide(orders, 'NAS100'), 'buy');
  assert.equal(openBookSide(orders, 'XAUUSD.m'), 'sell');
  assert.equal(openBookSide(orders, 'EURUSD'), '');
  assert.equal(directionBlockedByOpenBook('sell', 'buy'), 'This symbol already has BUY trades open, so the SELL was not opened.');
  assert.equal(directionBlockedByOpenBook('buy', 'buy'), '');
  assert.match(directionBlockedByOpenBook('buy', 'mixed'), /buy and sell/i);
  assert.equal(openBookSide([{ symbol: 'XAUUSDm', orderType: 0 }, { symbol: 'GOLD', orderType: 1 }], 'XAUUSD'), 'mixed');
});

test('candle rows keep the last close as the right edge', () => {
  const bars = normalizeBars([
    { time: '2026-09-30T10:00:00', openPrice: 1, highPrice: 2, lowPrice: 0.5, closePrice: 1.5 },
    { open: 1.5, high: 1.6, low: 1.4, close: 1.55 },
    { closePrice: 0 },
  ]);
  assert.equal(bars.length, 2);
  const text = formatBarsForModel('XAUUSD', 'M15', bars);
  assert.match(text, /last line is the right edge/);
  assert.match(text, /1\.55$/);
});
