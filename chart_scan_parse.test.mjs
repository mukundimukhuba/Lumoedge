import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CHART_SCAN_PROMPT,
  buildScanResponse,
  demoScanLevels,
  deriveTakeProfit,
  parseChartScanModelText,
  resolveScanPrices,
  validateScanPrices,
  validateTakeProfit,
} from './api/_lib/chartScanParse.mjs';

test('scan prompt requires take profit and stop loss', () => {
  assert.match(CHART_SCAN_PROMPT, /take_profit/);
  assert.match(CHART_SCAN_PROMPT, /stop_loss/);
  assert.match(CHART_SCAN_PROMPT, /entry_price/);
});

test('BUY prices keep SL below entry and TP above entry', () => {
  const prices = resolveScanPrices(
    { entry_price: 2345.6, stop_loss: 2339.8, take_profit: 2357.2 },
    'buy',
  );
  assert.equal(prices.pricesValid, true);
  assert.equal(prices.entryPrice, 2345.6);
  assert.equal(prices.stopLoss, 2339.8);
  assert.equal(prices.takeProfit, 2357.2);
});

test('SELL prices keep SL above entry and TP below entry', () => {
  const prices = resolveScanPrices(
    { entryPrice: 1.0854, stopLoss: 1.088, takeProfit: 1.0802 },
    'sell',
  );
  assert.equal(prices.pricesValid, true);
  assert.ok(prices.stopLoss > prices.entryPrice);
  assert.ok(prices.takeProfit < prices.entryPrice);
});

test('missing take profit is derived at 1:2 from stop distance', () => {
  const prices = resolveScanPrices({ entry_price: 100, stop_loss: 99 }, 'buy');
  assert.equal(prices.pricesValid, true);
  assert.equal(prices.takeProfit, deriveTakeProfit('buy', 100, 99, 2));
  assert.equal(prices.takeProfit, 102);
});

test('wrong-side stop loss is rejected', () => {
  const invalid = validateScanPrices('buy', 100, 101);
  assert.equal(invalid.pricesValid, false);
  assert.equal(validateTakeProfit('buy', 100, 99), 0);
  assert.equal(validateTakeProfit('sell', 100, 101), 0);
});

test('buildScanResponse returns camelCase entry, SL, and TP', () => {
  const result = buildScanResponse(
    {
      symbol: 'XAUUSD',
      symbol_visible: true,
      timeframe: 'M15',
      trend_bias: 'bullish',
      direction: 'buy',
      accuracy_percent: 77,
      entry_price: 2345.6,
      stop_loss: 2339.8,
      take_profit: 2357.2,
      summary: 'Bullish BOS retest',
    },
    'data:image/png;base64,abc',
  );
  assert.equal(result.status, 200);
  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.symbol, 'XAUUSD');
  assert.equal(result.payload.direction, 'buy');
  assert.equal(result.payload.entryPrice, 2345.6);
  assert.equal(result.payload.stopLoss, 2339.8);
  assert.equal(result.payload.takeProfit, 2357.2);
});

test('buildScanResponse omits invalid prices instead of inventing them', () => {
  const result = buildScanResponse({
    symbol: 'EURUSD',
    direction: 'buy',
    accuracy_percent: 72,
    summary: 'No scale',
  });
  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.entryPrice, undefined);
  assert.equal(result.payload.stopLoss, undefined);
  assert.equal(result.payload.takeProfit, undefined);
  assert.equal(result.payload.pricesValid, false);
});

test('demo levels always include entry, SL, and TP for both sides', () => {
  for (const side of ['buy', 'sell']) {
    const levels = demoScanLevels('XAUUSD', side);
    assert.ok(levels.entryPrice > 0);
    assert.ok(levels.stopLoss > 0);
    assert.ok(levels.takeProfit > 0);
    if (side === 'buy') {
      assert.ok(levels.stopLoss < levels.entryPrice);
      assert.ok(levels.takeProfit > levels.entryPrice);
    } else {
      assert.ok(levels.stopLoss > levels.entryPrice);
      assert.ok(levels.takeProfit < levels.entryPrice);
    }
  }
});

test('OpenAI chat wrapper JSON is parsed for nested scan fields', () => {
  const parsed = parseChartScanModelText(
    JSON.stringify({
      choices: [
        {
          message: {
            content:
              '{"symbol":"GBPUSD","direction":"sell","entry_price":1.2684,"stop_loss":1.271,"take_profit":1.2632}',
          },
        },
      ],
    }),
  );
  assert.equal(parsed.symbol, 'GBPUSD');
  assert.equal(parsed.take_profit, 1.2632);
});
