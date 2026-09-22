/**
 * Central Lumo Edge broker catalog (Firebase `lumo/brokers`).
 * Live MT5 /Search supplies servers; this catalog supplies real account types,
 * enable flags, and admin-managed metadata shared by Android + Admin Portal.
 */

export const BROKER_SEED = [
  {
    id: 'razormarkets',
    name: 'Razor Markets',
    aliases: ['RazorMarkets', 'Razor Markets', 'Razor Markets (Pty) Ltd'],
    enabled: true,
    recommended: true,
    platforms: ['MT5'],
    site: 'https://razormarkets.co.za',
    logoUrl: '',
    accountTypes: [
      { name: '100% Bonus Standard', platform: 'MT5' },
      { name: 'Standard', platform: 'MT5' },
      { name: 'Raw Spread', platform: 'MT5' },
    ],
    servers: [
      { name: 'RazorMarkets-Live', platform: 'MT5', mode: 'live' },
      { name: 'RazorMarkets-Demo', platform: 'MT5', mode: 'demo' },
    ],
  },
  {
    id: 'exness',
    name: 'Exness',
    aliases: [
      'Exness',
      'Exness Technologies Ltd',
      'Exness (KE) Limited',
      'Exness (MU) Ltd',
      'Exness (CY) Ltd',
      'Exness Technologies',
    ],
    enabled: true,
    recommended: false,
    platforms: ['MT4', 'MT5'],
    site: 'https://www.exness.com',
    logoUrl: '',
    accountTypes: [
      { name: 'Standard', platform: 'MT5' },
      { name: 'Standard Cent', platform: 'MT5' },
      { name: 'Pro', platform: 'MT5' },
      { name: 'Raw Spread', platform: 'MT5' },
      { name: 'Zero', platform: 'MT5' },
      { name: 'Standard', platform: 'MT4' },
      { name: 'Pro', platform: 'MT4' },
      { name: 'Raw Spread', platform: 'MT4' },
      { name: 'Zero', platform: 'MT4' },
    ],
    servers: [],
  },
  {
    id: 'icmarkets',
    name: 'IC Markets',
    aliases: ['IC Markets', 'ICMarkets', 'Raw Trading Ltd', 'International Capital Markets'],
    enabled: true,
    recommended: false,
    platforms: ['MT4', 'MT5'],
    site: 'https://www.icmarkets.com',
    logoUrl: '',
    accountTypes: [
      { name: 'Standard', platform: 'MT5' },
      { name: 'Raw Spread', platform: 'MT5' },
      { name: 'cTrader Raw', platform: 'MT5' },
      { name: 'Standard', platform: 'MT4' },
      { name: 'Raw Spread', platform: 'MT4' },
    ],
    servers: [{ name: 'ICMarketsSC-MT5', platform: 'MT5', mode: 'live' }],
  },
  {
    id: 'xm',
    name: 'XM',
    aliases: ['XM', 'XM Global', 'Trading Point', 'XM.com'],
    enabled: true,
    recommended: false,
    platforms: ['MT4', 'MT5'],
    site: 'https://www.xm.com',
    logoUrl: '',
    accountTypes: [
      { name: 'Standard', platform: 'MT5' },
      { name: 'Micro', platform: 'MT5' },
      { name: 'Ultra Low', platform: 'MT5' },
      { name: 'Shares', platform: 'MT5' },
      { name: 'Standard', platform: 'MT4' },
      { name: 'Micro', platform: 'MT4' },
      { name: 'Ultra Low', platform: 'MT4' },
    ],
    servers: [],
  },
  {
    id: 'ftmo',
    name: 'FTMO',
    aliases: ['FTMO', 'FTMO.com'],
    enabled: true,
    recommended: false,
    platforms: ['MT4', 'MT5'],
    site: 'https://ftmo.com',
    logoUrl: '',
    accountTypes: [
      { name: 'Challenge', platform: 'MT5' },
      { name: 'Verification', platform: 'MT5' },
      { name: 'FTMO Account', platform: 'MT5' },
      { name: 'Challenge', platform: 'MT4' },
      { name: 'Verification', platform: 'MT4' },
      { name: 'FTMO Account', platform: 'MT4' },
    ],
    servers: [],
  },
  {
    id: 'deriv',
    name: 'Deriv',
    aliases: ['Deriv', 'Deriv (SVG)', 'Deriv (BVI)', 'Deriv (VU)', 'Binary.com'],
    enabled: true,
    recommended: false,
    platforms: ['MT5'],
    site: 'https://deriv.com',
    logoUrl: '',
    accountTypes: [
      { name: 'Financial STP', platform: 'MT5' },
      { name: 'Financial', platform: 'MT5' },
      { name: 'Synthetic Indices', platform: 'MT5' },
      { name: 'Swap-Free', platform: 'MT5' },
    ],
    servers: [],
  },
  {
    id: 'rcgmarkets',
    name: 'RCG Markets',
    aliases: ['RCG Markets', 'RCGMarkets'],
    enabled: true,
    recommended: false,
    platforms: ['MT5'],
    site: 'https://rcgmarkets.com',
    logoUrl: '',
    accountTypes: [
      { name: 'Standard', platform: 'MT5' },
      { name: 'Raw', platform: 'MT5' },
    ],
    servers: [
      { name: 'RCGMarkets-Live', platform: 'MT5', mode: 'live' },
      { name: 'RCGMarkets-Demo', platform: 'MT5', mode: 'demo' },
    ],
  },
  {
    id: 'pepperstone',
    name: 'Pepperstone',
    aliases: ['Pepperstone', 'Pepperstone Limited'],
    enabled: true,
    recommended: false,
    platforms: ['MT4', 'MT5'],
    site: 'https://pepperstone.com',
    logoUrl: '',
    accountTypes: [
      { name: 'Standard', platform: 'MT5' },
      { name: 'Razor', platform: 'MT5' },
      { name: 'Standard', platform: 'MT4' },
      { name: 'Razor', platform: 'MT4' },
    ],
    servers: [],
  },
];

function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || `broker-${Date.now()}`;
}

export function normalizeBrokerRecord(raw, idHint = '') {
  const id = String(raw?.id || idHint || slugify(raw?.name)).trim();
  const accountTypes = Array.isArray(raw?.accountTypes)
    ? raw.accountTypes
        .map((t) => ({
          name: String(t?.name || t || '').trim(),
          platform: String(t?.platform || 'MT5').trim().toUpperCase() || 'MT5',
        }))
        .filter((t) => t.name)
    : [];
  const servers = Array.isArray(raw?.servers)
    ? raw.servers
        .map((s) => ({
          name: String(s?.name || s || '').trim(),
          platform: String(s?.platform || 'MT5').trim().toUpperCase() || 'MT5',
          mode: String(s?.mode || 'live').trim().toLowerCase() || 'live',
        }))
        .filter((s) => s.name)
    : [];
  return {
    id,
    name: String(raw?.name || id).trim(),
    aliases: Array.isArray(raw?.aliases)
      ? raw.aliases.map((a) => String(a || '').trim()).filter(Boolean)
      : [],
    enabled: raw?.enabled !== false,
    recommended: Boolean(raw?.recommended),
    platforms: Array.isArray(raw?.platforms)
      ? raw.platforms.map((p) => String(p || '').trim().toUpperCase()).filter(Boolean)
      : ['MT5'],
    site: String(raw?.site || '').trim(),
    logoUrl: String(raw?.logoUrl || '').trim(),
    accountTypes,
    servers,
    updatedAt: String(raw?.updatedAt || new Date().toISOString()),
  };
}

export function brokersFromFirebase(raw) {
  if (!raw || typeof raw !== 'object') return [];
  if (Array.isArray(raw)) {
    return raw.map((row, i) => normalizeBrokerRecord(row, row?.id || `b${i}`));
  }
  return Object.entries(raw).map(([id, row]) =>
    normalizeBrokerRecord(row && typeof row === 'object' ? row : {}, id),
  );
}

export async function ensureBrokerCatalog(firebaseRead, firebaseWrite) {
  const existing = await firebaseRead('lumo/brokers');
  const list = brokersFromFirebase(existing);
  if (list.length) return list;
  const seedMap = {};
  const now = new Date().toISOString();
  for (const seed of BROKER_SEED) {
    seedMap[seed.id] = normalizeBrokerRecord({ ...seed, updatedAt: now }, seed.id);
  }
  await firebaseWrite('lumo/brokers', seedMap);
  return Object.values(seedMap);
}

export function matchBrokerCatalog(companyName, catalog) {
  const q = String(companyName || '').toLowerCase().trim();
  if (!q) return null;
  for (const b of catalog) {
    if (!b.enabled) continue;
    const names = [b.name, b.id, ...(b.aliases || [])].map((s) =>
      String(s).toLowerCase(),
    );
    if (names.some((n) => n && (q.includes(n) || n.includes(q)))) return b;
  }
  return null;
}

export function filterCatalog(catalog, query) {
  const q = String(query || '').toLowerCase().trim();
  const enabled = catalog.filter((b) => b.enabled !== false);
  if (!q) return enabled;
  return enabled.filter((b) => {
    const hay = [b.name, b.id, ...(b.aliases || []), ...(b.servers || []).map((s) => s.name)]
      .join(' ')
      .toLowerCase();
    return hay.includes(q);
  });
}

function companyKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function mapSearchServer(raw, extras = {}) {
  const name = String(raw?.name || raw || '').trim();
  if (!name) return null;
  return {
    name,
    access: Array.isArray(raw?.access) ? raw.access : [],
    platform: String(raw?.platform || inferPlatformFromServer(name)).toUpperCase() || 'MT5',
    site: String(raw?.site || extras.site || '').trim(),
    logo_url: String(raw?.logo_url || raw?.logoUrl || extras.logoUrl || '').trim(),
  };
}

/** Normalize MT5 /Search rows (`companyName`) into the UI `company` + `results` shape. */
export function mapLiveSearchCompanies(raw, catalog = []) {
  const rows = Array.isArray(raw) ? raw : [];
  return rows
    .map((row) => {
      const company = String(row?.company || row?.companyName || row?.name || '').trim();
      const results = (Array.isArray(row?.results) ? row.results : [])
        .map((server) => mapSearchServer(server))
        .filter(Boolean);
      const catalogHit = matchBrokerCatalog(company, catalog);
      const accountTypes = Array.isArray(row?.accountTypes) && row.accountTypes.length
        ? row.accountTypes.map((t) => String(t?.name || t || '').trim()).filter(Boolean)
        : accountTypesForSelection(catalogHit, results[0]?.name);
      return {
        company,
        companyName: company,
        results,
        accountTypes,
        site: String(catalogHit?.site || row?.site || '').trim(),
        logoUrl: String(catalogHit?.logoUrl || row?.logoUrl || row?.logo_url || '').trim(),
        catalogId: catalogHit?.id || '',
      };
    })
    .filter((row) => row.company && row.results.length);
}

export function companiesFromCatalog(catalog, query) {
  return filterCatalog(catalog, query)
    .map((broker) => ({
      company: broker.name,
      companyName: broker.name,
      results: (broker.servers || [])
        .map((server) =>
          mapSearchServer(server, { site: broker.site, logoUrl: broker.logoUrl }),
        )
        .filter(Boolean),
      accountTypes: (broker.accountTypes || [])
        .map((t) => String(t?.name || t || '').trim())
        .filter(Boolean),
      site: broker.site || '',
      logoUrl: broker.logoUrl || '',
      catalogId: broker.id || '',
    }))
    .filter((row) => row.results.length);
}

export function mergeBrokerCompanies(primary = [], extra = []) {
  const out = [];
  const byKey = new Map();
  for (const row of [...primary, ...extra]) {
    const company = String(row?.company || row?.companyName || '').trim();
    if (!company) continue;
    const key = companyKey(company);
    const incoming = {
      ...row,
      company,
      companyName: company,
      results: [...(row.results || [])],
      accountTypes: [...(row.accountTypes || [])],
    };
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, incoming);
      out.push(incoming);
      continue;
    }
    const names = new Set(prev.results.map((s) => s.name));
    for (const server of incoming.results) {
      if (server?.name && !names.has(server.name)) {
        prev.results.push(server);
        names.add(server.name);
      }
    }
    if (!prev.accountTypes.length && incoming.accountTypes.length) {
      prev.accountTypes = incoming.accountTypes;
    }
    if (!prev.site && incoming.site) prev.site = incoming.site;
    if (!prev.logoUrl && incoming.logoUrl) prev.logoUrl = incoming.logoUrl;
  }
  return out;
}

export async function liveSearchCompanies(query, catalog = [], fetchFn = fetch) {
  const q = String(query || '').trim();
  const catalogHits = companiesFromCatalog(catalog, q);
  if (q.length < 2) return catalogHits;
  let raw = [];
  try {
    const { mt5ApiBase } = await import('./mt5Bridge.mjs');
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 12000);
    const res = await fetchFn(`${mt5ApiBase()}/Search?company=${encodeURIComponent(q)}`, {
      method: 'GET',
      headers: { Accept: 'application/json, text/plain, */*' },
      signal: ac.signal,
    });
    clearTimeout(timer);
    if (res.ok) {
      raw = await res.json();
    }
  } catch {
    raw = [];
  }
  return mergeBrokerCompanies(mapLiveSearchCompanies(raw, catalog), catalogHits);
}

/** Infer MT4/MT5 from a server name. */
export function inferPlatformFromServer(serverName) {
  const s = String(serverName || '');
  if (/mt4/i.test(s)) return 'MT4';
  return 'MT5';
}

export function accountTypesForSelection(broker, serverName) {
  const platform = inferPlatformFromServer(serverName);
  const types = Array.isArray(broker?.accountTypes) ? broker.accountTypes : [];
  const matched = types.filter(
    (t) => !t.platform || String(t.platform).toUpperCase() === platform,
  );
  if (matched.length) return matched.map((t) => t.name);
  if (types.length) return types.map((t) => t.name);
  return [];
}
