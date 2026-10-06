import { supabaseConfig, uploadPrivateJson } from './supabase.mjs';

const BUCKET = 'lumo-private';
const OBJECT_PATH = 'recovery/admin-sessions.json';
const FETCH_MS = 12000;
const KEEP = 400;

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

export function emptyAdminSessionStore() {
  return { sessions: {}, version: 0 };
}

export function adminToken(pathOrToken) {
  const raw = String(pathOrToken || '').trim();
  const token = raw.includes('/') ? raw.split('/').filter(Boolean).pop() : raw;
  return String(token || '').replace(/[^a-zA-Z0-9_-]/g, '');
}

function trimSessions(sessions) {
  const now = Date.now();
  const live = Object.entries(sessions).filter(([, row]) => {
    const exp = Number(row?.exp || 0);
    return row && (!exp || exp >= now);
  });
  live.sort((a, b) => Number(b[1]?.exp || 0) - Number(a[1]?.exp || 0));
  return Object.fromEntries(live.slice(0, KEEP));
}

export async function loadAdminSessionStore() {
  const config = supabaseConfig();
  if (!config.url || !config.secretKey) return emptyAdminSessionStore();
  try {
    const response = await fetch(`${config.url}/storage/v1/object/${BUCKET}/${OBJECT_PATH}`, {
      headers: headers(config.secretKey),
      cache: 'no-store',
      signal: AbortSignal.timeout(FETCH_MS),
    });
    if (response.status === 404) return emptyAdminSessionStore();
    if (!response.ok) return null;
    const body = await response.json();
    return { sessions: sessionMap(body), version: Number(body?.version || 0) };
  } catch {
    return null;
  }
}

async function putAdminSessionStore(store) {
  return uploadPrivateJson(OBJECT_PATH, store);
}

async function updateAdminSessionStore(mutate) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const current = await loadAdminSessionStore();
    if (!current) return null;
    const next = await mutate(current);
    if (!next) return null;
    if (!(await putAdminSessionStore(next))) continue;
    const check = await loadAdminSessionStore();
    if (check && Number(check.version) === Number(next.version)) return check;
  }
  return null;
}

export async function readAdminSession(pathOrToken) {
  const token = adminToken(pathOrToken);
  if (!token) return null;
  const store = await loadAdminSessionStore();
  const row = store?.sessions?.[token];
  return row && typeof row === 'object' ? row : null;
}

export async function writeAdminSession(pathOrToken, value) {
  const token = adminToken(pathOrToken);
  if (!token) return false;
  const saved = await updateAdminSessionStore((current) => {
    const sessions = trimSessions({ ...sessionMap(current) });
    if (value == null) delete sessions[token];
    else sessions[token] = value;
    return { sessions: trimSessions(sessions), version: Number(current.version || 0) + 1 };
  });
  return Boolean(saved);
}
