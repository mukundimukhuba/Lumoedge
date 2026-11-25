import { supabaseConfig } from './supabase.mjs';

const BUCKET = 'lumo-private';
const OBJECT_PATH = 'recovery/mentors.json';

function headers(secretKey, extra = {}) {
  return {
    apikey: secretKey,
    Authorization: `Bearer ${secretKey}`,
    ...extra,
  };
}

export function emptyMentorStore() {
  return { mentors: {}, version: 0 };
}

export function mentorEmail(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

/** Keep the stored password hash and the readable copy unless a newer one is supplied. */
export function upsertMentor(store, entry) {
  const email = mentorEmail(entry?.email);
  const mentors = {
    ...(store?.mentors && typeof store.mentors === 'object' && !Array.isArray(store.mentors)
      ? store.mentors
      : {}),
  };
  if (!email) return { mentors, version: Number(store?.version || 0) };
  const prev = mentors[email] && typeof mentors[email] === 'object' ? mentors[email] : {};
  const password = String(entry?.password || prev.password || '');
  const portalPassword = String(entry?.portalPassword || prev.portalPassword || '');
  mentors[email] = {
    ...prev,
    ...entry,
    email,
    password,
    portalPassword,
    role: entry?.role || prev.role || 'pending',
  };
  return { mentors, version: Number(store?.version || 0) + 1 };
}

export function listMentorRows(store) {
  const mentors = store?.mentors && typeof store.mentors === 'object' ? store.mentors : {};
  return Object.values(mentors).filter((row) => row && mentorEmail(row.email));
}

/**
 * Load the mentor password vault.
 * Distinguishes a real empty store from storage being offline (quota / 5xx),
 * so login never treats a restricted project as "no mentors exist".
 */
export async function loadMentorStoreResult() {
  const config = supabaseConfig();
  if (!config.url || !config.secretKey) {
    return { ok: false, offline: true, store: emptyMentorStore(), error: 'not_configured' };
  }
  try {
    const response = await fetch(`${config.url}/storage/v1/object/${BUCKET}/${OBJECT_PATH}`, {
      headers: headers(config.secretKey),
      cache: 'no-store',
      signal: AbortSignal.timeout(12000),
    });
    if (response.status === 404) {
      return { ok: true, offline: false, store: emptyMentorStore() };
    }
    if (!response.ok) {
      let message = '';
      try {
        const body = await response.json();
        message = String(body?.message || body?.error || '').slice(0, 220);
      } catch {
        message = '';
      }
      return {
        ok: false,
        offline: true,
        store: emptyMentorStore(),
        error: 'storage_unavailable',
        status: response.status,
        message,
      };
    }
    const body = await response.json();
    return {
      ok: true,
      offline: false,
      store: {
        mentors:
          body?.mentors && typeof body.mentors === 'object' && !Array.isArray(body.mentors)
            ? body.mentors
            : {},
        version: Number(body?.version || 0),
      },
    };
  } catch (error) {
    return {
      ok: false,
      offline: true,
      store: emptyMentorStore(),
      error: 'storage_unreachable',
      message: error instanceof Error ? error.message.slice(0, 180) : '',
    };
  }
}

export async function loadMentorStore() {
  const result = await loadMentorStoreResult();
  return result.store || emptyMentorStore();
}

async function putMentorStore(store) {
  const { uploadPrivateJson } = await import('./supabase.mjs');
  return uploadPrivateJson(OBJECT_PATH, store);
}

async function updateMentorStore(mutate) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const loaded = await loadMentorStoreResult();
    // Never mutate an empty placeholder when storage is offline — that can wipe mentors.
    if (loaded.offline || !loaded.store) return null;
    const current = loaded.store;
    const next = mutate(current) || current;
    if (!(await putMentorStore(next))) continue;
    const check = await loadMentorStoreResult();
    if (check.offline) return next;
    if (check.store && Number(check.store.version) === Number(next.version)) return check.store;
    return next;
  }
  return null;
}

export async function listMentors() {
  try {
    const result = await loadMentorStoreResult();
    if (result.offline) return [];
    return listMentorRows(result.store);
  } catch {
    return [];
  }
}

export async function listMentorsHealth() {
  try {
    const result = await loadMentorStoreResult();
    return {
      ok: !result.offline,
      offline: Boolean(result.offline),
      mentors: result.offline ? [] : listMentorRows(result.store),
      error: result.error,
      message: result.message,
    };
  } catch (error) {
    return {
      ok: false,
      offline: true,
      mentors: [],
      error: 'storage_unreachable',
      message: error instanceof Error ? error.message.slice(0, 180) : '',
    };
  }
}

/**
 * Persist a mentor row. Role-only approval patches may omit password —
 * upsertMentor keeps the previous hash / portalPassword in that case.
 */
export async function saveMentor(entry) {
  const email = mentorEmail(entry?.email);
  if (!email) return null;
  try {
    const saved = await updateMentorStore((store) => {
      const prev =
        store?.mentors && typeof store.mentors === 'object' ? store.mentors[email] : null;
      if (!String(entry?.password || '') && !String(prev?.password || '')) {
        // Brand-new row still needs a password; skip empty writes.
        if (!prev) return store;
      }
      return upsertMentor(store, { ...entry, email });
    });
    const row = listMentorRows(saved).find((item) => mentorEmail(item.email) === email);
    return row || null;
  } catch {
    return null;
  }
}
