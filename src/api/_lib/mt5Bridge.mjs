/**
 * MT5 broker bridge — connects through the swagger REST API at 159.203.191.196
 * (ConnectEx / Connect) and proxies account + trade endpoints server-side.
 */

export const DEFAULT_MT5_API_HOST = '159.203.191.196';
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

export async function enrichOrderSendPath(targetPath, fetchFn = fetch) {
  const rewritten = rewriteMt5Path(targetPath);
  const qIndex = rewritten.indexOf('?');
  const path = qIndex >= 0 ? rewritten.slice(0, qIndex) : rewritten;
  const params = new URLSearchParams(qIndex >= 0 ? rewritten.slice(qIndex + 1) : '');
  if (!/^\/OrderSendSafe$/i.test(path)) return rewritten;

  const existing = Number(params.get('price'));
  if (!(existing > 0)) {
    const id = String(params.get('id') || '').trim();
    const symbol = String(params.get('symbol') || '').trim();
    if (id && symbol) {
      try {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 8000);
        const res = await fetchFn(
          `${mt5ApiBase()}/GetQuote?id=${encodeURIComponent(id)}&symbol=${encodeURIComponent(symbol)}&msNotOlder=0`,
          { method: 'GET', headers: { Accept: 'application/json' }, signal: ac.signal },
        );
        clearTimeout(timer);
        if (res.status === 200) {
          const quote = await res.json();
          const price = priceForOperation(quote, params.get('operation'));
          if (price > 0) params.set('price', String(price));
        }
      } catch {
        // Instant-execution brokers need a price; market-execution can still send without one.
      }
    }
  }
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
  const path = await enrichOrderSendPath(targetPath);
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
