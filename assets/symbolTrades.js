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
