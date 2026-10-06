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

export async function loadMentorStore() {
  const config = supabaseConfig();
  if (!config.url || !config.secretKey) return emptyMentorStore();
  const response = await fetch(`${config.url}/storage/v1/object/${BUCKET}/${OBJECT_PATH}`, {
    headers: headers(config.secretKey),
    cache: 'no-store',
  });
  if (response.status === 404) return emptyMentorStore();
  if (!response.ok) return null;
  try {
    const body = await response.json();
    return {
      mentors: body?.mentors && typeof body.mentors === 'object' && !Array.isArray(body.mentors) ? body.mentors : {},
      version: Number(body?.version || 0),
    };
  } catch {
    return emptyMentorStore();
  }
}

async function putMentorStore(store) {
  const config = supabaseConfig();
  if (!config.url || !config.secretKey) return false;
  const response = await fetch(`${config.url}/storage/v1/object/${BUCKET}/${OBJECT_PATH}`, {
    method: 'PUT',
    headers: headers(config.secretKey, {
      'Content-Type': 'application/json',
      'x-upsert': 'true',
    }),
    body: JSON.stringify(store),
  });
  return response.ok;
}

async function updateMentorStore(mutate) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const current = await loadMentorStore();
    if (!current) return null;
    const next = mutate(current) || current;
    if (!(await putMentorStore(next))) continue;
    const check = await loadMentorStore();
    if (check && Number(check.version) === Number(next.version)) return check;
  }
  return null;
}

export async function listMentors() {
  try {
    const store = await loadMentorStore();
    return listMentorRows(store);
  } catch {
    return [];
  }
}

export async function saveMentor(entry) {
  const email = mentorEmail(entry?.email);
  if (!email || !String(entry?.password || '')) return null;
  try {
    const saved = await updateMentorStore((store) => upsertMentor(store, { ...entry, email }));
    const row = listMentorRows(saved).find((item) => mentorEmail(item.email) === email);
    return row || null;
  } catch {
    return null;
  }
}
