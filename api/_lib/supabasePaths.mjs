import { combineSubscriptions, mergeAdminRosters } from './supabaseRoster.mjs';
import { listMentors } from './mentorVault.mjs';
import { listSubscriptions } from './subscriptionVault.mjs';
import { loadRecoveryDb, mergeRecoveryPatch } from './phoneRecover.mjs';
import {
  clearPhoneDevice,
  getPhoneSession,
  putPhoneSession,
} from './phoneSessions.mjs';
import { readAdminSession, writeAdminSession } from './adminSessionStore.mjs';
import { supabaseConfig, uploadPrivateJson } from './supabase.mjs';

const BUCKET = 'lumo-private';
const SPECIAL_PATH = 'recovery/special.json';
const FETCH_MS = 12000;
let recoveryCache = { at: 0, db: null, pending: null };

function headers(secretKey, extra = {}) {
  return {
    apikey: secretKey,
    Authorization: `Bearer ${secretKey}`,
    ...extra,
  };
}

function dropRecoveryCache() {
  recoveryCache = { at: 0, db: null, pending: null };
}

async function cachedRecovery() {
  if (recoveryCache.db && Date.now() - recoveryCache.at < 15000) return recoveryCache.db;
  if (!recoveryCache.pending) {
    recoveryCache.pending = loadRecoveryDb()
      .then((db) => {
        if (db) recoveryCache = { at: Date.now(), db, pending: null };
        else recoveryCache.pending = null;
        return db;
      })
      .catch(() => {
        recoveryCache.pending = null;
        return null;
      });
  }
  return recoveryCache.pending;
}

function decodeKey(value) {
  try {
    return decodeURIComponent(String(value || '').trim());
  } catch {
    return String(value || '').trim();
  }
}

async function loadSpecial() {
  // Prefer recovery/db.json (same durable store as clients/vault). Fall back to
  // the older recovery/special.json object when present.
  const db = await cachedRecovery();
  if (db && (db.specialAccess || db.specialPayments)) {
    return {
      access: db.specialAccess && typeof db.specialAccess === 'object' ? db.specialAccess : {},
      payments: db.specialPayments && typeof db.specialPayments === 'object' ? db.specialPayments : {},
      version: Number(db.specialVersion || 0),
      via: 'recovery',
    };
  }
  // recovery loaded but no special fields yet — empty is real, not offline.
  if (db) {
    return { access: {}, payments: {}, version: 0, via: 'recovery' };
  }
  const config = supabaseConfig();
  if (!config.url || !config.secretKey) {
    return { access: {}, payments: {}, version: -1, via: 'offline', offline: true };
  }
  try {
    const response = await fetch(`${config.url}/storage/v1/object/${BUCKET}/${SPECIAL_PATH}`, {
      headers: headers(config.secretKey),
      cache: 'no-store',
      signal: AbortSignal.timeout(FETCH_MS),
    });
    if (response.status === 404) return { access: {}, payments: {}, version: 0, via: 'empty' };
    if (!response.ok) {
      return { access: {}, payments: {}, version: -1, via: 'offline', offline: true };
    }
    const body = await response.json();
    return {
      access: body?.access && typeof body.access === 'object' ? body.access : {},
      payments: body?.payments && typeof body.payments === 'object' ? body.payments : {},
      version: Number(body?.version || 0),
      via: 'file',
    };
  } catch {
    return { access: {}, payments: {}, version: -1, via: 'offline', offline: true };
  }
}

async function updateSpecial(mutate) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const current = await loadSpecial();
    if (!current) return null;
    const next = mutate(current);
    if (!next) return null;
    const saved = await mergeRecoveryPatch({
      specialAccess: next.access || {},
      specialPayments: next.payments || {},
      specialVersion: Number(next.version || 0),
    });
    if (!saved) continue;
    dropRecoveryCache();
    // Also mirror to special.json when storage allows (best effort).
    try {
      await uploadPrivateJson(SPECIAL_PATH, next);
    } catch {
      /* ignore */
    }
    return next;
  }
  return null;
}

export async function readStoredPath(path) {
  const key = String(path || '').replace(/^\/+/, '');
  const { isCalendarPath, readCalendarPath } = await import('./calendarStore.mjs');
  if (isCalendarPath(key)) return readCalendarPath(key);
  const { isWebsitePath, readWebsitePath } = await import('./websitePersist.mjs');
  if (isWebsitePath(key)) return readWebsitePath(key);
  if (key.startsWith('lumo/sessions/')) {
    return getPhoneSession(decodeKey(key.slice('lumo/sessions/'.length).split('/')[0]));
  }
  if (key.startsWith('lumo/adminSessions/')) return readAdminSession(key);
  if (key.startsWith('lumo/specialAccess/')) {
    const email = decodeKey(key.slice('lumo/specialAccess/'.length)).toLowerCase();
    const store = await loadSpecial();
    if (store?.offline) return { __offline: true, reason: 'special_store_offline' };
    return store?.access?.[email] || null;
  }
  if (key.startsWith('lumo/specialPayments/')) {
    const reference = decodeKey(key.slice('lumo/specialPayments/'.length));
    const store = await loadSpecial();
    if (store?.offline) return { __offline: true, reason: 'special_store_offline' };
    return store?.payments?.[reference] || null;
  }
  if (key === 'lumo/emailLogs' || key.startsWith('lumo/emailLogs/')) {
    return key === 'lumo/emailLogs' ? {} : null;
  }
  if (key.startsWith('lumo/images/')) return null;
  const db = await cachedRecovery();
  if (!db) return null;
  if (key === 'lumo/vault') return Array.isArray(db.vault) ? db.vault : [];
  if (key === 'lumo/revokedKeys') return Array.isArray(db.revokedKeys) ? db.revokedKeys : [];
  if (key === 'lumo/updatedAt') return db.updatedAt || null;
  if (key === 'lumo/deletedClients') return [];
  if (key === 'lumo/clients') {
    return combineSubscriptions(db.clients || [], await listSubscriptions());
  }
  if (key === 'lumo/auth') {
    return {
      admins: mergeAdminRosters(db.auth?.admins || [], await listMentors()),
      admin: null,
    };
  }
  if (key === 'lumo/store/workspaces') return db.store?.workspaces || {};
  if (key.startsWith('lumo/store/workspaces/')) {
    const id = decodeKey(key.slice('lumo/store/workspaces/'.length));
    return db.store?.workspaces?.[id] || null;
  }
  return null;
}

export async function writeStoredPath(path, value) {
  const key = String(path || '').replace(/^\/+/, '');
  const { isCalendarPath, writeCalendarPath } = await import('./calendarStore.mjs');
  if (isCalendarPath(key)) return writeCalendarPath(key, value);
  const { isWebsitePath, writeWebsitePath } = await import('./websitePersist.mjs');
  if (isWebsitePath(key)) return writeWebsitePath(key, value);
  if (key.startsWith('lumo/adminSessions/')) return writeAdminSession(key, value);
  if (key.startsWith('lumo/sessions/')) {
    const parts = key.slice('lumo/sessions/'.length).split('/');
    const id = decodeKey(parts[0]);
    if (parts[1] === 'device' && value == null) {
      const cleared = await clearPhoneDevice(id.includes('@') ? id : id);
      return cleared.ok;
    }
    if (!id.includes('@')) return false;
    if (value == null) return (await clearPhoneDevice(id)).ok;
    return Boolean(await putPhoneSession(id, value));
  }
  if (key.startsWith('lumo/specialAccess/') || key.startsWith('lumo/specialPayments/')) {
    const access = key.startsWith('lumo/specialAccess/');
    const id = decodeKey(
      key.slice(access ? 'lumo/specialAccess/'.length : 'lumo/specialPayments/'.length),
    );
    const mapKey = access ? id.toLowerCase() : id;
    const saved = await updateSpecial((current) => {
      const next = {
        access: { ...(current.access || {}) },
        payments: { ...(current.payments || {}) },
        version: Number(current.version || 0) + 1,
      };
      const bucket = access ? next.access : next.payments;
      if (value == null) delete bucket[mapKey];
      else bucket[mapKey] = value;
      return next;
    });
    return Boolean(saved);
  }
  if (
    key === 'lumo/updatedAt' ||
    key === 'lumo/emailLogs' ||
    key.startsWith('lumo/emailLogs/') ||
    key === 'lumo/deletedClients'
  ) {
    return true;
  }
  if (key.startsWith('lumo/images/')) return false;
  let patch = null;
  if (key === 'lumo/vault') patch = { vault: Array.isArray(value) ? value : [] };
  else if (key === 'lumo/revokedKeys') patch = { revokedKeys: Array.isArray(value) ? value : [] };
  else if (key === 'lumo/clients') patch = { clients: Array.isArray(value) ? value : [] };
  else if (key === 'lumo/auth') patch = { auth: value && typeof value === 'object' ? value : {} };
  else if (key === 'lumo/store/workspaces') {
    patch = { store: { workspaces: value && typeof value === 'object' ? value : {} } };
  } else if (key.startsWith('lumo/store/workspaces/')) {
    const id = decodeKey(key.slice('lumo/store/workspaces/'.length));
    if (!id || !value || typeof value !== 'object') return false;
    patch = { store: { workspaces: { [id]: value } } };
  }
  if (!patch) return false;
  const saved = await mergeRecoveryPatch(patch);
  dropRecoveryCache();
  return Boolean(saved);
}
