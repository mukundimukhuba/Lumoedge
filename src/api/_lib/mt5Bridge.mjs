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
  const path = rewriteMt5Path(targetPath);
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
  if (!result.ok) return { ok: false, error: result.error || 'OrderSend failed' };
  return { ok: true, ticket: String(result.token || '').trim(), raw: result.token };
}
