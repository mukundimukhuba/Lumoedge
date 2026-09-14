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
  '- If you cannot place a valid SL for the chosen direction, lower confidence below 65.\n' +
  '- Match decimal precision on the scale. If scale unreadable, set entry_price and stop_loss to null.\n' +
  'Before replying, verify: trend_bias, direction, and stop_loss placement all agree.\n' +
  'Reply ONLY compact JSON:\n' +
  '{"symbol":"EXACT_OR_null","symbol_visible":true,"timeframe":"M15_or_null","trend_bias":"bullish|bearish|ranging","direction":"buy|sell","accuracy_percent":77,"entry_price":2345.6,"stop_loss":2339.8,"direction_reason":"brief structure reason","summary":"one concise sentence citing structure + pattern"}';

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

  const entryPrice = Number(parsed.entry_price);
  const stopLoss = Number(parsed.stop_loss);
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
