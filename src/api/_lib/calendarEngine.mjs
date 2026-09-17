import { createHash, randomBytes } from 'node:crypto';
import { firebaseRead, firebaseWrite } from './clientMerge.mjs';
import {
  findVaultEntry,
  findWorkspaceLicense,
  normalizeLicenseKey,
} from './licenseClaim.mjs';
import { checkMt5Connect, sendMt5MarketOrder } from './mt5Bridge.mjs';
import {
  detectUpcomingNews,
  isOfficialNewsEvent,
  isTrackedNewsName,
  newsEventId,
  normalizeNewsName,
  TRACKED_NEWS,
  UPCOMING_HORIZON_MS,
  UPCOMING_LOOKBACK_MS,
} from './economicNews.mjs';

export const DEFAULT_EXPIRY_MS = 5 * 60 * 60 * 1000;
export const DIRECTIONS = new Set(['BUY', 'SELL']);
export const IMPACTS = new Set(['HIGH', 'MEDIUM', 'LOW']);
export const STORED_STATUSES = new Set(['draft', 'published', 'inactive', 'EXPIRED']);

export const EVENTS_ROOT = 'lumo/economicEvents';
export const NEWS_SYNC_ROOT = 'lumo/economicCalendarSync';
export const SIGNALS_ROOT = 'lumo/economicSignals';
export const EXECUTIONS_ROOT = 'lumo/signalExecutions';
export const LOCKS_ROOT = 'lumo/signalExecutionLocks';
export const SUPER_ADMIN_ID = 'LM-004821';
export const DEFAULT_SUPER_EA = { id: 'ea-lumo-edge', name: 'Lumo Edge' };

export const firebaseIo = {
  nowMs: () => Date.now(),
  nowIso: () => new Date().toISOString(),
  read: firebaseRead,
  write: firebaseWrite,
  id: () => `cal_${randomBytes(8).toString('hex')}`,
  checkConnect: checkMt5Connect,
  sendOrder: sendMt5MarketOrder,
};

export function toList(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value && typeof value === 'object') return Object.values(value).filter(Boolean);
  return [];
}

export function normalizeEmail(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

export function emailFingerprint(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return '';
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

export function executionLockId(email, signalId) {
  const fp = emailFingerprint(email).slice(0, 20);
  const sid = String(signalId || '').replace(/[^a-zA-Z0-9_-]/g, '');
  return fp && sid ? `${fp}_${sid}` : '';
}

export function normalizeDirection(value) {
  const raw = String(value || '')
    .trim()
    .toUpperCase();
  if (raw === 'BUY' || raw === 'SELL') return raw;
  return '';
}

export function mt5Operation(direction) {
  return normalizeDirection(direction) === 'SELL' ? 'Sell' : 'Buy';
}

export function normalizeImpact(value) {
  const raw = String(value || '')
    .trim()
    .toUpperCase();
  if (IMPACTS.has(raw)) return raw;
  if (raw === 'HIGH IMPACT') return 'HIGH';
  if (raw === 'MEDIUM IMPACT') return 'MEDIUM';
  if (raw === 'LOW IMPACT') return 'LOW';
  return 'HIGH';
}

export function normalizeSymbol(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

export function isValidSymbol(value) {
  const symbol = normalizeSymbol(value);
  return symbol.length >= 3 && symbol.length <= 12;
}

export function optionalPrice(value) {
  if (value == null || value === '' || String(value).trim().toUpperCase() === 'NONE') {
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function botKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

export function botsMatch(licenseOrBot, botId) {
  const want = botKey(botId);
  if (!want) return false;
  const id = botKey(licenseOrBot?.eaId || licenseOrBot?.botId || licenseOrBot?.id);
  const name = botKey(licenseOrBot?.eaName || licenseOrBot?.botName || licenseOrBot?.name);
  return Boolean(want && (id === want || name === want));
}

export function ownerIsSuper(entry) {
  const owner = String(entry?.ownerAdminId || entry?.adminId || '').trim();
  return owner === SUPER_ADMIN_ID;
}

export function isSuperEa(ea) {
  if (!ea) return false;
  const id = botKey(ea.id || ea.botId || ea.eaId);
  const name = botKey(ea.name || ea.botName || ea.eaName);
  return id === botKey(SUPER_ADMIN_ID) || id === botKey(DEFAULT_SUPER_EA.id) || name === botKey(DEFAULT_SUPER_EA.name);
}

export function parseTimeMs(value, fallbackMs = 0) {
  if (value == null || value === '') return fallbackMs;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : fallbackMs;
}

export function eventAtMs(dateValue, timeValue) {
  const date = String(dateValue || '').trim();
  const time = String(timeValue || '').trim() || '00:00';
  if (!date) return 0;
  const iso = date.includes('T') ? date : `${date}T${time.length === 5 ? `${time}:00` : time}Z`;
  return parseTimeMs(iso, 0);
}

export function deriveSignalStatus(signal, nowMs = Date.now()) {
  const stored = String(signal?.status || 'draft');
  if (stored === 'draft' || stored === 'inactive') return stored;
  if (stored === 'EXPIRED') return 'EXPIRED';
  const activationAt = parseTimeMs(signal?.activationAt, 0);
  const expirationAt = parseTimeMs(signal?.expirationAt, 0);
  if (expirationAt && nowMs >= expirationAt) return 'EXPIRED';
  if (activationAt && nowMs < activationAt) return 'upcoming';
  if (stored === 'published') return 'active';
  return stored;
}

export function isStudentVisibleStatus(status) {
  return status === 'upcoming' || status === 'active';
}

function formatClock(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(11, 16);
}

function formatDate(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

export function publicEvent(event, nowMs = Date.now()) {
  const at = parseTimeMs(event?.at, eventAtMs(event?.date, event?.time));
  const name = normalizeNewsName(event?.name) || String(event?.name || '').trim();
  return {
    id: event?.id || '',
    name,
    date: event?.date || formatDate(at),
    time: event?.time || formatClock(at),
    currency: String(event?.currency || '').trim().toUpperCase(),
    impact: normalizeImpact(event?.impact),
    at: at ? new Date(at).toISOString() : '',
    remainingMs: at ? at - nowMs : 0,
    source: event?.source || '',
  };
}

function priceLabel(value) {
  return value == null ? 'NONE' : value;
}

export function publicStudentSignal(signal, execution, nowMs = Date.now()) {
  if (!signal) return null;
  const status = deriveSignalStatus(signal, nowMs);
  const activationAt = parseTimeMs(signal.activationAt, 0);
  const expirationAt = parseTimeMs(signal.expirationAt, 0);
  const executed = String(execution?.executionStatus || '') === 'success';
  return {
    id: signal.id,
    eventId: signal.eventId || '',
    eventName: signal.eventName || '',
    eventDate: signal.eventDate || '',
    eventTime: signal.eventTime || '',
    symbol: signal.symbol,
    direction: signal.direction,
    message: signal.message || '',
    takeProfit: signal.takeProfit,
    stopLoss: signal.stopLoss,
    takeProfitLabel: priceLabel(signal.takeProfit),
    stopLossLabel: priceLabel(signal.stopLoss),
    activationAt: signal.activationAt,
    expirationAt: signal.expirationAt,
    status,
    remainingMs: status === 'upcoming' ? activationAt - nowMs : status === 'active' ? expirationAt - nowMs : 0,
    executed,
    executedAt: execution?.executedAt || '',
    executionStatus: execution?.executionStatus || '',
  };
}

export function adminSignalView(signal, nowMs = Date.now()) {
  const status = deriveSignalStatus(signal, nowMs);
  return {
    ...signal,
    derivedStatus: status,
    takeProfitLabel: priceLabel(signal?.takeProfit),
    stopLossLabel: priceLabel(signal?.stopLoss),
  };
}

export function createCalendarEngine(io = firebaseIo) {
  async function readMap(root) {
    const row = await io.read(root);
    if (!row || typeof row !== 'object') return {};
    return row;
  }

  async function writeRow(root, id, value) {
    const path = `${root}/${encodeURIComponent(id)}`;
    const ok = await io.write(path, value);
    if (!ok) throw new Error('Could not save calendar data');
    return value;
  }

  async function listEvents() {
    return toList(await readMap(EVENTS_ROOT));
  }

  async function syncUpcomingNews() {
    const nowMs = io.nowMs();
    const nowIso = io.nowIso();
    const meta = await io.read(NEWS_SYNC_ROOT);
    const last = parseTimeMs(meta?.at, 0);
    const existing = await listEvents();
    const hasUpcoming = existing.some((row) => {
      if (!isTrackedNewsName(row?.name)) return false;
      const at = parseTimeMs(row?.at, eventAtMs(row?.date, row?.time));
      return at >= nowMs - UPCOMING_LOOKBACK_MS;
    });
    if (last && nowMs - last < 30 * 60 * 1000 && hasUpcoming) {
      return { ok: true, synced: false, events: existing };
    }
    const detected = await detectUpcomingNews({ nowMs, fetchFn: io.fetch });
    for (const row of detected) {
      const prev =
        existing.find((item) => String(item?.id || '') === row.id) ||
        existing.find(
          (item) =>
            normalizeNewsName(item?.name) === row.name && String(item?.date || '') === row.date,
        );
      const event = {
        ...(prev || {}),
        ...row,
        createdAt: prev?.createdAt || row.createdAt || nowIso,
        updatedAt: nowIso,
      };
      await writeRow(EVENTS_ROOT, event.id, event);
    }
    await io.write(NEWS_SYNC_ROOT, {
      at: nowIso,
      count: detected.length,
      names: TRACKED_NEWS.slice(),
    });
    return { ok: true, synced: true, events: detected };
  }

  async function listUpcomingNews() {
    await syncUpcomingNews();
    const nowMs = io.nowMs();
    return (await listEvents())
      .filter((event) => isTrackedNewsName(event?.name) && isOfficialNewsEvent(event))
      .map((event) => publicEvent(event, nowMs))
      .filter((event) => {
        const at = parseTimeMs(event.at, 0);
        if (!at) return false;
        return at >= nowMs - UPCOMING_LOOKBACK_MS && at <= nowMs + UPCOMING_HORIZON_MS;
      })
      .sort((a, b) => parseTimeMs(a.at) - parseTimeMs(b.at));
  }

  async function listSignals() {
    return toList(await readMap(SIGNALS_ROOT));
  }

  async function getEvent(id) {
    const key = String(id || '').trim();
    if (!key) return null;
    const row = await io.read(`${EVENTS_ROOT}/${encodeURIComponent(key)}`);
    return row && typeof row === 'object' ? row : null;
  }

  async function getSignal(id) {
    const key = String(id || '').trim();
    if (!key) return null;
    const row = await io.read(`${SIGNALS_ROOT}/${encodeURIComponent(key)}`);
    return row && typeof row === 'object' ? row : null;
  }

  async function persistExpired(signal, nowMs) {
    if (!signal?.id) return signal;
    const derived = deriveSignalStatus(signal, nowMs);
    if (derived !== 'EXPIRED' || signal.status === 'EXPIRED') return { ...signal, status: signal.status };
    const next = { ...signal, status: 'EXPIRED', expiredAt: new Date(nowMs).toISOString() };
    await writeRow(SIGNALS_ROOT, signal.id, next);
    return next;
  }

  async function resolveSuperEa() {
    const superWs = await io.read(`lumo/store/workspaces/${SUPER_ADMIN_ID}`);
    const eas = toList(superWs?.eas);
    for (const ea of eas) {
      const id = String(ea?.id || '').trim();
      const name = String(ea?.name || ea?.eaName || '').trim();
      if (id || name) return { id: id || name, name: name || id };
    }
    const profileName = String(
      superWs?.profile?.eaDisplayName || superWs?.profile?.mentorName || superWs?.profile?.eaName || '',
    ).trim();
    if (profileName) return { id: profileName, name: profileName };

    const vault = toList(await io.read('lumo/vault'));
    const owned = vault.find((entry) => ownerIsSuper(entry) && String(entry?.status || '') !== 'deleted');
    if (owned) {
      const id = String(owned.eaId || '').trim();
      const name = String(owned.eaName || '').trim();
      if (id || name) return { id: id || name, name: name || id };
    }
    return { ...DEFAULT_SUPER_EA };
  }

  function signalMatchesLicense(signal, license) {
    if (!signal || !license?.ok) return false;
    if (botsMatch(signal, license.botId) || botsMatch(license.license, signal.botId) || botsMatch(license.license, signal.botName)) {
      return true;
    }
    return ownerIsSuper(license.license) && (botsMatch(signal, SUPER_ADMIN_ID) || isSuperEa(signal));
  }

  async function upsertEvent(input, actorId = '') {
    const name = String(input?.name || input?.eventName || '').trim();
    if (!name) return { ok: false, error: 'EVENT NAME required' };
    const date = String(input?.date || input?.eventDate || '').trim();
    const time = String(input?.time || input?.eventTime || '').trim();
    const at = parseTimeMs(input?.at, eventAtMs(date, time));
    if (!date && !at) return { ok: false, error: 'DATE required' };
    const events = await listEvents();
    const newsName = normalizeNewsName(name);
    const day = date || formatDate(at);
    const requestedId = String(input?.id || input?.eventId || '').trim();
    const existing =
      events.find((row) => String(row?.id || '') === requestedId) ||
      (newsName &&
        events.find(
          (row) => normalizeNewsName(row?.name) === newsName && String(row?.date || '') === day,
        )) ||
      events.find(
        (row) =>
          botKey(row?.name) === botKey(name) &&
          String(row?.date || '') === day &&
          String(row?.time || '') === (time || formatClock(at)),
      );
    const id =
      existing?.id ||
      requestedId ||
      (newsName ? newsEventId(newsName, day) : '') ||
      io.id();
    const event = {
      id,
      name: newsName || name,
      date: date || formatDate(at),
      time: time || formatClock(at),
      currency: String(input?.currency || existing?.currency || '').trim().toUpperCase(),
      impact: normalizeImpact(input?.impact || existing?.impact),
      at: at ? new Date(at).toISOString() : existing?.at || '',
      updatedAt: io.nowIso(),
      updatedBy: actorId || existing?.updatedBy || '',
      createdAt: existing?.createdAt || io.nowIso(),
    };
    await writeRow(EVENTS_ROOT, id, event);
    return { ok: true, event };
  }

  function parseActivationExpiration(input, eventAt) {
    const nowMs = io.nowMs();
    const activationAt = parseTimeMs(input?.activationAt || input?.activationTime, eventAt || nowMs);
    let expirationAt = parseTimeMs(input?.expirationAt || input?.expirationTime, 0);
    if (!expirationAt) {
      const hours = Number(input?.expirationHours);
      const ms = Number.isFinite(hours) && hours > 0 ? hours * 3600000 : DEFAULT_EXPIRY_MS;
      expirationAt = activationAt + ms;
    }
    if (expirationAt <= activationAt) {
      expirationAt = activationAt + DEFAULT_EXPIRY_MS;
    }
    return {
      activationAt: new Date(activationAt).toISOString(),
      expirationAt: new Date(expirationAt).toISOString(),
    };
  }

  async function createSignal(input, actorId = '') {
    const eventName = String(input?.eventName || input?.name || '').trim();
    const superEa = await resolveSuperEa();
    const botId = superEa.id;
    const botName = superEa.name;
    const symbol = normalizeSymbol(input?.symbol);
    const direction = normalizeDirection(input?.direction);
    if (!eventName) return { ok: false, error: 'EVENT NAME required' };
    if (!isValidSymbol(symbol)) return { ok: false, error: 'SYMBOL is not valid' };
    if (!direction) return { ok: false, error: 'DIRECTION must be BUY or SELL' };

    const eventResult = await upsertEvent(input, actorId);
    if (!eventResult.ok) return eventResult;
    const event = eventResult.event;
    const eventAt = parseTimeMs(event.at, eventAtMs(event.date, event.time));
    const window = parseActivationExpiration(input, eventAt);
    const id = String(input?.id || '').trim() || io.id();
    const requestedStatus = String(input?.status || 'published').trim().toLowerCase();
    const status = requestedStatus === 'draft' || requestedStatus === 'inactive' ? requestedStatus : 'published';
    const signal = {
      id,
      eventId: event.id,
      eventName: event.name,
      eventDate: event.date,
      eventTime: event.time,
      currency: event.currency,
      impact: event.impact,
      botId,
      botName,
      symbol,
      direction,
      message: String(input?.message || '').trim(),
      takeProfit: optionalPrice(input?.takeProfit),
      stopLoss: optionalPrice(input?.stopLoss),
      activationAt: window.activationAt,
      expirationAt: window.expirationAt,
      status,
      createdAt: io.nowIso(),
      createdBy: actorId,
      updatedAt: io.nowIso(),
      updatedBy: actorId,
      publishedAt: status === 'published' ? io.nowIso() : '',
    };
    await writeRow(SIGNALS_ROOT, id, signal);
    return { ok: true, signal: adminSignalView(signal, io.nowMs()), event };
  }

  async function updateSignal(id, input, actorId = '') {
    const current = await getSignal(id);
    if (!current) return { ok: false, error: 'Signal not found' };
    const merged = {
      ...current,
      eventName: input?.eventName ?? input?.name ?? current.eventName,
      eventDate: input?.eventDate ?? input?.date ?? current.eventDate,
      eventTime: input?.eventTime ?? input?.time ?? current.eventTime,
      currency: input?.currency ?? current.currency,
      impact: input?.impact ?? current.impact,
      botId: input?.botId ?? input?.eaId ?? current.botId,
      botName: input?.botName ?? input?.eaName ?? current.botName,
      symbol: input?.symbol ?? current.symbol,
      direction: input?.direction ?? current.direction,
      message: input?.message ?? current.message,
      takeProfit: Object.prototype.hasOwnProperty.call(input || {}, 'takeProfit')
        ? optionalPrice(input.takeProfit)
        : current.takeProfit,
      stopLoss: Object.prototype.hasOwnProperty.call(input || {}, 'stopLoss')
        ? optionalPrice(input.stopLoss)
        : current.stopLoss,
      activationAt: input?.activationAt || input?.activationTime || current.activationAt,
      expirationAt: input?.expirationAt || input?.expirationTime || current.expirationAt,
      expirationHours: input?.expirationHours,
    };
    const eventResult = await upsertEvent(
      {
        id: current.eventId,
        name: merged.eventName,
        date: merged.eventDate,
        time: merged.eventTime,
        currency: merged.currency,
        impact: merged.impact,
      },
      actorId,
    );
    if (!eventResult.ok) return eventResult;
    if (input?.activationAt || input?.activationTime || input?.expirationAt || input?.expirationTime || input?.expirationHours) {
      const eventAt = parseTimeMs(eventResult.event.at, eventAtMs(eventResult.event.date, eventResult.event.time));
      const window = parseActivationExpiration(merged, eventAt);
      merged.activationAt = window.activationAt;
      merged.expirationAt = window.expirationAt;
    }
    const superEa = await resolveSuperEa();
    const symbol = normalizeSymbol(merged.symbol);
    const direction = normalizeDirection(merged.direction);
    if (!isValidSymbol(symbol)) return { ok: false, error: 'SYMBOL is not valid' };
    if (!direction) return { ok: false, error: 'DIRECTION must be BUY or SELL' };
    const next = {
      ...current,
      ...merged,
      eventId: eventResult.event.id,
      eventName: eventResult.event.name,
      eventDate: eventResult.event.date,
      eventTime: eventResult.event.time,
      currency: eventResult.event.currency,
      impact: eventResult.event.impact,
      botId: superEa.id,
      botName: superEa.name,
      symbol,
      direction,
      takeProfit: merged.takeProfit,
      stopLoss: merged.stopLoss,
      updatedAt: io.nowIso(),
      updatedBy: actorId,
    };
    delete next.expirationHours;
    await writeRow(SIGNALS_ROOT, current.id, next);
    return { ok: true, signal: adminSignalView(next, io.nowMs()), event: eventResult.event };
  }

  async function setSignalStatus(id, status, actorId = '') {
    const current = await getSignal(id);
    if (!current) return { ok: false, error: 'Signal not found' };
    const next = {
      ...current,
      status,
      updatedAt: io.nowIso(),
      updatedBy: actorId,
      publishedAt: status === 'published' ? io.nowIso() : current.publishedAt || '',
      deactivatedAt: status === 'inactive' ? io.nowIso() : current.deactivatedAt || '',
    };
    await writeRow(SIGNALS_ROOT, id, next);
    return { ok: true, signal: adminSignalView(next, io.nowMs()) };
  }

  async function deleteSignal(id) {
    const current = await getSignal(id);
    if (!current) return { ok: false, error: 'Signal not found' };
    const ok = await io.write(`${SIGNALS_ROOT}/${encodeURIComponent(id)}`, null);
    if (!ok) return { ok: false, error: 'Could not delete signal' };
    return { ok: true };
  }

  async function listAdminSignals({ botId = '', view = 'all' } = {}) {
    const nowMs = io.nowMs();
    const rows = [];
    for (const signal of await listSignals()) {
      const persisted = await persistExpired(signal, nowMs);
      if (botId && !botsMatch(persisted, botId) && botKey(persisted.botId) !== botKey(botId) && botKey(persisted.botName) !== botKey(botId)) {
        continue;
      }
      const derived = deriveSignalStatus(persisted, nowMs);
      if (view === 'expired' && derived !== 'EXPIRED') continue;
      if (view === 'active' && derived !== 'active' && derived !== 'upcoming' && persisted.status !== 'published' && persisted.status !== 'draft') {
        continue;
      }
      if (view === 'active' && derived === 'EXPIRED') continue;
      rows.push(adminSignalView(persisted, nowMs));
    }
    rows.sort((a, b) => parseTimeMs(b.activationAt) - parseTimeMs(a.activationAt));
    return rows;
  }

  async function listBots() {
    const superEa = await resolveSuperEa();
    return [{ id: superEa.id, name: superEa.name }];
  }

  async function resolveStudentLicense(email, licenseKey) {
    const normalizedEmail = normalizeEmail(email);
    const key = normalizeLicenseKey(licenseKey);
    if (!normalizedEmail) return { ok: false, error: 'User is not authenticated' };
    if (!key) return { ok: false, error: 'User does not have an active license' };

    const vault = toList(await io.read('lumo/vault'));
    let entry = findVaultEntry(vault, key);
    let ownerId = String(entry?.ownerAdminId || entry?.adminId || '').trim();

    if (!entry && ownerId) {
      const workspace = await io.read(`lumo/store/workspaces/${encodeURIComponent(ownerId)}`);
      const hit = findWorkspaceLicense({ [ownerId]: workspace }, key);
      if (hit) {
        entry = hit.license;
        ownerId = hit.ownerId || ownerId;
      }
    }

    if (!entry) {
      const workspaces = await io.read('lumo/store/workspaces');
      const hit = findWorkspaceLicense(workspaces && typeof workspaces === 'object' ? workspaces : {}, key);
      if (hit) {
        entry = hit.license;
        ownerId = hit.ownerId || ownerId;
      }
    }

    if (!entry || entry.status === 'deleted' || entry.revoked) {
      return { ok: false, error: 'User does not have an active license' };
    }
    const status = String(entry.status || '').toLowerCase();
    if (status !== 'assigned' && status !== 'active') {
      return { ok: false, error: 'User does not have an active license' };
    }
    if (status === 'assigned' && normalizeEmail(entry.assignedEmail) !== normalizedEmail) {
      return { ok: false, error: 'License does not belong to this account' };
    }
    if (status !== 'assigned') {
      return { ok: false, error: 'User does not have an active license' };
    }
    const botId = String(entry.eaId || '').trim();
    const botName = String(entry.eaName || '').trim();
    if (!botId && !botName) {
      return { ok: false, error: 'License does not belong to an EA/Bot' };
    }
    return {
      ok: true,
      email: normalizedEmail,
      userId: normalizedEmail,
      licenseKey: key,
      licenseId: String(entry.id || entry.key || key),
      license: entry,
      botId: botId || botName,
      botName: botName || botId,
      ownerAdminId: ownerId,
    };
  }

  async function findExecutionFor(email, signalId) {
    const lockId = executionLockId(email, signalId);
    if (lockId) {
      const lock = await io.read(`${LOCKS_ROOT}/${encodeURIComponent(lockId)}`);
      if (lock?.executionId) {
        const row = await io.read(`${EXECUTIONS_ROOT}/${encodeURIComponent(lock.executionId)}`);
        if (row && typeof row === 'object') return row;
      }
    }
    const rows = toList(await io.read(EXECUTIONS_ROOT));
    return (
      rows.find(
        (row) =>
          normalizeEmail(row?.userId) === normalizeEmail(email) &&
          String(row?.signalId || '') === String(signalId || '') &&
          String(row?.executionStatus || '') === 'success',
      ) || null
    );
  }

  async function listStudentCalendar(email, licenseKey) {
    const license = await resolveStudentLicense(email, licenseKey);
    if (!license.ok) return license;
    await syncUpcomingNews();
    const nowMs = io.nowMs();
    const signals = [];
    for (const signal of await listSignals()) {
      if (signal.status === 'draft' || signal.status === 'inactive') continue;
      if (!signalMatchesLicense(signal, license)) {
        continue;
      }
      const persisted = deriveSignalStatus(signal, nowMs) === 'EXPIRED' ? { ...signal, status: 'EXPIRED' } : signal;
      const status = deriveSignalStatus(persisted, nowMs);
      if (!isStudentVisibleStatus(status)) continue;
      const execution = await findExecutionFor(license.email, signal.id);
      signals.push(publicStudentSignal(persisted, execution, nowMs));
    }
    const signalEventIds = new Set(signals.map((row) => row.eventId).filter(Boolean));
    const visibleEvents = (await listEvents())
      .map((event) => publicEvent(event, nowMs))
      .filter((event) => {
        const tracked = isTrackedNewsName(event.name) && isOfficialNewsEvent(event);
        const linked = signalEventIds.has(event.id);
        if (!tracked && !linked) return false;
        const at = parseTimeMs(event.at, 0);
        if (linked) return true;
        if (!at) return false;
        return at >= nowMs - UPCOMING_LOOKBACK_MS && at <= nowMs + UPCOMING_HORIZON_MS;
      });
    visibleEvents.sort((a, b) => parseTimeMs(a.at) - parseTimeMs(b.at));
    signals.sort((a, b) => parseTimeMs(a.activationAt) - parseTimeMs(b.activationAt));
    return {
      ok: true,
      serverNow: new Date(nowMs).toISOString(),
      serverNowMs: nowMs,
      license: {
        licenseId: license.licenseId,
        botId: license.botId,
        botName: license.botName,
      },
      events: visibleEvents,
      signals,
    };
  }

  async function executeSignal(input) {
    const email = normalizeEmail(input?.email);
    const licenseKey = input?.licenseKey;
    const signalId = String(input?.signalId || '').trim();
    const mt5Id = String(input?.mt5Id || input?.token || '').trim();
    const volume = Number(input?.volume);
    const lot = Number.isFinite(volume) && volume > 0 ? volume : 0.01;

    const license = await resolveStudentLicense(email, licenseKey);
    if (!license.ok) return license;
    if (!signalId) return { ok: false, error: 'Signal not found' };

    const signal = await getSignal(signalId);
    if (!signal) return { ok: false, error: 'Signal not found' };
    if (!signalMatchesLicense(signal, license)) {
      return { ok: false, error: 'Signal does not belong to your EA' };
    }
    if (String(signal.status || '') === 'draft' || String(signal.status || '') === 'inactive') {
      return { ok: false, error: 'Signal is not active' };
    }
    const nowMs = io.nowMs();
    const status = deriveSignalStatus(signal, nowMs);
    if (status === 'EXPIRED') return { ok: false, error: 'Signal has expired' };
    if (status !== 'active') return { ok: false, error: 'Signal is not active' };
    if (!isValidSymbol(signal.symbol)) return { ok: false, error: 'Symbol is not valid' };
    if (!normalizeDirection(signal.direction)) return { ok: false, error: 'Direction is not valid' };
    if (!mt5Id) return { ok: false, error: 'Broker/MT5 connection is not active' };

    const existing = await findExecutionFor(email, signalId);
    if (existing && existing.executionStatus === 'success') {
      return { ok: false, error: 'TRADE ALREADY EXECUTED FOR THIS SIGNAL', alreadyExecuted: true };
    }

    const lockId = executionLockId(email, signalId);
    const lockPath = `${LOCKS_ROOT}/${encodeURIComponent(lockId)}`;
    const lock = lockId ? await io.read(lockPath) : null;
    if (lock?.status === 'pending' && nowMs - parseTimeMs(lock.at, 0) < 60000) {
      return { ok: false, error: 'TRADE ALREADY EXECUTED FOR THIS SIGNAL', alreadyExecuted: true };
    }
    if (lock?.status === 'success') {
      return { ok: false, error: 'TRADE ALREADY EXECUTED FOR THIS SIGNAL', alreadyExecuted: true };
    }

    const connected = await io.checkConnect(mt5Id);
    if (!connected?.ok) {
      return { ok: false, error: connected?.error || 'Broker/MT5 connection is not active' };
    }

    const executionId = io.id();
    if (lockId) {
      await io.write(lockPath, {
        id: lockId,
        userId: email,
        signalId,
        status: 'pending',
        executionId,
        at: new Date(nowMs).toISOString(),
      });
    }

    const order = await io.sendOrder({
      id: mt5Id,
      symbol: signal.symbol,
      operation: mt5Operation(signal.direction),
      volume: lot,
      comment: `Lumo ${signal.eventName || 'NEWS'}`.slice(0, 31),
      slippage: 10000,
      stopLoss: signal.stopLoss,
      takeProfit: signal.takeProfit,
    });

    if (!order?.ok) {
      const failed = {
        id: executionId,
        userId: email,
        licenseId: license.licenseId,
        botId: license.botId,
        signalId,
        symbol: signal.symbol,
        direction: signal.direction,
        executedAt: new Date(io.nowMs()).toISOString(),
        executionStatus: 'failed',
        brokerOrderId: '',
        error: order?.error || 'OrderSend failed',
      };
      await writeRow(EXECUTIONS_ROOT, executionId, failed);
      if (lockId) await io.write(lockPath, null);
      return { ok: false, error: failed.error };
    }

    const ticket = String(order.ticket || order.raw || '').trim();
    const execution = {
      id: executionId,
      userId: email,
      licenseId: license.licenseId,
      botId: license.botId,
      signalId,
      symbol: signal.symbol,
      direction: signal.direction,
      executedAt: new Date(io.nowMs()).toISOString(),
      executionStatus: 'success',
      brokerOrderId: ticket,
      error: '',
    };
    await writeRow(EXECUTIONS_ROOT, executionId, execution);
    if (lockId) {
      await io.write(lockPath, {
        id: lockId,
        userId: email,
        signalId,
        status: 'success',
        executionId,
        at: execution.executedAt,
      });
    }
    return { ok: true, execution, ticket };
  }

  async function listExecutions(signalId = '') {
    const rows = toList(await io.read(EXECUTIONS_ROOT));
    const wanted = String(signalId || '').trim();
    return rows
      .filter((row) => !wanted || String(row?.signalId || '') === wanted)
      .sort((a, b) => parseTimeMs(b.executedAt) - parseTimeMs(a.executedAt));
  }

  return {
    upsertEvent,
    createSignal,
    updateSignal,
    setSignalStatus,
    deleteSignal,
    listAdminSignals,
    listEvents,
    listUpcomingNews,
    syncUpcomingNews,
    listBots,
    resolveSuperEa,
    resolveStudentLicense,
    listStudentCalendar,
    executeSignal,
    listExecutions,
    getSignal,
    getEvent,
  };
}

export const defaultEngine = createCalendarEngine();
