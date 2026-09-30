import { i as interop, t as reactMod } from './react-B8IZ02wI.js';

const React = interop(reactMod(), 1);
const h = React.createElement;

export const AUTO_SYMBOLS = ['XAUUSD', 'US30', 'USTECH', 'GBPUSD', 'EURUSD', 'USDJPY', 'GBPJPY', 'XAGUSD'];

const stepBtn = {
  width: 32,
  height: 32,
  borderRadius: 10,
  border: '1px solid rgba(103,232,249,.45)',
  background: 'rgba(59,130,246,.15)',
  color: '#67e8f9',
  font: 'inherit',
  fontSize: 18,
  fontWeight: 800,
  cursor: 'pointer',
};

const card = {
  border: '1px solid rgba(255,255,255,.14)',
  background: '#12121a',
  borderRadius: 16,
  padding: '14px 14px 12px',
  textAlign: 'left',
  color: '#fff',
  width: '100%',
  font: 'inherit',
  cursor: 'pointer',
};

function ModeButton({ kicker, title, body, onClick }) {
  return h(
    'button',
    { type: 'button', onClick, style: { ...card, display: 'block', marginBottom: 12 } },
    h('div', { style: { color: '#67e8f9', fontSize: 11, fontWeight: 800, letterSpacing: '.08em' } }, kicker),
    h('div', { style: { fontSize: 18, fontWeight: 800, marginTop: 4 } }, title),
    h('div', { style: { color: '#94a3b8', fontSize: 13, lineHeight: 1.4, marginTop: 6 } }, body),
  );
}

function levels(result) {
  if (!result?.entryPrice) return null;
  const side = result.direction === 'sell' ? 'SELL' : 'BUY';
  const chips = [
    ['Entry', result.entryPrice],
    ['SL', result.stopLoss],
    ['TP1', result.takeProfit1 || result.takeProfit],
    ['TP2', result.takeProfit2],
    ['TP3', result.takeProfit3],
  ].filter(([, value]) => value);
  return h(
    'div',
    { style: { ...card, cursor: 'default', marginTop: 12 } },
    h(
      'div',
      {
        style: {
          color: side === 'SELL' ? '#fb7185' : '#34d399',
          fontWeight: 800,
          letterSpacing: '.06em',
        },
      },
      `${result.symbol || ''} ${side} · ${result.accuracy || 0}%`,
    ),
    h(
      'div',
      { style: { display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 } },
      chips.map(([label, value]) =>
        h(
          'span',
          {
            key: label,
            style: {
              border: '1px solid rgba(255,255,255,.12)',
              borderRadius: 999,
              padding: '4px 8px',
              fontSize: 12,
            },
          },
          `${label} ${value}`,
        ),
      ),
    ),
    result.summary
      ? h('p', { style: { color: '#94a3b8', fontSize: 12, margin: '8px 0 0' } }, result.summary)
      : null,
  );
}

function cleanSymbol(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/\s+/g, '')
    .slice(0, 32);
}

function clampTrades(value) {
  return Math.max(1, Math.min(10, Math.round(Number(value) || 1)));
}

function symbolRows(list, query) {
  const names = (list || []).map((item) => String(item || '').trim()).filter(Boolean);
  const source = names.length ? names : AUTO_SYMBOLS;
  const q = String(query || '').trim().toUpperCase();
  const packed = q.replace(/[^A-Z0-9]/g, '');
  let filtered = !q
    ? source
    : source.filter((name) => {
        const up = name.toUpperCase();
        return up.includes(q) || up.replace(/[^A-Z0-9]/g, '').includes(packed);
      });
  const typed = cleanSymbol(query);
  if (typed.length >= 2 && !filtered.some((name) => name.toUpperCase() === typed)) {
    filtered = [typed, ...filtered];
  }
  return filtered.slice(0, q ? 60 : 48);
}

function SymbolRow({ symbol, trades, busy, onToggle, onTrades }) {
  const on = trades != null;
  return h(
    'div',
    {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginBottom: 8,
        border: on ? '1px solid #67e8f9' : '1px solid rgba(255,255,255,.1)',
        background: on ? 'rgba(103,232,249,.08)' : '#0d1118',
        borderRadius: 12,
        padding: '10px 10px',
      },
    },
    h(
      'button',
      {
        type: 'button',
        disabled: busy,
        onClick: () => onToggle(symbol),
        'aria-pressed': on,
        'aria-label': on ? `Remove ${symbol}` : `Select ${symbol}`,
        style: {
          flex: 1,
          textAlign: 'left',
          background: 'transparent',
          border: 0,
          color: '#fff',
          font: 'inherit',
          fontWeight: 800,
          fontSize: 16,
          cursor: 'pointer',
          padding: 0,
        },
      },
      symbol,
    ),
    on
      ? h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 6 } },
          h(
            'button',
            {
              type: 'button',
              'aria-label': `Fewer trades for ${symbol}`,
              disabled: busy || trades <= 1,
              onClick: () => onTrades(symbol, trades - 1),
              style: stepBtn,
            },
            '−',
          ),
          h('strong', { style: { minWidth: 18, textAlign: 'center', fontSize: 18 } }, trades),
          h(
            'button',
            {
              type: 'button',
              'aria-label': `More trades for ${symbol}`,
              disabled: busy || trades >= 10,
              onClick: () => onTrades(symbol, trades + 1),
              style: stepBtn,
            },
            '+',
          ),
        )
      : null,
  );
}

export function AutoScanScreen({ mode, onPick, onClose, onStart, busy, note, result, engine, loadSymbols }) {
  const [query, setQuery] = React.useState('');
  const [selected, setSelected] = React.useState({});
  const [lot, setLot] = React.useState('0.01');
  const [brokerSymbols, setBrokerSymbols] = React.useState([]);
  const [symbolNote, setSymbolNote] = React.useState('');
  const loadRef = React.useRef(loadSymbols);
  loadRef.current = loadSymbols;
  React.useEffect(() => {
    if (mode !== 'auto' || typeof loadRef.current !== 'function') return undefined;
    let stop = false;
    setSymbolNote('Loading symbols from the connected broker…');
    loadRef.current()
      .then((res) => {
        if (stop) return;
        const list = Array.isArray(res?.symbols) ? res.symbols : [];
        setBrokerSymbols(list);
        setSymbolNote(
          list.length
            ? `${list.length} symbols on this broker. Select the ones to trade.`
            : res?.connected === false
              ? 'Connect MetaTrader to load this broker. You can still type a symbol and select it.'
              : 'Type a symbol and select it.',
        );
      })
      .catch(() => {
        if (!stop) setSymbolNote('Could not read broker symbols. Type a name and select it.');
      });
    return () => {
      stop = true;
    };
  }, [mode]);

  const picks = Object.entries(selected).map(([symbol, trades]) => ({
    symbol,
    trades: clampTrades(trades),
  }));
  const rows = symbolRows(brokerSymbols, query);
  const shown = new Set(rows.map((name) => name.toUpperCase()));
  const pinned = picks.filter((row) => !shown.has(row.symbol.toUpperCase())).map((row) => row.symbol);
  const list = [...pinned, ...rows];

  const shell = (children) =>
    h(
      'div',
      {
        className: 'os-panel scan-shell scan-shell-premium',
        style: { minHeight: '100dvh', background: '#070b12', color: '#fff' },
      },
      h('div', { className: 'scan-page', style: { padding: 16 } }, ...children),
      engine || null,
    );

  const top = h(
    'header',
    { className: 'scan-header', style: { marginBottom: 16 } },
    h(
      'button',
      {
        type: 'button',
        className: 'scan-x',
        'aria-label': mode === 'pick' ? 'Close' : 'Back',
        onClick: () => (mode === 'pick' ? onClose() : onPick('pick')),
      },
      mode === 'pick' ? '×' : '←',
    ),
    h('h1', { className: 'scan-title', style: { margin: 0 } }, mode === 'auto' ? 'Auto Scan' : 'Scanner'),
    h('span', null),
  );

  if (mode !== 'auto') {
    return shell([
      top,
      h(ModeButton, {
        kicker: 'MANUAL',
        title: 'Chart Scanner',
        body: 'Upload your own market screenshot. AI reads it, then you decide whether to execute.',
        onClick: () => onPick('manual'),
      }),
      h(ModeButton, {
        kicker: 'AUTOMATIC',
        title: 'Auto Scan & Auto Trade',
        body: 'Select symbols on the list. Set the trades beside each one, then press START.',
        onClick: () => onPick('auto'),
      }),
    ]);
  }

  const toggle = (symbol) => {
    setSelected((prev) => {
      if (prev[symbol] != null) {
        const next = { ...prev };
        delete next[symbol];
        return next;
      }
      return { ...prev, [symbol]: 3 };
    });
  };
  const setTrades = (symbol, value) => {
    setSelected((prev) => ({ ...prev, [symbol]: clampTrades(value) }));
  };

  return shell([
    top,
    h(
      'p',
      { style: { color: '#94a3b8', fontSize: 13, lineHeight: 1.4, margin: '0 0 10px' } },
      'Select symbols here. The number on the right is how many trades START opens for that symbol.',
    ),
    h('input', {
      value: query,
      disabled: busy,
      onChange: (event) => setQuery(cleanSymbol(event.target.value)),
      placeholder: 'Filter or type a broker symbol',
      'aria-label': 'Filter symbols',
      autoCapitalize: 'characters',
      autoCorrect: 'off',
      spellCheck: false,
      style: {
        ...card,
        marginBottom: 8,
        fontSize: 16,
        fontWeight: 700,
        outline: 'none',
        cursor: 'text',
      },
    }),
    symbolNote
      ? h('div', { style: { color: '#94a3b8', fontSize: 12, marginBottom: 8 } }, symbolNote)
      : null,
    h(
      'div',
      { style: { marginBottom: 12 } },
      list.map((symbol) =>
        h(SymbolRow, {
          key: symbol,
          symbol,
          trades: selected[symbol],
          busy,
          onToggle: toggle,
          onTrades: setTrades,
        }),
      ),
    ),
    h(
      'label',
      {
        style: {
          ...card,
          cursor: 'text',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 10,
        },
      },
      h('span', { style: { color: '#94a3b8', fontSize: 12, letterSpacing: '.06em' } }, 'LOT SIZE'),
      h('input', {
        value: lot,
        inputMode: 'decimal',
        onChange: (event) => setLot(event.target.value.replace(/[^0-9.]/g, '').slice(0, 6)),
        'aria-label': 'Lot size',
        style: {
          width: 96,
          background: 'transparent',
          border: 0,
          color: '#fff',
          font: 'inherit',
          fontSize: 22,
          fontWeight: 800,
          textAlign: 'right',
        },
      }),
    ),
    h(
      'p',
      { style: { color: '#e2e8f0', fontSize: 13, margin: '0 0 12px', lineHeight: 1.4 } },
      picks.length
        ? picks.map((row) => `${row.symbol} × ${row.trades}`).join(' · ')
        : 'No symbols selected yet.',
    ),
    h(
      'button',
      {
        type: 'button',
        className: 'scan-execute-btn',
        disabled: busy || picks.length === 0,
        onClick: () => onStart(picks, lot),
      },
      busy ? 'WORKING…' : 'START',
    ),
    note ? h('p', { style: { color: '#e2e8f0', fontSize: 13, marginTop: 12 } }, note) : null,
    levels(result),
    h(
      'p',
      { style: { color: '#64748b', fontSize: 11, marginTop: 14, lineHeight: 1.4 } },
      'START scans each selected symbol with OpenAI on the live candles and opens the trades set beside that symbol, all in the same direction. Trade 1 uses TP1, trade 2 uses TP2, trade 3 uses TP3.',
    ),
  ]);
}
