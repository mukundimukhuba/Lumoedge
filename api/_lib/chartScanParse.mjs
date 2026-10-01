/** Shared chart scan prompt + direction validation for api/index.js and server.mjs */

export const CHART_SCAN_PROMPT =
  'You analyze MT5 / trading chart screenshots for institutional-grade trade signals.\n' +
  'Follow this order: (1) the latest candles on the right edge, (2) direction from those candles only, (3) prices that match that direction.\n' +
  'SYMBOL (highest priority):\n' +
  '- Read the EXACT symbol text from the chart header, tab, or market watch. Copy it into symbol_text and symbol.\n' +
  '- Keep dots and suffixes that are actually printed, including a leading or trailing dot. `.USTECH.` stays `.USTECH.` It is the Nasdaq index.\n' +
  '- Do NOT guess, substitute, or default to XAUUSD, EURUSD, US30, or US30.PRO unless that exact text is visible.\n' +
  '- US30, DJ30, and WS30 are the Dow. USTECH, USTEC, NAS100, US100, and NASDAQ are the Nasdaq. Never swap those families.\n' +
  '- Do not add .PRO, .MIC, or any suffix unless those letters are visible in the header.\n' +
  '- The digits 3 and 0 must be visible before you output US30. The letters USTECH must be output when the header shows USTECH.\n' +
  '- Distinguish similar symbols (EURUSD vs GBPUSD, XAUUSD vs XAGUSD, USTECH vs US30).\n' +
  '- If symbol text is unreadable, set symbol to null, symbol_text to null, and symbol_visible to false.\n' +
  'TIMEFRAME: read only if visible (M1,M5,M15,M30,H1,H4,D1,W1), else null.\n' +
  'STEP 1 — RIGHT EDGE ONLY (this is the signal):\n' +
  '- Look only at the last 5 to 8 candles where the chart ends, on the far right.\n' +
  '- Those candles rising or closing up → right_edge "up", trend_bias bullish, direction buy.\n' +
  '- Those candles falling or closing down → right_edge "down", trend_bias bearish, direction sell.\n' +
  '- Ignore the older move on the left. A drop that already finished, with the latest candles lifting, is a BUY. A rally that already finished, with the latest candles falling, is a SELL.\n' +
  '- NEVER output sell when the right edge is rising. NEVER output buy when the right edge is falling.\n' +
  'STEP 2 — LEVELS FOR THAT DIRECTION:\n' +
  '- BUY: stop_loss below entry, take_profit above entry.\n' +
  '- SELL: stop_loss above entry, take_profit below entry.\n' +
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
  '{"symbol":"EXACT_OR_null","symbol_text":"EXACT_HEADER_OR_null","symbol_visible":true,"timeframe":"H1_or_null","trend_bias":"bullish|bearish|ranging","right_edge":"up|down","direction":"buy|sell","accuracy_percent":77,"entry_price":2345.6,"stop_loss":2339.8,"take_profit":2351.4,"direction_reason":"what the last candles on the right are doing","summary":"one sentence about the right edge only"}';

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

/** Direction comes from the latest candles, not the older move on the left. */
export function rightEdgeDirection(parsed) {
  const edge = String(parsed?.right_edge || parsed?.latest_move || '').toLowerCase();
  if (/^up$|rising|bull|higher/.test(edge) || edge === 'buy') return 'buy';
  if (/^down$|falling|bear|lower/.test(edge) || edge === 'sell') return 'sell';
  const text = `${parsed?.summary || ''} ${parsed?.direction_reason || ''}`.toLowerCase();
  const rising = /right edge.{0,24}(up|ris|lift|green|bull)|latest candles.{0,24}(up|ris|green|bull)|bounc|recover/.test(
    text,
  );
  const falling = /right edge.{0,24}(down|fall|red|bear)|latest candles.{0,24}(down|fall|red|bear)/.test(text);
  if (rising && !falling) return 'buy';
  if (falling && !rising) return 'sell';
  return null;
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
  const edge = rightEdgeDirection(parsed);
  if (edge && edge !== direction) {
    direction = edge;
    corrected = true;
    correctionReason = 'right edge';
  }
  const edgeLocked = Boolean(edge);
  const trendBias = normalizeTrendBias(parsed);

  const entryPrice = parsePriceField(parsed, 'entry_price', 'entryPrice', 'entry');
  const stopLoss = parsePriceField(parsed, 'stop_loss', 'stopLoss', 'sl');
  const implied = priceImpliedDirection(entryPrice, stopLoss);

  const trendDir = trendBias === 'bullish' ? 'buy' : trendBias === 'bearish' ? 'sell' : null;

  // The older trend must not flip a right-edge buy into a sell, or the reverse.
  if (!edgeLocked && trendDir && implied && trendDir !== implied) {
    direction = trendDir;
    corrected = true;
    correctionReason = 'structure vs stop conflict';
    accuracy = Math.min(62, accuracy - 12);
  } else if (!edgeLocked && implied && implied !== direction) {
    direction = implied;
    corrected = true;
    correctionReason = 'stop_loss placement';
    accuracy = Math.max(55, accuracy - 6);
  } else if (!edgeLocked && trendDir && trendDir !== direction) {
    direction = trendDir;
    corrected = true;
    correctionReason = trendDir === 'buy' ? 'bullish structure' : 'bearish structure';
    accuracy = Math.max(55, accuracy - 8);
  }

  // Summary sanity check when trend_bias missing
  if (!edgeLocked && trendBias === 'unknown') {
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
    // Missing model confidence is not a 70%+ setup — keep it below auto-trade.
    accuracy = 58 + (seed % 5);
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

/**
 * Auto scans were parking the stop a few ticks off the price, so TP1–TP3
 * closed in the spread. Keep a wider stop when the model is tighter than this.
 * A stop that is already farther away stays where it is.
 */
export function minimumStopDistance(symbol, price) {
  const px = Number(price);
  if (!(px > 0)) return 0;
  const name = String(symbol || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (!name) return 0;
  const rules = [
    [/XAU|GOLD/, 0.0035, 12],
    [/XAG|SILVER/, 0.004, 0.15],
    [/BTC/, 0.006, 200],
    [/ETH/, 0.005, 12],
    [/USTEC|NAS100|NASDAQ|US100|NDX|USTECH/, 0.0025, 60],
    [/US30|DJ30|WALLST|DOW/, 0.0022, 80],
    [/DE30|GER40|GER30|DAX|DE40/, 0.002, 30],
    [/UK100|FTSE/, 0.002, 12],
    [/JP225|NI225|JPN225/, 0.002, 80],
    [/BRENT|UKOIL|USOIL|WTI/, 0.004, 0.4],
    [/JPY/, 0.0018, 0.2],
    [/EUR|GBP|AUD|NZD|USD|CAD|CHF/, 0.0015, 0.0015],
  ];
  for (const [pattern, pct, floor] of rules) {
    if (pattern.test(name)) return Math.max(px * pct, floor);
  }
  if (px >= 1000) return Math.max(px * 0.002, 15);
  if (px >= 50) return Math.max(px * 0.002, 0.5);
  return Math.max(px * 0.0015, 0.0015);
}

export function expandedRisk(symbol, entryPrice, stopLoss, decimals) {
  const entry = Number(entryPrice);
  const stop = Number(stopLoss);
  const risk = roundScanPrice(Math.abs(entry - stop), decimals);
  const min = roundScanPrice(minimumStopDistance(symbol, entry), decimals);
  return min > risk ? min : risk;
}

export const TP_RATIOS = [1, 2, 3];
export const MIN_AUTO_TRADE_ACCURACY = 74;
export const MAX_SCAN_TRADES = 3;
export const MAX_SCAN_LOT = 1;
export const MIN_SCAN_LOT = 0.01;

/** Keep entry, and put the stop on the correct side when the direction was flipped. */
export function alignStopToDirection(parsed, direction) {
  const entry = parsePriceField(parsed, 'entry_price', 'entryPrice', 'entry');
  const stop = parsePriceField(parsed, 'stop_loss', 'stopLoss', 'sl');
  const implied = priceImpliedDirection(entry, stop);
  if (!implied || implied === direction || !(entry > 0) || !(stop > 0)) return parsed;
  const risk = Math.abs(entry - stop);
  const mirrored = direction === 'buy' ? entry - risk : entry + risk;
  if (!(mirrored > 0)) return parsed;
  return { ...parsed, entry_price: entry, stop_loss: mirrored, direction };
}

export function isScanTradeable({ accuracy, pricesValid, symbol, demo } = {}) {
  const pair = String(symbol || '').trim();
  return (
    !demo &&
    Boolean(pair) &&
    pricesValid === true &&
    Number(accuracy) >= MIN_AUTO_TRADE_ACCURACY
  );
}

export function clampScanLot(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return MIN_SCAN_LOT;
  return Math.max(MIN_SCAN_LOT, Math.min(MAX_SCAN_LOT, n));
}

export function clampScanTrades(raw) {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.max(1, Math.min(MAX_SCAN_TRADES, n));
}

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

function tradeSide(direction) {
  const raw = String(direction || '').trim().toLowerCase();
  return raw === 'sell' || raw === '1' ? 'sell' : 'buy';
}

/** Which 1:1 / 1:2 / 1:3 rung this take-profit was built from. */
export function inferTakeProfitRatio(direction, entryPrice, stopLoss, takeProfit) {
  const side = tradeSide(direction);
  const entry = Number(entryPrice);
  const stop = Number(stopLoss);
  const tp = Number(takeProfit);
  const risk = Math.abs(entry - stop);
  if (!(risk > 0) || !(tp > 0) || !(entry > 0)) return 1;
  const reward = side === 'sell' ? entry - tp : tp - entry;
  const ratio = Math.round(reward / risk);
  return ratio === 2 || ratio === 3 ? ratio : 1;
}

/**
 * Market orders fill at the live quote, not the price in the screenshot.
 * Keep the scanned stop distance and place 1:1, 1:2, 1:3 from that fill.
 * A chart scan skips once price is already at the 1:1 target.
 * A new START trade is fresh: it always rebuilds that ladder from the live fill.
 */
export function anchorRiskLadder(direction, entryPrice, stopLoss, fillPrice, takeProfit = 0, options = {}) {
  const fresh = options?.fresh === true;
  const side = tradeSide(direction);
  const entry = Number(entryPrice);
  const stop = Number(stopLoss);
  const fill = Number(fillPrice);
  if (!(entry > 0) || !(stop > 0) || !(fill > 0)) {
    return { ok: false, error: 'Missing price for take profit.' };
  }
  const decimals = priceDecimals(entry, stop);
  const entryR = roundScanPrice(entry, decimals);
  const stopR = roundScanPrice(stop, decimals);
  const fillR = roundScanPrice(fill, decimals);
  const risk = expandedRisk(options.symbol, entryR, stopR, decimals);
  if (!(risk > 0)) return { ok: false, error: 'Stop distance is zero.' };
  const tp1 = roundScanPrice(side === 'sell' ? entryR - risk : entryR + risk, decimals);
  const throughFirst = side === 'sell' ? fillR <= tp1 : fillR >= tp1;
  if (throughFirst && !fresh) {
    return {
      ok: false,
      error:
        side === 'sell'
          ? 'Price already reached TP1. Sell skipped.'
          : 'Price already reached TP1. Buy skipped.',
    };
  }
  const anchoredStop = roundScanPrice(side === 'sell' ? fillR + risk : fillR - risk, decimals);
  if (!(anchoredStop > 0)) return { ok: false, error: 'Stop loss is not valid at this price.' };
  const ladder = deriveTakeProfitLadder(side, fillR, anchoredStop);
  const ratio = inferTakeProfitRatio(side, entryR, stopR, takeProfit);
  const picked = ladder.takeProfits[ratio - 1] || ladder.takeProfit1;
  if (!(picked > 0) || (side === 'sell' ? picked >= fillR : picked <= fillR)) {
    return {
      ok: false,
      error:
        side === 'sell'
          ? 'Price already reached TP. Sell skipped.'
          : 'Price already reached TP. Buy skipped.',
    };
  }
  return {
    ok: true,
    ...ladder,
    ratio,
    entry: fillR,
    stopLoss: anchoredStop,
    takeProfit: picked,
  };
}

export function validateTakeProfit(direction, entryPrice, takeProfit) {
  if (!Number.isFinite(takeProfit) || takeProfit <= 0 || takeProfit === entryPrice) return 0;
  if (direction === 'buy' && takeProfit > entryPrice) return takeProfit;
  if (direction === 'sell' && takeProfit < entryPrice) return takeProfit;
  return 0;
}

export function resolveScanPrices(parsed, direction, symbol = '') {
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
  const entry = roundScanPrice(validated.entryPrice, decimals);
  const risk = expandedRisk(symbol, entry, validated.stopLoss, decimals);
  const stop = roundScanPrice(direction === 'sell' ? entry + risk : entry - risk, decimals);
  const ladder = deriveTakeProfitLadder(direction, entry, stop > 0 ? stop : validated.stopLoss);
  return {
    entryPrice: entry,
    stopLoss: stop > 0 ? stop : roundScanPrice(validated.stopLoss, decimals),
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

function cleanHeader(value) {
  return String(value || '').trim().replace(/\s+/g, '');
}

function symbolFamily(value) {
  const compact = cleanHeader(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (/^(US30|DJ30|WS30|USA30|DOW)/.test(compact)) return 'dow';
  if (/^(USTECH|USTEC|NAS100|NASDAQ|US100|NDX)/.test(compact)) return 'nasdaq';
  return compact;
}

/** Header text wins. A Dow name on a Nasdaq-sized price is the header misread. */
export function readChartSymbol(parsed, entryPrice = 0) {
  const text = cleanHeader(parsed?.symbol_text);
  const named = cleanHeader(parsed?.symbol);
  const textOk = text && !/^(null|unknown|n\/a|none)$/i.test(text);
  const namedOk = named && !/^(null|unknown|n\/a|none)$/i.test(named);
  let symbol = textOk ? text : namedOk ? named : '';
  if (textOk && namedOk && symbolFamily(text) !== symbolFamily(named)) symbol = text;
  const entry = Number(entryPrice);
  if (symbolFamily(symbol) === 'dow' && entry >= 18000 && entry <= 36000) symbol = 'USTECH';
  return symbol;
}

export function buildScanResponse(parsed, image = '', { demo = false } = {}) {
  const symbolVisible = parsed.symbol_visible !== false;
  const hintedEntry = parsePriceField(parsed, 'entry_price', 'entryPrice', 'entry');
  let symbol = readChartSymbol(parsed, hintedEntry);
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

  const priced = alignStopToDirection(parsed, resolved.direction);
  const prices = resolveScanPrices(priced, resolved.direction, symbol);
  if (!prices.pricesValid || resolved.correctionReason === 'structure vs stop conflict') {
    resolved.accuracy = Math.min(resolved.accuracy, 62);
  }
  if (resolved.corrected && resolved.correctionReason !== 'right edge') {
    resolved.accuracy = Math.min(resolved.accuracy, 68);
  }
  const timeframeRaw = parsed.timeframe == null ? '' : String(parsed.timeframe).trim();
  const timeframe =
    !timeframeRaw || /null|unknown|n\/a|none/i.test(timeframeRaw) ? undefined : timeframeRaw;
  const tradeable = isScanTradeable({
    accuracy: resolved.accuracy,
    pricesValid: prices.pricesValid,
    symbol,
    demo,
  });

  return {
    ok: true,
    status: 200,
    payload: {
      ok: true,
      demo,
      tradeable,
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
