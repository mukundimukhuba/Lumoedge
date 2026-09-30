import { r as apiUrl } from './apiBase-CDudBPOx.js';
import { F as matchSymbol, O as mt5Token, m as ladder } from './index-BN3mw-4aa.js';
import { a as checkConnect, c as brokerSymbols, f as orderSend, i as tradeComment } from './mt5Api-CQ-lx09j.js?v=notp1';
import { readSymbolTrades, tradeCountFor } from './symbolTrades.js?v=symtrade1';
import { loadScannerTelegramPref, notifyMentorTelegramTrade } from './telegramNotify-Dhw55VDM.js';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clampLot(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0.01;
  return Math.max(0.01, Math.min(1, n));
}

export async function openSelectedTrades({ rows, scan, send, onNote }) {
  const list = (rows || [])
    .map((row) => ({
      symbol: String(row?.symbol || '').trim(),
      trades: tradeCountFor({ [row?.symbol]: row?.trades }, row?.symbol),
    }))
    .filter((row) => row.symbol);
  if (!list.length) return 'Select symbols first. No trades were opened.';
  const notes = [];
  for (let i = 0; i < list.length; i += 1) {
    const { symbol, trades } = list[i];
    onNote?.(`Scanning ${symbol} (${i + 1}/${list.length})…`);
    let data;
    try {
      data = await scan(symbol);
    } catch {
      notes.push(`${symbol}: scan failed`);
      continue;
    }
    if (!data?.ok) {
      notes.push(`${symbol}: ${data?.error || 'scan failed'}`);
      continue;
    }
    const direction = data.direction === 'sell' ? 'sell' : 'buy';
    const entry = Number(data.entryPrice) || 0;
    const stopLoss = Number(data.stopLoss) || 0;
    const accuracy = Math.max(1, Math.min(99, Math.round(Number(data.accuracy) || 0)));
    const brokerSymbol = data.symbol || symbol;
    if (data.demo || data.tradeable === false || data.pricesValid === false || !stopLoss || accuracy < 74) {
      notes.push(`${direction.toUpperCase()} ${brokerSymbol} is not strong enough to open trades.`);
      continue;
    }
    onNote?.(`Opening ${trades} ${direction.toUpperCase()} ${brokerSymbol} (${i + 1}/${list.length})…`);
    try {
      const status = await send({
        symbol: brokerSymbol,
        direction,
        trades,
        entry,
        stopLoss,
        accuracy,
        summary: data.summary,
        takeProfit1: data.takeProfit1 || data.takeProfit,
        takeProfit2: data.takeProfit2,
        takeProfit3: data.takeProfit3,
      });
      notes.push(status);
    } catch (error) {
      notes.push(`${brokerSymbol}: ${error instanceof Error ? error.message : 'Order failed'}`);
    }
  }
  return notes.join(' · ');
}

export async function runSelectedSymbolTrades({ email, symbols, eaName, mentorId, licenseKey, onNote }) {
  const names = (Array.isArray(symbols) ? symbols : []).map((item) => String(item || '').trim()).filter(Boolean);
  if (!names.length) return 'Select symbols first. START is on, and no trades were opened.';
  const saved = readSymbolTrades(email);
  const token = await mt5Token(email).catch(() => '');
  if (!token) return 'Connect MetaTrader first. START is on, and no trades were opened.';
  if (!(await checkConnect(token).catch(() => false))) {
    return 'MetaTrader session expired. Reconnect, then press START again.';
  }
  const brokerList = await brokerSymbols(token).catch(() => []);
  const lot = clampLot(saved.lot);
  const notify = String(email || '').toLowerCase() === 'mukundimukhuba8@gmail.com' && loadScannerTelegramPref(email) !== false;
  return openSelectedTrades({
    rows: names.map((symbol) => ({ symbol, trades: tradeCountFor(saved.counts, symbol) })),
    onNote,
    scan: async (symbol) => {
      const response = await fetch(apiUrl('/api/scan/auto'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, id: token }),
      });
      return response.json();
    },
    send: async (trade) => {
      const matched = matchSymbol(trade.symbol, Array.isArray(brokerList) ? brokerList : []);
      if (!matched.symbol) return `${trade.symbol}: ${matched.message || 'Symbol was not found on this broker.'}`;
      const symbol = matched.symbol;
      const prices = ladder(trade.entry, trade.stopLoss, trade.direction, 3);
      const operation = trade.direction === 'sell' ? 'Sell' : 'Buy';
      const comment = tradeComment(eaName);
      let opened = 0;
      let error = '';
      for (let n = 0; n < trade.trades; n += 1) {
        let ok = false;
        for (let attempt = 0; attempt < 2 && !ok; attempt += 1) {
          try {
            if (attempt) await sleep(400);
            await orderSend({
              id: token,
              symbol,
              operation,
              volume: lot,
              comment,
              slippage: 30,
              stopLoss: trade.stopLoss || undefined,
              takeProfit: prices[Math.min(n, Math.max(prices.length - 1, 0))] || undefined,
              entry: trade.entry || undefined,
            });
            opened += 1;
            ok = true;
          } catch (err) {
            error = err instanceof Error ? err.message : 'OrderSend failed';
          }
        }
        if (n < trade.trades - 1) await sleep(250);
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
      return `Opened ${opened}/${trade.trades} ${operation} ${symbol}`;
    },
  });
}
