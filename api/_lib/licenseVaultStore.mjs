/**
 * Per-key license objects under recovery/licenses/{fingerprint}.json
 * Avoids the overloaded 8MB recovery/db.json so Generate/Claim stay fast.
 */
import { supabaseConfig } from './supabase.mjs';
import { dbList, keysMatch, keyFingerprint } from './licenseClaim.mjs';

const BUCKET = 'lumo-private';
const PREFIX = 'recovery/licenses';
const INDEX_PATH = 'recovery/license-index.json';
const READ_MS = 8000;
const WRITE_MS = 12000;

function storageHeaders(secretKey, extra = {}) {
  return {
    apikey: secretKey,
    Authorization: `Bearer ${secretKey}`,
    ...extra,
  };
}

function objectPathForKey(key) {
  const fp = keyFingerprint(key);
  if (!fp) return '';
  return `${PREFIX}/${fp}.json`;
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, init, attempts = 3) {
  let lastErr = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(url, init);
      if (res.status === 429 || res.status === 544 || res.status === 503) {
        lastErr = new Error(`storage_${res.status}`);
        await sleep(400 * (i + 1));
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      await sleep(250 * (i + 1));
    }
  }
  // Never throw — callers treat null as storage miss/outage.
  console.warn('[licenseVault] fetch failed', lastErr?.message || lastErr);
  return null;
}

function normalizeEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const key = String(entry.key || entry.licenseKey || '').trim();
  if (!key) return null;
  const next = { ...entry, key };
  delete next.licenseKey;
  delete next.__forceRelease;
  return next;
}

function mergeOne(prev, incoming) {
  if (!incoming) return prev || null;
  if (!prev) return normalizeEntry(incoming);
  const entry = normalizeEntry(incoming);
  const base = normalizeEntry(prev);
  const merged = { ...base, ...entry };
  const nextStatus = String(entry.status || '').toLowerCase();
  const prevStatus = String(base.status || '').toLowerCase();
  const hasAssignedField = Object.prototype.hasOwnProperty.call(incoming, 'assignedEmail');
  const incomingEmail = hasAssignedField ? incoming.assignedEmail : undefined;
  const explicitRelease =
    nextStatus === 'active' &&
    (incomingEmail === null || incomingEmail === '' || incomingEmail === undefined) &&
    (hasAssignedField ||
      Object.prototype.hasOwnProperty.call(incoming, 'assignedAt') ||
      incoming?.__forceRelease === true);
  const explicitReassign =
    typeof incomingEmail === 'string' &&
    incomingEmail.trim() &&
    incomingEmail.trim().toLowerCase() !== String(base.assignedEmail || '').toLowerCase();
  if (explicitRelease) {
    merged.status = 'active';
    merged.assignedEmail = null;
    merged.assignedAt = null;
  } else if (explicitReassign) {
    merged.assignedEmail = String(incomingEmail).trim().toLowerCase();
    if (nextStatus === 'assigned') merged.status = 'assigned';
  } else if (prevStatus === 'assigned' && nextStatus && nextStatus !== 'assigned') {
    merged.status = base.status;
    if (base.assignedEmail && !merged.assignedEmail) merged.assignedEmail = base.assignedEmail;
    if (base.assignedAt && !merged.assignedAt) merged.assignedAt = base.assignedAt;
  }
  return merged;
}

async function readObject(path) {
  const config = supabaseConfig();
  if (!config.url || !config.secretKey || !path) return null;
  const res = await fetchWithRetry(
    `${config.url}/storage/v1/object/${BUCKET}/${path}`,
    {
      headers: storageHeaders(config.secretKey),
      cache: 'no-store',
      signal: AbortSignal.timeout(READ_MS),
    },
  );
  if (!res) return null;
  // Supabase Storage often returns HTTP 400 + statusCode 404 for missing keys.
  if (res.status === 404) return undefined;
  if (!res.ok) {
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    const code = String(body?.statusCode || body?.code || res.status);
    if (code === '404' || /not.?found|NoSuchKey/i.test(String(body?.error || body?.message || ''))) {
      return undefined;
    }
    return null;
  }
  return res.json().catch(() => null);
}

async function writeObject(path, body) {
  const config = supabaseConfig();
  if (!config.url || !config.secretKey || !path) return false;
  const res = await fetchWithRetry(
    `${config.url}/storage/v1/object/${BUCKET}/${path}`,
    {
      method: 'PUT',
      headers: storageHeaders(config.secretKey, {
        'Content-Type': 'application/json',
        'x-upsert': 'true',
      }),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(WRITE_MS),
    },
  );
  return Boolean(res && res.ok);
}

export function clearLicenseVaultCache() {
  /* no shared cache — per-key reads */
}

export async function loadLicenseByKey(key) {
  const path = objectPathForKey(key);
  if (!path) return null;
  const body = await readObject(path);
  if (body === undefined) return undefined; // missing
  if (!body) return null; // error
  return normalizeEntry(body.license || body);
}

export async function saveLicenseEntry(entry) {
  const normalized = normalizeEntry(entry);
  if (!normalized) return false;
  const path = objectPathForKey(normalized.key);
  if (!path) return false;
  const existing = await loadLicenseByKey(normalized.key);
  const merged = mergeOne(existing || null, { ...normalized, __forceRelease: entry?.__forceRelease });
  const ok = await writeObject(path, {
    license: merged,
    updatedAt: new Date().toISOString(),
  });
  if (ok) {
    void touchIndex(merged).catch(() => undefined);
  }
  return ok ? merged : null;
}

async function touchIndex(entry) {
  const current = (await readObject(INDEX_PATH)) || { keys: [], updatedAt: null };
  const keys = Array.isArray(current.keys) ? current.keys.slice(0, 4000) : [];
  const fp = keyFingerprint(entry.key);
  const row = {
    fp,
    key: entry.key,
    status: entry.status || 'active',
    ownerAdminId: entry.ownerAdminId || entry.adminId || '',
    clientEmail: entry.clientEmail || entry.email || '',
    assignedEmail: entry.assignedEmail || null,
    updatedAt: new Date().toISOString(),
  };
  const next = [row, ...keys.filter((k) => k?.fp !== fp)].slice(0, 4000);
  await writeObject(INDEX_PATH, { keys: next, updatedAt: new Date().toISOString() });
}

export async function loadLicenseVault() {
  // Best-effort index for bulk ops; Generate/Claim use per-key paths.
  const index = await readObject(INDEX_PATH);
  if (!index || !Array.isArray(index.keys)) return [];
  return index.keys
    .map((row) =>
      normalizeEntry({
        key: row.key,
        status: row.status,
        ownerAdminId: row.ownerAdminId,
        clientEmail: row.clientEmail,
        email: row.clientEmail,
        assignedEmail: row.assignedEmail,
      }),
    )
    .filter(Boolean);
}

export async function saveLicenseVault(entries) {
  const list = dbList(entries).map(normalizeEntry).filter(Boolean);
  let ok = 0;
  for (const entry of list.slice(0, 50)) {
    const saved = await saveLicenseEntry(entry);
    if (saved) ok += 1;
  }
  // For large seeds, only write index (avoid 2400 PUTs).
  if (list.length > 50) {
    const keys = list.slice(0, 4000).map((entry) => ({
      fp: keyFingerprint(entry.key),
      key: entry.key,
      status: entry.status || 'active',
      ownerAdminId: entry.ownerAdminId || entry.adminId || '',
      clientEmail: entry.clientEmail || entry.email || '',
      assignedEmail: entry.assignedEmail || null,
      updatedAt: new Date().toISOString(),
    }));
    await writeObject(INDEX_PATH, { keys, updatedAt: new Date().toISOString() });
  }
  return ok > 0 || list.length === 0;
}

export async function mergeLicenseVault(incomingEntries) {
  const list = dbList(incomingEntries).map(normalizeEntry).filter(Boolean);
  if (!list.length) return (await loadLicenseVault()) || [];
  const saved = [];
  for (const entry of list) {
    const row = await saveLicenseEntry(entry);
    if (row) saved.push(row);
  }
  return saved.length ? saved : null;
}

export async function seedLicenseVaultFromRecovery(recoveryVault) {
  // Only ensure index exists; do not PUT thousands of objects during request.
  const list = dbList(recoveryVault).map(normalizeEntry).filter(Boolean);
  if (!list.length) return [];
  const existing = await readObject(INDEX_PATH);
  if (existing && Array.isArray(existing.keys) && existing.keys.length >= Math.min(100, list.length)) {
    return list;
  }
  const keys = list.slice(0, 4000).map((entry) => ({
    fp: keyFingerprint(entry.key),
    key: entry.key,
    status: entry.status || 'active',
    ownerAdminId: entry.ownerAdminId || entry.adminId || '',
    clientEmail: entry.clientEmail || entry.email || '',
    assignedEmail: entry.assignedEmail || null,
    updatedAt: new Date().toISOString(),
  }));
  const ok = await writeObject(INDEX_PATH, { keys, updatedAt: new Date().toISOString() });
  return ok ? list : null;
}

export async function findLicenseInStore(key) {
  const direct = await loadLicenseByKey(key);
  if (direct) return direct;
  if (direct === undefined) return null;
  return null;
}
