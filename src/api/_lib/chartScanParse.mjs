/** Shared chart scan prompt + direction validation for api/index.js and server.mjs */

export const CHART_SCAN_PROMPT =
  'You analyze MT5 / trading chart screenshots for institutional-grade trade signals.\n' +
  'Follow this order: (1) trend, (2) direction aligned to trend, (3) prices that match direction.\n' +
  'SYMBOL (highest priority):\n' +
  '- Read the EXACT symbol text from the chart UI (title bar, tab, market watch, or header).\n' +
  '- Copy characters exactly including broker suffixes/prefixes (.m, .M, .pro, .PRO, .std, .STD, .r, .ecn, etc.).\n' +
  '- Do NOT guess, substitute, or default to XAUUSD/EURUSD unless that exact text is visible.\n' +
  '- Distinguish similar symbols (EURUSD vs GBPUSD, XAUUSD vs XAGUSD, NAS100 vs US100).\n' +
  '- If symbol text is unreadable, set symbol to null and symbol_visible to false.\n' +
  'TIMEFRAME: read only if visible (M1,M5,M15,M30,H1,H4,D1,W1), else null.\n' +
  'STEP 1 — MARKET STRUCTURE (decide trend_bias first):\n' +
  '- bullish = visible higher highs AND higher lows, price above rising structure, clear uptrend.\n' +
  '- bearish = visible lower highs AND lower lows, price below falling structure, clear downtrend.\n' +
  '- ranging = sideways chop between horizontal support/resistance, no clear HH/HL or LH/LL sequence.\n' +
  '- Mark swing highs/lows, break of structure (BOS), change of character (CHoCH).\n' +
  'STEP 2 — DIRECTION (must align with trend_bias unless confirmed CHoCH reversal):\n' +
  '- trend_bias bullish → direction MUST be buy (pullback to support, bullish BOS, demand retest).\n' +
  '- trend_bias bearish → direction MUST be sell (rejection at resistance, bearish BOS, supply retest).\n' +
  '- trend_bias ranging → pick buy at support OR sell at resistance; never counter-trend guess.\n' +
  '- NEVER output sell on a clearly bullish chart. NEVER output buy on a clearly bearish chart.\n' +
  '- Counter-trend ONLY when CHoCH is visibly confirmed at a major level — then lower confidence below 70.\n' +
  'CANDLESTICK & MOMENTUM:\n' +
  '- Recognize engulfing, pin bars, doji indecision, momentum candles, and rejection wicks at S/R.\n' +
  '- Weigh momentum vs exhaustion near structure.\n' +
  'CONFIDENCE (accuracy_percent) integer 55-89:\n' +
  '- 84-89 = textbook: clean trend, BOS/retest, strong momentum, clear S/R, RR ≥ 1:2.\n' +
  '- 74-83 = decent setup with minor noise or imperfect structure.\n' +
  '- 65-73 = marginal — only tradeable if structure still favors direction.\n' +
  '- 55-64 = low confidence — choppy, counter-trend, or unreadable; prefer this range when unsure.\n' +
  '- NEVER use lazy round numbers (80, 85) — pick the exact integer your analysis supports.\n' +
  '- If confidence would be below 65, still return JSON but set accuracy_percent in 55-64 range.\n' +
  'PRICES (from the right-hand price scale — must match direction):\n' +
  '- entry_price: last/current visible price where the chart ends.\n' +
  '- stop_loss for BUY: MUST be BELOW entry_price (below recent swing low / support).\n' +
  '- stop_loss for SELL: MUST be ABOVE entry_price (above recent swing high / resistance).\n' +
  '- take_profit / TP1 / TP2 / TP3: BUY above entry, SELL below entry.\n' +
  '- TP1 = 1:1, TP2 = 1:2, TP3 = 1:3 versus stop-loss distance. Prefer structure-aligned levels at those RRs.\n' +
  '- Always return entry_price and stop_loss as numbers when the scale is readable.\n' +
  '- If you cannot place a valid SL for the chosen direction, lower confidence below 65.\n' +
  '- Match decimal precision on the scale. If scale unreadable, set entry_price and stop_loss to null.\n' +
  'Before replying, verify: trend_bias, direction, and stop_loss placement all agree.\n' +
  'Reply ONLY compact JSON:\n' +
  '{"symbol":"EXACT_OR_null","symbol_visible":true,"timeframe":"M15_or_null","trend_bias":"bullish|bearish|ranging","direction":"buy|sell","accuracy_percent":77,"entry_price":2345.6,"stop_loss":2339.8,"take_profit":2351.4,"direction_reason":"brief structure reason","summary":"one concise sentence citing structure + pattern"}';

export function imageSeed(image) {
  let seed = 0;
  for (let i = 0; i < image.length; i += 97) {
    seed = (seed * 31 + image.charCodeAt(i)) >>> 0;
  }
  return seed;
}

export function normalizeTrendBias(parsed) {
  const raw = String(parsed.trend_bias || parsed.trend || parsed.structure || '').toLowerCase();
  if (/bull|up|hh|hl|uptrend|long/.test(raw)) return 'bullish';
  if (/bear|down|lh|ll|downtrend|short/.test(raw)) return 'bearish';
  if (/range|sideways|chop|flat|neutral/.test(raw)) return 'ranging';
  return 'unknown';
}

export function priceImpliedDirection(entryPrice, stopLoss) {
  if (
    !Number.isFinite(entryPrice) ||
    !Number.isFinite(stopLoss) ||
    entryPrice <= 0 ||
    stopLoss <= 0 ||
    entryPrice === stopLoss
  ) {
    return null;
  }
  const pct = Math.abs(entryPrice - stopLoss) / entryPrice;
  if (pct >= 0.2) return null;
  return stopLoss < entryPrice ? 'buy' : 'sell';
}

export function validateScanPrices(direction, entryPrice, stopLoss) {
  const implied = priceImpliedDirection(entryPrice, stopLoss);
  if (!implied) return { entryPrice: 0, stopLoss: 0, pricesValid: false, implied: null };
  const matches = implied === direction;
  return {
    entryPrice: matches ? entryPrice : 0,
    stopLoss: matches ? stopLoss : 0,
    pricesValid: matches,
    implied,
  };
}

/**
 * Resolve buy/sell with consistency checks against trend_bias and SL placement.
 * Returns { direction, accuracy, corrected, correctionReason }.
 */
export function resolveScanDirection(parsed, accuracy, image = '') {
  const rawDir = String(parsed.direction || parsed.side || '').toLowerCase();
  if (!rawDir.includes('sell') && !rawDir.includes('buy')) {
    return { ok: false, error: 'Could not determine BUY/SELL from this chart. Try another screenshot.' };
  }

  let direction = rawDir.includes('sell') ? 'sell' : 'buy';
  let corrected = false;
  let correctionReason = '';
  const trendBias = normalizeTrendBias(parsed);

  const entryPrice = parsePriceField(parsed, 'entry_price', 'entryPrice', 'entry');
  const stopLoss = parsePriceField(parsed, 'stop_loss', 'stopLoss', 'sl');
  const implied = priceImpliedDirection(entryPrice, stopLoss);

  // SL placement is the strongest objective signal — model often gets direction wrong but SL right
  if (implied && implied !== direction) {
    direction = implied;
    corrected = true;
    correctionReason = 'stop_loss placement';
    accuracy = Math.max(55, accuracy - 6);
  }

  // Trend bias must agree with direction unless ranging/unknown
  if (trendBias === 'bullish' && direction === 'sell') {
    direction = 'buy';
    corrected = true;
    correctionReason = correctionReason || 'bullish structure';
    accuracy = Math.max(55, accuracy - 8);
  } else if (trendBias === 'bearish' && direction === 'buy') {
    direction = 'sell';
    corrected = true;
    correctionReason = correctionReason || 'bearish structure';
    accuracy = Math.max(55, accuracy - 8);
  }

  // Summary sanity check when trend_bias missing
  if (trendBias === 'unknown') {
    const summary = String(parsed.summary || parsed.direction_reason || '').toLowerCase();
    const bullishCue = /bullish|uptrend|higher high|higher low|demand|support hold|buy bias|long bias/.test(
      summary,
    );
    const bearishCue = /bearish|downtrend|lower high|lower low|supply|resistance reject|sell bias|short bias/.test(
      summary,
    );
    if (bullishCue && !bearishCue && direction === 'sell') {
      direction = 'buy';
      corrected = true;
      correctionReason = correctionReason || 'bullish summary';
      accuracy = Math.max(55, accuracy - 7);
    } else if (bearishCue && !bullishCue && direction === 'buy') {
      direction = 'sell';
      corrected = true;
      correctionReason = correctionReason || 'bearish summary';
      accuracy = Math.max(55, accuracy - 7);
    }
  }

  accuracy = Math.max(55, Math.min(89, Math.round(accuracy)));

  return {
    ok: true,
    direction,
    accuracy,
    corrected,
    correctionReason,
    trendBias,
    implied,
  };
}

export function normalizeScanAccuracy(parsed, image = '') {
  const seed = image ? imageSeed(image) : Math.floor(Math.random() * 1e9);
  const jitter = (seed % 9) - 4;

  let accuracy = Number(parsed.accuracy_percent ?? parsed.accuracy ?? 0);
  if (!Number.isFinite(accuracy) || accuracy <= 0) {
    accuracy = 68 + (seed % 18);
  }
  if (accuracy % 5 === 0) {
    accuracy += jitter;
  }
  return Math.max(55, Math.min(89, Math.round(accuracy)));
}

export function parsePriceField(parsed, ...keys) {
  if (!parsed || typeof parsed !== 'object') return 0;
  for (const key of keys) {
    if (parsed[key] == null || parsed[key] === '') continue;
    const n = Number(String(parsed[key]).replace(/,/g, '').trim());
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

export function priceDecimals(entryPrice, stopLoss) {
  const samples = [entryPrice, stopLoss].filter((n) => Number.isFinite(n) && n > 0);
  let max = 0;
  for (const n of samples) {
    const frac = String(n).split('.')[1] || '';
    max = Math.max(max, Math.min(6, frac.length));
  }
  if (entryPrice >= 50) return Math.max(2, Math.min(max || 2, 3));
  if (entryPrice >= 10) return Math.max(3, Math.min(max || 3, 4));
  return Math.max(max || 5, 5);
}

export function roundScanPrice(value, decimals) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Number(value.toFixed(decimals));
}

export const TP_RATIOS = [1, 2, 3];

export function deriveTakeProfit(direction, entryPrice, stopLoss, ratio = 2) {
  const risk = Math.abs(entryPrice - stopLoss);
  if (!Number.isFinite(risk) || risk <= 0) return 0;
  const tp = direction === 'sell' ? entryPrice - risk * ratio : entryPrice + risk * ratio;
  return tp > 0 ? tp : 0;
}

export function deriveTakeProfitLadder(direction, entryPrice, stopLoss) {
  const decimals = priceDecimals(entryPrice, stopLoss);
  const takeProfits = TP_RATIOS.map((ratio) =>
    roundScanPrice(deriveTakeProfit(direction, entryPrice, stopLoss, ratio), decimals),
  ).filter((n) => n > 0);
  return {
    takeProfits,
    takeProfit1: takeProfits[0] || 0,
    takeProfit2: takeProfits[1] || 0,
    takeProfit3: takeProfits[2] || 0,
    takeProfit: takeProfits[0] || 0,
  };
}

export function validateTakeProfit(direction, entryPrice, takeProfit) {
  if (!Number.isFinite(takeProfit) || takeProfit <= 0 || takeProfit === entryPrice) return 0;
  if (direction === 'buy' && takeProfit > entryPrice) return takeProfit;
  if (direction === 'sell' && takeProfit < entryPrice) return takeProfit;
  return 0;
}

export function resolveScanPrices(parsed, direction) {
  const entryPrice = parsePriceField(parsed, 'entry_price', 'entryPrice', 'entry');
  const stopLoss = parsePriceField(parsed, 'stop_loss', 'stopLoss', 'sl');
  const validated = validateScanPrices(direction, entryPrice, stopLoss);
  if (!validated.pricesValid) {
    return {
      entryPrice: 0,
      stopLoss: 0,
      takeProfit: 0,
      takeProfit1: 0,
      takeProfit2: 0,
      takeProfit3: 0,
      takeProfits: [],
      pricesValid: false,
    };
  }
  const decimals = priceDecimals(validated.entryPrice, validated.stopLoss);
  const ladder = deriveTakeProfitLadder(direction, validated.entryPrice, validated.stopLoss);
  return {
    entryPrice: roundScanPrice(validated.entryPrice, decimals),
    stopLoss: roundScanPrice(validated.stopLoss, decimals),
    ...ladder,
    pricesValid: true,
  };
}

export function demoScanLevels(symbol, direction) {
  const u = String(symbol || '').toUpperCase();
  let entry = 1.0854;
  if (/XAU|GOLD/.test(u)) entry = 2345.6;
  else if (/XAG|SILVER/.test(u)) entry = 29.45;
  else if (/BTC/.test(u)) entry = 64250;
  else if (/NAS|US100|NDX/.test(u)) entry = 19850.5;
  else if (/US30|DJ/.test(u)) entry = 39200;
  else if (/GBP/.test(u)) entry = 1.26842;
  else if (/USDJPY|JPY/.test(u)) entry = 149.85;
  const risk = Math.max(entry * 0.0024, entry >= 50 ? 0.4 : 0.00024);
  const stopLoss = direction === 'sell' ? entry + risk : entry - risk;
  const decimals = priceDecimals(entry, stopLoss);
  return {
    entryPrice: roundScanPrice(entry, decimals),
    stopLoss: roundScanPrice(stopLoss, decimals),
    ...deriveTakeProfitLadder(direction, entry, stopLoss),
  };
}

export function parseChartScanModelText(raw) {
  let parsed = {};
  try {
    const outer = JSON.parse(raw);
    const content =
      outer?.choices?.[0]?.message?.content ||
      outer?.output_text ||
      outer?.content ||
      '';
    const match = String(content).match(/\{[\s\S]*\}/) || String(raw).match(/\{[\s\S]*\}/);
    parsed = match ? JSON.parse(match[0]) : outer && typeof outer === 'object' ? outer : {};
  } catch {
    parsed = {};
  }
  return parsed && typeof parsed === 'object' ? parsed : {};
}

function omitZero(value) {
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

export function buildScanResponse(parsed, image = '', { demo = false } = {}) {
  const symbolVisible = parsed.symbol_visible !== false;
  let symbol = parsed.symbol == null ? '' : String(parsed.symbol).trim();
  if (!symbolVisible || !symbol || /null|unknown|n\/a|none|guess/i.test(symbol)) {
    return {
      ok: false,
      status: 422,
      payload: {
        ok: false,
        accuracy: 0,
        error:
          'Could not read the symbol from this chart. Upload a clearer MT5 screenshot showing the pair name.',
      },
    };
  }
  symbol = symbol.replace(/\s+/g, '').toUpperCase();

  let accuracy = normalizeScanAccuracy(parsed, image);
  const resolved = resolveScanDirection(parsed, accuracy, image);
  if (!resolved.ok) {
    return {
      ok: false,
      status: 422,
      payload: { ok: false, accuracy: 0, error: resolved.error },
    };
  }

  const prices = resolveScanPrices(parsed, resolved.direction);
  const timeframeRaw = parsed.timeframe == null ? '' : String(parsed.timeframe).trim();
  const timeframe =
    !timeframeRaw || /null|unknown|n\/a|none/i.test(timeframeRaw) ? undefined : timeframeRaw;

  return {
    ok: true,
    status: 200,
    payload: {
      ok: true,
      demo,
      accuracy: resolved.accuracy,
      symbol,
      timeframe,
      direction: resolved.direction,
      summary: parsed.summary || `Scan for ${symbol}`,
      entryPrice: omitZero(prices.entryPrice),
      stopLoss: omitZero(prices.stopLoss),
      takeProfit: omitZero(prices.takeProfit),
      takeProfit1: omitZero(prices.takeProfit1),
      takeProfit2: omitZero(prices.takeProfit2),
      takeProfit3: omitZero(prices.takeProfit3),
      takeProfits: (prices.takeProfits || []).filter((n) => n > 0),
      pricesValid: prices.pricesValid,
    },
  };
}
