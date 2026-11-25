import { createHash, randomBytes } from 'node:crypto';
import { firebaseRead, firebaseWrite } from './clientMerge.mjs';
import {
  findVaultEntry,
  findWorkspaceLicense,
  keysMatch,
  normalizeLicenseKey,
} from './licenseClaim.mjs';
import { checkMt5Connect, sendMt5MarketOrder } from './mt5Bridge.mjs';
import {
  detectUpcomingNews,
  isOfficialNewsEvent,
  isTrackedNewsName,
  normalizeNewsName,
  NEWS_SYNC_TTL_MS,
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
  fetch: (...args) => globalThis.fetch(...args),
  checkConnect: checkMt5Connect,
  sendOrder: sendMt5MarketOrder,
};

let privateLicenseCache = { at: 0, db: null };

async function loadPrivateLicenseDb() {
  const now = Date.now();
  if (privateLicenseCache.db && now - privateLicenseCache.at < 30000) return privateLicenseCache.db;
  try {
    const { loadRecoveryDb } = await import('./phoneRecover.mjs');
    const db = await loadRecoveryDb();
    const next = db && typeof db === 'object' ? db : null;
    privateLicenseCache = { at: now, db: next };
    return next;
  } catch {
    return privateLicenseCache.db;
  }
}

function sessionBot(records, email) {
  const session = records?.sessions?.[normalizeEmail(email)];
  return session?.bot && typeof session.bot === 'object' ? session.bot : null;
}

export function findStudentLicenseRecord(records, email, licenseKey) {
  const normalizedEmail = normalizeEmail(email);
  const key = normalizeLicenseKey(licenseKey);
  if (!normalizedEmail || !key || !records) return null;
  let entry = findVaultEntry(records.vault, key);
  let ownerId = String(entry?.ownerAdminId || entry?.adminId || '').trim();
  if (!entry) {
    const hit = findWorkspaceLicense(records.store?.workspaces || {}, key);
    if (hit) {
      entry = hit.license;
      ownerId = hit.ownerId || ownerId;
    }
  }
  const bot = sessionBot(records, normalizedEmail);
  if (!entry && bot && keysMatch(String(bot.licenseKey || ''), key)) {
    entry = {
      key: String(bot.licenseKey || '').trim(),
      status: 'assigned',
      assignedEmail: normalizedEmail,
      eaId: String(bot.eaId || bot.id || '').trim(),
      eaName: String(bot.displayName || bot.name || bot.eaName || '').trim(),
      ownerAdminId: String(bot.ownerAdminId || '').trim(),
    };
    ownerId = entry.ownerAdminId;
  }
  if (entry && bot && keysMatch(String(bot.licenseKey || ''), key)) {
    const eaId = String(entry.eaId || '').trim();
    const eaName = String(entry.eaName || '').trim();
    if (!eaId && !eaName) {
      entry = {
        ...entry,
        eaId: String(bot.eaId || bot.id || '').trim(),
        eaName: String(bot.displayName || bot.name || bot.eaName || '').trim(),
      };
    }
  }
  if (!entry) return null;
  return { entry, ownerId };
}

export function licenseOwnerEmails(entry) {
  if (!entry || typeof entry !== 'object') return [];
  return [
    entry.assignedEmail,
    entry.clientEmail,
    entry.email,
    entry.claimedBy,
    entry.claimedEmail,
    entry.userEmail,
  ]
    .map((value) => normalizeEmail(value))
    .filter(Boolean);
}

function reviveFalseRevoke(entry, email, options = {}) {
  if (!entry || typeof entry !== 'object') return entry;
  const status = String(entry.status || '').toLowerCase();
  const markedDead = entry.revoked === true || status === 'deleted' || status === 'revoked';
  if (!markedDead) return entry;
  // Hard bans stay dead.
  try {
    // Lazy: bannedAccounts already gated in resolveStudentLicense.
  } catch {
    /* ignore */
  }
  const owners = licenseOwnerEmails(entry);
  const normalizedEmail = normalizeEmail(email);
  const sessionOwned = Boolean(options.sessionOwned);
  const ownedByCaller =
    sessionOwned ||
    (owners.length > 0 && owners.includes(normalizedEmail)) ||
    // Key possession from the activated student session is enough for Super seats.
    Boolean(options.presentedKey);
  if (!ownedByCaller) return entry;
  const superSeat =
    ownerIsSuper(entry) ||
    isSuperEa(entry) ||
    eaStem(entry.eaName || entry.displayName || entry.name) === 'unlimitedbull' ||
    eaStem(entry.eaId) === 'unlimitedbull';
  if (!superSeat) return entry;
  // Stale revoke list used to wipe live Unlimited bull seats. If the seat is still
  // owned by this student/super, treat it as assigned for calendar access.
  return {
    ...entry,
    revoked: false,
    status: owners.length || sessionOwned ? 'assigned' : 'active',
  };
}

export function acceptStudentLicense(entry, email, options = {}) {
  const normalizedEmail = normalizeEmail(email);
  const revived = reviveFalseRevoke(entry, normalizedEmail, options);
  if (!revived) {
    return { ok: false, error: 'User does not have an active license' };
  }
  const status = String(revived.status || '').toLowerCase();
  if (revived.revoked === true || status === 'deleted' || status === 'revoked' || status === 'expired') {
    return { ok: false, error: 'User does not have an active license' };
  }
  const owners = licenseOwnerEmails(revived);
  const sessionOwned = Boolean(options.sessionOwned);
  const usable =
    status === 'assigned' ||
    status === 'active' ||
    status === 'claimed' ||
    status === 'used' ||
    (!status && sessionOwned);
  if (!usable) {
    return { ok: false, error: 'User does not have an active license' };
  }
  if (owners.length && !owners.includes(normalizedEmail) && !sessionOwned) {
    return { ok: false, error: 'License does not belong to this account' };
  }
  // Empty owner fields on an assigned/active key: allow — the app already proved
  // possession of the license key from the student's activated session.
  const botId = String(revived.eaId || '').trim();
  const botName = String(revived.eaName || revived.displayName || revived.name || '').trim();
  if (!botId && !botName && !sessionOwned) {
    return { ok: false, error: 'License does not belong to an EA/Bot' };
  }
  return {
    ok: true,
    botId: botId || botName || String(options.sessionBotId || 'ea'),
    botName: botName || botId || String(options.sessionBotName || 'Lumo Edge'),
    license: revived,
  };
}

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

export function eaStem(value) {
  return botKey(value)
    .replace(/[^a-z0-9]/g, '')
    .replace(/v\d+$/g, '');
}

export function ownerIsSuper(entry) {
  const owner = String(entry?.ownerAdminId || entry?.adminId || '').trim();
  return owner === SUPER_ADMIN_ID;
}

export function isSuperEa(ea) {
  if (!ea) return false;
  const id = botKey(ea.id || ea.botId || ea.eaId);
  const name = botKey(ea.name || ea.botName || ea.eaName);
  const stem = eaStem(name || id);
  return (
    id === botKey(SUPER_ADMIN_ID) ||
    id === botKey(DEFAULT_SUPER_EA.id) ||
    name === botKey(DEFAULT_SUPER_EA.name) ||
    stem === 'unlimitedbull' ||
    stem === 'lumoedge' ||
    id === botKey('ea-1784470635215')
  );
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
    live: String(event?.source || '').toLowerCase() === 'live',
  };
}

function priceLabel(value) {
  return value == null ? 'NONE' : value;
}

export function normalizeLotSize(value, fallback = 0.01) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.round(n * 100) / 100;
}

export function normalizeMaxTrades(value, fallback = 1) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, 50);
}

export function resolveSignalEventAt(signal, event = null) {
  if (!signal) return 0;
  const liveAt = parseTimeMs(event?.at, 0);
  if (liveAt) return liveAt;
  const storedAt = parseTimeMs(signal.eventAt, 0);
  // Prefer an absolute ISO eventAt when present. Bare eventTime values from the
  // US economic calendar are Eastern wall-clock, not UTC — never rebuild from them
  // if we already have a trustworthy absolute timestamp on the linked event.
  if (storedAt && String(signal.eventAt || '').includes('T')) return storedAt;
  return parseTimeMs(signal.eventAt, eventAtMs(signal.eventDate, signal.eventTime));
}

export function publicStudentSignal(signal, execution, nowMs = Date.now(), event = null) {
  if (!signal) return null;
  const status = deriveSignalStatus(signal, nowMs);
  const activationAt = parseTimeMs(signal.activationAt, 0);
  const expirationAt = parseTimeMs(signal.expirationAt, 0);
  const eventAt = resolveSignalEventAt(signal, event);
  const executeOpensAt = eventAt ? eventAt - 20 * 60 * 1000 : activationAt;
  const executed = String(execution?.executionStatus || '') === 'success';
  const mentorName =
    String(signal.botName || signal.mentorName || signal.eaName || '').trim() || 'Unlimited bull';
  return {
    id: signal.id,
    eventId: signal.eventId || '',
    eventName: signal.eventName || '',
    eventDate: signal.eventDate || '',
    eventTime: signal.eventTime || '',
    eventAt: eventAt ? new Date(eventAt).toISOString() : '',
    botId: signal.botId || '',
    botName: mentorName,
    mentorName,
    symbol: signal.symbol,
    direction: signal.direction,
    lotSize: normalizeLotSize(signal.lotSize, 0.01),
    maxTrades: normalizeMaxTrades(signal.maxTrades, 1),
    message: signal.message || '',
    takeProfit: signal.takeProfit,
    stopLoss: signal.stopLoss,
    takeProfitLabel: priceLabel(signal.takeProfit),
    stopLossLabel: priceLabel(signal.stopLoss),
    activationAt: signal.activationAt,
    expirationAt: signal.expirationAt,
    executeOpensAt: executeOpensAt ? new Date(executeOpensAt).toISOString() : '',
    updatedAt: signal.updatedAt || '',
    publishedAt: signal.publishedAt || signal.createdAt || '',
    status,
    remainingMs: status === 'upcoming' ? activationAt - nowMs : status === 'active' ? expirationAt - nowMs : 0,
    executeOpensInMs: executeOpensAt ? executeOpensAt - nowMs : 0,
    canExecute: !executed && Boolean(executeOpensAt) && nowMs >= executeOpensAt && (!expirationAt || nowMs < expirationAt),
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

  async function syncUpcomingNews({ force = false } = {}) {
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
    // Cache hit even when the live Forex Factory pull failed — baked schedule is enough.
    if (!force && last && nowMs - last < NEWS_SYNC_TTL_MS && hasUpcoming) {
      return { ok: true, synced: false, events: existing };
    }
    const detected = await detectUpcomingNews({
      nowMs,
      fetchFn: typeof io.fetch === 'function' ? io.fetch : undefined,
    });
    const eventMap = {};
    for (const row of existing) {
      const id = String(row?.id || '').trim();
      if (id) eventMap[id] = row;
    }
    for (const row of detected) {
      const prev =
        eventMap[row.id] ||
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
      if (event.id) eventMap[event.id] = event;
    }
    try {
      const { mutateCalendarStore } = await import('./calendarStore.mjs');
      await mutateCalendarStore((store) => ({
        ...store,
        economicEvents: { ...(store.economicEvents || {}), ...eventMap },
        economicCalendarSync: {
          at: nowIso,
          count: detected.length,
          live: detected.some((row) => row.source === 'live'),
          names: TRACKED_NEWS.slice(),
        },
      }));
    } catch {
      /* Keep serving detected/baked rows even if storage is briefly unavailable. */
    }
    return { ok: true, synced: true, events: Object.values(eventMap) };
  }

  async function listUpcomingNews() {
    const synced = await syncUpcomingNews();
    const nowMs = io.nowMs();
    const byId = new Map();
    for (const event of [...toList(synced?.events), ...(await listEvents())]) {
      if (!event?.id) continue;
      byId.set(String(event.id), event);
    }
    return [...byId.values()]
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

  function namesShareStem(left, right) {
    const a = eaStem(left);
    const b = eaStem(right);
    return Boolean(a && b && a === b);
  }

  function signalMatchesLicense(signal, license) {
    if (!signal || !license?.ok) return false;
    if (botsMatch(signal, license.botId) || botsMatch(license.license, signal.botId) || botsMatch(license.license, signal.botName)) {
      return true;
    }
    const licenseNames = [license.botId, license.botName, license.license?.eaId, license.license?.eaName];
    const signalNames = [signal.botId, signal.botName];
    if (licenseNames.some((name) => signalNames.some((other) => namesShareStem(name, other)))) return true;
    const owner = String(license.ownerAdminId || license.license?.ownerAdminId || '').trim();
    const author = String(signal.createdBy || '').trim();
    if (owner && author && owner === author) return true;
    const seatIsUnlimitedBull =
      owner === SUPER_ADMIN_ID ||
      ownerIsSuper(license.license) ||
      isSuperEa(license) ||
      isSuperEa(license.license) ||
      licenseNames.some((name) => eaStem(name) === 'unlimitedbull' || eaStem(name) === 'lumoedge');
    const signalIsUnlimitedBullDesk =
      author === SUPER_ADMIN_ID ||
      isSuperEa(signal) ||
      botsMatch(signal, SUPER_ADMIN_ID) ||
      eaStem(signal.botName) === 'unlimitedbull' ||
      eaStem(signal.botId) === 'unlimitedbull' ||
      eaStem(signal.mentorName) === 'unlimitedbull';
    // Super Admin / Unlimited bull calendar posts reach every Unlimited bull seat.
    if (seatIsUnlimitedBull && signalIsUnlimitedBullDesk) return true;
    return false;
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
    const id = existing?.id || requestedId || io.id();
    const official = existing && isOfficialNewsEvent(existing);
    const event = {
      id,
      name: newsName || name,
      date: official ? existing.date || date || formatDate(at) : date || formatDate(at),
      time: official ? existing.time || formatClock(at) : time || formatClock(at),
      currency: official
        ? String(existing.currency || 'USD').trim().toUpperCase()
        : String(input?.currency || existing?.currency || '').trim().toUpperCase(),
      impact: official ? normalizeImpact(existing.impact) : normalizeImpact(input?.impact || existing?.impact),
      at: official && existing.at ? existing.at : at ? new Date(at).toISOString() : existing?.at || '',
      source: existing?.source || '',
      timezone: existing?.timezone || '',
      updatedAt: io.nowIso(),
      updatedBy: actorId || existing?.updatedBy || '',
      createdAt: existing?.createdAt || io.nowIso(),
    };
    await writeRow(EVENTS_ROOT, id, event);
    return { ok: true, event };
  }

  function parseActivationExpiration(input, eventAt) {
    const nowMs = io.nowMs();
    // Default activation to NOW so Send/Edit makes the trade executable immediately.
    // Admins can still set a future activation time explicitly.
    const hasActivation = Boolean(input?.activationAt || input?.activationTime);
    const activationAt = hasActivation
      ? parseTimeMs(input?.activationAt || input?.activationTime, nowMs)
      : nowMs;
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
      eventAt: eventAt || 0,
    };
  }

  function optionalLot(value, fallback = 0.01) {
    return normalizeLotSize(value, fallback);
  }

  async function createSignal(input, actorId = '') {
    const eventName = String(input?.eventName || input?.name || '').trim();
    const superEa = await resolveSuperEa();
    const botId = superEa.id;
    const botName = superEa.name;
    const symbol = normalizeSymbol(input?.symbol);
    const direction = normalizeDirection(input?.direction);
    const lotSize = optionalLot(input?.lotSize ?? input?.volume ?? input?.lot, 0.01);
    const maxTrades = normalizeMaxTrades(input?.maxTrades ?? input?.trades, 1);
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
      eventAt: event.at || (eventAt ? new Date(eventAt).toISOString() : ''),
      currency: String(input?.currency || event.currency || 'USD').trim().toUpperCase(),
      impact: event.impact,
      botId,
      botName,
      mentorName: botName,
      symbol,
      direction,
      lotSize,
      maxTrades,
      message:
        String(input?.message || '').trim() ||
        `${direction} ${symbol} · ${lotSize} lot · ${maxTrades} trade${maxTrades === 1 ? '' : 's'}`,
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
      lotSize: Object.prototype.hasOwnProperty.call(input || {}, 'lotSize')
        || Object.prototype.hasOwnProperty.call(input || {}, 'volume')
        || Object.prototype.hasOwnProperty.call(input || {}, 'lot')
        ? optionalLot(input?.lotSize ?? input?.volume ?? input?.lot, current.lotSize || 0.01)
        : optionalLot(current.lotSize, 0.01),
      maxTrades: Object.prototype.hasOwnProperty.call(input || {}, 'maxTrades')
        || Object.prototype.hasOwnProperty.call(input || {}, 'trades')
        ? normalizeMaxTrades(input?.maxTrades ?? input?.trades, current.maxTrades || 1)
        : normalizeMaxTrades(current.maxTrades, 1),
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
    // Do not push trade currency into official CPI/NFP events — those stay USD.
    const eventResult = await upsertEvent(
      {
        id: current.eventId,
        name: merged.eventName,
        date: merged.eventDate,
        time: merged.eventTime,
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
      // Keep the admin-chosen trade fields — do not let the news event overwrite them.
      currency: String(merged.currency || eventResult.event.currency || 'USD').trim().toUpperCase(),
      impact: merged.impact || eventResult.event.impact,
      botId: superEa.id,
      botName: superEa.name,
      symbol,
      direction,
      lotSize: optionalLot(merged.lotSize, 0.01),
      maxTrades: normalizeMaxTrades(merged.maxTrades, 1),
      takeProfit: merged.takeProfit,
      stopLoss: merged.stopLoss,
      updatedAt: io.nowIso(),
      updatedBy: actorId,
    };
    if (!Object.prototype.hasOwnProperty.call(input || {}, 'message')) {
      next.message = `${next.direction} ${next.symbol} · ${next.lotSize} lot · ${next.maxTrades} trade${next.maxTrades === 1 ? '' : 's'}`;
    } else {
      next.message = String(merged.message || '').trim();
    }
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
    if (status === 'inactive') {
      await purgeOrphanSignalEvents(current.eventId);
    }
    return { ok: true, signal: adminSignalView(next, io.nowMs()) };
  }

  async function deleteSignal(id) {
    const current = await getSignal(id);
    if (!current) return { ok: false, error: 'Signal not found' };
    const ok = await io.write(`${SIGNALS_ROOT}/${encodeURIComponent(id)}`, null);
    if (!ok) return { ok: false, error: 'Could not delete signal' };
    await purgeOrphanSignalEvents(current.eventId);
    return { ok: true };
  }

  async function purgeOrphanSignalEvents(preferEventId = '') {
    const remaining = await listSignals();
    const used = new Set(
      remaining
        .filter((row) => {
          const status = String(row?.status || '').toLowerCase();
          return status !== 'inactive' && status !== 'draft' && status !== 'expired';
        })
        .map((row) => String(row?.eventId || '').trim())
        .filter(Boolean),
    );
    const events = await listEvents();
    const targets = preferEventId
      ? events.filter((event) => String(event?.id || '') === String(preferEventId))
      : events;
    for (const event of targets) {
      const id = String(event?.id || '').trim();
      if (!id || used.has(id) || isOfficialNewsEvent(event)) continue;
      await io.write(`${EVENTS_ROOT}/${encodeURIComponent(id)}`, null);
    }
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

    try {
      const { isBannedEmail, isBannedLicenseKey, banReason } = await import('./bannedAccounts.mjs');
      if (isBannedEmail(normalizedEmail) || isBannedLicenseKey(key)) {
        return { ok: false, error: banReason() };
      }
    } catch {
      /* continue without ban list */
    }

    const privateDb = io.loadLicenseDb ? await io.loadLicenseDb() : await loadPrivateLicenseDb();
    const phoneBot = privateDb ? sessionBot(privateDb, normalizedEmail) : null;
    const sessionOwned = Boolean(
      phoneBot && keysMatch(String(phoneBot.licenseKey || ''), key),
    );
    const firebaseVault = toList(await io.read('lumo/vault'));
    let entry = findVaultEntry(firebaseVault, key);
    let ownerId = String(entry?.ownerAdminId || entry?.adminId || '').trim();
    if (privateDb) {
      const saved = findStudentLicenseRecord(privateDb, normalizedEmail, key);
      if (saved?.entry) {
        // Prefer recovery/session ownership fields when Firebase vault is incomplete.
        entry = entry
          ? {
              ...saved.entry,
              ...entry,
              assignedEmail:
                entry.assignedEmail ||
                saved.entry.assignedEmail ||
                (sessionOwned ? normalizedEmail : ''),
              clientEmail:
                entry.clientEmail ||
                saved.entry.clientEmail ||
                (sessionOwned ? normalizedEmail : ''),
              eaId: entry.eaId || saved.entry.eaId,
              eaName: entry.eaName || saved.entry.eaName,
            }
          : saved.entry;
        ownerId = saved.ownerId || ownerId;
      }
    }

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

    // Phone session already holds this key for this email — synthesize a usable license row.
    if (!entry && sessionOwned && phoneBot) {
      entry = {
        key: String(phoneBot.licenseKey || key).trim(),
        status: 'assigned',
        assignedEmail: normalizedEmail,
        clientEmail: normalizedEmail,
        eaId: String(phoneBot.eaId || phoneBot.id || '').trim(),
        eaName: String(phoneBot.displayName || phoneBot.name || phoneBot.eaName || 'Lumo Edge').trim(),
        ownerAdminId: String(phoneBot.ownerAdminId || SUPER_ADMIN_ID).trim(),
      };
      ownerId = entry.ownerAdminId;
    } else if (entry && sessionOwned) {
      entry = {
        ...entry,
        assignedEmail: entry.assignedEmail || normalizedEmail,
        clientEmail: entry.clientEmail || entry.email || normalizedEmail,
        eaId: entry.eaId || String(phoneBot?.eaId || phoneBot?.id || '').trim(),
        eaName:
          entry.eaName ||
          String(phoneBot?.displayName || phoneBot?.name || phoneBot?.eaName || '').trim(),
      };
    }

    let accepted = acceptStudentLicense(entry, normalizedEmail, {
      sessionOwned,
      presentedKey: Boolean(key),
      sessionBotId: phoneBot?.eaId || phoneBot?.id,
      sessionBotName: phoneBot?.displayName || phoneBot?.name || phoneBot?.eaName,
    });

    // If this specific key was falsely wiped, fall back to any live Super /
    // Unlimited bull seat still assigned to this email.
    if (!accepted.ok) {
      const candidates = [];
      if (privateDb) {
        candidates.push(...toList(privateDb.vault));
        const workspaces = privateDb.store?.workspaces || {};
        for (const ws of Object.values(workspaces || {})) {
          candidates.push(...toList(ws?.licenses));
        }
      }
      candidates.push(...firebaseVault);
      const alt = candidates.find((row) => {
        if (!row?.key) return false;
        if (keysMatch(row.key, key)) return false;
        const owners = licenseOwnerEmails(row);
        if (!owners.includes(normalizedEmail)) return false;
        const trial = acceptStudentLicense(row, normalizedEmail, {
          sessionOwned: false,
          presentedKey: true,
          sessionBotId: phoneBot?.eaId || phoneBot?.id,
          sessionBotName: phoneBot?.displayName || phoneBot?.name || phoneBot?.eaName,
        });
        return trial.ok && (ownerIsSuper(row) || isSuperEa(row) || eaStem(row.eaName) === 'unlimitedbull');
      });
      if (alt) {
        entry = alt;
        ownerId = String(alt.ownerAdminId || alt.adminId || ownerId || SUPER_ADMIN_ID).trim();
        accepted = acceptStudentLicense(alt, normalizedEmail, {
          sessionOwned: false,
          presentedKey: true,
          sessionBotId: phoneBot?.eaId || phoneBot?.id,
          sessionBotName: phoneBot?.displayName || phoneBot?.name || phoneBot?.eaName,
        });
      }
    }

    if (!accepted.ok) return accepted;
    if (accepted.license) entry = accepted.license;
    const botId = accepted.botId;
    const botName = accepted.botName;
    return {
      ok: true,
      email: normalizedEmail,
      userId: normalizedEmail,
      licenseKey: String(entry?.key || key).trim() || key,
      licenseId:
        String(entry?.id || '').trim() && !keysMatch(entry?.id, entry?.key || key)
          ? String(entry.id)
          : emailFingerprint(normalizedEmail).slice(0, 16),
      license: entry,
      botId: botId || botName,
      botName: botName || botId,
      ownerAdminId: ownerId,
    };
  }

  async function listSuccessfulExecutions(email, signalId) {
    const rows = toList(await io.read(EXECUTIONS_ROOT));
    return rows.filter(
      (row) =>
        normalizeEmail(row?.userId) === normalizeEmail(email) &&
        String(row?.signalId || '') === String(signalId || '') &&
        String(row?.executionStatus || '') === 'success',
    );
  }

  async function findExecutionFor(email, signalId) {
    const successes = await listSuccessfulExecutions(email, signalId);
    if (successes.length) return successes[successes.length - 1];
    const lockId = executionLockId(email, signalId);
    if (lockId) {
      const lock = await io.read(`${LOCKS_ROOT}/${encodeURIComponent(lockId)}`);
      if (lock?.executionId) {
        const row = await io.read(`${EXECUTIONS_ROOT}/${encodeURIComponent(lock.executionId)}`);
        if (row && typeof row === 'object') return row;
      }
    }
    return null;
  }

  async function listStudentCalendar(email, licenseKey) {
    const license = await resolveStudentLicense(email, licenseKey);
    if (!license.ok) return license;
    let syncedEvents = [];
    let allSignals = [];
    try {
      const [synced, signalRows] = await Promise.all([
        syncUpcomingNews().catch(() => ({ events: [] })),
        listSignals(),
      ]);
      syncedEvents = toList(synced?.events);
      allSignals = signalRows;
    } catch {
      syncedEvents = [];
      allSignals = await listSignals().catch(() => []);
    }
    const nowMs = io.nowMs();
    const storedEvents = await listEvents();
    const byId = new Map();
    for (const event of [...syncedEvents, ...storedEvents]) {
      if (!event?.id) continue;
      byId.set(String(event.id), event);
    }
    const eventsByNameDate = new Map();
    for (const event of byId.values()) {
      const key = `${normalizeNewsName(event.name) || String(event.name || '').trim().toUpperCase()}|${String(event.date || '').trim()}`;
      if (key && !eventsByNameDate.has(key)) eventsByNameDate.set(key, event);
    }
    function liveEventForSignal(signal) {
      if (!signal) return null;
      if (signal.eventId && byId.has(String(signal.eventId))) return byId.get(String(signal.eventId));
      const key = `${normalizeNewsName(signal.eventName) || String(signal.eventName || '').trim().toUpperCase()}|${String(signal.eventDate || '').trim()}`;
      return eventsByNameDate.get(key) || null;
    }
    const signals = [];
    for (const signal of allSignals) {
      if (signal.status === 'draft' || signal.status === 'inactive') continue;
      if (!signalMatchesLicense(signal, license)) {
        continue;
      }
      const liveEvent = liveEventForSignal(signal);
      const correctedAt = resolveSignalEventAt(signal, liveEvent);
      const patched =
        correctedAt && correctedAt !== parseTimeMs(signal.eventAt, 0)
          ? { ...signal, eventAt: new Date(correctedAt).toISOString() }
          : signal;
      const persisted = deriveSignalStatus(patched, nowMs) === 'EXPIRED' ? { ...patched, status: 'EXPIRED' } : patched;
      const status = deriveSignalStatus(persisted, nowMs);
      if (!isStudentVisibleStatus(status)) continue;
      const successes = await listSuccessfulExecutions(license.email, signal.id);
      const maxTrades = normalizeMaxTrades(signal.maxTrades, 1);
      const execution = successes[successes.length - 1] || null;
      const view = publicStudentSignal(persisted, execution, nowMs, liveEvent);
      if (view) {
        view.tradesUsed = successes.length;
        view.maxTrades = maxTrades;
        view.executed = successes.length >= maxTrades;
        view.lotSize = normalizeLotSize(signal.lotSize, 0.01);
      }
      signals.push(view);
    }
    const signalEventIds = new Set(signals.map((row) => row.eventId).filter(Boolean));
    const visibleEvents = [...byId.values()]
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
    // One live signal per news event + symbol (+ direction). Multi-pair CPI bias
    // (XAUUSD SELL + USDJPY BUY) must all reach Unlimited bull students.
    const latestByEventSymbol = new Map();
    for (const row of signals) {
      const eventKey = String(row.eventId || `${row.eventName}|${row.eventDate}` || row.id);
      const symbolKey = String(row.symbol || '').trim().toUpperCase() || 'NA';
      const directionKey = String(row.direction || '').trim().toUpperCase() || 'NA';
      const key = `${eventKey}|${symbolKey}|${directionKey}`;
      const prev = latestByEventSymbol.get(key);
      if (!prev) {
        latestByEventSymbol.set(key, row);
        continue;
      }
      const prevT = parseTimeMs(prev.updatedAt || prev.publishedAt || prev.activationAt, 0);
      const nextT = parseTimeMs(row.updatedAt || row.publishedAt || row.activationAt, 0);
      if (nextT >= prevT) latestByEventSymbol.set(key, row);
    }
    const deduped = [...latestByEventSymbol.values()];
    deduped.sort((a, b) => parseTimeMs(a.activationAt) - parseTimeMs(b.activationAt));
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
      signals: deduped,
    };
  }

  async function executeSignal(input) {
    const email = normalizeEmail(input?.email);
    const licenseKey = input?.licenseKey;
    const signalId = String(input?.signalId || '').trim();
    const mt5Id = String(input?.mt5Id || input?.token || '').trim();
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
    if (status !== 'active' && status !== 'upcoming') {
      return { ok: false, error: 'Signal is not active' };
    }
    let liveEvent = null;
    try {
      const synced = await syncUpcomingNews().catch(() => ({ events: [] }));
      const allEvents = [...toList(synced?.events), ...(await listEvents().catch(() => []))];
      liveEvent =
        allEvents.find((event) => signal.eventId && String(event?.id || '') === String(signal.eventId)) ||
        allEvents.find(
          (event) =>
            (normalizeNewsName(event?.name) || '') === (normalizeNewsName(signal.eventName) || '') &&
            String(event?.date || '') === String(signal.eventDate || ''),
        ) ||
        null;
    } catch {
      liveEvent = null;
    }
    const eventAt = resolveSignalEventAt(signal, liveEvent);
    const executeOpensAt = eventAt ? eventAt - 20 * 60 * 1000 : parseTimeMs(signal.activationAt, 0);
    if (executeOpensAt && nowMs < executeOpensAt) {
      const mins = Math.max(1, Math.ceil((executeOpensAt - nowMs) / 60000));
      return { ok: false, error: `Execute opens in ${mins} min (20 min before the news)` };
    }
    if (!isValidSymbol(signal.symbol)) return { ok: false, error: 'Symbol is not valid' };
    if (!normalizeDirection(signal.direction)) return { ok: false, error: 'Direction is not valid' };
    if (!mt5Id) return { ok: false, error: 'Broker/MT5 connection is not active' };
    const lot = optionalLot(
      input?.volume ?? input?.lotSize ?? input?.lot ?? signal.lotSize,
      normalizeLotSize(signal.lotSize, 0.01),
    );
    const maxTrades = normalizeMaxTrades(signal.maxTrades, 1);
    const successes = await listSuccessfulExecutions(email, signalId);
    if (successes.length >= maxTrades) {
      return { ok: false, error: 'TRADE ALREADY EXECUTED FOR THIS SIGNAL', alreadyExecuted: true };
    }

    const lockId = executionLockId(email, signalId);
    const lockPath = `${LOCKS_ROOT}/${encodeURIComponent(lockId)}`;
    const lock = lockId ? await io.read(lockPath) : null;
    if (lock?.status === 'pending' && nowMs - parseTimeMs(lock.at, 0) < 60000) {
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
