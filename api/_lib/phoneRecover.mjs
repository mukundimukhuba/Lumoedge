import { mergeDatabases } from './mergeDb.mjs';
import { emptyDb } from './store.mjs';
import { supabaseConfig } from './supabase.mjs';

const BUCKET = 'lumo-private';
const OBJECT_PATH = 'recovery/db.json';
const RESET_OBJECT_PATH = 'recovery/password-resets.json';
const SENT_OBJECT_PATH = 'recovery/email-sent.json';
const SENT_KEEP = 2500;
const MAX_BODY_CHARS = 2_000_000;

const PHOTO_KEYS = new Set([
  'eaImage',
  'imageUrl',
  'customMedia',
  'images',
  'backdropUrl',
  'avatar',
  'photo',
  'mediaUrl',
  'eaImageUrl',
  'image',
]);

const SECRET_KEYS = new Set(['passwordSha256', 'sessionToken', 'token']);

function keepText(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const norm = text.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (norm === 'lumoedge' || norm === 'lumo') return '';
  return text;
}

function keepImageRef(value) {
  const text = String(value || '').trim();
  if (!text || text.startsWith('data:') || text.startsWith('blob:') || text.length > 240) return '';
  if (text.startsWith('img:') || text.startsWith('/api/images/') || text.startsWith('/api/media/')) {
    return text;
  }
  return '';
}

export function stripPhotos(value) {
  if (typeof value === 'string') {
    const text = value.trim();
    if (text.startsWith('data:') || text.startsWith('blob:')) return '';
    if (text.length > 2000) return '';
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => stripPhotos(item));
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (SECRET_KEYS.has(key)) continue;
    if (key === 'customMedia' && Array.isArray(item)) {
      const slots = item
        .map((slot) => {
          if (!slot || typeof slot !== 'object') return null;
          const url = keepImageRef(slot.url);
          if (!url) return null;
          return stripPhotos({ ...slot, url });
        })
        .filter(Boolean);
      if (slots.length) out[key] = slots;
      continue;
    }
    if (PHOTO_KEYS.has(key)) {
      const ref = keepImageRef(item);
      if (ref) out[key] = ref;
      continue;
    }
    out[key] = stripPhotos(item);
  }
  return out;
}

function asObject(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function takeLicense(vault, license, ownerId) {
  if (!license || typeof license !== 'object') return;
  const key = String(license.key || license.licenseKey || '').trim();
  if (!key) return;
  const eaName = keepText(license.eaName || license.displayName || license.name);
  const mainText = keepText(license.mainText);
  const next = stripPhotos({
    ...license,
    key,
    ownerAdminId: license.ownerAdminId || ownerId || license.adminId || '',
  });
  if (eaName) next.eaName = eaName;
  else delete next.eaName;
  if (mainText) next.mainText = mainText;
  else delete next.mainText;
  delete next.licenseKey;
  delete next.name;
  delete next.displayName;
  vault.push(next);
}

function takeClient(clients, entry) {
  if (!entry || typeof entry !== 'object') return;
  const email = String(entry.email || entry.clientEmail || '').trim().toLowerCase();
  if (!email || !email.includes('@')) return;
  clients.push(stripPhotos({ ...entry, email }));
}

function takeWorkspace(workspaces, vault, clients, id, workspace) {
  if (!id || !workspace || typeof workspace !== 'object' || Array.isArray(workspace)) return;
  const clean = stripPhotos(workspace);
  workspaces[id] = clean;
  for (const license of Array.isArray(clean.licenses) ? clean.licenses : []) {
    takeLicense(vault, license, id);
  }
  for (const entry of Array.isArray(clean.clientRequests) ? clean.clientRequests : []) {
    takeClient(clients, entry);
  }
}

export function phoneSnapshotToPatch(body) {
  const src = body && typeof body === 'object' ? body : {};
  const vault = [];
  const clients = [];
  const workspaces = {};
  const sessions = {};

  const takeSession = (raw) => {
    const session = asObject(raw);
    if (!session || Array.isArray(session) || typeof session !== 'object') return;
    const clean = stripPhotos(session);
    const email = String(clean.user?.email || '').trim().toLowerCase();
    const bot = clean.bot && typeof clean.bot === 'object' ? clean.bot : {};
    const key = String(bot.licenseKey || '').trim();
    const eaName = keepText(bot.displayName || bot.name);
    const mainText = keepText(bot.mainText);
    if (email) {
      takeClient(clients, {
        email,
        firstName: clean.user.firstName || '',
        lastName: clean.user.lastName || '',
        id: clean.user.id || email,
        status: key ? 'approved' : 'pending',
      });
    }
    if (key) {
      takeLicense(vault, {
        key,
        eaName,
        mainText,
        symbols: Array.isArray(bot.symbols) ? bot.symbols : [],
        status: 'active',
        email,
        clientEmail: email,
        clientName: [clean.user?.firstName, clean.user?.lastName].filter(Boolean).join(' '),
      });
      if (email) {
        sessions[email] = {
          ...clean,
          accessStatus: 'licensed',
          bot: {
            ...bot,
            licenseKey: key,
            ...(eaName ? { name: eaName, displayName: eaName } : {}),
            ...(mainText ? { mainText } : {}),
          },
        };
      }
    }
  };

  takeSession(src['ub-web/session-v2']);
  takeSession(src['ub-web/session-v1']);

  for (const storageKey of [
    'ub-web/admin-store-v3',
    'ub-web/admin-data-v2',
    'ub-web/admin-data-v1',
  ]) {
    const data = asObject(src[storageKey]);
    if (!data || Array.isArray(data) || typeof data !== 'object') continue;
    if (data.workspaces && typeof data.workspaces === 'object') {
      for (const [id, workspace] of Object.entries(data.workspaces)) {
        takeWorkspace(workspaces, vault, clients, id, workspace);
      }
    }
    if (Array.isArray(data.vault)) {
      for (const entry of data.vault) takeLicense(vault, entry);
    }
    if (Array.isArray(data.licenses)) {
      const owner = String(data.id || data.profile?.id || data.ownerAdminId || '').trim();
      for (const license of data.licenses) takeLicense(vault, license, owner);
      if (owner) takeWorkspace(workspaces, vault, clients, owner, data);
    }
    if (Array.isArray(data.clients)) {
      for (const entry of data.clients) takeClient(clients, entry);
    }
    if (Array.isArray(data.clientRequests)) {
      for (const entry of data.clientRequests) takeClient(clients, entry);
    }
  }

  const queue = asObject(src['ub-web/subscriber-queue-v1']);
  if (Array.isArray(queue)) {
    for (const entry of queue) takeClient(clients, entry);
  } else if (queue && Array.isArray(queue.clients)) {
    for (const entry of queue.clients) takeClient(clients, entry);
  }

  const savedVault = asObject(src['ub-web/license-vault-v1']);
  if (Array.isArray(savedVault)) {
    for (const entry of savedVault) takeLicense(vault, entry);
  } else if (savedVault && Array.isArray(savedVault.vault)) {
    for (const entry of savedVault.vault) takeLicense(vault, entry);
  }

  const mt5 =
    asObject(src['ub-web/client-mt5-v1']) ||
    asObject(src['ub-web/mt5-session-v1']) ||
    asObject(src['ub-web/mt5-account-cache-v1']);
  const sessionEmail = Object.keys(sessions)[0];
  if (mt5 && !Array.isArray(mt5) && sessionEmail && sessions[sessionEmail]) {
    sessions[sessionEmail] = { ...sessions[sessionEmail], mt5: stripPhotos(mt5) };
  }

  return {
    ...emptyDb(),
    vault: vault.slice(0, 500),
    clients: clients.slice(0, 2000),
    sessions,
    store: { workspaces },
    images: {},
  };
}

export function recoveryCounts(db) {
  const workspaces = db?.store?.workspaces || {};
  let licenses = 0;
  for (const workspace of Object.values(workspaces)) {
    licenses += Array.isArray(workspace?.licenses) ? workspace.licenses.length : 0;
  }
  return {
    clients: Array.isArray(db?.clients) ? db.clients.length : 0,
    vault: Array.isArray(db?.vault) ? db.vault.length : 0,
    licenses,
    sessions: db?.sessions && typeof db.sessions === 'object' ? Object.keys(db.sessions).length : 0,
    workspaces: Object.keys(workspaces).length,
    images: 0,
  };
}

function storageHeaders(secretKey, extra = {}) {
  return {
    apikey: secretKey,
    Authorization: `Bearer ${secretKey}`,
    ...extra,
  };
}

export async function loadRecoveryDb() {
  const config = supabaseConfig();
  if (!config.url || !config.secretKey) return null;
  const response = await fetch(
    `${config.url}/storage/v1/object/${BUCKET}/${OBJECT_PATH}`,
    { headers: storageHeaders(config.secretKey), cache: 'no-store' },
  );
  if (response.status === 404) return emptyDb();
  if (!response.ok) return null;
  try {
    const db = await response.json();
    return db && typeof db === 'object' ? { ...db, images: {} } : emptyDb();
  } catch {
    return null;
  }
}

export function bodyHasPrivateLicenses(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  const hasKey = (entry) => entry && (entry.key || entry.licenseKey);
  if (Array.isArray(body.vault) && body.vault.some(hasKey)) return true;
  if (Array.isArray(body.licenses) && body.licenses.some(hasKey)) return true;
  if (Array.isArray(body.revokedKeys) && body.revokedKeys.some((key) => String(key || '').trim())) {
    return true;
  }
  const workspaces = body.store?.workspaces;
  if (!workspaces || typeof workspaces !== 'object') return false;
  return Object.values(workspaces).some(
    (workspace) => Array.isArray(workspace?.licenses) && workspace.licenses.some(hasKey),
  );
}

export function redactPortalDb(db) {
  const next = db && typeof db === 'object' ? { ...db } : {};
  next.vault = [];
  next.images = {};
  next.clients = [];
  next.sessions = {};
  next.revokedKeys = [];
  delete next.passwordResets;
  delete next.passwordResetLimits;
  next.store = {
    ...(next.store && typeof next.store === 'object' ? next.store : {}),
    workspaces: {},
  };
  return next;
}

function withWorkspaceLicenses(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const workspaces = patch.store?.workspaces;
  if (!workspaces || typeof workspaces !== 'object') return patch;
  const extra = [];
  for (const [id, workspace] of Object.entries(workspaces)) {
    const licenses = Array.isArray(workspace?.licenses) ? workspace.licenses : [];
    for (const license of licenses) takeLicense(extra, license, id);
  }
  if (!extra.length) return patch;
  return {
    ...patch,
    vault: [...(Array.isArray(patch.vault) ? patch.vault : []), ...extra],
  };
}

export function prepareLicensePatch(patch) {
  return withWorkspaceLicenses(stripPhotos(patch || {}));
}

export function emptyResetStore() {
  return { passwordResets: {}, passwordResetLimits: {}, version: 0 };
}

/** Reset codes live in their own small file so a subscription save cannot wipe them. */
export async function loadResetStore() {
  const config = supabaseConfig();
  if (!config.url || !config.secretKey) return emptyResetStore();
  try {
    const response = await fetch(
      `${config.url}/storage/v1/object/${BUCKET}/${RESET_OBJECT_PATH}`,
      {
        headers: storageHeaders(config.secretKey),
        cache: 'no-store',
        signal: AbortSignal.timeout(12000),
      },
    );
    if (response.status === 404) return emptyResetStore();
    if (!response.ok) return emptyResetStore();
    const body = await response.json();
    return {
      passwordResets:
        body?.passwordResets && typeof body.passwordResets === 'object' && !Array.isArray(body.passwordResets)
          ? body.passwordResets
          : {},
      passwordResetLimits:
        body?.passwordResetLimits &&
        typeof body.passwordResetLimits === 'object' &&
        !Array.isArray(body.passwordResetLimits)
          ? body.passwordResetLimits
          : {},
      version: Number(body?.version || 0),
    };
  } catch {
    return emptyResetStore();
  }
}

async function putResetStore(store) {
  const { uploadPrivateJson } = await import('./supabase.mjs');
  return uploadPrivateJson(RESET_OBJECT_PATH, store);
}

/** Merge into the reset file and retry if another save landed first. */
export async function updateResetStore(mutate) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const current = await loadResetStore();
    if (!current) return null;
    const draft = {
      passwordResets: { ...(current.passwordResets || {}) },
      passwordResetLimits: { ...(current.passwordResetLimits || {}) },
      version: Number(current.version || 0) + 1,
    };
    const next = (await mutate(draft)) || draft;
    next.version = draft.version;
    if (!(await putResetStore(next))) continue;
    const check = await loadResetStore();
    if (check && Number(check.version) === Number(next.version)) return check;
    // A cached miss after a successful upload must not drop the code.
    return next;
  }
  return null;
}

export function emptySentStore() {
  return { sent: {}, version: 0 };
}

export function nextSentStore(current, key, now = new Date().toISOString()) {
  const sent = {
    ...(current?.sent && typeof current.sent === 'object' && !Array.isArray(current.sent) ? current.sent : {}),
  };
  const id = String(key || '').trim().slice(0, 180);
  if (id) sent[id] = now;
  const entries = Object.entries(sent)
    .filter(([name, at]) => name && at)
    .sort((a, b) => String(b[1]).localeCompare(String(a[1])))
    .slice(0, SENT_KEEP);
  return { sent: Object.fromEntries(entries), version: Number(current?.version || 0) + 1 };
}

export function emailSendSeen(store, key) {
  const id = String(key || '').trim();
  return Boolean(id && store?.sent && Object.prototype.hasOwnProperty.call(store.sent, id));
}

export async function loadSentStore() {
  const config = supabaseConfig();
  if (!config.url || !config.secretKey) return null;
  const response = await fetch(`${config.url}/storage/v1/object/${BUCKET}/${SENT_OBJECT_PATH}`, {
    headers: storageHeaders(config.secretKey),
    cache: 'no-store',
  });
  if (response.status === 404) return emptySentStore();
  if (!response.ok) return null;
  try {
    const body = await response.json();
    return {
      sent: body?.sent && typeof body.sent === 'object' && !Array.isArray(body.sent) ? body.sent : {},
      version: Number(body?.version || 0),
    };
  } catch {
    return emptySentStore();
  }
}

async function putSentStore(store) {
  const config = supabaseConfig();
  if (!config.url || !config.secretKey) return false;
  const response = await fetch(`${config.url}/storage/v1/object/${BUCKET}/${SENT_OBJECT_PATH}`, {
    method: 'PUT',
    headers: storageHeaders(config.secretKey, {
      'Content-Type': 'application/json',
      'x-upsert': 'true',
    }),
    body: JSON.stringify(store),
  });
  return response.ok;
}

async function updateSentStore(mutate) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const current = await loadSentStore();
    if (!current) return null;
    const next = mutate(current) || current;
    if (!(await putSentStore(next))) continue;
    const check = await loadSentStore();
    if (check && Number(check.version) === Number(next.version)) return check;
  }
  return null;
}

export async function emailSendAlreadyRecorded(key) {
  try {
    const store = await loadSentStore();
    if (!store) return false;
    return emailSendSeen(store, key);
  } catch {
    return false;
  }
}

export async function rememberEmailSend(key) {
  const id = String(key || '').trim();
  if (!id) return false;
  try {
    const saved = await updateSentStore((store) => nextSentStore(store, id));
    return emailSendSeen(saved, id);
  } catch {
    return false;
  }
}

export async function removeRecoveryClient(email) {
  const key = String(email || '').trim().toLowerCase();
  if (!key.includes('@')) return false;
  const config = supabaseConfig();
  if (!config.url || !config.secretKey) return false;
  const current = await loadRecoveryDb();
  if (!current) return false;
  const keep = (row) => String(row?.email || '').trim().toLowerCase() !== key;
  current.clients = (Array.isArray(current.clients) ? current.clients : []).filter(keep);
  const workspaces = current.store?.workspaces;
  if (workspaces && typeof workspaces === 'object') {
    for (const workspace of Object.values(workspaces)) {
      if (Array.isArray(workspace?.clientRequests)) {
        workspace.clientRequests = workspace.clientRequests.filter(keep);
      }
    }
  }
  current.images = {};
  current.updatedAt = new Date().toISOString();
  const response = await fetch(`${config.url}/storage/v1/object/${BUCKET}/${OBJECT_PATH}`, {
    method: 'PUT',
    headers: storageHeaders(config.secretKey, {
      'Content-Type': 'application/json',
      'x-upsert': 'true',
    }),
    body: JSON.stringify(current),
  });
  return response.ok;
}

export async function mergeRecoveryPatch(patch, preloaded) {
  const config = supabaseConfig();
  if (!config.url || !config.secretKey) return null;
  let current = preloaded && typeof preloaded === 'object' ? preloaded : null;
  if (!current) {
    current = await loadRecoveryDb();
    if (!current) return null;
  }
  const next = mergeDatabases(current, prepareLicensePatch(patch));
  next.images = {};
  next.updatedAt = new Date().toISOString();
  const response = await fetch(`${config.url}/storage/v1/object/${BUCKET}/${OBJECT_PATH}`, {
    method: 'PUT',
    headers: storageHeaders(config.secretKey, {
      'Content-Type': 'application/json',
      'x-upsert': 'true',
    }),
    body: JSON.stringify(next),
  });
  if (!response.ok) return null;
  return next;
}

export async function acceptPhoneSnapshot(body) {
  const raw = JSON.stringify(body || {});
  if (raw.length > MAX_BODY_CHARS) return { ok: false, error: 'Too large' };
  const patch = phoneSnapshotToPatch(body);
  const incoming = recoveryCounts(patch);
  if (!incoming.clients && !incoming.vault && !incoming.licenses && !incoming.sessions) {
    return { ok: false, error: 'Nothing to save' };
  }
  const saved = await mergeRecoveryPatch(patch);
  if (!saved) return { ok: false, error: 'Could not save' };
  return { ok: true, kept: recoveryCounts(saved) };
}

export async function recoveryStatus() {
  const db = await loadRecoveryDb();
  if (!db) return { ok: false, saved: false, ...recoveryCounts(emptyDb()) };
  return { ok: true, saved: true, ...recoveryCounts(db) };
}
