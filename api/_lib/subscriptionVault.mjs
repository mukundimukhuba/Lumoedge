import { mergeClientRecord, normalizeClientStatus } from './clientMerge.mjs';
import {
  isRegistrationEmail,
  normalizeRegistrationEmail,
  splitNameFromEmail,
} from './registrationEmail.mjs';
import { supabaseConfig, uploadPrivateJson } from './supabase.mjs';

const BUCKET = 'lumo-private';
const OBJECT_PATH = 'recovery/subscriptions.json';
const FETCH_MS = 12000;

function headers(secretKey, extra = {}) {
  return {
    apikey: secretKey,
    Authorization: `Bearer ${secretKey}`,
    ...extra,
  };
}

function clientMap(store) {
  const clients = store?.clients;
  return clients && typeof clients === 'object' && !Array.isArray(clients) ? clients : {};
}

export function emptySubscriptionStore() {
  return { clients: {}, version: 0 };
}

export function subscriptionEntryFromBody(body, now = new Date().toISOString()) {
  const email = normalizeRegistrationEmail(body?.email);
  const names = splitNameFromEmail(email);
  // Public register / I've Paid must NEVER self-approve. Only admin PATCH or
  // payment webhooks set approved + paymentVerified.
  const allowPrivilege = body?.__allowAdminPrivilege === true;
  const wantApproved = allowPrivilege && String(body?.status || '').toLowerCase() === 'approved';
  const wantPaid = body?.paymentClaimed === true;
  const wantVerified = allowPrivilege && body?.paymentVerified === true;
  // Do NOT write paymentVerified:false — that key would wipe a prior Mark as paid
  // when the client re-registers or taps I've Paid again.
  const entry = {
    id: `cli-${Date.now()}`,
    email,
    firstName: String(body?.firstName || '').trim() || names.firstName,
    lastName: String(body?.lastName || '').trim() || names.lastName,
    status: wantApproved ? 'approved' : 'pending',
    createdAt: body?.createdAt || now,
    notifiedAt: now,
    paymentClaimed: wantPaid,
    paymentClaimedAt: wantPaid ? body?.paymentClaimedAt || now : undefined,
  };
  if (wantVerified) {
    entry.paymentVerified = true;
    entry.paymentVerifiedSource =
      body?.paymentVerifiedSource && body.paymentVerifiedSource !== 'assigned_license'
        ? body.paymentVerifiedSource
        : 'admin';
    entry.paymentVerifiedAt = body?.paymentVerifiedAt || now;
    entry.status = 'approved';
    entry.paymentClaimed = true;
    entry.paymentClaimedAt = entry.paymentClaimedAt || now;
  }
  return entry;
}

/** A later pending or unpaid copy must not cancel a saved payment or approval. */
export function upsertSubscription(store, entry) {
  const email = normalizeRegistrationEmail(entry?.email);
  const clients = { ...clientMap(store) };
  if (!email) return { clients, version: Number(store?.version || 0) };
  const prev = clients[email] && typeof clients[email] === 'object' ? clients[email] : null;
  const next = prev
    ? mergeClientRecord(prev, { ...entry, email, id: prev.id || entry.id })
    : { ...entry, email };
  if (prev?.id) next.id = prev.id;
  clients[email] = next;
  return { clients, version: Number(store?.version || 0) + 1 };
}

export function applySubscriptionPatch(store, id, patch) {
  const clients = { ...clientMap(store) };
  const key = String(id || '').trim();
  const lower = key.toLowerCase();
  let email = lower.includes('@') ? normalizeRegistrationEmail(lower) : '';
  if (!email || !clients[email]) {
    const hit = Object.values(clients).find(
      (row) =>
        row &&
        (row.id === key || normalizeRegistrationEmail(row.email) === lower),
    );
    email = hit ? normalizeRegistrationEmail(hit.email) : '';
  }
  const prev = email && clients[email] && typeof clients[email] === 'object' ? clients[email] : null;
  if (!prev) return null;
  const updated = mergeClientRecord(prev, {
    ...(patch && typeof patch === 'object' ? patch : {}),
    email: prev.email,
    id: prev.id,
  });
  if (prev.id) updated.id = prev.id;
  clients[email] = updated;
  return {
    clients,
    version: Number(store?.version || 0) + 1,
    row: updated,
  };
}

export function listSubscriptionRows(store) {
  return Object.values(clientMap(store)).filter((row) => isRegistrationEmail(row?.email));
}

export async function loadSubscriptionStore() {
  const config = supabaseConfig();
  // Missing credentials: treat as offline so callers return 503 instead of “not found”.
  if (!config.url || !config.secretKey) {
    return { clients: {}, version: -1, __offline: true, reason: 'not_configured' };
  }
  try {
    const response = await fetch(`${config.url}/storage/v1/object/${BUCKET}/${OBJECT_PATH}`, {
      headers: headers(config.secretKey),
      cache: 'no-store',
      signal: AbortSignal.timeout(FETCH_MS),
    });
    if (response.status === 404) return emptySubscriptionStore();
    if (!response.ok) {
      return { clients: {}, version: -1, __offline: true, reason: `http_${response.status}` };
    }
    const body = await response.json();
    return {
      clients: clientMap(body),
      version: Number(body?.version || 0),
    };
  } catch {
    // Never return an empty store on transport failure — that looked like “unpaid”.
    return { clients: {}, version: -1, __offline: true, reason: 'storage_unreachable' };
  }
}

async function putSubscriptionStore(store) {
  return uploadPrivateJson(OBJECT_PATH, store);
}

async function updateSubscriptionStore(mutate) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const current = await loadSubscriptionStore();
    // Never mutate from an offline/empty error store — that wiped subscriptions.
    if (!current || current.__offline) return null;
    const next = await mutate(current);
    if (!next || next.__offline) return null;
    if (!(await putSubscriptionStore(next))) continue;
    const check = await loadSubscriptionStore();
    if (check?.__offline) return null;
    if (check && Number(check.version) === Number(next.version)) return check;
    return next;
  }
  return null;
}

export async function listSubscriptions() {
  try {
    const store = await loadSubscriptionStore();
    if (store?.__offline) {
      const err = new Error('subscription_store_offline');
      err.code = 'unavailable';
      err.offline = true;
      throw err;
    }
    return listSubscriptionRows(store);
  } catch (error) {
    if (error?.offline || error?.code === 'unavailable') throw error;
    const err = new Error('subscription_store_offline');
    err.code = 'unavailable';
    err.offline = true;
    throw err;
  }
}

export async function getSubscription(email) {
  const key = normalizeRegistrationEmail(email);
  if (!isRegistrationEmail(key)) return null;
  const store = await loadSubscriptionStore();
  if (store?.__offline) {
    try {
      const { getOfflineRosterClient } = await import('./offlineRoster.mjs');
      const offline = getOfflineRosterClient(key);
      if (offline) return offline;
    } catch {
      /* ignore */
    }
    const err = new Error('subscription_store_offline');
    err.code = 'unavailable';
    err.offline = true;
    throw err;
  }
  const row = store?.clients?.[key];
  if (row && typeof row === 'object') return row;
  try {
    const { getOfflineRosterClient } = await import('./offlineRoster.mjs');
    return getOfflineRosterClient(key);
  } catch {
    return null;
  }
}

export async function saveSubscription(entry) {
  const email = normalizeRegistrationEmail(entry?.email);
  if (!isRegistrationEmail(email)) return null;
  try {
    const saved = await updateSubscriptionStore((store) =>
      upsertSubscription(store, { ...entry, email }),
    );
    return saved?.clients?.[email] || null;
  } catch {
    return null;
  }
}

export async function saveSubscriptionPatch(id, patch) {
  try {
    let row = null;
    const saved = await updateSubscriptionStore((store) => {
      const applied = applySubscriptionPatch(store, id, patch);
      if (!applied) return null;
      row = applied.row;
      return { clients: applied.clients, version: applied.version };
    });
    if (!saved || !row) return null;
    const email = normalizeRegistrationEmail(row.email);
    return saved.clients?.[email] || row;
  } catch {
    return null;
  }
}

/** Permanently drop a subscriber from the durable subscription store. */
export async function deleteSubscription(idOrEmail) {
  const needle = normalizeRegistrationEmail(idOrEmail);
  const raw = String(idOrEmail || '').trim();
  if (!needle && !raw) return false;
  try {
    let removed = false;
    await updateSubscriptionStore((store) => {
      const clients = { ...(store?.clients || {}) };
      for (const [email, row] of Object.entries(clients)) {
        const id = String(row?.id || '').trim();
        if (
          email === needle ||
          normalizeRegistrationEmail(row?.email) === needle ||
          (raw && (id === raw || email === raw.toLowerCase()))
        ) {
          delete clients[email];
          removed = true;
        }
      }
      if (!removed) return null;
      return { clients, version: Number(store?.version || 0) + 1 };
    });
    return removed;
  } catch {
    return false;
  }
}
