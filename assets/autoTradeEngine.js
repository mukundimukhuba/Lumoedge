const RING_RADIUS = 52;

export function headerStatus(phase) {
  if (phase === 'ready') return 'READY';
  if (phase === 'stopped') return 'STOPPED';
  if (phase === 'error') return 'ERROR';
  if (phase === 'open') return 'TRADE OPEN';
  if (phase === 'starting') return 'STARTING';
  if (phase === 'executing') return 'EXECUTING';
  if (phase === 'nosignal' || phase === 'waiting') return 'WAITING';
  if (phase === 'scanning' || phase === 'confirming' || phase === 'starting') return 'ANALYZING';
  return 'LIVE ENGINE';
}

export function countdownCopy(left) {
  const n = Math.max(0, Math.min(15, Math.round(Number(left) || 0)));
  const time = `00:${String(n).padStart(2, '0')}`;
  if (n <= 10) return { kicker: 'NEXT SCAN IN', time, sub: '' };
  return { kicker: 'AUTO SCAN', time, sub: 'NEXT ANALYSIS' };
}

export function ringMetrics(left, total = 15, radius = RING_RADIUS) {
  const circ = 2 * Math.PI * radius;
  const n = Math.max(0, Math.min(total, Number(left) || 0));
  const span = total > 0 ? total : 1;
  return { circ, offset: circ * (1 - n / span) };
}

function cleanSymbol(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/\s+/g, '')
    .slice(0, 32);
}

function chosenSymbols(seed) {
  const out = [];
  const seen = new Set();
  for (const value of Array.isArray(seed) ? seed : []) {
    const name = cleanSymbol(value?.symbol || value);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

function clock() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '—';
  return String(n);
}

function cssText() {
  return `
.lte-shell{position:fixed;inset:0;z-index:260;overflow:auto;display:flex;justify-content:center;align-items:flex-start;padding:calc(78px + env(safe-area-inset-top)) 18px calc(22px + env(safe-area-inset-bottom));background:rgba(2,4,10,.38);backdrop-filter:blur(3px);color:#f4f7fb;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
.lte-shell *{box-sizing:border-box}
.lte-wrap{width:min(100%,360px);margin:0;padding:16px 16px 14px;border-radius:22px;background:linear-gradient(180deg,rgba(16,18,32,.96),rgba(8,10,18,.96));border:1px solid rgba(125,211,252,.42);box-shadow:0 0 0 1px rgba(168,85,247,.2),0 22px 50px rgba(0,0,0,.48),0 0 32px rgba(99,102,241,.28)}
.lte-top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.lte-kicker{margin:0;font-size:11px;letter-spacing:.22em;color:#67e8f9;font-weight:700}
.lte-title{margin:4px 0 0;font-size:18px;line-height:1.15;font-weight:760;letter-spacing:.02em}
.lte-powered{margin:6px 0 0;color:#94a3b8;font-size:12px}
.lte-x{width:40px;height:40px;border-radius:12px;border:1px solid rgba(125,211,252,.35);background:rgba(15,23,42,.55);color:#e2e8f0;font-size:22px;line-height:1;cursor:pointer}
.lte-pill{display:inline-flex;align-items:center;gap:8px;margin-top:14px;padding:6px 10px;border-radius:999px;border:1px solid rgba(125,211,252,.35);background:rgba(15,23,42,.55);font-size:11px;letter-spacing:.14em;font-weight:750}
.lte-dot{width:8px;height:8px;border-radius:99px;background:#64748b;box-shadow:0 0 0 0 rgba(103,232,249,.0)}
.lte-pill.is-live .lte-dot{background:#67e8f9;animation:lte-pulse 1.6s ease-out infinite}
.lte-pill.is-open .lte-dot{background:#34d399;animation:lte-pulse 1.6s ease-out infinite}
.lte-pill.is-error .lte-dot{background:#fb7185}
.lte-card{margin-top:12px;padding:0;border:0;background:transparent;box-shadow:none}
.lte-label{margin:0 0 10px;font-size:11px;letter-spacing:.16em;color:#94a3b8;font-weight:700}
.lte-chips{display:flex;flex-wrap:wrap;gap:8px}
.lte-chip{min-height:40px;padding:8px 12px;border-radius:12px;border:1px solid rgba(148,163,184,.28);background:rgba(15,23,42,.45);color:#e2e8f0;font:inherit;font-size:13px;font-weight:750;letter-spacing:.04em;cursor:pointer}
.lte-chip.is-on{color:#ecfeff;border-color:rgba(103,232,249,.85);background:linear-gradient(180deg, rgba(34,211,238,.18), rgba(99,102,241,.16));box-shadow:0 0 18px rgba(34,211,238,.28)}
.lte-chip:disabled{opacity:.55;cursor:default}
.lte-counts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
.lte-count{min-height:44px;border-radius:12px;border:1px solid rgba(148,163,184,.28);background:rgba(15,23,42,.45);color:#e2e8f0;font:inherit;font-size:12px;font-weight:750;cursor:pointer;padding:6px}
.lte-count.is-on{color:#fff;border-color:rgba(192,132,252,.9);background:linear-gradient(180deg, rgba(168,85,247,.28), rgba(59,130,246,.16));box-shadow:0 0 16px rgba(168,85,247,.28)}
.lte-count:disabled{opacity:.55;cursor:default}
.lte-custom{width:100%;margin-top:8px;height:44px;border-radius:12px;border:1px solid rgba(125,211,252,.35);background:#0b1020;color:#fff;font:inherit;font-size:18px;font-weight:750;padding:0 12px}
.lte-summary{display:grid;grid-template-columns:1fr 1fr;gap:10px 12px}
.lte-summary span{display:block;color:#94a3b8;font-size:10px;letter-spacing:.14em}
.lte-summary strong{display:block;margin-top:3px;font-size:13px;font-weight:720;word-break:break-word}
.lte-lot{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:12px}
.lte-lot input{width:96px;height:40px;border:0;background:transparent;color:#fff;font:inherit;font-size:20px;font-weight:760;text-align:right}
.lte-go{width:100%;margin-top:14px;min-height:56px;border:0;border-radius:16px;cursor:pointer;color:#041018;font:inherit;font-size:15px;font-weight:800;letter-spacing:.08em;background:linear-gradient(90deg,#67e8f9,#818cf8 55%,#e879f9)}
.lte-go:disabled{opacity:.45;cursor:default}
.lte-go.is-stop{color:#fff;background:linear-gradient(90deg,#1e1b4b,#312e81);box-shadow:0 0 0 1px rgba(129,140,248,.7), 0 0 24px rgba(99,102,241,.45);animation:lte-glow 1.8s ease-in-out infinite}
.lte-run{margin:8px 0 0;text-align:center;font-size:11px;letter-spacing:.18em;color:#c4b5fd;font-weight:750}
.lte-stage{position:relative;overflow:hidden;padding:12px;border-radius:16px;border:1px solid rgba(125,211,252,.2);background:rgba(255,255,255,.03)}
.lte-stage.is-scan{background-image:linear-gradient(rgba(103,232,249,.05) 1px, transparent 1px),linear-gradient(90deg, rgba(103,232,249,.05) 1px, transparent 1px);background-size:22px 22px;animation:lte-grid 8s linear infinite}
.lte-ring-wrap{display:grid;place-items:center;min-height:148px}
.lte-ring{width:132px;height:132px;position:relative}
.lte-ring svg{width:100%;height:100%;transform:rotate(-90deg)}
.lte-ring circle{fill:none;stroke-width:6}
.lte-ring .track{stroke:rgba(148,163,184,.2)}
.lte-ring .prog{stroke-linecap:round;transition:stroke-dashoffset .9s linear}
.lte-ring-copy{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:28px}
.lte-ring-copy b{font-size:22px;letter-spacing:.04em;font-weight:760}
.lte-ring-copy small{color:#94a3b8;letter-spacing:.14em;font-size:10px;font-weight:700}
.lte-scan-title{margin:0;font-size:18px;font-weight:760;letter-spacing:.01em}
.lte-scan-symbol{margin:4px 0 0;color:#67e8f9;font-size:12px;letter-spacing:.12em;font-weight:700}
.lte-bar{height:8px;margin:12px 0;border-radius:99px;background:rgba(148,163,184,.16);overflow:hidden}
.lte-bar i{display:block;height:100%;width:40%;border-radius:inherit;background:linear-gradient(90deg,#22d3ee,#818cf8,#e879f9);animation:lte-bar 1.2s ease-in-out infinite}
.lte-steps{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.lte-steps li{color:#94a3b8;font-size:13px}
.lte-steps li.is-hot{color:#e2e8f0}
.lte-signal{animation:lte-in .35s ease}
.lte-side{margin:6px 0;font-size:28px;font-weight:800;letter-spacing:.08em}
.lte-side.sell{color:#fb7185}
.lte-side.buy{color:#34d399}
.lte-meta{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:8px}
.lte-meta span{display:block;color:#94a3b8;font-size:10px;letter-spacing:.12em}
.lte-meta strong{font-size:13px}
.lte-exec{margin-top:12px;text-align:center;letter-spacing:.16em;font-size:12px;font-weight:800;color:#e9d5ff;animation:lte-in .35s ease}
.lte-pl.up{color:#34d399}
.lte-pl.down{color:#fb7185}
.lte-empty{color:#cbd5e1;font-size:14px;line-height:1.45}
.lte-log{margin-top:8px}
.lte-log summary{cursor:pointer;letter-spacing:.14em;font-size:11px;color:#94a3b8}
.lte-log ul{list-style:none;margin:10px 0 0;padding:0;display:grid;gap:6px;max-height:180px;overflow:auto}
.lte-log li{font-size:12px;color:#cbd5e1;font-variant-numeric:tabular-nums}
.lte-log time{color:#67e8f9;margin-right:8px}
.lte-note{margin:10px 0 0;color:#94a3b8;font-size:12px;line-height:1.4}
@keyframes lte-pulse{0%{box-shadow:0 0 0 0 rgba(103,232,249,.55)}100%{box-shadow:0 0 0 10px rgba(103,232,249,0)}}
@keyframes lte-glow{50%{box-shadow:0 0 0 1px rgba(192,132,252,.9), 0 0 28px rgba(232,121,249,.45)}}
@keyframes lte-bar{0%{transform:translateX(-120%)}100%{transform:translateX(280%)}}
@keyframes lte-grid{to{background-position:22px 22px, 22px 22px}}
@keyframes lte-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion: reduce){
  .lte-dot,.lte-go.is-stop,.lte-bar i,.lte-stage.is-scan,.lte-signal,.lte-exec{animation:none}
  .lte-ring .prog{transition:none}
}
`;
}

function ensureStyle() {
  if (document.getElementById('lte-style')) return;
  const style = document.createElement('style');
  style.id = 'lte-style';
  style.textContent = cssText();
  document.head.appendChild(style);
}

function field(label, value) {
  return `<span>${label}</span><strong>${value}</strong>`;
}

export async function openAutoEngine(opts = {}) {
  ensureStyle();
  const existing = document.getElementById('lte-shell');
  if (existing) {
    existing.scrollTop = 0;
    if (opts.autostart !== false && !existing.__lteRunning?.()) existing.__lteStart?.();
    return existing;
  }
  const { readSymbolTrades, tradeCountFor } = await import('./symbolTrades.js?v=symedit1');
  const saved = readSymbolTrades(opts.email);
  const symbols = chosenSymbols(opts.symbols);
  const counts = Object.fromEntries(symbols.map((name) => [name, tradeCountFor(saved.counts, name)]));

  const state = {
    phase: 'ready',
    running: false,
    finished: false,
    symbols,
    selected: new Set(symbols),
    counts,
    lot: String(saved.lot || '0.01'),
    symbol: '',
    direction: '',
    accuracy: 0,
    entry: 0,
    opened: 0,
    requested: 0,
    price: null,
    openedAt: 0,
    message: '',
    left: 15,
    trades: [],
    log: [],
    scanStep: 0,
  };
  let controller = null;
  let quoteTimer = 0;
  let durationTimer = 0;
  let scanTimer = 0;

  const shell = document.createElement('div');
  shell.id = 'lte-shell';
  shell.className = 'lte-shell';
  shell.innerHTML = `
    <div class="lte-wrap">
      <div class="lte-top">
        <div>
          <p class="lte-kicker">LUMO</p>
          <h1 class="lte-title">AUTO TRADE ENGINE</h1>
          <p class="lte-powered">Powered by Lumo</p>
        </div>
        <button type="button" class="lte-x" aria-label="Close">×</button>
      </div>
      <div class="lte-pill" id="lte-pill"><i class="lte-dot"></i><span id="lte-pill-text">READY</span></div>
      <section class="lte-card lte-stage" id="lte-stage" hidden></section>
      <section class="lte-card" id="lte-open" hidden></section>
      <section class="lte-card" id="lte-setup"></section>
      <p class="lte-run" id="lte-run" hidden>ENGINE RUNNING</p>
      <button type="button" class="lte-go is-stop" id="lte-go" hidden>STOP ENGINE</button>
      <details class="lte-card lte-log" id="lte-log">
        <summary>ENGINE ACTIVITY</summary>
        <ul id="lte-log-list"></ul>
      </details>
      <p class="lte-note" id="lte-note"></p>
    </div>`;
  document.body.appendChild(shell);

  const setupEl = shell.querySelector('#lte-setup');
  const stageEl = shell.querySelector('#lte-stage');
  const openEl = shell.querySelector('#lte-open');
  const goBtn = shell.querySelector('#lte-go');
  const runEl = shell.querySelector('#lte-run');
  const pill = shell.querySelector('#lte-pill');
  const pillText = shell.querySelector('#lte-pill-text');
  const logList = shell.querySelector('#lte-log-list');
  const noteEl = shell.querySelector('#lte-note');

  function addLog(text) {
    if (!text) return;
    state.log.push({ stamp: clock(), text });
    if (state.log.length > 40) state.log.shift();
    logList.innerHTML = state.log
      .map((row) => `<li><time>${row.stamp}</time>${row.text}</li>`)
      .join('');
  }

  function paintSetup() {
    const names = [...state.selected];
    const tradeLine = names.map((name) => `${state.counts[name] || 1}`).join(', ') || '—';
    setupEl.innerHTML = `<div class="lte-summary"><div>${field('SYMBOLS', names.join(', ') || 'None selected')}</div><div>${field('TRADES', tradeLine)}</div><div>${field('TIMEFRAME', '15M')}</div><div>${field('ENGINE MODE', 'AUTO')}</div></div>`;
  }

  function paintStage() {
    const phase = state.phase;
    const showScan = phase === 'scanning' || phase === 'confirming' || phase === 'starting';
    const showCount = phase === 'countdown' || phase === 'signal';
    const showSignal = phase === 'signal' || phase === 'countdown' || phase === 'executing';
    const showEmpty = phase === 'nosignal';
    const showError = phase === 'error';
    stageEl.hidden = !(showScan || showCount || showSignal || showEmpty || showError);
    stageEl.classList.toggle('is-scan', showScan);
    if (showScan) {
      const title = 'Analyzing the market';
      const steps = ['Market structure', 'Momentum', 'Trend', 'Volatility']
        .map((name, index) => `<li class="${index <= state.scanStep ? 'is-hot' : ''}">${index <= state.scanStep ? '●' : '○'} ${name}</li>`)
        .join('');
      stageEl.innerHTML = `<p class="lte-scan-title">${title}</p>${state.symbol ? `<p class="lte-scan-symbol">${state.symbol}</p>` : ''}<div class="lte-bar" aria-hidden="true"><i></i></div><ul class="lte-steps">${steps}</ul>`;
      return;
    }
    if (showCount || showSignal || showEmpty || showError) {
      const copy = countdownCopy(state.left);
      const ring = ringMetrics(phase === 'confirming' ? 0 : state.left);
      const side = state.direction === 'sell' ? 'SELL' : state.direction === 'buy' ? 'BUY' : '';
      const ringHtml = showCount
        ? `<div class="lte-ring-wrap"><div class="lte-ring"><svg viewBox="0 0 120 120" aria-hidden="true"><defs><linearGradient id="lte-ring-grad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#67e8f9"/><stop offset=".55" stop-color="#818cf8"/><stop offset="1" stop-color="#e879f9"/></linearGradient></defs><circle class="track" cx="60" cy="60" r="${RING_RADIUS}"></circle><circle class="prog" cx="60" cy="60" r="${RING_RADIUS}" stroke="url(#lte-ring-grad)" stroke-dasharray="${ring.circ}" stroke-dashoffset="${ring.offset}"></circle></svg><div class="lte-ring-copy"><small>${copy.kicker}</small><b>${copy.time}</b>${copy.sub ? `<small>${copy.sub}</small>` : ''}</div></div></div>`
        : '';
      const signalHtml = showSignal
        ? `<div class="lte-signal"><p class="lte-label">SIGNAL DETECTED</p><strong>${state.symbol || ''}</strong><div class="lte-side ${side === 'SELL' ? 'sell' : 'buy'}">${side}</div><div class="lte-meta"><div><span>CONFIDENCE</span><strong>${state.accuracy || '—'}%</strong></div><div><span>ENTRY</span><strong>${money(state.entry)}</strong></div><div><span>TRADES</span><strong>${state.requested || state.counts[state.symbol] || 1}</strong></div></div>${phase === 'executing' ? '<div class="lte-exec">EXECUTE TRADE</div>' : ''}</div>`
        : '';
      const emptyHtml = showEmpty
        ? `<div class="lte-empty"><p class="lte-label">NO VALID SIGNAL</p><p>Market conditions do not meet the engine requirements.</p></div>`
        : '';
      const errorHtml = showError ? `<div class="lte-empty"><p class="lte-label">ERROR</p><p>${state.message || 'The engine could not finish this scan.'}</p></div>` : '';
      stageEl.innerHTML = ringHtml + signalHtml + emptyHtml + errorHtml;
      const prog = stageEl.querySelector('.prog');
      if (prog) {
        prog.style.strokeDasharray = prog.getAttribute('stroke-dasharray');
        prog.style.strokeDashoffset = prog.getAttribute('stroke-dashoffset');
      }
    }
  }

  function paintOpen() {
    const trade = state.trades[state.trades.length - 1];
    if (!trade) {
      openEl.hidden = true;
      openEl.innerHTML = '';
      return;
    }
    openEl.hidden = false;
    const side = trade.direction === 'sell' ? 'SELL' : 'BUY';
    const px = Number(state.price);
    let floatText = '—';
    let floatClass = '';
    if (Number.isFinite(px) && px > 0 && trade.entry > 0) {
      const delta = side === 'SELL' ? trade.entry - px : px - trade.entry;
      floatText = `${delta > 0 ? '+' : ''}${delta.toFixed(2)}`;
      floatClass = delta > 0 ? 'up' : delta < 0 ? 'down' : '';
    }
    const seconds = trade.openedAt ? Math.max(0, Math.floor((Date.now() - trade.openedAt) / 1000)) : 0;
    const duration = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    openEl.innerHTML = `
      <p class="lte-label">TRADE ACTIVE</p>
      <strong>${trade.symbol}</strong>
      <div class="lte-side ${side === 'SELL' ? 'sell' : 'buy'}">${side}</div>
      <div class="lte-meta">
        <div><span>STATUS</span><strong>OPEN</strong></div>
        <div><span>TRADE</span><strong>#${trade.opened}</strong></div>
        <div><span>OPENED</span><strong>${trade.opened}/${trade.requested}</strong></div>
        <div><span>ENTRY</span><strong>${money(trade.entry)}</strong></div>
        <div><span>PRICE</span><strong>${Number.isFinite(px) && px > 0 ? px : '—'}</strong></div>
        <div><span>FLOAT</span><strong class="lte-pl ${floatClass}">${floatText}</strong></div>
        <div><span>DURATION</span><strong id="lte-duration">${duration}</strong></div>
      </div>`;
  }

  function paintCountdown() {
    const copy = countdownCopy(state.left);
    const ring = ringMetrics(state.left);
    const prog = stageEl.querySelector('.prog');
    const copyEl = stageEl.querySelector('.lte-ring-copy');
    if (!prog || !copyEl) {
      paintStage();
      return;
    }
    prog.style.strokeDasharray = String(ring.circ);
    prog.style.strokeDashoffset = String(ring.offset);
    copyEl.innerHTML = `<small>${copy.kicker}</small><b>${copy.time}</b>${copy.sub ? `<small>${copy.sub}</small>` : ''}`;
  }

  function paintChrome() {
    let status = headerStatus(state.phase);
    if (state.running && ['starting', 'scanning', 'confirming'].includes(state.phase)) status = 'ANALYZING';
    else if (state.running && !['error', 'open', 'stopped', 'ready'].includes(state.phase)) status = 'LIVE ENGINE';
    if (!state.running && state.phase === 'nosignal') status = 'STOPPED';
    pillText.textContent = status;
    pill.classList.toggle('is-live', state.running || status === 'LIVE ENGINE' || status === 'ANALYZING');
    pill.classList.toggle('is-open', state.phase === 'open');
    pill.classList.toggle('is-error', state.phase === 'error');
    goBtn.hidden = !state.running;
    goBtn.textContent = 'STOP ENGINE';
    goBtn.classList.add('is-stop');
    runEl.hidden = !state.running || ['starting', 'scanning', 'confirming'].includes(state.phase);
    const opened = state.trades.reduce((sum, trade) => sum + (Number(trade.opened) || 0), 0);
    noteEl.textContent = opened ? `Opened this pass: ${opened}.` : '';
  }

  function render() {
    paintSetup();
    paintStage();
    paintOpen();
    paintChrome();
  }

  function stopQuotes() {
    if (quoteTimer) clearInterval(quoteTimer);
    if (durationTimer) clearInterval(durationTimer);
    quoteTimer = 0;
    durationTimer = 0;
  }

  async function pollQuote() {
    const trade = state.trades[state.trades.length - 1];
    if (!trade || !opts.email) return;
    try {
      const quote = opts.quote
        ? await opts.quote(trade.symbol)
        : await liveQuote(opts.email, trade.symbol);
      if (Number.isFinite(Number(quote)) && Number(quote) > 0) {
        state.price = Number(quote);
        paintOpen();
      }
    } catch {
      /* a missing quote stays blank instead of a made-up price */
    }
  }

  function watchTrade() {
    stopQuotes();
    if (!state.trades.length) return;
    pollQuote();
    quoteTimer = setInterval(pollQuote, 3000);
    durationTimer = setInterval(() => {
      const node = shell.querySelector('#lte-duration');
      const trade = state.trades[state.trades.length - 1];
      if (!node || !trade?.openedAt) return;
      const seconds = Math.max(0, Math.floor((Date.now() - trade.openedAt) / 1000));
      node.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    }, 1000);
  }

  function onStatus(event) {
    if (!event || typeof event !== 'object') return;
    if (event.symbol) state.symbol = event.symbol;
    if (event.direction === 'buy' || event.direction === 'sell') state.direction = event.direction;
    if (event.accuracy) state.accuracy = event.accuracy;
    if (event.entry) state.entry = event.entry;
    if (event.trades) state.requested = event.trades;
    if (event.left != null) state.left = event.left;
    if (event.message) state.message = event.message;
    if (event.phase === 'scanning' || event.phase === 'confirming') {
      state.phase = event.phase;
      state.scanStep = 0;
      if (scanTimer) clearInterval(scanTimer);
      scanTimer = setInterval(() => {
        state.scanStep = Math.min(3, state.scanStep + 1);
        if (state.phase === 'scanning' || state.phase === 'confirming') paintStage();
        if (state.scanStep >= 3) clearInterval(scanTimer);
      }, 450);
      addLog(`${event.symbol || 'Market'} scan started`);
    } else if (event.phase === 'signal') {
      state.phase = 'signal';
      state.left = 15;
      addLog(`${String(event.direction || '').toUpperCase()} ${event.symbol || ''} signal found`);
    } else if (event.phase === 'countdown') {
      const first = state.phase !== 'countdown';
      state.phase = 'countdown';
      if (event.left === 15) addLog('Opening countdown started');
      if (first) render();
      else {
        paintCountdown();
        paintChrome();
      }
      return;
    } else if (event.phase === 'executing') {
      state.phase = 'executing';
      addLog('Starting opening trades');
    } else if (event.phase === 'open' && Number(event.opened) > 0) {
      state.phase = 'open';
      state.trades.push({
        symbol: event.symbol,
        direction: event.direction,
        entry: Number(event.entry) || 0,
        opened: Number(event.opened) || 0,
        requested: Number(event.requested) || Number(event.trades) || state.counts[event.symbol] || 1,
        openedAt: Date.now(),
      });
      addLog(event.message || `Opened ${event.opened} ${event.symbol || ''}`);
      watchTrade();
    } else if (event.phase === 'nosignal') {
      state.phase = 'nosignal';
      addLog(event.message || 'No valid signal');
    } else if (event.phase === 'error') {
      state.phase = 'error';
      addLog(event.message || 'Engine error');
    } else if (event.phase === 'stopped') {
      state.running = false;
      state.finished = true;
      if (scanTimer) clearInterval(scanTimer);
      if (state.phase === 'open' && state.trades.length) {
        /* keep the trade card; the order was actually opened */
      } else if (state.phase !== 'nosignal' && state.phase !== 'error') {
        state.phase = 'stopped';
      }
      addLog(event.message || 'Engine stopped');
      window.__lumoAutoStop = null;
    }
    render();
  }

  async function start() {
    if (state.running) return;
    const names = [...state.selected];
    if (!names.length) {
      state.phase = 'error';
      state.message = 'Select symbols on the Symbols page first. No trades were opened.';
      addLog(state.message);
      render();
      return;
    }
    const counts = Object.fromEntries(names.map((name) => [name, state.counts[name] || 1]));
    state.running = true;
    state.finished = false;
    state.phase = 'starting';
    state.message = '';
    stopQuotes();
    state.trades = [];
    controller = new AbortController();
    window.__lumoAutoStop = stop;
    addLog('Engine started');
    render();
    const run = opts.run || defaultRun;
    try {
      await run({
        email: opts.email,
        symbols: names,
        counts,
        lot: state.lot,
        eaName: opts.eaName,
        mentorId: opts.mentorId,
        licenseKey: opts.licenseKey,
        signal: controller.signal,
        onStatus,
        onNote: (text) => {
          if (text) state.message = text;
        },
      });
    } catch (error) {
      state.running = false;
      state.phase = 'error';
      state.message = error instanceof Error ? error.message : 'Could not open the selected trades.';
      addLog(state.message);
    } finally {
      state.running = false;
      if (state.phase === 'starting' || state.phase === 'scanning' || state.phase === 'countdown') {
        state.phase = state.trades.length ? 'open' : 'stopped';
      }
      window.__lumoAutoStop = null;
      render();
    }
  }

  function stop() {
    controller?.abort();
    state.running = false;
    if (state.phase !== 'open') state.phase = 'stopped';
    render();
  }

  goBtn.addEventListener('click', () => {
    if (state.running) stop();
  });
  shell.querySelector('.lte-x').addEventListener('click', () => {
    if (state.running) stop();
    close();
  });

  function close() {
    stop();
    stopQuotes();
    if (scanTimer) clearInterval(scanTimer);
    shell.remove();
    if (window.__lumoAutoStop === stop) window.__lumoAutoStop = null;
  }

  shell.__lteStart = start;
  shell.__lteRunning = () => state.running;
  if (opts.autostart !== false) start();
  else render();
  return shell;
}

async function defaultRun(args) {
  const { runSelectedSymbolTrades } = await import('./runSymbolTrades.js?v=engine1');
  return runSelectedSymbolTrades(args);
}

async function liveQuote(email, symbol) {
  const { O: mt5Token } = await import('./index-BN3mw-4aa.js');
  const { r: apiUrl } = await import('./apiBase-CDudBPOx.js');
  const token = await mt5Token(email).catch(() => '');
  if (!token || !symbol) return null;
  const response = await fetch(
    apiUrl(`/api/mt5/GetQuote?id=${encodeURIComponent(token)}&symbol=${encodeURIComponent(symbol)}&msNotOlder=0`),
  );
  if (!response.ok) return null;
  const data = await response.json();
  const bid = Number(data?.bid);
  const ask = Number(data?.ask);
  if (bid > 0 && ask > 0) return (bid + ask) / 2;
  const last = Number(data?.last);
  return last > 0 ? last : null;
}
