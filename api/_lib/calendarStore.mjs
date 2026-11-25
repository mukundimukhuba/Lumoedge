import { supabaseConfig } from './supabase.mjs';

const BUCKET = 'lumo-private';
const OBJECT_PATH = 'recovery/calendar.json';
const FETCH_MS = 15000;

const MAP_ROOTS = new Set([
  'lumo/economicEvents',
  'lumo/economicSignals',
  'lumo/signalExecutions',
  'lumo/signalExecutionLocks',
]);

const VALUE_ROOTS = new Set(['lumo/economicCalendarSync']);

const FIELD_BY_ROOT = {
  'lumo/economicEvents': 'economicEvents',
  'lumo/economicSignals': 'economicSignals',
  'lumo/signalExecutions': 'signalExecutions',
  'lumo/signalExecutionLocks': 'signalExecutionLocks',
  'lumo/economicCalendarSync': 'economicCalendarSync',
};

export function emptyCalendarStore() {
  return {
    economicEvents: {},
    economicSignals: {},
    economicCalendarSync: null,
    signalExecutions: {},
    signalExecutionLocks: {},
    version: 0,
  };
}

function headers(secretKey, extra = {}) {
  return {
    apikey: secretKey,
    Authorization: `Bearer ${secretKey}`,
    ...extra,
  };
}

function decodeKey(value) {
  try {
    return decodeURIComponent(String(value || '').trim());
  } catch {
    return String(value || '').trim();
  }
}

function rootField(root) {
  return FIELD_BY_ROOT[root] || '';
}

export function isCalendarPath(path) {
  const key = String(path || '').replace(/^\/+/, '');
  if (VALUE_ROOTS.has(key)) return true;
  for (const root of MAP_ROOTS) {
    if (key === root || key.startsWith(`${root}/`)) return true;
  }
  return false;
}

function normalizeStore(body) {
  const base = emptyCalendarStore();
  if (!body || typeof body !== 'object') return base;
  return {
    ...base,
    economicEvents:
      body.economicEvents && typeof body.economicEvents === 'object' && !Array.isArray(body.economicEvents)
        ? body.economicEvents
        : {},
    economicSignals:
      body.economicSignals && typeof body.economicSignals === 'object' && !Array.isArray(body.economicSignals)
        ? body.economicSignals
        : {},
    economicCalendarSync:
      body.economicCalendarSync && typeof body.economicCalendarSync === 'object'
        ? body.economicCalendarSync
        : null,
    signalExecutions:
      body.signalExecutions && typeof body.signalExecutions === 'object' && !Array.isArray(body.signalExecutions)
        ? body.signalExecutions
        : {},
    signalExecutionLocks:
      body.signalExecutionLocks &&
      typeof body.signalExecutionLocks === 'object' &&
      !Array.isArray(body.signalExecutionLocks)
        ? body.signalExecutionLocks
        : {},
    version: Number(body.version || 0),
  };
}

let storeMemory = { at: 0, store: null };
const STORE_MEMORY_MS = 2500;

export function dropCalendarStoreCache() {
  storeMemory = { at: 0, store: null };
}

export async function loadCalendarStore({ bypassCache = false } = {}) {
  const now = Date.now();
  if (!bypassCache && storeMemory.store && now - storeMemory.at < STORE_MEMORY_MS) {
    return normalizeStore(storeMemory.store);
  }
  const config = supabaseConfig();
  if (!config.url || !config.secretKey) return emptyCalendarStore();
  try {
    const response = await fetch(`${config.url}/storage/v1/object/${BUCKET}/${OBJECT_PATH}`, {
      headers: headers(config.secretKey),
      cache: 'no-store',
      signal: AbortSignal.timeout(FETCH_MS),
    });
    if (response.status === 404 || response.status === 400) {
      const empty = emptyCalendarStore();
      storeMemory = { at: now, store: empty };
      return empty;
    }
    if (!response.ok) {
      // Prefer an empty store over hard-failing every signal save.
      return emptyCalendarStore();
    }
    const store = normalizeStore(await response.json());
    storeMemory = { at: now, store };
    return store;
  } catch {
    return emptyCalendarStore();
  }
}

async function putCalendarStore(store) {
  const config = supabaseConfig();
  if (!config.url || !config.secretKey) return { ok: false, error: 'not_configured' };
  const url = `${config.url}/storage/v1/object/${BUCKET}/${OBJECT_PATH}`;
  const normalized = normalizeStore(store);
  const body = JSON.stringify(normalized);
  const init = {
    headers: headers(config.secretKey, {
      'Content-Type': 'application/json',
      'x-upsert': 'true',
    }),
    body,
    signal: AbortSignal.timeout(25000),
  };
  try {
    // PUT+upsert creates or replaces; fall back to POST for older storage behavior.
    const updated = await fetch(url, { ...init, method: 'PUT' });
    if (updated.ok) {
      storeMemory = { at: Date.now(), store: normalized };
      return { ok: true, status: updated.status };
    }
    const posted = await fetch(url, { ...init, method: 'POST' });
    if (posted.ok) {
      storeMemory = { at: Date.now(), store: normalized };
      return { ok: true, status: posted.status };
    }
    let message = '';
    try {
      message = (await updated.text()).slice(0, 180) || (await posted.text()).slice(0, 180);
    } catch {
      message = '';
    }
    return { ok: false, status: posted.status || updated.status, error: message || 'upload_failed' };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message.slice(0, 180) : 'upload_unreachable',
    };
  }
}

/** Apply several calendar map/value changes in one storage round-trip. */
export async function mutateCalendarStore(mutator) {
  const saved = await updateCalendarStore(mutator);
  return Boolean(saved && !saved.__error);
}

function mergeStores(base, overlay) {
  const a = normalizeStore(base);
  const b = normalizeStore(overlay);
  return {
    economicEvents: { ...a.economicEvents, ...b.economicEvents },
    economicSignals: { ...a.economicSignals, ...b.economicSignals },
    signalExecutions: { ...a.signalExecutions, ...b.signalExecutions },
    signalExecutionLocks: { ...a.signalExecutionLocks, ...b.signalExecutionLocks },
    economicCalendarSync: b.economicCalendarSync ?? a.economicCalendarSync,
    version: Math.max(Number(a.version || 0), Number(b.version || 0)),
  };
}

async function updateCalendarStore(mutate) {
  let lastError = 'write_failed';
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const current = normalizeStore(await loadCalendarStore({ bypassCache: attempt > 0 }));
    const cloned = JSON.parse(JSON.stringify(current));
    const mutated = mutate(cloned) || current;
    // Reload right before upload and merge so a parallel sync/event write
    // cannot wipe a just-saved signal (last-write-wins without merge).
    const fresh = normalizeStore(await loadCalendarStore({ bypassCache: true }));
    const next = mergeStores(fresh, mutated);
    next.version = Number(fresh.version || 0) + 1;
    const saved = await putCalendarStore(next);
    if (!saved.ok) {
      lastError = saved.error || lastError;
      continue;
    }
    const check = normalizeStore(await loadCalendarStore());
    if (Number(check.version || 0) >= next.version) return check;
  }
  return { __error: lastError };
}

export async function calendarStorageHealth() {
  const loaded = await loadCalendarStore();
  const probe = {
    ...normalizeStore(loaded),
    healthCheckAt: new Date().toISOString(),
  };
  const saved = await putCalendarStore(probe);
  return {
    ok: Boolean(saved.ok),
    configured: Boolean(supabaseConfig().url && supabaseConfig().secretKey),
    events: Object.keys(probe.economicEvents || {}).length,
    signals: Object.keys(probe.economicSignals || {}).length,
    error: saved.ok ? undefined : saved.error,
    status: saved.status,
  };
}

export async function readCalendarPath(path) {
  const key = String(path || '').replace(/^\/+/, '');
  if (!isCalendarPath(key)) return undefined;
  const store = await loadCalendarStore();
  if (VALUE_ROOTS.has(key)) return store[rootField(key)] ?? null;
  for (const root of MAP_ROOTS) {
    const field = rootField(root);
    if (key === root) return store[field] || {};
    if (key.startsWith(`${root}/`)) {
      const id = decodeKey(key.slice(root.length + 1));
      if (!id) return null;
      return (store[field] || {})[id] || null;
    }
  }
  return null;
}

export async function writeCalendarPath(path, value) {
  const key = String(path || '').replace(/^\/+/, '');
  if (!isCalendarPath(key)) return false;

  const saved = await updateCalendarStore((store) => {
    if (VALUE_ROOTS.has(key)) {
      const field = rootField(key);
      return { ...store, [field]: value == null ? null : value };
    }
    for (const root of MAP_ROOTS) {
      const field = rootField(root);
      if (key === root) {
        return { ...store, [field]: value == null ? {} : value };
      }
      if (key.startsWith(`${root}/`)) {
        const id = decodeKey(key.slice(root.length + 1));
        if (!id) return store;
        const map = { ...(store[field] || {}) };
        if (value == null) delete map[id];
        else map[id] = value;
        return { ...store, [field]: map };
      }
    }
    return store;
  });
  return Boolean(saved && !saved.__error);
}
