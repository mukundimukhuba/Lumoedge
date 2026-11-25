import { supabaseConfig } from './supabase.mjs';

const BUCKET = 'lumo-private';

export function imageObjectPath(key) {
  const safe = String(key || '')
    .trim()
    .replace(/\.\./g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/^_+/, '')
    .slice(0, 160);
  return safe ? `images/${safe}` : '';
}

export function parseDataUrl(dataUrl) {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/s.exec(String(dataUrl || ''));
  if (!match) return null;
  const contentType = match[1].slice(0, 80) || 'application/octet-stream';
  if (!contentType.startsWith('image/') && contentType !== 'application/octet-stream') return null;
  const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
  if (!buffer.length) return null;
  return { contentType, buffer };
}

/**
 * Alias keys some mentors still reference after older uploads.
 * Prefer the durable profile-{mentorId} object when a robot alias is missing.
 */
export function imageKeyFallbacks(key) {
  const raw = String(key || '').trim();
  if (!raw) return [];
  const out = [];
  const push = (value) => {
    const next = String(value || '').trim();
    if (!next || next === raw || out.includes(next)) return;
    out.push(next);
  };

  const mentorId = (raw.match(/LM-\d+/i) || [])[0];
  if (mentorId) {
    if (/^(web-)?robot[-_]/i.test(raw) || raw === mentorId) {
      push(`profile-${mentorId}`);
    }
    if (/^ea[-_]/i.test(raw)) push(`profile-${mentorId}`);
    if (raw.startsWith(`profile-${mentorId}-`)) push(`profile-${mentorId}`);
    // Missing home wallpaper slots → mentor profile so the shell is never blank black.
    if (new RegExp(`^${mentorId}-bg-\\d+$`, 'i').test(raw) || /[-_]bg[-_]?\d+$/i.test(raw)) {
      push(`profile-${mentorId}`);
    }
  }
  if (raw.startsWith('img:')) push(raw.slice(4));
  return out;
}

function storageHeaders(secretKey, extra = {}) {
  return {
    apikey: secretKey,
    Authorization: `Bearer ${secretKey}`,
    ...extra,
  };
}

async function fetchPrivateObject(config, path) {
  const response = await fetch(`${config.url}/storage/v1/object/${BUCKET}/${path}`, {
    headers: storageHeaders(config.secretKey),
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) return null;
  const contentType = String(response.headers.get('content-type') || 'image/jpeg').split(';')[0];
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) return null;
  return { contentType, buffer };
}

export async function savePrivateImage(key, dataUrl) {
  const config = supabaseConfig();
  const path = imageObjectPath(key);
  const parsed = parseDataUrl(dataUrl);
  if (!config.url || !config.secretKey || !path || !parsed) return false;
  const init = {
    headers: storageHeaders(config.secretKey, {
      'Content-Type': parsed.contentType,
      'x-upsert': 'true',
    }),
    body: parsed.buffer,
    signal: AbortSignal.timeout(25000),
  };
  try {
    const posted = await fetch(`${config.url}/storage/v1/object/${BUCKET}/${path}`, {
      ...init,
      method: 'POST',
    });
    if (posted.ok) return true;
    const updated = await fetch(`${config.url}/storage/v1/object/${BUCKET}/${path}`, {
      ...init,
      method: 'PUT',
    });
    return updated.ok;
  } catch {
    return false;
  }
}

export async function loadPrivateImage(key) {
  const config = supabaseConfig();
  if (!config.url || !config.secretKey) return null;
  const keys = [String(key || '').trim(), ...imageKeyFallbacks(key)].filter(Boolean);
  for (const candidate of keys) {
    const path = imageObjectPath(candidate);
    if (!path) continue;
    try {
      const loaded = await fetchPrivateObject(config, path);
      if (loaded) return loaded;
    } catch {
      /* try next alias */
    }
  }
  return null;
}

const FALLBACK_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAXUlEQVR42u3YQQkAIBBFwT0bwACe7F/FHmbYEoJ8GHgF5vpqzB1dAQAAAAAAAAAAAAAAAAB8AKxznwQAAAAAAAAAAAAAAAAAAAAAkAVw5gAAAAAAAAAAAAAAAACCa9jTHTntHbmNAAAAAElFTkSuQmCC', 'base64');

/** Brand mark when a mentor photo blob is missing from Storage. */
export async function loadFallbackPeopleImage() {
  try {
    const { readFileSync, existsSync } = await import('node:fs');
    const { join, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const here = dirname(fileURLToPath(import.meta.url));
    const candidates = [
      join(here, 'fallback-avatar.png'),
      join(here, '..', 'lumo-logo-192.png'),
      join(here, '..', '..', 'lumo-logo-192.png'),
      join(process.cwd(), 'api', 'lumo-logo-192.png'),
      join(process.cwd(), 'lumo-logo-192.png'),
    ];
    for (const path of candidates) {
      if (!existsSync(path)) continue;
      const buffer = readFileSync(path);
      if (buffer?.length) return { contentType: 'image/png', buffer };
    }
  } catch {
    /* embedded buffer below */
  }
  if (FALLBACK_PNG?.length) return { contentType: 'image/png', buffer: FALLBACK_PNG };
  return null;
}
