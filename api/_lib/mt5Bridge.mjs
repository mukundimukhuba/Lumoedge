/**
 * MT5 broker bridge — connects through the swagger REST API at 157.230.1.186:5000
 * (ConnectEx / Connect) and proxies account + trade endpoints server-side.
 */

import { anchorRiskLadder } from './chartScanParse.mjs';

export class Mt5LevelError extends Error {
  constructor(message) {
    super(message);
    this.name = 'Mt5LevelError';
  }
}

export const DEFAULT_MT5_API_HOST = '157.230.1.186:5000';
export const DEFAULT_MT5_API_BASE = `http://${DEFAULT_MT5_API_HOST}`;

const PATH_ALIASES = {
  '/OrderSend': '/OrderSendSafe',
  '/OrderClose': '/OrderCloseSafe',
  '/OrderModify': '/OrderModifySafe',
};

const OPERATION_CODES = {
  buy: '0',
  sell: '1',
  buylimit: '2',
  selllimit: '3',
  buystop: '4',
  sellstop: '5',
  buystoplimit: '6',
  sellstoplimit: '7',
};

export function mapMt5Operation(value) {
  const raw = String(value || '').trim();
  if (!raw) return raw;
  if (/^\d+$/.test(raw)) return raw;
  return OPERATION_CODES[raw.toLowerCase()] || raw;
}

export function rewriteMt5Path(targetPath) {
  const raw = String(targetPath || '');
  const qIndex = raw.indexOf('?');
  const path = qIndex >= 0 ? raw.slice(0, qIndex) : raw;
  const query = qIndex >= 0 ? raw.slice(qIndex + 1) : '';
  const mapped = PATH_ALIASES[path] || path;
  if (!query) return mapped;
  const params = new URLSearchParams(query);
  if (params.has('operation')) {
    params.set('operation', mapMt5Operation(params.get('operation')));
  }
  const qs = params.toString();
  return qs ? `${mapped}?${qs}` : mapped;
}

export function priceForOperation(quote, operation) {
  const op = mapMt5Operation(operation);
  const bid = Number(quote?.bid);
  const ask = Number(quote?.ask);
  const last = Number(quote?.last);
  const sell = op === '1' || op === '3' || op === '5' || op === '7';
  const px = sell ? bid : ask;
  if (Number.isFinite(px) && px > 0) return px;
  if (Number.isFinite(last) && last > 0) return last;
  return 0;
}

export function extractMt5Ticket(payload) {
  if (payload == null) return '';
  let value = payload;
  if (typeof value === 'string') {
    const text = value.trim();
    if (/^[1-9]\d*$/.test(text)) return text;
    try {
      value = JSON.parse(text);
    } catch {
      return '';
    }
  }
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return String(Math.trunc(value));
  }
  if (value && typeof value === 'object') {
    const ticket = value.ticket ?? value.Ticket ?? value.order ?? value.Order;
    if (ticket != null && ticket !== '' && Number(ticket) > 0) return String(ticket);
  }
  return '';
}

export function orderFailureIsDisabled(payload) {
  const text = `${mt5ExceptionMessage(payload)} ${typeof payload === 'string' ? payload : ''}`.toLowerCase();
  return /trading is disabled|trade is disabled|disabled for|symbol is disabled|trade disabled|4089631/.test(text);
}

export function mt5ExceptionMessage(payload) {
  if (!payload) return '';
  if (typeof payload === 'string') {
    const text = payload.trim();
    try {
      return mt5ExceptionMessage(JSON.parse(text)) || text;
    } catch {
      return text;
    }
  }
  if (typeof payload === 'object') {
    return String(payload.message || payload.error || payload.code || '').trim();
  }
  return '';
}

/** New mt5rest uses HTTP 201 for ExceptionResult — that is a failed trade, not success. */
export function mt5ProxyStatus(upstreamStatus, bodyText) {
  const status = Number(upstreamStatus);
  if (status !== 201) return status;
  const text = String(bodyText || '');
  if (!text) return 400;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && (parsed.code != null || parsed.message)) {
      return 400;
    }
  } catch {
    return 400;
  }
  return 400;
}

const SYMBOL_WRAPPER_KEYS = new Set([
  'base',
  'symGroups',
  'sessions',
  'groups',
  'infos',
  'infosById',
  'names',
  'symbols',
  'groupNames',
  'comissions',
  'commissions',
]);

const SYMBOL_SUFFIXES = [
  '',
  '.mic',
  '.MIC',
  'mic',
  '.M',
  '.m',
  'm',
  '.PRO',
  '.pro',
  '.STD',
  '.std',
  '.R',
  '.r',
  '.ECN',
  '.RAW',
  '.I',
  '.SB',
  '.micro',
  '.MICRO',
  '.mini',
  '.MINI',
  '#',
];

const SYMBOL_ALIAS_GROUPS = [
  ['XAUUSD', 'GOLD', 'XAUUSDM', 'XAUUSD.M', 'XAUUSD.MICRO', 'GOLD.M', 'XAUUSD.C'],
  ['XAGUSD', 'SILVER', 'XAGUSDM', 'XAGUSD.M', 'SILVER.M'],
  ['BTCUSD', 'BITCOIN', 'BTCUSDM', 'BTCUSD.M'],
  ['ETHUSD', 'ETHEREUM', 'ETHUSDM', 'ETHUSD.M'],
  ['US30', 'DJ30', 'WALLSTREET30', 'WS30', 'USA30', 'US30CASH'],
  ['NAS100', 'USTEC', 'USTECH', 'US100', 'NASDAQ', 'NAS100.M', 'USTEC.M', 'US100CASH'],
];

export function compactMt5Symbol(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

export function stripBrokerSymbolSuffix(value) {
  let text = String(value || '').toUpperCase().trim();
  let prev = '';
  while (text && text !== prev) {
    prev = text;
    text = text
      .replace(/[#._-](MICRO|MINI|MIC|PRO|STD|ECN|RAW|SB|CASH|M|C|R)$/i, '')
      .replace(/(MICRO|MINI|MIC)$/i, '');
  }
  // XAUUSDm keeps the trailing micro flag off the instrument name. SILVER does not.
  if (/M$/.test(text) && text.length > 6) text = text.slice(0, -1);
  return text;
}

function addUniqueName(names, seen, value) {
  const name = String(value || '').trim();
  if (!name || seen.has(name)) return;
  seen.add(name);
  names.push(name);
}

function symbolNameFromItem(item) {
  if (typeof item === 'string') return item.trim();
  if (!item || typeof item !== 'object') return '';
  // SymbolInfo uses `currency` for USD/EUR — never treat that as the instrument name.
  return String(item.symbol || item.name || item.Symbol || item.Name || '').trim();
}

function looksLikeSymbolInfo(value) {
  return Boolean(
    value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      ('currency' in value ||
        'digits' in value ||
        'description' in value ||
        'points' in value ||
        'profitCurrency' in value),
  );
}

/** /Symbols is a SymbolInfo map keyed by name, or {names, infos}. Never prefer currency. */
export function parseMt5SymbolNames(payload) {
  if (payload == null) return [];
  if (typeof payload === 'string') {
    const text = payload.trim();
    if (!text) return [];
    try {
      return parseMt5SymbolNames(JSON.parse(text));
    } catch {
      return [text];
    }
  }

  const names = [];
  const seen = new Set();

  if (Array.isArray(payload)) {
    for (const item of payload) {
      addUniqueName(names, seen, typeof item === 'string' ? item : symbolNameFromItem(item));
    }
    return names;
  }

  if (typeof payload !== 'object') return [];

  if (Array.isArray(payload.names)) {
    for (const item of payload.names) addUniqueName(names, seen, item);
  }
  if (Array.isArray(payload.symbols)) {
    for (const item of payload.symbols) {
      addUniqueName(names, seen, typeof item === 'string' ? item : symbolNameFromItem(item));
    }
  }
  if (payload.infos && typeof payload.infos === 'object' && !Array.isArray(payload.infos)) {
    for (const key of Object.keys(payload.infos)) addUniqueName(names, seen, key);
  }

  const keys = Object.keys(payload);
  const infoMap =
    keys.length > 0 &&
    keys.every((key) => SYMBOL_WRAPPER_KEYS.has(key) || looksLikeSymbolInfo(payload[key]));
  if (infoMap) {
    for (const key of keys) {
      if (!SYMBOL_WRAPPER_KEYS.has(key) && looksLikeSymbolInfo(payload[key])) {
        addUniqueName(names, seen, key);
      }
    }
  }

  return names;
}

function keysForSymbol(value) {
  const upper = String(value || '').toUpperCase().trim();
  if (!upper) return [];
  return [upper, compactMt5Symbol(upper), stripBrokerSymbolSuffix(upper)];
}

function sameAliasGroup(candidate, detected) {
  const candKeys = keysForSymbol(candidate);
  const detKeys = keysForSymbol(detected);
  for (const group of SYMBOL_ALIAS_GROUPS) {
    const compactGroup = group.map((item) => compactMt5Symbol(item));
    const candHit = candKeys.some((value) => group.includes(value) || compactGroup.includes(value));
    const detHit = detKeys.some((value) => group.includes(value) || compactGroup.includes(value));
    if (candHit && detHit) return true;
  }
  return false;
}

function scoreBrokerSymbol(candidate, detectedUpper, detectedCompact, detectedBase) {
  const upper = String(candidate || '').toUpperCase();
  const compact = compactMt5Symbol(candidate);
  let score = 0;
  if (upper === detectedUpper) score += 100;
  if (compact === detectedCompact) score += 80;
  if (upper === detectedBase) score += 60;
  if (compact === compactMt5Symbol(detectedBase)) score += 50;
  if (sameAliasGroup(candidate, detectedUpper) || sameAliasGroup(candidate, detectedBase)) score += 40;
  if (/M$/.test(detectedCompact) && /M$/.test(compact)) score += 25;
  if (/M$/.test(detectedCompact) && !/M$/.test(compact) && compact === compactMt5Symbol(detectedBase)) {
    score -= 5;
  }
  if (upper.startsWith(detectedBase)) score += 15;
  if (compact.startsWith(compactMt5Symbol(detectedBase))) score += 10;
  return score;
}

/** Map chart text like XAUUSDm onto the broker's real name (XAUUSD.m / XAUUSD / GOLD). */
export function resolveBrokerSymbol(detected, brokerNames) {
  const raw = String(detected || '').trim();
  if (!raw) return null;
  const names = (brokerNames || []).map((item) => String(item || '').trim()).filter(Boolean);
  if (!names.length) return raw;

  const detectedUpper = raw.toUpperCase();
  const detectedCompact = compactMt5Symbol(raw);
  const detectedBase = stripBrokerSymbolSuffix(raw);
  const byUpper = new Map(names.map((name) => [name.toUpperCase(), name]));
  const byCompact = new Map();
  for (const name of names) {
    const compact = compactMt5Symbol(name);
    if (compact && !byCompact.has(compact)) byCompact.set(compact, name);
  }

  if (byUpper.has(detectedUpper)) return byUpper.get(detectedUpper);
  if (byCompact.has(detectedCompact)) return byCompact.get(detectedCompact);

  const candidates = new Set([detectedUpper, detectedBase, detectedCompact, compactMt5Symbol(detectedBase)]);
  for (const group of SYMBOL_ALIAS_GROUPS) {
    if (group.includes(detectedUpper) || group.includes(detectedBase) || group.includes(detectedCompact)) {
      for (const alias of group) candidates.add(alias);
    }
  }
  for (const seed of [...candidates]) {
    for (const suffix of SYMBOL_SUFFIXES) {
      candidates.add(`${seed}${suffix}`.toUpperCase());
      candidates.add(compactMt5Symbol(`${seed}${suffix}`));
    }
  }

  const hits = [];
  const hitSeen = new Set();
  const consider = (name) => {
    if (!name || hitSeen.has(name)) return;
    hitSeen.add(name);
    hits.push(name);
  };
  for (const candidate of candidates) {
    consider(byUpper.get(candidate));
    consider(byCompact.get(candidate));
  }
  if (!hits.length) {
    for (const name of names) {
      const upper = name.toUpperCase();
      const compact = compactMt5Symbol(name);
      if (
        upper === detectedBase ||
        compact === compactMt5Symbol(detectedBase) ||
        upper.includes(detectedBase) ||
        detectedBase.includes(compact)
      ) {
        consider(name);
      }
    }
  }
  if (!hits.length) return null;

  const scored = hits
    .map((name) => ({
      name,
      score: scoreBrokerSymbol(name, detectedUpper, detectedCompact, detectedBase),
    }))
    .sort((a, b) => b.score - a.score);
  if (scored[0].score <= 0) return null;
  if (scored.length === 1 || scored[0].score > scored[1].score) return scored[0].name;
  if (scored[0].score >= 50) return scored[0].name;
  return null;
}

export function brokerSymbolCandidates(detected, brokerNames) {
  const names = (brokerNames || []).map((item) => String(item || '').trim()).filter(Boolean);
  const out = [];
  const seen = new Set();
  const add = (value) => {
    const name = String(value || '').trim();
    if (!name) return;
    const key = name.toUpperCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(name);
  };
  add(resolveBrokerSymbol(detected, names));
  add(detected);
  const compact = compactMt5Symbol(detected);
  for (const name of names) {
    if (compactMt5Symbol(name) === compact) add(name);
  }
  return out;
}

function symbolFamilyBases(value) {
  const bases = new Set();
  const upper = String(value || '').toUpperCase().trim();
  if (!upper) return bases;
  bases.add(compactMt5Symbol(stripBrokerSymbolSuffix(upper)));
  bases.add(compactMt5Symbol(upper));
  for (const group of SYMBOL_ALIAS_GROUPS) {
    const keys = group.map((item) => compactMt5Symbol(item));
    const hit = [...bases].some((item) => keys.includes(item) || group.includes(item));
    if (!hit) continue;
    for (const alias of group) bases.add(compactMt5Symbol(stripBrokerSymbolSuffix(alias)));
  }
  bases.delete('');
  return bases;
}

/** Exact name plus the broker's .mic / .m sibling for the same instrument. */
export function tradeableSymbolCandidates(requested, brokerNames) {
  const names = (brokerNames || []).map((item) => String(item || '').trim()).filter(Boolean);
  const primary = resolveBrokerSymbol(requested, names);
  const bases = symbolFamilyBases(requested);
  if (primary) {
    for (const item of symbolFamilyBases(primary)) bases.add(item);
  }
  const siblings = names.filter((name) => {
    const base = compactMt5Symbol(stripBrokerSymbolSuffix(name));
    return bases.has(base) || bases.has(compactMt5Symbol(name));
  });
  siblings.sort((a, b) => Number(/\.mic$/i.test(b)) - Number(/\.mic$/i.test(a)));
  const out = [];
  const seen = new Set();
  const add = (value) => {
    const name = String(value || '').trim();
    if (!name) return;
    const key = name.toUpperCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(name);
  };
  add(primary);
  for (const name of siblings) add(name);
  add(requested);
  return out;
}

export function tradeModeAllowsOrder(mode) {
  const text = String(mode ?? '').trim().toLowerCase();
  if (!text) return null;
  if (text === '0' || text.includes('disabled') || text.includes('close')) return false;
  if (
    text === '4' ||
    text === '1' ||
    text === '2' ||
    text.includes('full') ||
    text.includes('long') ||
    text.includes('short')
  ) {
    return true;
  }
  return null;
}

function readTradeMode(payload) {
  if (!payload || typeof payload !== 'object') return '';
  const info = payload.symbol && typeof payload.symbol === 'object' ? payload.symbol : payload;
  const group = payload.symbolGroup || payload.group || {};
  return info.tradeMode ?? info.TradeMode ?? info.trade_mode ?? group.tradeMode ?? group.TradeMode ?? '';
}

/** Use the account's enabled name. EURUSD stays EURUSD until the broker says that name cannot trade. */
export async function resolveTradeableSymbol(id, requested, brokerNames, fetchFn = fetch) {
  const names = Array.isArray(brokerNames) ? brokerNames : [];
  const choices = tradeableSymbolCandidates(requested, names);
  const fallback = choices[0] || (names.length ? '' : String(requested || '').trim());
  if (!id || !choices.length) return fallback;
  let unknown = '';
  let sawDisabled = false;
  for (const symbol of choices.slice(0, 6)) {
    const params = await fetchMt5Json(
      fetchFn,
      `/SymbolParams?id=${encodeURIComponent(id)}&symbol=${encodeURIComponent(symbol)}`,
    );
    const allows = tradeModeAllowsOrder(readTradeMode(params));
    if (allows === true) return symbol;
    if (allows === false) {
      sawDisabled = true;
      continue;
    }
    if (!unknown) unknown = symbol;
  }
  if (unknown) return unknown;
  if (sawDisabled) {
    return choices.find((name) => /\.mic$/i.test(name)) || '';
  }
  return fallback;
}

/** One more send on the .mic name when the plain symbol is turned off. */
export async function alternateOrderPath(enrichedPath, fetchFn = fetch) {
  const raw = String(enrichedPath || '');
  const qIndex = raw.indexOf('?');
  const path = qIndex >= 0 ? raw.slice(0, qIndex) : raw;
  if (!/^\/OrderSend(Safe)?$/i.test(path)) return '';
  const params = new URLSearchParams(qIndex >= 0 ? raw.slice(qIndex + 1) : '');
  const id = String(params.get('id') || '').trim();
  const current = String(params.get('symbol') || '').trim();
  if (!id || !current || /\.mic$/i.test(current)) return '';
  const names = await loadBrokerSymbolNames(id, fetchFn).catch(() => []);
  const next = tradeableSymbolCandidates(current, names).find(
    (name) => name.toUpperCase() !== current.toUpperCase() && /\.mic$/i.test(name),
  );
  if (!next) return '';
  params.set('symbol', next);
  try {
    const price = await quoteForSymbol(fetchFn, id, next, params.get('operation'));
    if (price > 0) params.set('price', String(price));
  } catch {
    // Keep the levels already on the request.
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

async function fetchMt5Json(fetchFn, path) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 8000);
  try {
    const res = await fetchFn(`${mt5ApiBase()}${path}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: ac.signal,
    });
    clearTimeout(timer);
    if (res.status !== 200) return null;
    if (typeof res.json === 'function') return await res.json();
    return null;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

export async function loadBrokerSymbolNames(id, fetchFn = fetch) {
  const token = String(id || '').trim();
  if (!token) return [];
  const encoded = encodeURIComponent(token);
  const list = parseMt5SymbolNames(await fetchMt5Json(fetchFn, `/SymbolList?id=${encoded}`));
  if (list.length) return list;
  return parseMt5SymbolNames(await fetchMt5Json(fetchFn, `/Symbols?id=${encoded}`));
}

async function quoteForSymbol(fetchFn, id, symbol, operation) {
  const res = await fetchMt5Json(
    fetchFn,
    `/GetQuote?id=${encodeURIComponent(id)}&symbol=${encodeURIComponent(symbol)}&msNotOlder=0`,
  );
  if (!res || typeof res !== 'object') return 0;
  return priceForOperation(res, operation);
}

function marketSide(operation) {
  const op = mapMt5Operation(operation);
  if (op === '1') return 'sell';
  if (op === '0') return 'buy';
  return '';
}

/** Buy at/above the attached target, or sell at/below it, is already done. */
export function marketAlreadyThroughTarget(operation, price, takeProfit) {
  const side = marketSide(operation);
  const px = Number(price);
  const tp = Number(takeProfit);
  if (!side || !(px > 0) || !(tp > 0)) return false;
  return side === 'sell' ? px <= tp : px >= tp;
}

function applyFillToLevels(params, livePrice) {
  const side = marketSide(params.get('operation'));
  const entry = Number(params.get('entry'));
  const stopLoss = Number(params.get('stoploss'));
  const takeProfit = Number(params.get('takeprofit'));
  const fresh = params.get('fresh') === '1';
  params.delete('entry');
  params.delete('fresh');
  if (!side || !(livePrice > 0)) return;
  if (entry > 0 && stopLoss > 0) {
    const anchored = anchorRiskLadder(side, entry, stopLoss, livePrice, takeProfit, {
      fresh,
      symbol: params.get('symbol'),
    });
    if (!anchored.ok) throw new Mt5LevelError(anchored.error);
    params.set('stoploss', String(anchored.stopLoss));
    if (anchored.takeProfit > 0) params.set('takeprofit', String(anchored.takeProfit));
    return;
  }
  if (marketAlreadyThroughTarget(side, livePrice, takeProfit)) {
    throw new Mt5LevelError(
      side === 'sell' ? 'Price already reached TP. Sell skipped.' : 'Price already reached TP. Buy skipped.',
    );
  }
}

export async function enrichOrderSendPath(targetPath, fetchFn = fetch) {
  const rewritten = rewriteMt5Path(targetPath);
  const qIndex = rewritten.indexOf('?');
  const path = qIndex >= 0 ? rewritten.slice(0, qIndex) : rewritten;
  const params = new URLSearchParams(qIndex >= 0 ? rewritten.slice(qIndex + 1) : '');
  if (!/^\/OrderSendSafe$/i.test(path)) return rewritten;

  const id = String(params.get('id') || '').trim();
  const requested = String(params.get('symbol') || '').trim();
  let livePrice = Number(params.get('price')) || 0;
  if (id && requested) {
    let names = [];
    try {
      names = await loadBrokerSymbolNames(id, fetchFn);
    } catch {
      names = [];
    }
    const candidates = tradeableSymbolCandidates(requested, names);
    let resolved = (await resolveTradeableSymbol(id, requested, names, fetchFn)) || candidates[0] || requested;
    const existing = Number(params.get('price'));
    if (!(existing > 0)) {
      const quoteOrder = [resolved, ...candidates.filter((symbol) => symbol !== resolved)];
      for (const symbol of quoteOrder.length ? quoteOrder : [requested]) {
        try {
          const price = await quoteForSymbol(fetchFn, id, symbol, params.get('operation'));
          if (price > 0) {
            params.set('price', String(price));
            livePrice = price;
            if (symbol === resolved || !resolved) resolved = symbol;
            break;
          }
        } catch {
          // Instant-execution brokers need a price; market-execution can still send without one.
        }
      }
    } else if (resolved) {
      livePrice = existing;
    }
    if (resolved) params.set('symbol', resolved);
  }

  applyFillToLevels(params, livePrice);

  if (!params.get('slippage')) params.set('slippage', '100');
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

function envMt5Base() {
  return String(process.env.MT5_API_BASE || process.env.mt5_api_base || '').replace(/\/$/, '');
}

const BROKER_TERMINALS = [
  { server: 'razormarkets-live', terminalUrl: 'https://webtrader.razormarkets.co.za/terminal' },
  { server: 'rcgmarkets-live', terminalUrl: 'https://webtrader.rcgmarkets.com/terminal' },
  { server: 'rcgmarkets-demo', terminalUrl: 'https://webtrader-demo.rcgmarkets.com/terminal' },
  { server: 'accumarkets-live', terminalUrl: 'https://webterminal.accumarkets.co.za/terminal' },
  { server: 'rockwest-server', terminalUrl: 'https://webtrader.rock-west.com/terminal' },
  { server: 'luxetradingmarkets-live', terminalUrl: 'https://webtrader.luxemarkets.forex/' },
  { server: 'maonoglobalmarkets-live', terminalUrl: 'https://web.maonoglobalmarkets.com/terminal' },
  { server: 'rocketx-live', terminalUrl: 'https://webtrader.rocketx.io:1950/terminal' },
  { server: 'spacemarkets-live', terminalUrl: 'https://webtrader.spacemarkets.io:1960/terminal' },
  { server: 'deriv-demo', terminalUrl: 'https://mt5-demo-web.deriv.com/terminal' },
  { server: 'derivsvg-server', terminalUrl: 'https://mt5-real01-web-svg.deriv.com/terminal' },
  { server: 'derivsvg-server-02', terminalUrl: 'https://mt5-real02-web-svg.deriv.com/terminal' },
  { server: 'derivsvg-server-03', terminalUrl: 'https://mt5-real03-web-svg.deriv.com/terminal' },
  { server: 'derivbvi-server', terminalUrl: 'https://mt5-real01-web-bvi.deriv.com/terminal' },
  { server: 'derivbvi-server-02', terminalUrl: 'https://mt5-real02-web-bvi.deriv.com/terminal' },
  { server: 'derivbvi-server-03', terminalUrl: 'https://mt5-real03-web-bvi.deriv.com/terminal' },
  { server: 'derivbvi-server-vu', terminalUrl: 'https://mt5-real01-web-vu.deriv.com/terminal' },
  { server: 'derivbvi-server-vu-02', terminalUrl: 'https://mt5-real02-web-vu.deriv.com/terminal' },
  { server: 'derivbvi-server-vu-03', terminalUrl: 'https://mt5-real03-web-vu.deriv.com/terminal' },
];

const byServer = new Map(
  BROKER_TERMINALS.map((entry) => [entry.server.toLowerCase(), entry]),
);

export function getBrokerTerminal(serverName) {
  return byServer.get(String(serverName || '').trim().toLowerCase());
}

export function parseTerminalEndpoint(terminalUrl) {
  try {
    const u = new URL(terminalUrl);
    const host = u.hostname;
    if (!host) return null;
    const port = u.port ? Number(u.port) : u.protocol === 'https:' ? 443 : 80;
    return { host, port };
  } catch {
    return null;
  }
}

function mt5Bases() {
  const host = (process.env.MT5_API_HOST || DEFAULT_MT5_API_HOST).trim();
  const envBase = envMt5Base();
  // HTTP first — this host does not serve HTTPS and TLS handshakes hang.
  return [...(envBase ? [envBase] : []), `http://${host}`].filter(
    (b, i, arr) => arr.indexOf(b) === i,
  );
}

export function mt5ApiBase() {
  return mt5Bases()[0] || DEFAULT_MT5_API_BASE;
}

async function readUpstreamText(res) {
  const text = (await res.text()).trim();
  if (!text) return '';
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === 'string') return parsed.trim();
    if (parsed && typeof parsed === 'object') {
      if (parsed.ticket != null && parsed.ticket !== '') return String(parsed.ticket).trim();
      if (typeof parsed.token === 'string') return parsed.token.trim();
      if (typeof parsed.id === 'string') return parsed.id.trim();
    }
    return text;
  } catch {
    return text.replace(/^"|"$/g, '');
  }
}

async function mt5Request(targetPath, timeoutMs = 12000) {
  let lastErr = 'MT5 bridge unreachable';
  let path;
  try {
    path = await enrichOrderSendPath(targetPath);
  } catch (err) {
    if (err instanceof Mt5LevelError) return { ok: false, error: err.message };
    throw err;
  }
  for (const base of mt5Bases()) {
    const targetUrl = `${base}${path}`;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const upstream = await fetch(targetUrl, {
        method: 'GET',
        headers: { Accept: 'application/json, text/plain, */*' },
        signal: ac.signal,
      });
      clearTimeout(timer);
      const body = await readUpstreamText(upstream);
      if (upstream.status === 200 && body && !/error|fail|invalid/i.test(body)) {
        return { ok: true, token: body.replace(/^"|"$/g, ''), status: upstream.status };
      }
      lastErr = body || `Connect failed (${upstream.status})`;
    } catch (err) {
      clearTimeout(timer);
      lastErr =
        err instanceof Error
          ? `MT5 bridge unreachable via ${base}: ${err.message}`
          : `MT5 bridge unreachable via ${base}`;
    }
  }
  return { ok: false, error: lastErr };
}

/**
 * Connect to MT5 — swagger ConnectEx (server name) first, web terminal fallback.
 */
export async function connectMt5Broker(input) {
  const user = String(input.user || '').trim();
  const password = String(input.password || '');
  const server = String(input.server || '').trim();
  if (!user || !password || !server) {
    return { ok: false, error: 'Missing login, password, or server' };
  }

  const attempts = [];

  // Primary: swagger ConnectEx by MT5 server name
  const exParams = new URLSearchParams({ user, password, server });
  attempts.push(`/ConnectEx?${exParams.toString()}`);

  // Fallback: web terminal host/port Connect
  const entry = getBrokerTerminal(server);
  const endpoint = entry ? parseTerminalEndpoint(entry.terminalUrl) : null;
  if (endpoint) {
    const params = new URLSearchParams({
      user,
      password,
      host: endpoint.host,
      port: String(endpoint.port),
    });
    attempts.push(`/Connect?${params.toString()}`);
  }

  let lastErr = 'Connection failed';
  for (const path of attempts) {
    const result = await mt5Request(path);
    if (result.ok && result.token) {
      return { ok: true, token: result.token };
    }
    lastErr = result.error || lastErr;
  }

  return { ok: false, error: lastErr };
}

export async function checkMt5Connect(id) {
  const token = String(id || '').trim();
  if (!token) return { ok: false, error: 'Broker/MT5 connection is not active' };
  const result = await mt5Request(`/CheckConnect?id=${encodeURIComponent(token)}`);
  const body = String(result.token || result.error || '');
  if (result.ok && /ok/i.test(body)) return { ok: true };
  return { ok: false, error: 'Broker/MT5 connection is not active' };
}

function optionalPrice(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Existing MT5 OrderSend proxy — omit TP/SL when they are none/0. */
export async function sendMt5MarketOrder(input) {
  const id = String(input?.id || '').trim();
  const symbol = String(input?.symbol || '').trim();
  const operation = String(input?.operation || '').trim();
  const volume = Number(input?.volume);
  if (!id) return { ok: false, error: 'Broker/MT5 connection is not active' };
  if (!symbol) return { ok: false, error: 'Symbol is not valid' };
  if (operation !== 'Buy' && operation !== 'Sell') {
    return { ok: false, error: 'Direction is not valid' };
  }
  if (!Number.isFinite(volume) || volume <= 0) {
    return { ok: false, error: 'Volume is not valid' };
  }

  const params = new URLSearchParams({
    id,
    symbol,
    operation,
    volume: String(volume),
  });
  if (input?.comment) params.set('comment', String(input.comment).slice(0, 31));
  if (input?.slippage != null) params.set('slippage', String(input.slippage));
  const stopLoss = optionalPrice(input?.stopLoss);
  const takeProfit = optionalPrice(input?.takeProfit);
  if (stopLoss) params.set('stoploss', String(stopLoss));
  if (takeProfit) params.set('takeprofit', String(takeProfit));

  const result = await mt5Request(`/OrderSend?${params.toString()}`, 20000);
  if (!result.ok) return { ok: false, error: mt5ExceptionMessage(result.error) || result.error || 'OrderSend failed' };
  const ticket = extractMt5Ticket(result.token);
  if (!ticket) {
    return { ok: false, error: mt5ExceptionMessage(result.token) || 'Broker did not open the order' };
  }
  return { ok: true, ticket, raw: result.token };
}
