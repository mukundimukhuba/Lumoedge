import {
  dbList,
  findVaultEntry,
  findWorkspaceLicense,
  keysMatch,
  normalizeLicenseKey,
} from './licenseClaim.mjs';

const TERMINAL_ROOT = 'lumo/copyTerminals';

export function sortOrders(orders) {
  return [...orders].sort((a, b) => {
    const ai = Number(String(a?.id || '').replace(/^ord-/, '')) || 0;
    const bi = Number(String(b?.id || '').replace(/^ord-/, '')) || 0;
    return bi - ai;
  });
}

export async function resolveLicenseContext(firebaseRead, licenseKey) {
  const key = normalizeLicenseKey(licenseKey);
  if (!key) return { error: 'Invalid license key' };

  const [vaultRaw, workspacesRaw] = await Promise.all([
    firebaseRead('lumo/vault'),
    firebaseRead('lumo/store/workspaces'),
  ]);
  const vault = dbList(vaultRaw);
  const workspaces =
    workspacesRaw && typeof workspacesRaw === 'object' ? workspacesRaw : {};

  let entry = findVaultEntry(vault, key);
  let mentorId = entry?.ownerAdminId || '';
  if (!entry) {
    const wsHit = findWorkspaceLicense(workspaces, key);
    if (wsHit) {
      entry = wsHit.license;
      mentorId = wsHit.ownerId;
    }
  }
  if (!entry || !mentorId) return { error: 'License not found' };
  if (entry.status === 'deleted') return { error: 'License revoked' };

  return { key, entry, mentorId };
}

export async function loadTerminal(firebaseRead, copyEaId) {
  const id = String(copyEaId || '').trim();
  if (!id) return null;
  const row = await firebaseRead(`${TERMINAL_ROOT}/${encodeURIComponent(id)}`);
  return row && typeof row === 'object' ? row : null;
}

export async function registerTerminal(firebaseRead, firebaseWrite, input) {
  const copyEaId = String(input.copyEaId || '').trim();
  const licenseKey = normalizeLicenseKey(String(input.licenseKey || ''));
  const email = String(input.email || '').trim().toLowerCase();
  if (!copyEaId || !licenseKey) return { ok: false, error: 'copyEaId and licenseKey required' };
  if (!/^CT-[A-Z0-9-]{4,32}$/i.test(copyEaId)) {
    return { ok: false, error: 'Invalid Copy EA ID format' };
  }

  const ctx = await resolveLicenseContext(firebaseRead, licenseKey);
  if (ctx.error) return { ok: false, error: ctx.error };

  const existing = await loadTerminal(firebaseRead, copyEaId);
  if (
    existing?.licenseKey &&
    !keysMatch(existing.licenseKey, licenseKey)
  ) {
    return { ok: false, error: 'Copy EA ID already linked to another license' };
  }

  const next = {
    copyEaId,
    licenseKey: ctx.key,
    mentorId: ctx.mentorId,
    managedEaId: String(ctx.entry.eaId || ''),
    eaName: String(ctx.entry.eaName || 'Lumo Edge'),
    email: email || existing?.email || '',
    processedOrderIds: Array.isArray(existing?.processedOrderIds)
      ? existing.processedOrderIds.slice(-100)
      : [],
    registeredAt: existing?.registeredAt || new Date().toISOString(),
    lastSeen: new Date().toISOString(),
  };
  const ok = await firebaseWrite(`${TERMINAL_ROOT}/${encodeURIComponent(copyEaId)}`, next);
  return ok ? { ok: true, terminal: next } : { ok: false, error: 'Could not register terminal' };
}

export async function pollCopyOrder(firebaseRead, firebaseWrite, input) {
  const copyEaId = String(input.copyEaId || '').trim();
  const licenseKey = normalizeLicenseKey(String(input.licenseKey || ''));
  if (!copyEaId || !licenseKey) return { ok: false, error: 'copyEaId and licenseKey required' };

  const ctx = await resolveLicenseContext(firebaseRead, licenseKey);
  if (ctx.error) return { ok: false, error: ctx.error };

  let terminal = await loadTerminal(firebaseRead, copyEaId);
  if (!terminal) {
    const reg = await registerTerminal(firebaseRead, firebaseWrite, {
      copyEaId,
      licenseKey,
      email: input.email || '',
    });
    if (!reg.ok) return reg;
    terminal = reg.terminal;
  } else if (!keysMatch(terminal.licenseKey, licenseKey)) {
    return { ok: false, error: 'Copy EA ID does not match this license' };
  }

  const ws = (await firebaseRead(`lumo/store/workspaces/${ctx.mentorId}`)) || {};
  const orders = sortOrders(dbList(ws.orders));
  const processed = new Set(
    (Array.isArray(terminal.processedOrderIds) ? terminal.processedOrderIds : []).map(String),
  );

  const pending = orders.find((row) => row?.id && !processed.has(String(row.id))) || null;
  const order = pending
    ? {
        id: String(pending.id),
        symbol: String(pending.symbol || 'XAUUSD').toUpperCase(),
        side: String(pending.side || 'buy') === 'sell' ? 'sell' : 'buy',
        volume: Math.max(0.01, Number(pending.volume) || 0.01),
        stopLoss: Number(pending.stopLoss) || 0,
        takeProfit: Number(pending.takeProfit) || 0,
        comment: String(pending.comment || ctx.entry.eaName || 'Lumo Edge').slice(0, 31),
        trades: Math.max(1, Math.min(50, Math.round(Number(pending.trades) || 1))),
        createdAt: String(pending.createdAt || ''),
      }
    : null;

  await firebaseWrite(`${TERMINAL_ROOT}/${encodeURIComponent(copyEaId)}`, {
    ...terminal,
    licenseKey: ctx.key,
    mentorId: ctx.mentorId,
    lastSeen: new Date().toISOString(),
    lastPollAt: new Date().toISOString(),
  });

  return { ok: true, pending: Boolean(order), order };
}

export async function ackCopyOrder(firebaseRead, firebaseWrite, input) {
  const copyEaId = String(input.copyEaId || '').trim();
  const licenseKey = normalizeLicenseKey(String(input.licenseKey || ''));
  const orderId = String(input.orderId || '').trim();
  if (!copyEaId || !licenseKey || !orderId) {
    return { ok: false, error: 'copyEaId, licenseKey, and orderId required' };
  }

  const ctx = await resolveLicenseContext(firebaseRead, licenseKey);
  if (ctx.error) return { ok: false, error: ctx.error };

  const terminal = await loadTerminal(firebaseRead, copyEaId);
  if (!terminal || !keysMatch(terminal.licenseKey, licenseKey)) {
    return { ok: false, error: 'Terminal not registered for this license' };
  }

  const processed = Array.isArray(terminal.processedOrderIds)
    ? terminal.processedOrderIds.map(String)
    : [];
  if (!processed.includes(orderId)) processed.push(orderId);

  const next = {
    ...terminal,
    processedOrderIds: processed.slice(-100),
    lastAckAt: new Date().toISOString(),
    lastSeen: new Date().toISOString(),
  };
  const ok = await firebaseWrite(`${TERMINAL_ROOT}/${encodeURIComponent(copyEaId)}`, next);
  return ok ? { ok: true } : { ok: false, error: 'Could not save acknowledgement' };
}

export function formatPollText(result) {
  if (!result.ok) return `ERR\n${result.error || 'Unknown error'}`;
  if (!result.pending || !result.order) return 'OK\nNONE';
  const o = result.order;
  return [
    'OK',
    'ORDER',
    o.id,
    o.symbol,
    o.side,
    String(o.volume),
    String(o.stopLoss || 0),
    String(o.takeProfit || 0),
    o.comment,
    String(o.trades || 1),
  ].join('\n');
}
