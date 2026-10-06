import {
  mergeSessionPreferLicense,
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

export async function putPhoneSession(email, incoming) {
  const key = phoneEmail(email);
  if (!key.includes('@') || !incoming || typeof incoming !== 'object') return null;
  const saved = await updatePhoneSessionStore((current) => {
    const sessions = { ...sessionMap(current) };
    sessions[key] = mergeSessionPreferLicense(sessions[key], incoming);
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
  const released = sessionWithoutDevice(prev || {});
  const saved = await updatePhoneSessionStore((store) => {
    const sessions = { ...sessionMap(store) };
    sessions[key] = released.session;
    return { sessions: trimSessions(sessions), version: Number(store.version || 0) + 1 };
  });
  return {
    ok: Boolean(saved),
    previousLabel: released.previousLabel || '',
    session: saved?.sessions?.[key] || released.session,
  };
}
