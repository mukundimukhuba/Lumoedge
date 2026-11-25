import { supabaseConfig } from './supabase.mjs';

const BUCKET = 'lumo-private';
const OBJECT_PATH = 'recovery/websites.json';
const FETCH_MS = 15000;

const MAP_ROOTS = new Set([
  'lumo/websites',
  'lumo/mentorWebsites',
  'lumo/websiteSlugs',
  'lumo/storeOrders',
]);

const FIELD_BY_ROOT = {
  'lumo/websites': 'websites',
  'lumo/mentorWebsites': 'mentorWebsites',
  'lumo/websiteSlugs': 'websiteSlugs',
  'lumo/storeOrders': 'storeOrders',
};

export function emptyWebsitePersistStore() {
  return {
    websites: {},
    mentorWebsites: {},
    websiteSlugs: {},
    storeOrders: {},
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

export function isWebsitePath(path) {
  const key = String(path || '').replace(/^\/+/, '');
  for (const root of MAP_ROOTS) {
    if (key === root || key.startsWith(`${root}/`)) return true;
  }
  return false;
}

function asMap(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeStore(body) {
  const base = emptyWebsitePersistStore();
  if (!body || typeof body !== 'object') return base;
  return {
    ...base,
    websites: asMap(body.websites),
    mentorWebsites: asMap(body.mentorWebsites),
    websiteSlugs: asMap(body.websiteSlugs),
    storeOrders: asMap(body.storeOrders),
    version: Number(body.version || 0),
  };
}

let storeMemory = { at: 0, store: null };
const STORE_MEMORY_MS = 2500;

export function dropWebsitePersistCache() {
  storeMemory = { at: 0, store: null };
}

export async function loadWebsitePersistStore({ bypassCache = false } = {}) {
  const now = Date.now();
  if (!bypassCache && storeMemory.store && now - storeMemory.at < STORE_MEMORY_MS) {
    return normalizeStore(storeMemory.store);
  }
  const config = supabaseConfig();
  if (!config.url || !config.secretKey) return emptyWebsitePersistStore();
  try {
    const response = await fetch(`${config.url}/storage/v1/object/${BUCKET}/${OBJECT_PATH}`, {
      headers: headers(config.secretKey),
      cache: 'no-store',
      signal: AbortSignal.timeout(FETCH_MS),
    });
    if (response.status === 404 || response.status === 400) {
      const empty = emptyWebsitePersistStore();
      storeMemory = { at: now, store: empty };
      return empty;
    }
    if (!response.ok) return emptyWebsitePersistStore();
    const store = normalizeStore(await response.json());
    storeMemory = { at: now, store };
    return store;
  } catch {
    return emptyWebsitePersistStore();
  }
}

async function putWebsitePersistStore(store) {
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

async function updateWebsitePersistStore(mutate) {
  let lastError = 'write_failed';
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const current = normalizeStore(await loadWebsitePersistStore({ bypassCache: true }));
    const next = normalizeStore(mutate(JSON.parse(JSON.stringify(current))) || current);
    next.version = Number(current.version || 0) + 1;
    const saved = await putWebsitePersistStore(next);
    if (!saved.ok) {
      lastError = saved.error || lastError;
      continue;
    }
    const check = normalizeStore(await loadWebsitePersistStore({ bypassCache: true }));
    if (Number(check.version || 0) >= next.version) return check;
  }
  return { __error: lastError };
}

export async function readWebsitePath(path) {
  const key = String(path || '').replace(/^\/+/, '');
  if (!isWebsitePath(key)) return undefined;
  const store = await loadWebsitePersistStore();
  for (const root of MAP_ROOTS) {
    const field = rootField(root);
    if (key === root) return store[field] || {};
    if (key.startsWith(`${root}/`)) {
      const id = decodeKey(key.slice(root.length + 1));
      if (!id) return null;
      const value = (store[field] || {})[id];
      return value === undefined ? null : value;
    }
  }
  return null;
}

export async function writeWebsitePath(path, value) {
  const key = String(path || '').replace(/^\/+/, '');
  if (!isWebsitePath(key)) return false;

  const saved = await updateWebsitePersistStore((store) => {
    for (const root of MAP_ROOTS) {
      const field = rootField(root);
      if (key === root) {
        return { ...store, [field]: value == null ? {} : asMap(value) };
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
