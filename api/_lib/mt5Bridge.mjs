/**
 * MT5 broker bridge — connects through the swagger REST API
 * (ConnectEx / Connect / Health) and proxies account + trade endpoints server-side.
 * Primary host: DigitalOcean droplet mt5rest at 142.93.68.250 (nginx :80 + docker :5000).
 * Broker egress uses DigitalOcean SOCKS at 142.93.68.250:1080.
 * Do not use trycloudflare or other ephemeral tunnels.
 * Trial renew 2026-11-23 → new DO droplet IP 142.93.68.250.
 */

import { anchorRiskLadder } from './chartScanParse.mjs';

export class Mt5LevelError extends Error {
  constructor(message) {
    super(message);
    this.name = 'Mt5LevelError';
  }
}

export const DEFAULT_MT5_API_HOST = '142.93.68.250';
export const DEFAULT_MT5_API_BASE = `http://${DEFAULT_MT5_API_HOST}`;

function mt5SocksConfig() {
  if (String(process.env.MT5_SOCKS_DISABLE || process.env.mt5_socks_disable || '').trim() === '1') return null;
  const host = String(process.env.MT5_SOCKS_HOST || process.env.mt5_socks_host || '142.93.68.250').trim();
  const port = Number(process.env.MT5_SOCKS_PORT || process.env.mt5_socks_port || 1080);
  const user = String(process.env.MT5_SOCKS_USER || process.env.mt5_socks_user || 'lumo').trim();
  const password = String(process.env.MT5_SOCKS_PASS || process.env.mt5_socks_pass || 'LumoSock7mt5');
  if (!host || !Number.isFinite(port) || port <= 0) return null;
  // mt5rest enum: 0=None 1=Http 2=Socks4 3=Socks5. API runs on same droplet → use loopback.
  const apiHost = String(process.env.MT5_API_HOST || DEFAULT_MT5_API_HOST)
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/:\d+$/, '');
  const sameHost = apiHost && (apiHost === host || host === '127.0.0.1' || host === 'localhost');
  return {
    host: sameHost ? '127.0.0.1' : host,
    port,
    user,
    password,
    type: '3',
  };
}

function isPrivateOrLocalHost(host) {
  const h = String(host || '').trim().toLowerCase();
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.local')) return true;
  if (h.startsWith('10.') || h.startsWith('127.') || h.startsWith('192.168.') || h.startsWith('169.254.')) return true;
  const m = /^172\.(\d+)\./.exec(h);
  if (m) {
    const n = Number(m[1]);
    if (n >= 16 && n <= 31) return true;
  }
  // RFC6598 CGNAT (often appears in broker access lists and is not reachable)
  const cgnat = /^100\.(\d+)\./.exec(h);
  if (cgnat) {
    const n = Number(cgnat[1]);
    if (n >= 64 && n <= 127) return true;
  }
  return false;
}

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
  const raw = String(process.env.MT5_API_BASE || process.env.mt5_api_base || '')
    .trim()
    .replace(/\/$/, '');
  // Ignore encrypted/invalid values — only accept real HTTP(S) bridge URLs.
  if (!/^https?:\/\//i.test(raw)) return '';
  try {
    const u = new URL(raw);
    if (!u.hostname) return '';
    return raw;
  } catch {
    return '';
  }
}

const BROKER_TERMINALS = [
  { server: 'razormarkets-live', terminalUrl: 'https://webtrader.razormarkets.co.za/terminal' },
  { server: 'razormarkets-demo', terminalUrl: 'https://webtrader.razormarkets.co.za/terminal' },
  { server: 'rcgmarkets-live', terminalUrl: 'https://webtrader.rcgmarkets.com/terminal' },
  { server: 'rcgmarkets-demo', terminalUrl: 'https://webtrader-demo.rcgmarkets.com/terminal' },
  { server: 'rcgmarkets-real', terminalUrl: 'https://webtrader.rcgmarkets.com/terminal' },
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
  { server: 'derivvu-server', terminalUrl: 'https://mt5-real01-web-vu.deriv.com/terminal' },
  { server: 'derivmu-server', terminalUrl: 'https://mt5-real01-web.deriv.com/terminal' },
  { server: 'pepperstone-mt5-live01', terminalUrl: 'https://live-mt5.pepperstone.com/terminal' },
  { server: 'pepperstone-mt5-live', terminalUrl: 'https://live-mt5.pepperstone.com/terminal' },
  { server: 'icmarketssc-mt5', terminalUrl: 'https://mt5.icmarkets.com/terminal' },
];

const byServer = new Map(
  BROKER_TERMINALS.map((entry) => [entry.server.toLowerCase(), entry]),
);

function compactServerKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

export function getBrokerTerminal(serverName) {
  const raw = String(serverName || '').trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  const direct = byServer.get(lower);
  if (direct) return direct;
  const compact = compactServerKey(raw);
  for (const [key, entry] of byServer.entries()) {
    const keyCompact = compactServerKey(key);
    if (compact === keyCompact || compact.startsWith(keyCompact) || keyCompact.startsWith(compact)) {
      return entry;
    }
  }
  return null;
}

function companyHintsFromServer(serverName) {
  const raw = String(serverName || '').trim();
  if (!raw) return [];
  const base = raw.split(/[-_\s]/)[0] || raw;
  const hints = new Set([
    raw,
    base,
    base.replace(/MT5$/i, ''),
    base.replace(/(SC|EU|KE|MU|UK|CY|SVG|BVI|VU|ZA|GRP)$/i, ''),
  ]);
  const compact = base.toLowerCase();
  if (compact.includes('exness')) hints.add('Exness');
  if (compact.includes('icmarkets') || compact === 'ic') hints.add('IC Markets');
  if (compact.startsWith('xm')) hints.add('XM');
  if (compact.includes('ftmo')) hints.add('FTMO');
  if (compact.includes('deriv')) hints.add('Deriv');
  if (compact.includes('pepper')) hints.add('Pepperstone');
  if (compact.includes('razor')) hints.add('Razor');
  if (compact.includes('rcg')) hints.add('RCG');
  return [...hints].map((h) => String(h || '').trim()).filter((h) => h.length >= 2);
}

function serverNamesMatch(a, b) {
  const left = String(a || '').trim().toLowerCase();
  const right = String(b || '').trim().toLowerCase();
  if (!left || !right) return false;
  if (left === right) return true;
  return compactServerKey(left) === compactServerKey(right);
}

function parseAccessEndpoint(access) {
  const raw = String(access || '').trim();
  if (!raw) return null;
  // IPv6 in brackets: [host]:port
  const bracket = raw.match(/^\[([^\]]+)\]:(\d+)$/);
  if (bracket) return { host: bracket[1], port: Number(bracket[2]) || 443 };
  const idx = raw.lastIndexOf(':');
  if (idx <= 0) return { host: raw, port: 443 };
  const host = raw.slice(0, idx).trim();
  const port = Number(raw.slice(idx + 1).trim()) || 443;
  if (!host) return null;
  return { host, port };
}

async function lookupServerAccess(serverName, fetchFn = fetch) {
  const hints = companyHintsFromServer(serverName);
  const out = [];
  const seen = new Set();
  for (const hint of hints.slice(0, 4)) {
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 10000);
      const res = await fetchFn(`${mt5ApiBase()}/Search?company=${encodeURIComponent(hint)}`, {
        method: 'GET',
        headers: { Accept: 'application/json, text/plain, */*' },
        signal: ac.signal,
      });
      clearTimeout(timer);
      if (!res.ok) continue;
      const rows = await res.json().catch(() => []);
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        for (const server of row?.results || []) {
          if (!serverNamesMatch(server?.name, serverName)) continue;
          for (const access of server?.access || []) {
            const endpoint = parseAccessEndpoint(access);
            if (!endpoint) continue;
            const key = `${endpoint.host}:${endpoint.port}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(endpoint);
          }
        }
      }
      if (out.length) break;
    } catch {
      /* try next hint */
    }
  }
  // Prefer publicly routable trade servers — many broker Search rows include private 10.x first.
  out.sort((a, b) => Number(isPrivateOrLocalHost(a.host)) - Number(isPrivateOrLocalHost(b.host)));
  const publicOnly = out.filter((e) => !isPrivateOrLocalHost(e.host));
  return (publicOnly.length ? publicOnly : out).slice(0, 8);
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
  const host = (process.env.MT5_API_HOST || DEFAULT_MT5_API_HOST).trim().replace(/^https?:\/\//i, '');
  const envBase = envMt5Base();
  const bases = [];
  if (envBase) bases.push(envBase.replace(/\/$/, ''));
  if (host) {
    if (/^https?:\/\//i.test(process.env.MT5_API_HOST || '')) {
      bases.push((process.env.MT5_API_HOST || '').replace(/\/$/, ''));
    } else if (/trycloudflare\.com/i.test(host)) {
      bases.push(`https://${host}`);
    } else {
      const isIpOrPort = /:\d+$/.test(host) || /^\d+\.\d+\.\d+\.\d+$/.test(host);
      if (isIpOrPort) {
        const bare = host.replace(/:\d+$/, '');
        bases.push(`http://${bare}`);
        bases.push(`http://${bare}:5000`);
      } else {
        bases.push(`https://${host}`);
        bases.push(`http://${host}`);
      }
    }
  }
  // Dead droplet fallbacks only when no live tunnel/API base is configured.
  // Hitting 157.x while CF is up wastes ~28s per attempt and leaves the phone at 88%.
  const usingLiveTunnel = bases.some((b) => /trycloudflare\.com/i.test(b));
  if (!usingLiveTunnel) {
    bases.push('http://142.93.68.250');
    bases.push('http://142.93.68.250:5000');
  }
  return [...new Set(bases.filter(Boolean))];
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

function isDefinitiveMt5Error(body) {
  const text = String(body || '');
  // CONNECT_ERROR is host/path specific — let callers try the next access endpoint / API base.
  return /trial expired|invalid_account|invalid login|wrong.?password|MAX_SESSIONS|license/i.test(
    text,
  );
}

async function mt5Request(targetPath, timeoutMs = 45000) {
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
      // Broker/license answered — do not keep trying alternate hosts.
      if (isDefinitiveMt5Error(body) || upstream.status === 201) {
        return { ok: false, error: lastErr };
      }
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

function isCredentialError(body) {
  return /invalid_account|invalid login|wrong.?password|invalid password/i.test(String(body || ''));
}

function isHandshakeSoftError(body) {
  return /SendAccountPassword expected|Server closed the socket|CONNECT_ERROR|Not connected: the connect deadline|disposed object|Network unreachable|had scoket error|had socket error/i.test(
    String(body || ''),
  );
}

function extractSuggestedServers(errorText) {
  const text = String(errorText || '');
  const out = [];
  const mean = /Did you mean '([^']+)'/i.exec(text);
  if (mean?.[1]) out.push(mean[1].trim());
  const avail = /Available:\s*([^(:]+)/i.exec(text);
  if (avail?.[1]) {
    for (const part of avail[1].split(',')) {
      const name = part.trim().replace(/\.$/, '');
      if (name && !out.includes(name)) out.push(name);
    }
  }
  return out.slice(0, 4);
}

/** Common UI / shorthand names → exact MT5 directory names */
const SERVER_ALIASES = {
  'pepperstone-mt5': 'Pepperstone-MT5-Live01',
  'pepperstone-mt5-live': 'Pepperstone-MT5-Live01',
  'pepperstoneuk-mt5': 'PepperstoneUK-Live',
  'icmarketseu-mt5': 'ICMarketsEU-MT5-5',
  'icmarketssc-mt5': 'ICMarketsSC-MT5',
  'roboforex-demo': 'RoboForex-ECN',
  'admiralmarkets-live': 'AdmiralMarketsAS-Live',
  'justmarkets-mt5': 'JustMarkets-Live',
  'oanda-mt5': 'OANDA-Live-1',
  'hfmarketsglobal-mt5': 'HFMarketsGlobal-Live4',
  'hfm-live': 'HFMarketsGlobal-Live4',
  'forex.com-live': 'Forex.com-Live 536',
  'vantageinternational-mt5': 'VantageMarkets-Live 8',
};

/**
 * Connect to MT5 — ConnectEx by server name, then host:port from live Search
 * access lists / known web terminals. Many brokers (Exness, XM, …) reject
 * ConnectEx but accept Connect on the published trade-server endpoints.
 */
export function formatMt5ConnectError(raw) {
  let err = String(raw || 'Connect failed');
  try {
    const parsed = JSON.parse(err);
    if (parsed && typeof parsed === 'object') {
      err = String(parsed.message || parsed.error || parsed.code || err);
    }
  } catch {
    /* keep raw */
  }
  const lower = err.toLowerCase();
  if (/invalid_account|invalid login|wrong.?password|invalid password/.test(lower)) {
    return 'Invalid login or password for this server. Check MT5 credentials and try again.';
  }
  if (/sendaccountpassword expected|server closed the socket|disposed object/.test(lower)) {
    return 'Could not open this MT5 server. Search your broker again and pick the exact server name shown in MT5.';
  }
  if (/server .+ not found/i.test(err)) {
    const clean = err.split('Process:')[0].split('stackTrace')[0].trim();
    return clean.slice(0, 240) || 'Server not found. Search your broker and pick the exact MT5 server name.';
  }
  if (/trial expired|license/.test(lower)) {
    return 'Broker API trial expired. Please renew the MT5 API.';
  }
  // strip noisy stack traces
  return err.split('Process:')[0].split('stackTrace')[0].trim().slice(0, 240) || 'Connect failed';
}

export async function connectMt5Broker(input) {
  const user = String(input.user || '').trim();
  const password = String(input.password || '');
  let server = String(input.server || '').trim();
  if (!user || !password || !server) {
    return { ok: false, error: 'Missing login, password, or server' };
  }
  const aliased = SERVER_ALIASES[server.toLowerCase()];
  if (aliased) server = aliased;

  const sessionId = `lumo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const socks = mt5SocksConfig();
  const attempts = [];
  const seen = new Set();
  const addAttempt = (path) => {
    if (!path || seen.has(path)) return;
    seen.add(path);
    attempts.push(path);
  };

  const proxyFields = socks
    ? {
        proxyHost: socks.host,
        proxyPort: String(socks.port),
        proxyType: socks.type,
        ...(socks.user ? { proxyUser: socks.user, proxyPassword: socks.password } : {}),
      }
    : null;

  let lastErr = 'Connection failed';
  const tryPaths = async (paths, timeoutMs = 22000) => {
    for (const path of paths) {
      let result = await mt5Request(path, timeoutMs);
      if (!result.ok && /wait \d+ milliseconds|had scoket error|had socket error|disposed object/i.test(String(result.error || ''))) {
        await new Promise((r) => setTimeout(r, 400));
        result = await mt5Request(path, timeoutMs);
      }
      if (result.ok && result.token) {
        return { ok: true, token: result.token };
      }
      lastErr = result.error || lastErr;
      if (isCredentialError(lastErr)) {
        return { ok: false, error: formatMt5ConnectError(lastErr) };
      }
      if (/proxy .* is not reachable/i.test(String(lastErr))) {
        continue;
      }
    }
    return null;
  };

  // Fast path: ConnectEx immediately — do NOT await Search first (Search hangs left the UI at 88%).
  addAttempt(
    `/ConnectEx?${new URLSearchParams({
      user,
      password,
      server,
      id: sessionId,
      connectTimeoutSeconds: '20',
    }).toString()}`,
  );
  if (proxyFields) {
    addAttempt(
      `/ConnectProxyEx?${new URLSearchParams({
        user,
        password,
        server,
        id: sessionId,
        connectTimeoutSeconds: '20',
        ...proxyFields,
      }).toString()}`,
    );
  }
  const fastCount = attempts.length;
  const fast = await tryPaths(attempts, 22000);
  if (fast) return fast;

  // Slow path: live Search access IPs + terminal hosts
  const accessEndpoints = await Promise.race([
    lookupServerAccess(server).catch(() => []),
    new Promise((resolve) => setTimeout(() => resolve([]), 8000)),
  ]);
  for (const endpoint of accessEndpoints) {
    if (proxyFields) {
      addAttempt(
        `/ConnectProxy?${new URLSearchParams({
          user,
          password,
          host: endpoint.host,
          port: String(endpoint.port || 443),
          id: sessionId,
          connectTimeoutSeconds: '20',
          ...proxyFields,
        }).toString()}`,
      );
    }
    addAttempt(
      `/Connect?${new URLSearchParams({
        user,
        password,
        host: endpoint.host,
        port: String(endpoint.port || 443),
        id: sessionId,
        connectTimeoutSeconds: '20',
      }).toString()}`,
    );
  }

  const entry = getBrokerTerminal(server);
  const terminal = entry ? parseTerminalEndpoint(entry.terminalUrl) : null;
  if (terminal) {
    if (proxyFields) {
      addAttempt(
        `/ConnectProxy?${new URLSearchParams({
          user,
          password,
          host: terminal.host,
          port: String(terminal.port),
          id: sessionId,
          connectTimeoutSeconds: '20',
          ...proxyFields,
        }).toString()}`,
      );
    }
    addAttempt(
      `/Connect?${new URLSearchParams({
        user,
        password,
        host: terminal.host,
        port: String(terminal.port),
        id: sessionId,
        connectTimeoutSeconds: '20',
      }).toString()}`,
    );
  }

  const first = await tryPaths(attempts.slice(fastCount), 18000);
  if (first) return first;

  // Auto-retry with exact directory names suggested by mt5rest ("Did you mean…")
  if (/server .+ not found/i.test(String(lastErr))) {
    for (const alt of extractSuggestedServers(lastErr)) {
      if (!alt || alt.toLowerCase() === server.toLowerCase()) continue;
      const altAttempts = [];
      if (proxyFields) {
        altAttempts.push(
          `/ConnectProxyEx?${new URLSearchParams({
            user,
            password,
            server: alt,
            id: `${sessionId}-a`,
            connectTimeoutSeconds: '25',
            ...proxyFields,
          }).toString()}`,
        );
      }
      altAttempts.push(
        `/ConnectEx?${new URLSearchParams({
          user,
          password,
          server: alt,
          id: `${sessionId}-a`,
          connectTimeoutSeconds: '25',
        }).toString()}`,
      );
      const hit = await tryPaths(altAttempts);
      if (hit) return hit;
    }
  }

  return { ok: false, error: formatMt5ConnectError(lastErr) };
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
