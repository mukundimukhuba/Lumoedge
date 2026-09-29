import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CHART_SCAN_PROMPT,
  buildScanResponse,
  clampScanLot,
  clampScanTrades,
  demoScanLevels,
  anchorRiskLadder,
  deriveTakeProfit,
  inferTakeProfitRatio,
  isScanTradeable,
  normalizeScanAccuracy,
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

test('BUY prices keep SL below entry and TP ladder above entry', () => {
  const prices = resolveScanPrices({ entry_price: 2345.6, stop_loss: 2339.8 }, 'buy');
  assert.equal(prices.pricesValid, true);
  assert.equal(prices.entryPrice, 2345.6);
  assert.equal(prices.stopLoss, 2339.8);
  assert.ok(prices.takeProfit1 > prices.entryPrice);
  assert.ok(prices.takeProfit2 > prices.takeProfit1);
  assert.ok(prices.takeProfit3 > prices.takeProfit2);
  assert.deepEqual(prices.takeProfits, [
    prices.takeProfit1,
    prices.takeProfit2,
    prices.takeProfit3,
  ]);
});

test('SELL prices keep SL above entry and TP ladder below entry', () => {
  const prices = resolveScanPrices({ entryPrice: 1.0854, stopLoss: 1.088 }, 'sell');
  assert.equal(prices.pricesValid, true);
  assert.ok(prices.stopLoss > prices.entryPrice);
  assert.ok(prices.takeProfit1 < prices.entryPrice);
  assert.ok(prices.takeProfit2 < prices.takeProfit1);
  assert.ok(prices.takeProfit3 < prices.takeProfit2);
});

test('take profits are always 1:1, 1:2, and 1:3 from stop distance', () => {
  const prices = resolveScanPrices({ entry_price: 100, stop_loss: 99 }, 'buy');
  assert.equal(prices.pricesValid, true);
  assert.equal(prices.takeProfit1, deriveTakeProfit('buy', 100, 99, 1));
  assert.equal(prices.takeProfit2, deriveTakeProfit('buy', 100, 99, 2));
  assert.equal(prices.takeProfit3, deriveTakeProfit('buy', 100, 99, 3));
  assert.deepEqual(prices.takeProfits, [101, 102, 103]);
  assert.equal(prices.takeProfit, 101);
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
  assert.equal(result.payload.takeProfit1 > result.payload.entryPrice, true);
  assert.equal(result.payload.takeProfits.length, 3);
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
  assert.equal(result.payload.takeProfit1, undefined);
  assert.equal(result.payload.takeProfits.length, 0);
  assert.equal(result.payload.pricesValid, false);
});

test('demo levels always include entry, SL, and TP for both sides', () => {
  for (const side of ['buy', 'sell']) {
    const levels = demoScanLevels('XAUUSD', side);
    assert.ok(levels.entryPrice > 0);
    assert.ok(levels.stopLoss > 0);
    assert.ok(levels.takeProfit1 > 0);
    assert.ok(levels.takeProfit2 > 0);
    assert.ok(levels.takeProfit3 > 0);
    assert.equal(levels.takeProfits.length, 3);
    if (side === 'buy') {
      assert.ok(levels.stopLoss < levels.entryPrice);
      assert.ok(levels.takeProfit1 > levels.entryPrice);
      assert.ok(levels.takeProfit3 > levels.takeProfit2);
    } else {
      assert.ok(levels.stopLoss > levels.entryPrice);
      assert.ok(levels.takeProfit1 < levels.entryPrice);
      assert.ok(levels.takeProfit3 < levels.takeProfit2);
    }
  }
});

test('missing model confidence stays below auto-trade', () => {
  const accuracy = normalizeScanAccuracy({}, 'data:image/png;base64,abc');
  assert.ok(accuracy >= 55 && accuracy < 74);
  assert.equal(isScanTradeable({ accuracy: 80, pricesValid: true, symbol: 'XAUUSD', demo: true }), false);
  assert.equal(isScanTradeable({ accuracy: 80, pricesValid: false, symbol: 'XAUUSD' }), false);
  assert.equal(isScanTradeable({ accuracy: 80, pricesValid: true, symbol: '' }), false);
  assert.equal(isScanTradeable({ accuracy: 73, pricesValid: true, symbol: 'XAUUSD' }), false);
  assert.equal(isScanTradeable({ accuracy: 74, pricesValid: true, symbol: 'XAUUSD' }), true);
  assert.equal(clampScanLot(50), 1);
  assert.equal(clampScanTrades(20), 3);
});

test('structure vs stop conflict is not auto-tradeable', () => {
  const result = buildScanResponse({
    symbol: 'XAUUSD',
    symbol_visible: true,
    trend_bias: 'bullish',
    direction: 'sell',
    accuracy_percent: 86,
    entry_price: 2345.6,
    stop_loss: 2351.2,
    summary: 'Conflict',
  });
  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.direction, 'buy');
  assert.equal(result.payload.pricesValid, true);
  assert.ok(result.payload.stopLoss < result.payload.entryPrice);
  assert.equal(result.payload.tradeable, false);
  assert.ok(result.payload.accuracy < 74);
});

test('a rising right edge is a buy even if the model said sell', () => {
  const result = buildScanResponse(
    {
      symbol: 'XAUUSD',
      symbol_visible: true,
      timeframe: 'H1',
      trend_bias: 'bearish',
      right_edge: 'up',
      direction: 'sell',
      accuracy_percent: 78,
      entry_price: 4161.76,
      stop_loss: 4185.2,
      summary: 'Bearish trend with price below resistance, suggesting continuation.',
    },
    'data:image/png;base64,gold',
  );
  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.direction, 'buy');
  assert.equal(result.payload.tradeable, true);
  assert.ok(result.payload.stopLoss < result.payload.entryPrice);
  assert.ok(result.payload.takeProfit1 > result.payload.entryPrice);
  assert.ok(result.payload.takeProfit3 > result.payload.takeProfit2);
  assert.ok(result.payload.accuracy >= 74);
});

test('a falling right edge stays a sell', () => {
  const result = buildScanResponse(
    {
      symbol: 'XAUUSD',
      symbol_visible: true,
      timeframe: 'H1',
      trend_bias: 'bearish',
      right_edge: 'down',
      direction: 'sell',
      accuracy_percent: 82,
      entry_price: 4161.76,
      stop_loss: 4185.2,
      summary: 'Rejected a fresh lower high at supply.',
    },
    'data:image/png;base64,fresh',
  );
  assert.equal(result.payload.tradeable, true);
  assert.equal(result.payload.direction, 'sell');
  assert.ok(result.payload.accuracy >= 74);
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

test('a buy is skipped once the live price has already reached TP1', () => {
  const skipped = anchorRiskLadder('buy', 157.331, 157.29, 157.375, 157.372);
  assert.equal(skipped.ok, false);
  assert.match(skipped.error, /TP1/);
});

test('live fill rebuilds 1:1 1:2 1:3 from the same stop distance', () => {
  const anchored = anchorRiskLadder('buy', 157.331, 157.29, 157.35, 157.372);
  assert.equal(anchored.ok, true);
  assert.equal(anchored.entry, 157.35);
  assert.equal(anchored.stopLoss, 157.309);
  assert.equal(anchored.takeProfit1, 157.391);
  assert.equal(anchored.takeProfit2, 157.432);
  assert.equal(anchored.takeProfit3, 157.473);
  assert.equal(anchored.takeProfit, 157.391);
  assert.equal(inferTakeProfitRatio('buy', 157.331, 157.29, 157.413), 2);
  const second = anchorRiskLadder('buy', 157.331, 157.29, 157.35, 157.413);
  assert.equal(second.takeProfit, 157.432);
  const sell = anchorRiskLadder('sell', 157.331, 157.372, 157.3, 157.29);
  assert.equal(sell.ok, true);
  assert.equal(sell.stopLoss, 157.341);
  assert.equal(sell.takeProfit1, 157.259);
  assert.equal(anchorRiskLadder('sell', 157.331, 157.372, 157.29, 157.29).ok, false);
});
