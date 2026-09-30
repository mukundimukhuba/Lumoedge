const KEY = 'lumo-symbol-trades-v1';

function storageKey(email) {
  return `${KEY}:${String(email || '').trim().toLowerCase()}`;
}

export function tradeCountFor(counts, symbol) {
  const name = String(symbol || '').trim();
  const raw = counts?.[name] ?? counts?.[name.toUpperCase()];
  const n = Number(raw);
  if (!Number.isFinite(n)) return 3;
  return Math.max(1, Math.min(50, Math.round(n)));
}

export function readSymbolTrades(email) {
  try {
    const raw = localStorage.getItem(storageKey(email));
    const data = raw ? JSON.parse(raw) : {};
    const counts = data?.counts && typeof data.counts === 'object' ? data.counts : {};
    return { counts, lot: String(data?.lot || '0.01') };
  } catch {
    return { counts: {}, lot: '0.01' };
  }
}

export function writeSymbolTrades(email, next) {
  const counts = next?.counts && typeof next.counts === 'object' ? next.counts : {};
  const lot = String(next?.lot || '0.01');
  localStorage.setItem(storageKey(email), JSON.stringify({ counts, lot }));
}

function asLots(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n >= 10000) return n / 100000000;
  return n;
}

function firstLots(values) {
  for (const value of values) {
    const lots = asLots(value);
    if (lots > 0) return lots;
  }
  return 0;
}

/** Fit a lot to the broker minimum and step so MT5 does not reject the volume. */
export function snapLot(requested, spec = {}) {
  const min = firstLots([spec.minLots, spec.minVolume]) || 0.01;
  const step = firstLots([spec.lotsStep, spec.volumeStep]) || 0.01;
  const max = firstLots([spec.maxLots, spec.maxVolume]) || 100;
  let lot = Number(requested);
  if (!Number.isFinite(lot) || lot <= 0) lot = min;
  if (lot < min) lot = min;
  if (lot > max) lot = max;
  const units = Math.max(0, Math.round(Number(((lot - min) / step).toFixed(8))));
  const decimals = Math.min(8, (String(step).split('.')[1] || '').length);
  lot = Number((min + units * step).toFixed(decimals));
  if (lot < min) lot = Number(min.toFixed(decimals));
  if (lot > max) lot = Number(max.toFixed(decimals));
  return lot;
}
