/**
 * Auto Scan reads live candles for one symbol, asks the same chart model for
 * buy/sell, and keeps that analysis so a later manual scan of the same market
 * cannot flip the other way while it is still valid.
 */

import {
  mt5ApiBase,
  loadBrokerSymbolNames,
  resolveBrokerSymbol,
  resolveTradeableSymbol,
  tradeableSymbolCandidates,
} from './mt5Bridge.mjs';
import {
  buildScanResponse,
  deriveTakeProfitLadder,
  isScanTradeable,
  parseChartScanModelText,
  priceDecimals,
  roundScanPrice,
} from './chartScanParse.mjs';

export const ANALYSIS_TTL_MS = 20 * 60 * 1000;

export const AUTO_MARKETS = [
  { id: 'XAUUSD', aliases: ['XAUUSD', 'GOLD', 'XAU'] },
  { id: 'US30', aliases: ['US30', 'DJ30', 'WS30', 'USA30', 'WALLSTREET30'] },
  { id: 'USTECH', aliases: ['USTECH', 'USTEC', 'NAS100', 'US100', 'NASDAQ', 'NDX'] },
  { id: 'GBPUSD', aliases: ['GBPUSD'] },
  { id: 'EURUSD', aliases: ['EURUSD'] },
  { id: 'USDJPY', aliases: ['USDJPY'] },
  { id: 'GBPJPY', aliases: ['GBPJPY'] },
  { id: 'XAGUSD', aliases: ['XAGUSD', 'SILVER', 'XAG'] },
];

export const AUTO_SCAN_PROMPT =
  'You analyze recent MT5 candles for one symbol and return one trade.\n' +
  'The LAST 5 to 8 candles are the right edge. Direction comes only from those.\n' +
  'Rising or closing up → right_edge "up", trend_bias bullish, direction buy.\n' +
  'Falling or closing down → right_edge "down", trend_bias bearish, direction sell.\n' +
  'Ignore the older move. A drop that already finished, with the latest candles lifting, is a BUY. A rally that already finished, with the latest candles falling, is a SELL.\n' +
  'entry_price is the last close.\n' +
  'BUY: stop_loss below entry. SELL: stop_loss above entry.\n' +
  'accuracy_percent is an integer 55-89. Never use 80 or 85.\n' +
  'Reply ONLY compact JSON:\n' +
  '{"symbol":"SYMBOL","symbol_visible":true,"timeframe":"M15","trend_bias":"bullish|bearish|ranging","right_edge":"up|down","direction":"buy|sell","accuracy_percent":77,"entry_price":0,"stop_loss":0,"summary":"one sentence about the right edge only"}';

const TIMEFRAMES = [
  { code: 15, label: 'M15' },
  { code: 16385, label: 'H1' },
  { code: 5, label: 'M5' },
  { code: 1, label: 'M1' },
];

function compact(raw) {
  return String(raw || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function stripTail(raw) {
  return compact(raw).replace(/(CASH|MICRO|MINI|MIC|PRO|STD|ECN|RAW|SB|M)$/i, '');
}

export function isSymbolQuery(raw) {
  return /^[A-Za-z0-9._#-]{2,32}$/.test(String(raw || '').trim());
}

export function canonicalSymbol(raw) {
  const packed = compact(raw);
  const base = stripTail(raw);
  for (const market of AUTO_MARKETS) {
    for (const alias of market.aliases) {
      const key = compact(alias);
      if (packed === key || base === key) return market.id;
    }
  }
  return '';
}

/** Firebase key for the current analysis of a symbol. */
export function analysisKey(raw) {
  const known = canonicalSymbol(raw);
  if (known) return known;
  const packed = compact(raw);
  if (packed.length < 3 || packed.length > 16) return '';
  return packed;
}

export function analysisStatus(record, now = Date.now(), price = 0) {
  if (!record || (record.direction !== 'buy' && record.direction !== 'sell')) {
    return { valid: false, reason: 'missing' };
  }
  const expires = Date.parse(record.expiresAt);
  if (!Number.isFinite(expires) || expires <= now) return { valid: false, reason: 'expired' };
  const px = Number(price);
  const stop = Number(record.stopLoss);
  const target = Number(record.takeProfit1 || record.takeProfit);
  if (px > 0 && stop > 0 && target > 0) {
    const done =
      record.direction === 'buy' ? px <= stop || px >= target : px >= stop || px <= target;
    if (done) return { valid: false, reason: 'invalidated' };
  }
  return { valid: true, reason: 'active' };
}

export function lockPayloadToAnalysis(payload, active) {
  const direction = active?.direction === 'sell' ? 'sell' : 'buy';
  if (!payload || payload.direction === direction) {
    return payload ? { ...payload, held: true } : payload;
  }
  const storedEntry = Number(active.entryPrice);
  const imageEntry = Number(payload.entryPrice);
  const entry = imageEntry > 0 ? imageEntry : storedEntry;
  const storedRisk = Math.abs(storedEntry - Number(active.stopLoss));
  const localRisk = Math.abs(entry - Number(payload.stopLoss));
  const risk = storedRisk > 0 ? storedRisk : localRisk;
  const accuracy = Number(active.accuracy) || Number(payload.accuracy) || 0;
  const name = payload.symbol || active.brokerSymbol || active.symbol;
  if (!(entry > 0) || !(risk > 0)) {
    return { ...payload, direction, held: true, accuracy, symbol: name };
  }
  const stop = direction === 'sell' ? entry + risk : entry - risk;
  if (!(stop > 0)) return { ...payload, direction, held: true, accuracy, symbol: name };
  const decimals = priceDecimals(entry, stop);
  const ladder = deriveTakeProfitLadder(direction, entry, stop);
  const symbol = name;
  return {
    ...payload,
    symbol,
    direction,
    held: true,
    accuracy,
    entryPrice: roundScanPrice(entry, decimals),
    stopLoss: roundScanPrice(stop, decimals),
    takeProfit: ladder.takeProfit,
    takeProfit1: ladder.takeProfit1,
    takeProfit2: ladder.takeProfit2,
    takeProfit3: ladder.takeProfit3,
    takeProfits: ladder.takeProfits,
    pricesValid: true,
    tradeable: isScanTradeable({
      accuracy,
      pricesValid: true,
      symbol,
      demo: payload.demo,
    }),
    summary: `Held ${direction.toUpperCase()} from the current ${analysisKey(symbol) || symbol} analysis.`,
  };
}

export function normalizeBars(raw) {
  const list = Array.isArray(raw) ? raw : [];
  return list
    .map((bar) => ({
      time: String(bar?.time || bar?.Time || ''),
      open: Number(bar?.openPrice ?? bar?.open ?? bar?.Open),
      high: Number(bar?.highPrice ?? bar?.high ?? bar?.High),
      low: Number(bar?.lowPrice ?? bar?.low ?? bar?.Low),
      close: Number(bar?.closePrice ?? bar?.close ?? bar?.Close),
    }))
    .filter((bar) => Number.isFinite(bar.close) && bar.close > 0);
}

export function formatBarsForModel(symbol, timeframe, bars) {
  const lines = bars.map((bar) => `${bar.time} ${bar.open} ${bar.high} ${bar.low} ${bar.close}`);
  return `SYMBOL: ${symbol}\nTIMEFRAME: ${timeframe}\nCANDLES oldest to newest. The last line is the right edge.\n${lines.join('\n')}`;
}

function analysisPath(key) {
  return `lumo/symbolAnalysis/${encodeURIComponent(key)}`;
}

async function readJson(fetchFn, url, timeoutMs) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, { headers: { Accept: 'application/json' }, signal: ac.signal });
    const text = await res.text();
    clearTimeout(timer);
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    return { status: res.status, data, text };
  } catch (err) {
    clearTimeout(timer);
    return { status: 0, data: null, text: err instanceof Error ? err.message : 'request failed' };
  }
}

export async function fetchRecentBars(id, symbol, fetchFn = fetch) {
  const base = mt5ApiBase();
  const token = encodeURIComponent(id);
  const name = encodeURIComponent(symbol);
  let lastError = 'No candle history for this symbol.';
  for (const frame of TIMEFRAMES) {
    const today = await readJson(
      fetchFn,
      `${base}/PriceHistoryToday?id=${token}&symbol=${name}&timeFrame=${frame.code}`,
      12000,
    );
    let bars = today.status === 200 ? normalizeBars(today.data) : [];
    if (bars.length < 8) {
      const to = new Date();
      const from = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      const range = await readJson(
        fetchFn,
        `${base}/PriceHistory?id=${token}&symbol=${name}&from=${encodeURIComponent(from.toISOString().slice(0, 19))}&to=${encodeURIComponent(to.toISOString().slice(0, 19))}&timeFrame=${frame.code}`,
        12000,
      );
      if (range.status === 200) bars = normalizeBars(range.data);
      else if (today.status !== 200) lastError = String(range.text || today.text || lastError).slice(0, 180);
    }
    if (bars.length >= 8) return { bars: bars.slice(-48), timeframe: frame.label, symbol };
  }
  return { bars: [], timeframe: '', symbol, error: lastError };
}

async function quotePrice(id, symbol, fetchFn) {
  if (!id || !symbol) return 0;
  const url = `${mt5ApiBase()}/GetQuote?id=${encodeURIComponent(id)}&symbol=${encodeURIComponent(symbol)}&msNotOlder=0`;
  const res = await readJson(fetchFn, url, 8000);
  const quote = res.data;
  if (!quote || typeof quote !== 'object') return 0;
  const bid = Number(quote.bid);
  const ask = Number(quote.ask);
  if (bid > 0 && ask > 0) return (bid + ask) / 2;
  return Number(quote.last) || bid || ask || 0;
}

async function loadChartScanConfig() {
  let secret = null;
  try {
    const { firebaseRead } = await import('./clientMerge.mjs');
    secret = await Promise.race([
      firebaseRead('lumo/secrets/chartScan'),
      new Promise((resolve) => setTimeout(() => resolve(null), 4000)),
    ]);
  } catch {
    secret = null;
  }
  return {
    apiKey: secret?.apiKey || process.env.CHART_SCAN_API_KEY || process.env.OPENAI_API_KEY || '',
    apiUrl: secret?.apiUrl || process.env.CHART_SCAN_API_URL || 'https://api.openai.com/v1/chat/completions',
    model: secret?.model || process.env.CHART_SCAN_MODEL || 'gpt-4o',
  };
}

export async function readSymbolAnalysis(symbol) {
  const key = analysisKey(symbol);
  if (!key) return null;
  try {
    const { firebaseRead } = await import('./clientMerge.mjs');
    const record = await Promise.race([
      firebaseRead(analysisPath(key)),
      new Promise((resolve) => setTimeout(() => resolve(null), 4000)),
    ]);
    return record && typeof record === 'object' ? record : null;
  } catch {
    return null;
  }
}

export async function writeSymbolAnalysis(payload, source) {
  const key = analysisKey(payload?.symbol);
  if (!key || payload?.tradeable !== true || payload?.demo) return false;
  const now = Date.now();
  const record = {
    symbol: key,
    brokerSymbol: String(payload.symbol || key),
    direction: payload.direction === 'sell' ? 'sell' : 'buy',
    entryPrice: Number(payload.entryPrice) || 0,
    stopLoss: Number(payload.stopLoss) || 0,
    takeProfit: Number(payload.takeProfit1 || payload.takeProfit) || 0,
    takeProfit1: Number(payload.takeProfit1 || payload.takeProfit) || 0,
    takeProfit2: Number(payload.takeProfit2) || 0,
    takeProfit3: Number(payload.takeProfit3) || 0,
    accuracy: Number(payload.accuracy) || 0,
    summary: String(payload.summary || ''),
    timeframe: payload.timeframe || '',
    source,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ANALYSIS_TTL_MS).toISOString(),
  };
  try {
    const { firebaseWrite } = await import('./clientMerge.mjs');
    return firebaseWrite(analysisPath(key), record);
  } catch {
    return false;
  }
}

export async function reconcileManualScan(result, mt5Id, fetchFn = fetch) {
  if (!result?.ok || !result.payload?.symbol) return result;
  const active = await readSymbolAnalysis(result.payload.symbol);
  const price = await quotePrice(mt5Id, active?.brokerSymbol || result.payload.symbol, fetchFn);
  const status = analysisStatus(active, Date.now(), price);
  if (status.valid) {
    result.payload = lockPayloadToAnalysis(result.payload, active);
    return result;
  }
  if (result.payload.tradeable) await writeSymbolAnalysis(result.payload, 'manual');
  return result;
}

async function resolveMarketSymbol(id, requested, fetchFn) {
  const names = await loadBrokerSymbolNames(id, fetchFn).catch(() => []);
  const resolved = await resolveTradeableSymbol(id, requested, names, fetchFn);
  if (resolved) return resolved;
  const market = AUTO_MARKETS.find((item) => item.id === canonicalSymbol(requested));
  for (const alias of market?.aliases || [requested]) {
    const hit = resolveBrokerSymbol(alias, names);
    if (hit) return hit;
  }
  const sibling = tradeableSymbolCandidates(requested, names).find((name) => name && name !== requested);
  if (sibling) return sibling;
  return names.length ? '' : requested;
}

export async function runAutoScan(body, fetchFn = fetch) {
  const requested = String(body?.symbol || body?.canonical || '').trim();
  if (!isSymbolQuery(requested)) {
    return { status: 400, payload: { ok: false, error: 'Type the symbol from your broker.' } };
  }
  const id = String(body?.id || '').trim();
  if (!id) {
    return {
      status: 400,
      payload: { ok: false, error: 'Connect MetaTrader first. Auto Scan reads the live market on your account.' },
    };
  }
  const market = canonicalSymbol(requested) || requested.toUpperCase();
  const config = await loadChartScanConfig();
  if (!config.apiKey) {
    return {
      status: 503,
      payload: {
        ok: false,
        demo: true,
        tradeable: false,
        accuracy: 0,
        error: 'Chart Scanner is not configured. Fake demo signals are disabled so they cannot be sent to MT5.',
      },
    };
  }
  let brokerSymbol = await resolveMarketSymbol(id, requested, fetchFn);
  if (!brokerSymbol) {
    return { status: 422, payload: { ok: false, error: `${market} is not on this broker account.` } };
  }
  let history = await fetchRecentBars(id, brokerSymbol, fetchFn);
  if (!history.bars.length) {
    const names = await loadBrokerSymbolNames(id, fetchFn).catch(() => []);
    for (const alt of tradeableSymbolCandidates(requested, names)) {
      if (!alt || alt === brokerSymbol) continue;
      const next = await fetchRecentBars(id, alt, fetchFn);
      if (next.bars.length) {
        history = next;
        brokerSymbol = alt;
        break;
      }
    }
  }
  if (!history.bars.length) {
    return {
      status: 502,
      payload: { ok: false, error: history.error || `No candles for ${brokerSymbol}.` },
    };
  }
  let upstream;
  try {
    upstream = await fetchFn(config.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0,
        messages: [
          {
            role: 'user',
            content: `${AUTO_SCAN_PROMPT}\n\n${formatBarsForModel(market, history.timeframe, history.bars)}`,
          },
        ],
      }),
    });
  } catch (err) {
    return {
      status: 502,
      payload: { ok: false, error: err instanceof Error ? err.message : 'Scan failed.' },
    };
  }
  const raw = await upstream.text();
  if (!upstream.ok) {
    return {
      status: 502,
      payload: { ok: false, accuracy: 0, error: `Scan API ${upstream.status}: ${raw.slice(0, 180)}` },
    };
  }
  const parsed = parseChartScanModelText(raw);
  parsed.symbol = market;
  parsed.symbol_visible = true;
  parsed.timeframe = parsed.timeframe || history.timeframe;
  const seed = history.bars
    .slice(-8)
    .map((bar) => bar.close)
    .join(',');
  const result = buildScanResponse(parsed, seed, { demo: false });
  if (result.payload) {
    result.payload.symbol = brokerSymbol;
    result.payload.timeframe = history.timeframe;
    result.payload.source = 'auto';
    result.payload.market = market;
  }
  if (result.ok && result.payload?.tradeable) await writeSymbolAnalysis(result.payload, 'auto');
  return result;
}
