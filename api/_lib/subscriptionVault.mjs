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
  const wantApproved = String(body?.status || '').toLowerCase() === 'approved';
  const wantPaid = body?.paymentClaimed === true || wantApproved;
  return {
    id: `cli-${Date.now()}`,
    email,
    firstName: String(body?.firstName || '').trim() || names.firstName,
    lastName: String(body?.lastName || '').trim() || names.lastName,
    status: wantApproved ? 'approved' : normalizeClientStatus(body?.status || 'pending'),
    createdAt: body?.createdAt || now,
    notifiedAt: now,
    paymentClaimed: wantPaid,
    paymentClaimedAt: wantPaid ? body?.paymentClaimedAt || now : undefined,
    paymentVerified: false,
  };
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
  if (!config.url || !config.secretKey) return emptySubscriptionStore();
  try {
    const response = await fetch(`${config.url}/storage/v1/object/${BUCKET}/${OBJECT_PATH}`, {
      headers: headers(config.secretKey),
      cache: 'no-store',
      signal: AbortSignal.timeout(FETCH_MS),
    });
    if (response.status === 404) return emptySubscriptionStore();
    if (!response.ok) return null;
    const body = await response.json();
    return {
      clients: clientMap(body),
      version: Number(body?.version || 0),
    };
  } catch {
    return emptySubscriptionStore();
  }
}

async function putSubscriptionStore(store) {
  return uploadPrivateJson(OBJECT_PATH, store);
}

async function updateSubscriptionStore(mutate) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const current = await loadSubscriptionStore();
    if (!current) return null;
    const next = await mutate(current);
    if (!next) return null;
    if (!(await putSubscriptionStore(next))) continue;
    const check = await loadSubscriptionStore();
    if (check && Number(check.version) === Number(next.version)) return check;
    return next;
  }
  return null;
}

export async function listSubscriptions() {
  try {
    const store = await loadSubscriptionStore();
    return listSubscriptionRows(store);
  } catch {
    return [];
  }
}

export async function getSubscription(email) {
  const key = normalizeRegistrationEmail(email);
  if (!isRegistrationEmail(key)) return null;
  try {
    const store = await loadSubscriptionStore();
    const row = store?.clients?.[key];
    return row && typeof row === 'object' ? row : null;
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
