import { i as interop, t as reactMod } from './react-B8IZ02wI.js';

const React = interop(reactMod(), 1);
const h = React.createElement;

export const AUTO_SYMBOLS = ['XAUUSD', 'US30', 'USTECH', 'GBPUSD', 'EURUSD', 'USDJPY', 'GBPJPY', 'XAGUSD'];

const stepBtn = {
  width: 36,
  height: 36,
  borderRadius: 10,
  border: '1px solid rgba(103,232,249,.45)',
  background: 'rgba(59,130,246,.15)',
  color: '#67e8f9',
  font: 'inherit',
  fontSize: 20,
  fontWeight: 800,
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

function brokerMatches(list, query) {
  const names = (list || []).map((item) => String(item || '').trim()).filter(Boolean);
  const q = String(query || '').trim().toUpperCase();
  const packed = q.replace(/[^A-Z0-9]/g, '');
  const filtered = !q
    ? names
    : names.filter((name) => {
        const up = name.toUpperCase();
        return up.includes(q) || up.replace(/[^A-Z0-9]/g, '').includes(packed);
      });
  return filtered.slice(0, q ? 40 : 16);
}

export function AutoScanScreen({ mode, onPick, onClose, onStart, busy, note, result, engine, loadSymbols }) {
  const [symbol, setSymbol] = React.useState('XAUUSD');
  const [trades, setTrades] = React.useState(3);
  const [lot, setLot] = React.useState('0.01');
  const [brokerSymbols, setBrokerSymbols] = React.useState([]);
  const [symbolNote, setSymbolNote] = React.useState('');
  const loadRef = React.useRef(loadSymbols);
  loadRef.current = loadSymbols;
  React.useEffect(() => {
    if (mode !== 'auto' || typeof loadRef.current !== 'function') return undefined;
    let stop = false;
    setSymbolNote('Searching the connected broker…');
    loadRef.current()
      .then((res) => {
        if (stop) return;
        const list = Array.isArray(res?.symbols) ? res.symbols : [];
        setBrokerSymbols(list);
        setSymbolNote(
          list.length
            ? `${list.length} symbols on this broker. Type to search, or edit the name.`
            : res?.connected === false
              ? 'Connect MetaTrader to search this broker. You can still type the symbol.'
              : 'Type the symbol name your broker uses.',
        );
      })
      .catch(() => {
        if (!stop) setSymbolNote('Could not read broker symbols. Type the name your platform uses.');
      });
    return () => {
      stop = true;
    };
  }, [mode]);
  const tradeCount = Math.max(1, Math.min(10, Math.round(Number(trades) || 1)));
  const plan =
    tradeCount === 1
      ? '1 trade opens at TP1.'
      : tradeCount === 2
        ? 'Trade 1 → TP1. Trade 2 → TP2.'
        : `Trade 1 → TP1, Trade 2 → TP2, Trade 3 → TP3${tradeCount > 3 ? '. Extra trades use TP3.' : '.'}`;

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
        body: 'Choose a symbol and how many trades. START scans that market and opens the trades.',
        onClick: () => onPick('auto'),
      }),
    ]);
  }

  return shell([
    top,
    h('div', { style: { color: '#94a3b8', fontSize: 12, marginBottom: 8 } }, 'Symbol on your broker'),
    h('input', {
      value: symbol,
      disabled: busy,
      onChange: (event) => setSymbol(event.target.value.toUpperCase().replace(/\s+/g, '').slice(0, 32)),
      placeholder: 'Search or type, e.g. XAUUSD.m',
      'aria-label': 'Broker symbol',
      autoCapitalize: 'characters',
      autoCorrect: 'off',
      spellCheck: false,
      style: {
        ...card,
        marginBottom: 8,
        fontSize: 18,
        fontWeight: 800,
        outline: 'none',
      },
    }),
    symbolNote
      ? h('div', { style: { color: '#94a3b8', fontSize: 12, marginBottom: 8 } }, symbolNote)
      : null,
    h(
      'div',
      { style: { display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 } },
      AUTO_SYMBOLS.map((item) =>
        h(
          'button',
          {
            key: item,
            type: 'button',
            disabled: busy,
            onClick: () => setSymbol(item),
            style: {
              border: item === symbol ? '1px solid #67e8f9' : '1px solid rgba(255,255,255,.14)',
              background: '#12121a',
              color: item === symbol ? '#67e8f9' : '#fff',
              borderRadius: 999,
              padding: '6px 10px',
              font: 'inherit',
              fontSize: 12,
              fontWeight: 800,
            },
          },
          item,
        ),
      ),
    ),
    h(
      'div',
      { style: { maxHeight: 180, overflow: 'auto', marginBottom: 14 } },
      brokerMatches(brokerSymbols, symbol).map((item) =>
        h(
          'button',
          {
            key: item,
            type: 'button',
            disabled: busy,
            onClick: () => setSymbol(item),
            style: {
              display: 'block',
              width: '100%',
              textAlign: 'left',
              marginBottom: 6,
              border: item === symbol ? '1px solid #67e8f9' : '1px solid rgba(255,255,255,.1)',
              background: '#0d1118',
              color: '#fff',
              borderRadius: 10,
              padding: '8px 10px',
              font: 'inherit',
              fontWeight: 700,
            },
          },
          item,
        ),
      ),
    ),
    h(
      'div',
      { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 } },
      h(
        'div',
        { style: card },
        h('div', { style: { color: '#94a3b8', fontSize: 11, letterSpacing: '.06em' } }, 'NUMBER OF TRADES'),
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 } },
          h(
            'button',
            {
              type: 'button',
              'aria-label': 'Fewer trades',
              disabled: busy || tradeCount <= 1,
              onClick: () => setTrades(Math.max(1, tradeCount - 1)),
              style: stepBtn,
            },
            '−',
          ),
          h('strong', { style: { fontSize: 28 } }, tradeCount),
          h(
            'button',
            {
              type: 'button',
              'aria-label': 'More trades',
              disabled: busy || tradeCount >= 10,
              onClick: () => setTrades(Math.min(10, tradeCount + 1)),
              style: stepBtn,
            },
            '+',
          ),
        ),
      ),
      h(
        'label',
        { style: card },
        h('div', { style: { color: '#94a3b8', fontSize: 11, letterSpacing: '.06em' } }, 'LOT SIZE'),
        h('input', {
          value: lot,
          inputMode: 'decimal',
          onChange: (event) => setLot(event.target.value.replace(/[^0-9.]/g, '').slice(0, 6)),
          'aria-label': 'Lot size',
          style: {
            width: '100%',
            marginTop: 6,
            background: 'transparent',
            border: 0,
            color: '#fff',
            font: 'inherit',
            fontSize: 28,
            fontWeight: 800,
            textAlign: 'center',
          },
        }),
      ),
    ),
    h('p', { style: { color: '#94a3b8', fontSize: 12, margin: '10px 0 14px' } }, `${symbol} · ${plan}`),
    h(
      'button',
      {
        type: 'button',
        className: 'scan-execute-btn',
        disabled: busy || String(symbol || '').trim().length < 2,
        onClick: () => onStart(String(symbol || '').trim(), tradeCount, lot),
      },
      busy ? 'WORKING…' : 'START',
    ),
    note ? h('p', { style: { color: '#e2e8f0', fontSize: 13, marginTop: 12 } }, note) : null,
    levels(result),
    h(
      'p',
      { style: { color: '#64748b', fontSize: 11, marginTop: 14, lineHeight: 1.4 } },
      'START uses OpenAI on the live candles, then opens every trade in that same direction. The analysis stays the current read for this symbol until price hits the stop or TP1, or 20 minutes pass. A manual scan of the same symbol follows it.',
    ),
  ]);
}
