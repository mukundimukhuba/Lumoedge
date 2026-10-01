import { r as apiUrl } from './apiBase-CDudBPOx.js';
import { F as matchSymbol, O as mt5Token, m as ladder } from './index-BN3mw-4aa.js';
import { a as checkConnect, c as brokerSymbols, f as orderSend, i as tradeComment } from './mt5Api-CQ-lx09j.js?v=fresh1';
import { readSymbolTrades, snapLot, tradeCountFor } from './symbolTrades.js?v=symedit1';
import { loadScannerTelegramPref, notifyMentorTelegramTrade } from './telegramNotify-Dhw55VDM.js';

function sleep(ms, signal) {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (!signal) return;
    const stop = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal.addEventListener('abort', stop, { once: true });
  });
}

function abortError() {
  const error = new Error('Engine stopped.');
  error.name = 'AbortError';
  return error;
}

function clampLot(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0.01;
  return Math.max(0.01, Math.min(100, n));
}

function symbolBase(name) {
  let text = String(name || '').toUpperCase().trim();
  let prev = '';
  while (text && text !== prev) {
    prev = text;
    text = text
      .replace(/[#._-](MICRO|MINI|MIC|PRO|STD|ECN|RAW|SB|CASH|M|C|R)$/i, '')
      .replace(/(MICRO|MINI|MIC)$/i, '');
  }
  if (/M$/.test(text) && text.length > 6) text = text.slice(0, -1);
  return text.replace(/[^A-Z0-9]/g, '');
}

async function tradeModeAllows(token, symbol) {
  try {
    const response = await fetch(
      apiUrl(`/api/mt5/SymbolParams?id=${encodeURIComponent(token)}&symbol=${encodeURIComponent(symbol)}`),
    );
    const data = await response.json();
    const info = data?.symbol && typeof data.symbol === 'object' ? data.symbol : data || {};
    const group = data?.symbolGroup || {};
    const mode = String(info.tradeMode ?? info.TradeMode ?? group.tradeMode ?? group.TradeMode ?? '').toLowerCase();
    if (!mode) return null;
    if (mode === '0' || mode.includes('disabled') || mode.includes('close')) return false;
    if (mode === '4' || mode === '1' || mode === '2' || mode.includes('full') || mode.includes('long') || mode.includes('short')) {
      return true;
    }
    return null;
  } catch {
    return null;
  }
}

function symbolChoices(requested, matched, brokerList) {
  const base = symbolBase(matched || requested);
  const names = (Array.isArray(brokerList) ? brokerList : []).filter((name) => symbolBase(name) === base);
  names.sort((a, b) => Number(/\.mic$/i.test(b)) - Number(/\.mic$/i.test(a)));
  const out = [];
  const seen = new Set();
  for (const name of [matched, ...names, requested]) {
    const clean = String(name || '').trim();
    const key = clean.toUpperCase();
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  return out.slice(0, 6);
}

async function openableSymbol(token, choices) {
  let unknown = '';
  let sawDisabled = false;
  for (const name of choices) {
    const allows = await tradeModeAllows(token, name);
    if (allows === true) return name;
    if (allows === false) {
      sawDisabled = true;
      continue;
    }
    if (!unknown) unknown = name;
  }
  if (unknown) return unknown;
  if (sawDisabled) return choices.find((name) => /\.mic$/i.test(name)) || '';
  return choices[0] || '';
}

async function symbolLot(token, symbol, requested) {
  let group = {};
  try {
    const response = await fetch(
      apiUrl(`/api/mt5/SymbolParams?id=${encodeURIComponent(token)}&symbol=${encodeURIComponent(symbol)}`),
    );
    const data = await response.json();
    group = data?.symbolGroup || {};
  } catch {
    group = {};
  }
  return snapLot(requested, group);
}

function emitStatus(onStatus, event) {
  try {
    onStatus?.(event);
  } catch {
    /* status display must not block the order path */
  }
}

function tradeRejected(data, direction, brokerSymbol) {
  const accuracy = Math.max(1, Math.min(99, Math.round(Number(data?.accuracy) || 0)));
  const stopLoss = Number(data?.stopLoss) || 0;
  if (!data?.ok) return data?.error || 'scan failed';
  if (data.demo || data.tradeable === false || data.pricesValid === false || !stopLoss || accuracy < 74) {
    return `${direction.toUpperCase()} ${brokerSymbol} is not strong enough to open trades.`;
  }
  return '';
}

export async function openSelectedTrades({ rows, scan, send, onNote, onStatus, signal }) {
  const list = (rows || [])
    .map((row) => ({
      symbol: String(row?.symbol || '').trim(),
      trades: tradeCountFor({ [row?.symbol]: row?.trades }, row?.symbol),
    }))
    .filter((row) => row.symbol);
  if (!list.length) return 'Select symbols first. No trades were opened.';
  const notes = [];
  try {
    for (let i = 0; i < list.length; i += 1) {
      if (signal?.aborted) throw abortError();
      const { symbol, trades } = list[i];
      onNote?.('Analyzing the market');
      emitStatus(onStatus, { phase: 'scanning', symbol, index: i + 1, total: list.length, trades });
      let data;
      try {
        data = await scan(symbol);
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
        const message = `${symbol}: scan failed`;
        notes.push(message);
        emitStatus(onStatus, { phase: 'error', symbol, message });
        continue;
      }
      if (signal?.aborted) throw abortError();
      const direction = data?.direction === 'sell' ? 'sell' : 'buy';
      const brokerSymbol = data?.symbol || symbol;
      const rejected = tradeRejected(data, direction, brokerSymbol);
      if (rejected) {
        notes.push(`${symbol}: ${rejected}`);
        emitStatus(onStatus, { phase: 'nosignal', symbol: brokerSymbol, message: rejected });
        continue;
      }
      const accuracy = Math.max(1, Math.min(99, Math.round(Number(data.accuracy) || 0)));
      const stopLoss = Number(data.stopLoss) || 0;
      const label = `${direction.toUpperCase()} ${brokerSymbol}`;
      onNote?.(label);
      emitStatus(onStatus, {
        phase: 'signal',
        symbol: brokerSymbol,
        direction,
        accuracy,
        entry: Number(data.entryPrice) || 0,
        stopLoss,
        takeProfit1: data.takeProfit1 || data.takeProfit || 0,
        trades,
        summary: data.summary || '',
      });
      for (let left = 15; left >= 1; left -= 1) {
        if (signal?.aborted) throw abortError();
        onNote?.(`${label} · ${left}`);
        emitStatus(onStatus, { phase: 'countdown', symbol: brokerSymbol, direction, left, total: 15, accuracy, trades });
        await sleep(1000, signal);
      }
      if (signal?.aborted) throw abortError();
      onNote?.('Analyzing the market');
      emitStatus(onStatus, { phase: 'confirming', symbol: brokerSymbol, direction });
      let confirm = null;
      try {
        confirm = await scan(symbol);
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
        confirm = null;
      }
      if (signal?.aborted) throw abortError();
      const confirmDirection = confirm?.direction === 'sell' ? 'sell' : confirm?.direction === 'buy' ? 'buy' : '';
      const confirmAccuracy = Math.round(Number(confirm?.accuracy) || 0);
      const confirmRejected =
        !confirm?.ok ||
        confirm.demo ||
        confirm.tradeable === false ||
        confirm.pricesValid === false ||
        confirmDirection !== direction ||
        confirmAccuracy < 74 ||
        !Number(confirm.stopLoss);
      if (confirmRejected) {
        const message = `${label} changed on the live market. No trades opened.`;
        notes.push(message);
        emitStatus(onStatus, { phase: 'nosignal', symbol: brokerSymbol, direction, message });
        continue;
      }
      onNote?.('Starting opening trades');
      const entry = Number(confirm.entryPrice) || Number(data.entryPrice) || 0;
      const liveStop = Number(confirm.stopLoss) || stopLoss;
      emitStatus(onStatus, {
        phase: 'executing',
        symbol: brokerSymbol,
        direction,
        trades,
        entry,
        accuracy: confirmAccuracy,
      });
      try {
        const status = await send({
          symbol: brokerSymbol,
          direction,
          trades,
          entry,
          stopLoss: liveStop,
          accuracy: confirmAccuracy,
          summary: confirm.summary || data.summary,
          takeProfit1: confirm.takeProfit1 || confirm.takeProfit || data.takeProfit1 || data.takeProfit,
          takeProfit2: confirm.takeProfit2 || data.takeProfit2,
          takeProfit3: confirm.takeProfit3 || data.takeProfit3,
        });
        notes.push(status);
        const openedMatch = String(status || '').match(/Opened\s+(\d+)/i);
        const opened = openedMatch ? Number(openedMatch[1]) : 0;
        if (opened > 0) {
          emitStatus(onStatus, {
            phase: 'open',
            symbol: brokerSymbol,
            direction,
            entry,
            opened,
            requested: trades,
            accuracy: confirmAccuracy,
            message: status,
          });
        } else {
          emitStatus(onStatus, { phase: 'error', symbol: brokerSymbol, message: status || 'Broker rejected the order.' });
        }
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
        const message = `${brokerSymbol}: ${error instanceof Error ? error.message : 'Order failed'}`;
        notes.push(message);
        emitStatus(onStatus, { phase: 'error', symbol: brokerSymbol, message });
      }
    }
  } catch (error) {
    if (error?.name === 'AbortError') {
      notes.push('Engine stopped. No further trades were opened.');
      emitStatus(onStatus, { phase: 'stopped', message: 'Engine stopped. No further trades were opened.' });
      return notes.join(' · ');
    }
    throw error;
  }
  emitStatus(onStatus, { phase: 'stopped', message: notes.join(' · ') });
  return notes.join(' · ');
}

export async function runSelectedSymbolTrades({ email, symbols, eaName, mentorId, licenseKey, onNote, onStatus, signal, counts, lot }) {
  const names = (Array.isArray(symbols) ? symbols : []).map((item) => String(item || '').trim()).filter(Boolean);
  if (!names.length) {
    const message = 'Select symbols first. START is on, and no trades were opened.';
    emitStatus(onStatus, { phase: 'error', message });
    return message;
  }
  const saved = readSymbolTrades(email);
  const savedCounts = counts && typeof counts === 'object' ? counts : saved.counts;
  const token = await mt5Token(email).catch(() => '');
  if (!token) {
    const message = 'Connect MetaTrader first. START is on, and no trades were opened.';
    emitStatus(onStatus, { phase: 'error', message });
    return message;
  }
  if (!(await checkConnect(token).catch(() => false))) {
    const message = 'MetaTrader session expired. Reconnect, then press START again.';
    emitStatus(onStatus, { phase: 'error', message });
    return message;
  }
  const brokerList = await brokerSymbols(token).catch(() => []);
  const requestedLot = clampLot(lot ?? saved.lot);
  const notify = String(email || '').toLowerCase() === 'mukundimukhuba8@gmail.com' && loadScannerTelegramPref(email) !== false;
  return openSelectedTrades({
    rows: names.map((symbol) => ({ symbol, trades: tradeCountFor(savedCounts, symbol) })),
    onNote,
    onStatus,
    signal,
    scan: async (symbol) => {
      const response = await fetch(apiUrl('/api/scan/auto'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, id: token }),
      });
      return response.json();
    },
    send: async (trade) => {
      const names = Array.isArray(brokerList) ? brokerList : [];
      const matched = matchSymbol(trade.symbol, names);
      const choices = symbolChoices(trade.symbol, matched.symbol, names);
      let symbol = await openableSymbol(token, choices);
      if (!symbol) return `${trade.symbol}: ${matched.message || 'Trading is disabled on this broker.'}`;
      let lot = await symbolLot(token, symbol, requestedLot);
      let choiceIndex = Math.max(0, choices.indexOf(symbol));
      const prices = ladder(trade.entry, trade.stopLoss, trade.direction, 3);
      const operation = trade.direction === 'sell' ? 'Sell' : 'Buy';
      const comment = tradeComment(eaName);
      let opened = 0;
      let error = '';
      for (let n = 0; n < trade.trades; n += 1) {
        let ok = false;
        for (let attempt = 0; attempt < choices.length && !ok; attempt += 1) {
          const current = choices[Math.min(choiceIndex, choices.length - 1)] || symbol;
          const currentLot = current === symbol ? lot : await symbolLot(token, current, requestedLot);
          try {
            if (attempt) await sleep(400, signal);
            await orderSend({
              id: token,
              symbol: current,
              operation,
              volume: currentLot,
              comment,
              slippage: 30,
              stopLoss: trade.stopLoss || undefined,
              takeProfit: prices[Math.min(n, Math.max(prices.length - 1, 0))] || undefined,
              entry: trade.entry || undefined,
              fresh: true,
            });
            symbol = current;
            lot = currentLot;
            opened += 1;
            ok = true;
          } catch (err) {
            const message = err instanceof Error ? err.message : 'OrderSend failed';
            const disabled = /trading is disabled|trade is disabled|4089631/i.test(message);
            error = /invalid volume/i.test(message)
              ? `invalid volume at lot ${currentLot}`
              : disabled
                ? 'trading is disabled on this broker'
                : message;
            if (disabled && choiceIndex < choices.length - 1) {
              choiceIndex += 1;
              continue;
            }
            break;
          }
        }
        if (n < trade.trades - 1) await sleep(250, signal);
      }
      if (!opened) return `${symbol}: ${error || 'Broker rejected the order.'}`;
      if (notify) {
        await notifyMentorTelegramTrade({
          licenseKey: String(licenseKey || ''),
          mentorId: String(mentorId || ''),
          email: String(email || ''),
          symbol,
          side: trade.direction,
          entry: trade.entry || undefined,
          stopLoss: trade.stopLoss || undefined,
          takeProfit: prices[0] || undefined,
          takeProfit1: prices[0] || undefined,
          takeProfit2: prices[1] || undefined,
          takeProfit3: prices[2] || undefined,
          volume: lot,
          trades: trade.trades,
          eaName,
          accuracy: trade.accuracy,
          source: 'Symbols Start',
          notify: true,
        }).catch(() => null);
      }
      const legs = ['TP1 1:1', 'TP2 1:2', 'TP3 1:3'].slice(0, Math.min(opened, 3));
      return `Opened ${opened}/${trade.trades} ${operation} ${symbol} · ${legs.join(', ')}`;
    },
  });
}
