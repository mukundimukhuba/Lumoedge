/**
 * Append-only audit trail for critical portal actions.
 * Stored as a compact JSON object (ring buffer) — never rewrite recovery/db.json.
 */
import { supabaseConfig } from './supabase.mjs';

const BUCKET = 'lumo-private';
const OBJECT_PATH = 'recovery/audit-log.json';
const MAX_EVENTS = 2000;
const WRITE_MS = 12000;
const READ_MS = 8000;

const SECRET_KEYS = /password|secret|token|authorization|apikey|service.?role|sha256/i;

function headers(secretKey, extra = {}) {
  return {
    apikey: secretKey,
    Authorization: `Bearer ${secretKey}`,
    ...extra,
  };
}

function scrub(value, depth = 0) {
  if (depth > 4) return '[truncated]';
  if (value == null) return value;
  if (typeof value === 'string') {
    if (value.length > 240) return `${value.slice(0, 240)}…`;
    return value;
  }
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => scrub(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (SECRET_KEYS.test(k)) {
      out[k] = '[redacted]';
      continue;
    }
    out[k] = scrub(v, depth + 1);
  }
  return out;
}

async function loadLog() {
  const config = supabaseConfig();
  if (!config.url || !config.secretKey) return { events: [], version: 0 };
  try {
    const res = await fetch(`${config.url}/storage/v1/object/${BUCKET}/${OBJECT_PATH}`, {
      headers: headers(config.secretKey),
      cache: 'no-store',
      signal: AbortSignal.timeout(READ_MS),
    });
    if (res.status === 404 || res.status === 400) return { events: [], version: 0 };
    if (!res.ok) return { events: [], version: -1, offline: true };
    const body = await res.json();
    return {
      events: Array.isArray(body?.events) ? body.events : [],
      version: Number(body?.version || 0),
    };
  } catch {
    return { events: [], version: -1, offline: true };
  }
}

async function saveLog(store) {
  const config = supabaseConfig();
  if (!config.url || !config.secretKey) return false;
  try {
    const res = await fetch(`${config.url}/storage/v1/object/${BUCKET}/${OBJECT_PATH}`, {
      method: 'PUT',
      headers: headers(config.secretKey, {
        'Content-Type': 'application/json',
        'x-upsert': 'true',
      }),
      body: JSON.stringify(store),
      signal: AbortSignal.timeout(WRITE_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * @param {string} action e.g. license.claim, subscription.approve, mentor.login_fail
 * @param {object} detail ids / emails / error codes (scrubbed)
 */
export async function audit(action, detail = {}) {
  const event = {
    id: `aud-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    action: String(action || 'unknown').slice(0, 80),
    ...scrub(detail && typeof detail === 'object' ? detail : { detail }),
  };
  try {
    const current = await loadLog();
    if (current.offline) {
      console.warn('[audit]', event.action, event.id, '(offline — console only)');
      return event;
    }
    const events = [event, ...(current.events || [])].slice(0, MAX_EVENTS);
    await saveLog({
      events,
      version: Number(current.version || 0) + 1,
      updatedAt: event.at,
    });
    return event;
  } catch (err) {
    console.warn('[audit] write failed', err?.message || err);
    return event;
  }
}

/** Fire-and-forget wrapper for request paths. */
export function auditAsync(action, detail) {
  void audit(action, detail).catch(() => undefined);
}
