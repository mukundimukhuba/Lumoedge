import {
  isReleasedDeviceId,
  mergeSessionPreferLicense,
  preferSessionDevice,
  sessionEmailKey,
  sessionWithoutDevice,
} from './clientMerge.mjs';
import { supabaseConfig, uploadPrivateJson } from './supabase.mjs';

const BUCKET = 'lumo-private';
const OBJECT_PATH = 'recovery/phone-sessions.json';
const FETCH_MS = 12000;
const KEEP = 5000;

function headers(secretKey, extra = {}) {
  return {
    apikey: secretKey,
    Authorization: `Bearer ${secretKey}`,
    ...extra,
  };
}

function sessionMap(store) {
  const sessions = store?.sessions;
  return sessions && typeof sessions === 'object' && !Array.isArray(sessions) ? sessions : {};
}

export function emptyPhoneSessionStore() {
  return { sessions: {}, version: 0 };
}

export function phoneEmail(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

export function findPhoneSession(store, id) {
  const sessions = sessionMap(store);
  const raw = decodeURIComponent(String(id || '').trim());
  const email = phoneEmail(raw);
  if (email.includes('@') && sessions[email]) return sessions[email];
  const folded = raw.toLowerCase();
  for (const [key, row] of Object.entries(sessions)) {
    if (key === folded || sessionEmailKey(key) === folded) return row;
  }
  return null;
}

function trimSessions(sessions) {
  const entries = Object.entries(sessions);
  if (entries.length <= KEEP) return sessions;
  entries.sort((a, b) =>
    String(b[1]?.device?.lastSeenAt || b[1]?.updatedAt || '').localeCompare(
      String(a[1]?.device?.lastSeenAt || a[1]?.updatedAt || ''),
    ),
  );
  return Object.fromEntries(entries.slice(0, KEEP));
}

export async function loadPhoneSessionStore() {
  const config = supabaseConfig();
  if (!config.url || !config.secretKey) return emptyPhoneSessionStore();
  try {
    const response = await fetch(`${config.url}/storage/v1/object/${BUCKET}/${OBJECT_PATH}`, {
      headers: headers(config.secretKey),
      cache: 'no-store',
      signal: AbortSignal.timeout(FETCH_MS),
    });
    if (response.status === 404) return emptyPhoneSessionStore();
    if (!response.ok) return null;
    const body = await response.json();
    return { sessions: sessionMap(body), version: Number(body?.version || 0) };
  } catch {
    return null;
  }
}

async function putPhoneSessionStore(store) {
  return uploadPrivateJson(OBJECT_PATH, store);
}

async function updatePhoneSessionStore(mutate) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const current = await loadPhoneSessionStore();
    if (!current) return null;
    const next = await mutate(current);
    if (!next) return null;
    if (!(await putPhoneSessionStore(next))) continue;
    const check = await loadPhoneSessionStore();
    if (check && Number(check.version) === Number(next.version)) return check;
  }
  return null;
}

async function seedFromRecovery(email) {
  try {
    const { loadRecoveryDb } = await import('./phoneRecover.mjs');
    const db = await loadRecoveryDb();
    const row = db?.sessions?.[email];
    return row && typeof row === 'object' ? row : null;
  } catch {
    return null;
  }
}

export async function getPhoneSession(id) {
  const store = await loadPhoneSessionStore();
  const found = findPhoneSession(store, id);
  if (found) return found;
  const email = phoneEmail(decodeURIComponent(String(id || '')));
  if (!email.includes('@')) return null;
  const seeded = await seedFromRecovery(email);
  if (!seeded) return null;
  await updatePhoneSessionStore((current) => ({
    sessions: trimSessions({ ...sessionMap(current), [email]: seeded }),
    version: Number(current.version || 0) + 1,
  }));
  return seeded;
}

export async function putPhoneSession(email, incoming, opts = {}) {
  const key = phoneEmail(email);
  if (!key.includes('@') || !incoming || typeof incoming !== 'object') return null;
  const force = Boolean(opts?.force);
  const saved = await updatePhoneSessionStore((current) => {
    const sessions = { ...sessionMap(current) };
    const prev = sessions[key];
    if (force) {
      // Force may rewrite license/persona, but never let another phone steal an active lock.
      const next = { ...incoming };
      if (incoming.device == null) {
        if (prev?.device) next.device = prev.device;
        if (prev?.releasedDeviceIds) next.releasedDeviceIds = prev.releasedDeviceIds;
        if (prev?.deviceReleasedAt) next.deviceReleasedAt = prev.deviceReleasedAt;
      } else if (isReleasedDeviceId(prev, incoming.device.id)) {
        next.device = prev?.device;
        next.releasedDeviceIds = prev?.releasedDeviceIds;
        next.deviceReleasedAt = prev?.deviceReleasedAt;
        if (!prev?.device) delete next.device;
      } else {
        next.device = preferSessionDevice(prev?.device, incoming.device);
        // Keep unlink block list forever so old phones cannot silently reclaim.
        if (prev?.releasedDeviceIds) next.releasedDeviceIds = prev.releasedDeviceIds;
        if (prev?.deviceReleasedAt) next.deviceReleasedAt = prev.deviceReleasedAt;
      }
      sessions[key] = next;
    } else {
      let merged = mergeSessionPreferLicense(prev, incoming);
      if (incoming?.device?.id && isReleasedDeviceId(prev, incoming.device.id)) {
        merged = {
          ...merged,
          device: prev?.device,
          releasedDeviceIds: prev?.releasedDeviceIds,
          deviceReleasedAt: prev?.deviceReleasedAt,
        };
        if (!prev?.device) delete merged.device;
      } else {
        if (prev?.releasedDeviceIds) merged.releasedDeviceIds = prev.releasedDeviceIds;
        if (prev?.deviceReleasedAt) merged.deviceReleasedAt = prev.deviceReleasedAt;
      }
      sessions[key] = merged;
    }
    return { sessions: trimSessions(sessions), version: Number(current.version || 0) + 1 };
  });
  return saved?.sessions?.[key] || null;
}

function locatePhoneSession(store, id) {
  const sessions = sessionMap(store);
  const raw = decodeURIComponent(String(id || '').trim());
  const email = phoneEmail(raw);
  if (email.includes('@')) return { email, row: sessions[email] || null };
  const folded = raw.toLowerCase();
  for (const [key, row] of Object.entries(sessions)) {
    if (key === folded || sessionEmailKey(key) === folded) return { email: key, row };
  }
  return { email: '', row: null };
}

export async function clearPhoneDevice(id) {
  const current = await loadPhoneSessionStore();
  const located = locatePhoneSession(current, id);
  const key = located.email;
  if (!key.includes('@')) return { ok: false, previousLabel: '' };
  const prev = located.row || (await getPhoneSession(key));
  const previousLabel = String(prev?.device?.label || '');
  // Full wipe — do not blacklist the old device id (that re-locked APK/web users).
  const cleaned = { ...(prev || {}), email: key, updatedAt: new Date().toISOString() };
  delete cleaned.device;
  delete cleaned.deviceReleasedAt;
  delete cleaned.releasedDeviceIds;
  const saved = await updatePhoneSessionStore((store) => {
    const sessions = { ...sessionMap(store) };
    sessions[key] = cleaned;
    return { sessions: trimSessions(sessions), version: Number(store.version || 0) + 1 };
  });
  return {
    ok: Boolean(saved),
    previousLabel,
    session: saved?.sessions?.[key] || cleaned,
  };
}

/**
 * After a successful payment, keep/reclaim THIS phone.
 * Never blacklist the paying device — that caused "locked to another phone"
 * right after auto-approve.
 */
/**
 * One-shot: clear requiresRepayment for verified prior payers.
 * emails = Set/Array of paymentVerified emails that must keep access.
 */
export async function clearRepaymentFlagsForEmails(emails) {
  const keep = new Set(
    (Array.isArray(emails) ? emails : [...(emails || [])])
      .map((e) => phoneEmail(e))
      .filter((e) => e.includes('@')),
  );
  if (!keep.size) return { ok: true, cleared: 0, emails: [] };
  let isBannedEmail = () => false;
  try {
    ({ isBannedEmail } = await import('./bannedAccounts.mjs'));
  } catch {}
  const cleared = [];
  const saved = await updatePhoneSessionStore((current) => {
    const sessions = { ...sessionMap(current) };
    const now = new Date().toISOString();
    for (const [key, row] of Object.entries(sessions)) {
      const email = phoneEmail(key);
      if (!keep.has(email) || isBannedEmail(email)) continue;
      if (!row || row.requiresRepayment !== true) continue;
      const bot = row.bot && typeof row.bot === 'object' ? row.bot : {};
      const hasLicense = Boolean(String(bot.licenseKey || '').trim());
      sessions[key] = {
        ...row,
        email,
        requiresRepayment: false,
        accessStatus: hasLicense
          ? 'licensed'
          : row.accessStatus === 'licensed'
            ? 'licensed'
            : row.accessStatus === 'none' || row.accessStatus === 'pending'
              ? 'paid'
              : row.accessStatus || 'paid',
        updatedAt: now,
      };
      cleared.push(email);
    }
    return { sessions: trimSessions(sessions), version: Number(current.version || 0) + 1 };
  });
  return { ok: Boolean(saved), cleared: cleared.length, emails: cleared };
}

export async function reclaimPhoneAfterPayment(email, deviceId, deviceLabel = '') {
  const key = phoneEmail(email);
  if (!key.includes('@')) return null;
  const id = String(deviceId || '').trim();
  const saved = await updatePhoneSessionStore((current) => {
    const sessions = { ...sessionMap(current) };
    const prev = sessions[key] && typeof sessions[key] === 'object' ? sessions[key] : {};
    const blocked = Array.isArray(prev.releasedDeviceIds)
      ? prev.releasedDeviceIds.map((row) => String(row || '').trim()).filter(Boolean)
      : [];
    const nextBlocked = id ? blocked.filter((row) => row !== id) : blocked;
    const now = new Date().toISOString();
    const next = { ...prev, email: key, updatedAt: now };
    if (id) {
      next.device = {
        ...(prev.device && prev.device.id === id ? prev.device : {}),
        id,
        label: String(deviceLabel || prev.device?.label || 'this phone').trim() || 'this phone',
        claimedAt: prev.device?.id === id ? prev.device.claimedAt || now : now,
        lastSeenAt: now,
      };
    } else if (prev.device) {
      next.device = prev.device;
    }
    if (nextBlocked.length) next.releasedDeviceIds = nextBlocked.slice(-20);
    else delete next.releasedDeviceIds;
    delete next.deviceReleasedAt;
    sessions[key] = next;
    return { sessions: trimSessions(sessions), version: Number(current.version || 0) + 1 };
  });
  return saved?.sessions?.[key] || null;
}
