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
      'Exness Technologies',
      'Exness (KE) Limited',
      'Exness (MU) Ltd',
      'Exness (CY) Ltd',
      'Exness (SC) Ltd',
      'Exness (VG) Ltd',
      'Exness (UK) Ltd',
      'Exness B.V.',
      'Exness Limited Jordan LLC',
      'Exness Mena Financial Brokers L.L.C',
      'Exness Limited',
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
      { name: 'Trial / Demo', platform: 'MT5' },
      { name: 'Standard', platform: 'MT4' },
      { name: 'Standard Cent', platform: 'MT4' },
      { name: 'Pro', platform: 'MT4' },
      { name: 'Raw Spread', platform: 'MT4' },
      { name: 'Zero', platform: 'MT4' },
      { name: 'Trial / Demo', platform: 'MT4' },
    ],
        servers: [
      { name: "ExnessCY-Demo", platform: "MT5", mode: "demo" },
      { name: "ExnessCY-LP_Real1", platform: "MT5", mode: "live" },
      { name: "ExnessKE-MT5Trial4", platform: "MT5", mode: "demo" },
      { name: "ExnessKE-MT5Real9", platform: "MT5", mode: "live" },
      { name: "ExnessKE-MT5Trial9", platform: "MT5", mode: "demo" },
      { name: "ExnessKE-MT5Trial10", platform: "MT5", mode: "demo" },
      { name: "ExnessKE-MT5Real4", platform: "MT5", mode: "live" },
      { name: "ExnessKE-MT5Real21", platform: "MT5", mode: "live" },
      { name: "ExnessKE-MT5Real10", platform: "MT5", mode: "live" },
      { name: "ExnessMU-MT5Trial5", platform: "MT5", mode: "demo" },
      { name: "ExnessMU-MT5Trial4", platform: "MT5", mode: "demo" },
      { name: "ExnessMU-MT5Real11", platform: "MT5", mode: "live" },
      { name: "ExnessMU-MT5Trial6", platform: "MT5", mode: "demo" },
      { name: "ExnessMU-MT5Real9", platform: "MT5", mode: "live" },
      { name: "ExnessMU-MT5Trial", platform: "MT5", mode: "demo" },
      { name: "ExnessMU-MT5Real3", platform: "MT5", mode: "live" },
      { name: "ExnessMU-MT5Real6", platform: "MT5", mode: "live" },
      { name: "ExnessMU-MT5Real5", platform: "MT5", mode: "live" },
      { name: "ExnessMU-MT5Trial3", platform: "MT5", mode: "demo" },
      { name: "ExnessMU-MT5Trial11", platform: "MT5", mode: "demo" },
      { name: "ExnessMU-MT5Trial9", platform: "MT5", mode: "demo" },
      { name: "ExnessMU-MT5Trial12", platform: "MT5", mode: "demo" },
      { name: "ExnessMU-MT5Real12", platform: "MT5", mode: "live" },
      { name: "ExnessMU-MT5Trial8", platform: "MT5", mode: "demo" },
      { name: "ExnessMU-MT5Real8", platform: "MT5", mode: "live" },
      { name: "ExnessMU-MT5Trial10", platform: "MT5", mode: "demo" },
      { name: "ExnessMU-MT5Real4", platform: "MT5", mode: "live" },
      { name: "ExnessMU-MT5Real10", platform: "MT5", mode: "live" },
      { name: "ExnessMU-MT5Real", platform: "MT5", mode: "live" },
      { name: "ExnessMU-MT5Real2", platform: "MT5", mode: "live" },
      { name: "ExnessMU-MT5Trial2", platform: "MT5", mode: "demo" },
      { name: "ExnessMU-MT5Real50", platform: "MT5", mode: "live" },
      { name: "ExnessMU-MT5Real7", platform: "MT5", mode: "live" },
      { name: "ExnessMU-MT5Real15", platform: "MT5", mode: "live" },
      { name: "ExnessMU-MT5Trial7", platform: "MT5", mode: "demo" },
      { name: "ExnessSC-MT5Trial5", platform: "MT5", mode: "demo" },
      { name: "ExnessSC-MT5Trial4", platform: "MT5", mode: "demo" },
      { name: "ExnessSC-MT5Real11", platform: "MT5", mode: "live" },
      { name: "ExnessSC-MT5Trial6", platform: "MT5", mode: "demo" },
      { name: "ExnessSC-MT5Real9", platform: "MT5", mode: "live" },
      { name: "ExnessSC-MT5Trial", platform: "MT5", mode: "demo" },
      { name: "ExnessSC-MT5Real3", platform: "MT5", mode: "live" },
      { name: "ExnessSC-MT5Real6", platform: "MT5", mode: "live" },
      { name: "ExnessSC-MT5Real5", platform: "MT5", mode: "live" },
      { name: "ExnessSC-MT5Trial3", platform: "MT5", mode: "demo" },
      { name: "ExnessSC-MT5Trial11", platform: "MT5", mode: "demo" },
      { name: "ExnessSC-MT5Trial9", platform: "MT5", mode: "demo" },
      { name: "ExnessSC-MT5Trial12", platform: "MT5", mode: "demo" },
      { name: "ExnessSC-MT5Real12", platform: "MT5", mode: "live" },
      { name: "ExnessSC-MT5Trial8", platform: "MT5", mode: "demo" },
      { name: "ExnessSC-MT5Real8", platform: "MT5", mode: "live" },
      { name: "ExnessSC-MT5Trial10", platform: "MT5", mode: "demo" },
      { name: "ExnessSC-MT5Real4", platform: "MT5", mode: "live" },
      { name: "ExnessSC-MT5Real10", platform: "MT5", mode: "live" },
      { name: "ExnessSC-MT5Real", platform: "MT5", mode: "live" },
      { name: "ExnessSC-MT5Real2", platform: "MT5", mode: "live" },
      { name: "ExnessSC-MT5Trial2", platform: "MT5", mode: "demo" },
      { name: "ExnessSCLtd-Demo", platform: "MT5", mode: "demo" },
      { name: "ExnessSC-MT5Real50", platform: "MT5", mode: "live" },
      { name: "ExnessSC-MT5Real7", platform: "MT5", mode: "live" },
      { name: "ExnessSC-MT5Real15", platform: "MT5", mode: "live" },
      { name: "ExnessSC-MT5Trial7", platform: "MT5", mode: "demo" },
      { name: "ExnessSCLtd-LP_Real1", platform: "MT5", mode: "live" },
      { name: "ExnessUK-Demo", platform: "MT5", mode: "demo" },
      { name: "ExnessUK-LP_Real1", platform: "MT5", mode: "live" },
      { name: "ExnessVG-MT5Trial5", platform: "MT5", mode: "demo" },
      { name: "ExnessVG-MT5Trial4", platform: "MT5", mode: "demo" },
      { name: "ExnessVG-MT5Real11", platform: "MT5", mode: "live" },
      { name: "ExnessVG-MT5Trial6", platform: "MT5", mode: "demo" },
      { name: "ExnessVG-MT5Real9", platform: "MT5", mode: "live" },
      { name: "ExnessVG-MT5Trial", platform: "MT5", mode: "demo" },
      { name: "ExnessVG-MT5Real3", platform: "MT5", mode: "live" },
      { name: "ExnessVG-MT5Real6", platform: "MT5", mode: "live" },
      { name: "ExnessVG-MT5Real5", platform: "MT5", mode: "live" },
      { name: "ExnessVG-MT5Trial3", platform: "MT5", mode: "demo" },
      { name: "ExnessVG-MT5Trial11", platform: "MT5", mode: "demo" },
      { name: "ExnessVG-MT5Trial9", platform: "MT5", mode: "demo" },
      { name: "ExnessVG-MT5Trial12", platform: "MT5", mode: "demo" },
      { name: "ExnessVG-MT5Real12", platform: "MT5", mode: "live" },
      { name: "ExnessVG-MT5Trial8", platform: "MT5", mode: "demo" },
      { name: "ExnessVG-MT5Real8", platform: "MT5", mode: "live" },
      { name: "ExnessVG-MT5Trial10", platform: "MT5", mode: "demo" },
      { name: "ExnessVG-MT5Real4", platform: "MT5", mode: "live" },
      { name: "ExnessVG-MT5Real10", platform: "MT5", mode: "live" },
      { name: "ExnessVG-MT5Real", platform: "MT5", mode: "live" },
      { name: "ExnessVG-MT5Real2", platform: "MT5", mode: "live" },
      { name: "ExnessVG-MT5Trial2", platform: "MT5", mode: "demo" },
      { name: "ExnessVGLtd-Demo", platform: "MT5", mode: "demo" },
      { name: "ExnessVG-MT5Real50", platform: "MT5", mode: "live" },
      { name: "ExnessVG-MT5Real7", platform: "MT5", mode: "live" },
      { name: "ExnessVG-MT5Real15", platform: "MT5", mode: "live" },
      { name: "ExnessVG-MT5Trial7", platform: "MT5", mode: "demo" },
      { name: "ExnessVGLtd-LP_Real1", platform: "MT5", mode: "live" },
      { name: "ExnessBV-MT5Trial5", platform: "MT5", mode: "demo" },
      { name: "ExnessBV-MT5Trial4", platform: "MT5", mode: "demo" },
      { name: "ExnessBV-MT5Real11", platform: "MT5", mode: "live" },
      { name: "ExnessBV-MT5Trial6", platform: "MT5", mode: "demo" },
      { name: "ExnessBV-MT5Real9", platform: "MT5", mode: "live" },
      { name: "ExnessBV-MT5Trial", platform: "MT5", mode: "demo" },
      { name: "ExnessBV-MT5Real3", platform: "MT5", mode: "live" },
      { name: "ExnessBV-MT5Real6", platform: "MT5", mode: "live" },
      { name: "ExnessBV-MT5Real5", platform: "MT5", mode: "live" },
      { name: "ExnessBV-MT5Trial3", platform: "MT5", mode: "demo" },
      { name: "ExnessBV-MT5Trial11", platform: "MT5", mode: "demo" },
      { name: "ExnessBV-MT5Trial9", platform: "MT5", mode: "demo" },
      { name: "ExnessBV-MT5Trial12", platform: "MT5", mode: "demo" },
      { name: "ExnessBV-MT5Real12", platform: "MT5", mode: "live" },
      { name: "ExnessBV-MT5Trial8", platform: "MT5", mode: "demo" },
      { name: "ExnessBV-MT5Real8", platform: "MT5", mode: "live" },
      { name: "ExnessBV-MT5Trial10", platform: "MT5", mode: "demo" },
      { name: "ExnessBV-MT5Real4", platform: "MT5", mode: "live" },
      { name: "ExnessBV-MT5Real10", platform: "MT5", mode: "live" },
      { name: "ExnessBV-MT5Real", platform: "MT5", mode: "live" },
      { name: "ExnessBV-MT5Real2", platform: "MT5", mode: "live" },
      { name: "ExnessBV-MT5Trial2", platform: "MT5", mode: "demo" },
      { name: "ExnessBV-MT5Real50", platform: "MT5", mode: "live" },
      { name: "ExnessBV-MT5Real7", platform: "MT5", mode: "live" },
      { name: "ExnessBV-MT5Real15", platform: "MT5", mode: "live" },
      { name: "ExnessBV-MT5Trial7", platform: "MT5", mode: "demo" },
      { name: "ExnessJO-MT5Trial16", platform: "MT5", mode: "demo" },
      { name: "ExnessJO-MT5Real35", platform: "MT5", mode: "live" },
      { name: "ExnessJO-MT5Real2", platform: "MT5", mode: "live" },
      { name: "ExnessJO-MT5Trial2", platform: "MT5", mode: "demo" },
      { name: "ExnessMenaFinancial-MT5Trial16", platform: "MT5", mode: "demo" },
      { name: "ExnessMenaFinancial-MT5Real33", platform: "MT5", mode: "live" },
      { name: "ExnessMenaFinancial-MT5Real34", platform: "MT5", mode: "live" },
      { name: "ExnessMenaFinancial-MT5Real35", platform: "MT5", mode: "live" },
      { name: "ExnessMenaFinancial-MT5Real32", platform: "MT5", mode: "live" },
      { name: "ExnessMenaFinancial-MT5Trial15", platform: "MT5", mode: "demo" },
      { name: "Exness-MT5Trial5", platform: "MT5", mode: "demo" },
      { name: "Exness-MT5Real16", platform: "MT5", mode: "live" },
      { name: "Exness-MT5Trial4", platform: "MT5", mode: "demo" },
      { name: "Exness-MT5Real19", platform: "MT5", mode: "live" },
      { name: "Exness-MT5Real11", platform: "MT5", mode: "live" },
      { name: "Exness-MT5Trial6", platform: "MT5", mode: "demo" },
      { name: "Exness-MT5Real9", platform: "MT5", mode: "live" },
      { name: "Exness-MT5Trial16", platform: "MT5", mode: "demo" },
      { name: "Exness-MT5Real20", platform: "MT5", mode: "live" },
      { name: "Exness-MT5Real17", platform: "MT5", mode: "live" },
      { name: "Exness-MT5Trial", platform: "MT5", mode: "demo" },
      { name: "Exness-MT5Real33", platform: "MT5", mode: "live" },
      { name: "Exness-MT5Real3", platform: "MT5", mode: "live" },
      { name: "Exness-MT5Real6", platform: "MT5", mode: "live" },
      { name: "Exness-MT5Real25", platform: "MT5", mode: "live" },
      { name: "Exness-MT5Real5", platform: "MT5", mode: "live" },
      { name: "Exness-MT5Trial3", platform: "MT5", mode: "demo" },
      { name: "Exness-MT5Real26", platform: "MT5", mode: "live" },
      { name: "Exness-MT5Trial11", platform: "MT5", mode: "demo" },
      { name: "Exness-MT5Trial9", platform: "MT5", mode: "demo" },
      { name: "Exness-MT5Real23", platform: "MT5", mode: "live" },
      { name: "Exness-MT5Real22", platform: "MT5", mode: "live" },
      { name: "Exness-MT5Trial12", platform: "MT5", mode: "demo" },
      { name: "Exness-MT5Real12", platform: "MT5", mode: "live" },
      { name: "Exness-MT5Real34", platform: "MT5", mode: "live" },
      { name: "Exness-MT5Real35", platform: "MT5", mode: "live" },
      { name: "Exness-MT5Trial8", platform: "MT5", mode: "demo" },
      { name: "Exness-MT5Real32", platform: "MT5", mode: "live" },
      { name: "Exness-MT5Real8", platform: "MT5", mode: "live" },
      { name: "Exness-MT5Trial10", platform: "MT5", mode: "demo" },
      { name: "Exness-MT5Trial15", platform: "MT5", mode: "demo" },
      { name: "Exness-MT5Real27", platform: "MT5", mode: "live" },
      { name: "Exness-MT5Real4", platform: "MT5", mode: "live" },
      { name: "Exness-MT5Real21", platform: "MT5", mode: "live" },
      { name: "Exness-MT5Real10", platform: "MT5", mode: "live" },
      { name: "Exness-MT5Real", platform: "MT5", mode: "live" },
      { name: "Exness-MT5Real2", platform: "MT5", mode: "live" },
      { name: "Exness-MT5Trial2", platform: "MT5", mode: "demo" },
      { name: "Exness-MT5Real28", platform: "MT5", mode: "live" },
      { name: "Exness-MT5Trial14", platform: "MT5", mode: "demo" },
      { name: "Exness-MT5Real38", platform: "MT5", mode: "live" },
      { name: "Exness-MT5Real42", platform: "MT5", mode: "live" },
      { name: "Exness-MT5Real43", platform: "MT5", mode: "live" },
      { name: "Exness-MT5Real50", platform: "MT5", mode: "live" },
      { name: "Exness-MT5Real40", platform: "MT5", mode: "live" },
      { name: "Exness-MT5Real46", platform: "MT5", mode: "live" },
      { name: "Exness-MT5Real7", platform: "MT5", mode: "live" },
      { name: "Exness-MT5Real15", platform: "MT5", mode: "live" },
      { name: "Exness-MT5Real29", platform: "MT5", mode: "live" },
      { name: "Exness-MT5Real24", platform: "MT5", mode: "live" },
      { name: "Exness-MT5Trial7", platform: "MT5", mode: "demo" },
      { name: "Exness-MT5Real41", platform: "MT5", mode: "live" },
      { name: "Exness-MT5Real48", platform: "MT5", mode: "live" },
      { name: "Exness-MT5Real51", platform: "MT5", mode: "live" },
      { name: "Exness-MT5Trial17", platform: "MT5", mode: "demo" },
      { name: "Exness-MT5Real30", platform: "MT5", mode: "live" },
      { name: "Exness-MT5Real36", platform: "MT5", mode: "live" },
      { name: "Exness-MT5Real31", platform: "MT5", mode: "live" },
      { name: "Exness-MT5Real39", platform: "MT5", mode: "live" },
      { name: "Exness-MT5Real18", platform: "MT5", mode: "live" },
      { name: "Exness-MT5Real44", platform: "MT5", mode: "live" },
      { name: "Exness-MT5Real37", platform: "MT5", mode: "live" },
    ],
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
    servers: [
      { name: 'ICMarketsSC-MT5', platform: 'MT5', mode: 'live' },
      { name: 'ICMarketsEU-MT5-5', platform: 'MT5', mode: 'live' },
      { name: 'ICMarketsKE-MT5-7', platform: 'MT5', mode: 'live' },
      { name: 'ICMarketsEU-Demo', platform: 'MT5', mode: 'demo' },
    ],
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
    servers: [
      { name: 'XMGlobal-MT5 2', platform: 'MT5', mode: 'live' },
      { name: 'XMGlobal-MT5 4', platform: 'MT5', mode: 'live' },
      { name: 'XMGlobal-MT5 6', platform: 'MT5', mode: 'live' },
      { name: 'XMGlobal-MT5 9', platform: 'MT5', mode: 'live' },
      { name: 'XMZA-MT5 2', platform: 'MT5', mode: 'live' },
    ],
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
    servers: [
      { name: 'FTMO-Server2', platform: 'MT5', mode: 'live' },
      { name: 'FTMO-Server5', platform: 'MT5', mode: 'live' },
      { name: 'FTMO-Demo', platform: 'MT5', mode: 'demo' },
    ],
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
    servers: [
      { name: 'DerivSVG-Server', platform: 'MT5', mode: 'live' },
      { name: 'DerivSVG-Server-03', platform: 'MT5', mode: 'live' },
      { name: 'DerivBVI-Server', platform: 'MT5', mode: 'live' },
      { name: 'DerivSVG-Demo', platform: 'MT5', mode: 'demo' },
    ],
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
    servers: [
      { name: 'Pepperstone-MT5-Live01', platform: 'MT5', mode: 'live' },
      { name: 'PepperstoneEU-Live', platform: 'MT5', mode: 'live' },
      { name: 'PepperstoneMU-MT5-Live01', platform: 'MT5', mode: 'live' },
    ],
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
  const now = new Date().toISOString();
  const seedMap = {};
  for (const seed of BROKER_SEED) {
    seedMap[seed.id] = normalizeBrokerRecord({ ...seed, updatedAt: now }, seed.id);
  }
  let existing = null;
  try {
    existing = await firebaseRead('lumo/brokers');
  } catch {
    existing = null;
  }
  const list = brokersFromFirebase(existing);
  if (!list.length) {
    try {
      await firebaseWrite('lumo/brokers', seedMap);
    } catch {
      /* in-memory seed is enough when durable brokers path is unavailable */
    }
    return Object.values(seedMap);
  }

  // Merge seed servers/account types into existing catalog so brokers with
  // empty servers[] become connectable without wiping admin edits.
  let changed = false;
  const mergedMap = {};
  for (const broker of list) {
    const seed = seedMap[broker.id];
    if (!seed) {
      mergedMap[broker.id] = broker;
      continue;
    }
    const serverNames = new Set((broker.servers || []).map((s) => String(s.name || '').toLowerCase()));
    const nextServers = [...(broker.servers || [])];
    for (const server of seed.servers || []) {
      const key = String(server.name || '').toLowerCase();
      if (!key || serverNames.has(key)) continue;
      nextServers.push(server);
      serverNames.add(key);
      changed = true;
    }
    const typeNames = new Set(
      (broker.accountTypes || []).map(
        (t) => `${String(t.name || '').toLowerCase()}|${String(t.platform || '').toUpperCase()}`,
      ),
    );
    const nextTypes = [...(broker.accountTypes || [])];
    for (const type of seed.accountTypes || []) {
      const key = `${String(type.name || '').toLowerCase()}|${String(type.platform || '').toUpperCase()}`;
      if (!type.name || typeNames.has(key)) continue;
      nextTypes.push(type);
      typeNames.add(key);
      changed = true;
    }
    mergedMap[broker.id] = normalizeBrokerRecord(
      {
        ...broker,
        enabled: broker.enabled === false ? false : true,
        servers: nextServers,
        accountTypes: nextTypes,
        updatedAt: changed ? now : broker.updatedAt,
      },
      broker.id,
    );
  }
  for (const seed of BROKER_SEED) {
    if (!mergedMap[seed.id]) {
      mergedMap[seed.id] = seedMap[seed.id];
      changed = true;
    }
  }
  if (changed) {
    try {
      await firebaseWrite('lumo/brokers', mergedMap);
    } catch {
      /* keep merged response even if durable write is unsupported */
    }
  }
  return Object.values(mergedMap);
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


const BROKER_BRAND_GROUPS = [
  { id: 'exness', label: 'Exness', match: /exness/i },
  { id: 'icmarkets', label: 'IC Markets', match: /ic\s*markets|raw trading/i },
  { id: 'xm', label: 'XM', match: /\bxm\b|trading point/i },
];

function brandGroupForCompany(companyName) {
  const name = String(companyName || '');
  for (const g of BROKER_BRAND_GROUPS) {
    if (g.match.test(name)) return g;
  }
  return null;
}

export function collapseBrandCompanies(rows = [], catalog = []) {
  const passthrough = [];
  const brands = new Map();
  for (const row of rows) {
    const company = String(row?.company || row?.companyName || '').trim();
    if (!company) continue;
    const brand = brandGroupForCompany(company);
    if (!brand) {
      passthrough.push(row);
      continue;
    }
    let bucket = brands.get(brand.id);
    if (!bucket) {
      const catalogHit =
        catalog.find((b) => b.id === brand.id) || matchBrokerCatalog(brand.label, catalog);
      bucket = {
        company: brand.label,
        companyName: brand.label,
        results: [],
        accountTypes: accountTypesForSelection(catalogHit, 'MT5'),
        site: String(catalogHit?.site || row?.site || '').trim(),
        logoUrl: String(catalogHit?.logoUrl || row?.logoUrl || '').trim(),
        catalogId: catalogHit?.id || brand.id,
      };
      brands.set(brand.id, bucket);
    }
    const names = new Set(bucket.results.map((s) => s.name));
    for (const server of row.results || []) {
      if (server?.name && !names.has(server.name)) {
        bucket.results.push(server);
        names.add(server.name);
      }
    }
    if (!bucket.accountTypes.length && row.accountTypes?.length) {
      bucket.accountTypes = [...row.accountTypes];
    }
  }
  const brandRows = [...brands.values()]
    .map((b) => ({
      ...b,
      results: [...b.results].sort((a, c) => String(a.name).localeCompare(String(c.name))),
    }))
    .filter((b) => b.results.length);
  return [...brandRows, ...passthrough];
}

async function fanOutLiveSearch(query, fetchFn = fetch) {
  const q = String(query || '').trim();
  const queries = [q];
  if (/exness/i.test(q)) {
    for (const extra of [
      'Exness',
      'Exness KE',
      'Exness SC',
      'Exness VG',
      'Exness MU',
      'Exness BV',
      'Exness CY',
      'Exness Technologies',
      'Exness Limited',
      'Exness Mena',
    ]) {
      if (!queries.some((x) => x.toLowerCase() === extra.toLowerCase())) queries.push(extra);
    }
  }
  const { mt5ApiBase } = await import('./mt5Bridge.mjs');
  const base = mt5ApiBase();
  const chunks = await Promise.all(
    queries.slice(0, 8).map(async (term) => {
      try {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 12000);
        const res = await fetchFn(`${base}/Search?company=${encodeURIComponent(term)}`, {
          method: 'GET',
          headers: { Accept: 'application/json, text/plain, */*' },
          signal: ac.signal,
        });
        clearTimeout(timer);
        if (!res.ok) return [];
        const raw = await res.json();
        return Array.isArray(raw) ? raw : [];
      } catch {
        return [];
      }
    }),
  );
  const merged = [];
  for (const part of chunks) merged.push(...part);
  return merged;
}

export async function liveSearchCompanies(query, catalog = [], fetchFn = fetch) {
  const q = String(query || '').trim();
  const catalogHits = companiesFromCatalog(catalog, q);
  if (q.length < 2) return catalogHits;
  let raw = [];
  try {
    raw = await fanOutLiveSearch(q, fetchFn);
  } catch {
    raw = [];
  }
  const merged = mergeBrokerCompanies(mapLiveSearchCompanies(raw, catalog), catalogHits);
  return collapseBrandCompanies(merged, catalog).sort((a, b) => {
      const rank = (name) => {
        const c = companyKey(name);
        const n = companyKey(q);
        if (!n) return 50;
        if (c === n) return 0;
        if (c.startsWith(`${n} `) || c.startsWith(`${n}(`) || c.startsWith(n)) return 1;
        if (c.includes(` ${n}`) || c.includes(`(${n}`)) return 2;
        if (c.includes(n)) return 3;
        return 8;
      };
      const diff = rank(a.company) - rank(b.company);
      if (diff) return diff;
      return (b.results?.length || 0) - (a.results?.length || 0) || String(a.company).localeCompare(String(b.company));
    });
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
