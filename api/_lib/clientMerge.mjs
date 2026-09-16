import {
  isRegistrationEmail,
  normalizeRegistrationEmail,
  splitNameFromEmail,
} from './registrationEmail.mjs';

const FIREBASE_DB_URL = (
  process.env.FIREBASE_DATABASE_URL ||
  process.env.VITE_FIREBASE_DATABASE_URL ||
  'https://lumoedge-61c02-default-rtdb.firebaseio.com'
).replace(/\/$/, '');

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.values(value);
  return [];
}

export function normalizeClientStatus(raw) {
  const value = String(raw ?? 'pending')
    .trim()
    .toLowerCase();
  if (value === 'approved') return 'approved';
  if (value === 'rejected') return 'rejected';
  return 'pending';
}

export function pickClientStatus(a, b) {
  const left = normalizeClientStatus(a);
  const right = normalizeClientStatus(b);
  if (left === 'approved' || right === 'approved') return 'approved';
  if (left === 'pending' || right === 'pending') return 'pending';
  return 'rejected';
}

/** Live Firebase queue wins for pending — stale GitHub approved must not hide new registrations. */
export function pickClientStatusLive(live, backup) {
  const l = normalizeClientStatus(live);
  const b = normalizeClientStatus(backup);
  if (l === 'rejected') return 'rejected';
  if (l === 'approved') return 'approved';
  if (l === 'pending') return 'pending';
  return b;
}

export function mergeClientRecordLive(backup, live) {
  const email = String(live.email || backup.email || '').toLowerCase();
  return {
    ...backup,
    ...live,
    email,
    status: pickClientStatusLive(live.status, backup.status),
    paymentClaimed:
      'paymentClaimed' in live
        ? Boolean(live.paymentClaimed)
        : Boolean(backup.paymentClaimed),
    paymentClaimedAt:
      'paymentClaimedAt' in live
        ? live.paymentClaimedAt || undefined
        : backup.paymentClaimedAt,
    licenseReleasedAt:
      'licenseReleasedAt' in live
        ? live.licenseReleasedAt || undefined
        : backup.licenseReleasedAt,
  };
}

export function mergeClientsLive(liveList, backupList) {
  const byEmail = new Map();
  for (const item of toArray(backupList)) {
    const email = String(item?.email || '').trim().toLowerCase();
    if (!email) continue;
    byEmail.set(email, { ...item, email });
  }
  for (const item of toArray(liveList)) {
    const email = String(item?.email || '').trim().toLowerCase();
    if (!email) continue;
    const prev = byEmail.get(email);
    byEmail.set(email, prev ? mergeClientRecordLive(prev, item) : { ...item, email });
  }
  return [...byEmail.values()];
}

export function mergeClientRecord(prev, incoming) {
  const email = String(incoming.email || prev.email || '').toLowerCase();
  return {
    ...prev,
    ...incoming,
    email,
    status: pickClientStatus(prev.status, incoming.status),
    paymentClaimed:
      'paymentClaimed' in incoming
        ? Boolean(incoming.paymentClaimed)
        : Boolean(prev.paymentClaimed),
    paymentClaimedAt:
      'paymentClaimedAt' in incoming
        ? incoming.paymentClaimedAt || undefined
        : prev.paymentClaimedAt,
    licenseReleasedAt:
      'licenseReleasedAt' in incoming
        ? incoming.licenseReleasedAt || undefined
        : prev.licenseReleasedAt,
  };
}

export function mergeClients(existing = [], incoming = []) {
  const byEmail = new Map();
  for (const c of existing || []) {
    if (c?.email) byEmail.set(String(c.email).toLowerCase(), c);
  }
  for (const c of incoming || []) {
    if (!c?.email) continue;
    const email = String(c.email).toLowerCase();
    const prev = byEmail.get(email);
    byEmail.set(email, prev ? mergeClientRecord(prev, { ...c, email }) : { ...c, email });
  }
  return [...byEmail.values()];
}

export async function firebaseRead(path) {
  try {
    const res = await fetch(`${FIREBASE_DB_URL}/${path}.json`, { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function firebaseWrite(path, value) {
  try {
    const res = await fetch(`${FIREBASE_DB_URL}/${path}.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Live Firebase registrations merged with durable GitHub backup — never drop pending. */
export async function loadMergedClients(loadDb) {
  const { db } = await loadDb();
  const githubClients = toArray(db.clients);
  const fbClients = toArray(await firebaseRead('lumo/clients'));
  return mergeClientsLive(fbClients, githubClients);
}

export function mirrorClientToSuperWorkspace(workspaces, entry) {
  const sid = 'LM-004821';
  const next = { ...workspaces };
  const ws = next[sid] || {
    eas: [],
    licenses: [],
    clientRequests: [],
    mt5: {},
    profile: {},
    orders: [],
    revokedKeys: [],
  };
  const rest = toArray(ws.clientRequests).filter(
    (c) => c.id !== entry.id && String(c.email || '').toLowerCase() !== String(entry.email || '').toLowerCase(),
  );
  next[sid] = { ...ws, clientRequests: [entry, ...rest] };
  return next;
}

/** Create or return existing client in Firebase — source of truth for live registrations. */
export async function firebasePostClientEntry(input) {
  const email = normalizeRegistrationEmail(input.email);
  if (!isRegistrationEmail(email)) return null;
  const fromEmail = splitNameFromEmail(email);
  const firstName = String(input.firstName || '').trim() || fromEmail.firstName;
  const lastName = String(input.lastName || '').trim() || fromEmail.lastName;

  const freshClients = toArray(await firebaseRead('lumo/clients'));
  const existing = freshClients.find((c) => String(c.email || '').toLowerCase() === email);
  if (existing) {
    const remoteWs = (await firebaseRead('lumo/store/workspaces')) || {};
    const nextWs = mirrorClientToSuperWorkspace(remoteWs, existing);
    const sid = 'LM-004821';
    if (nextWs[sid]) {
      await firebaseWrite(`lumo/store/workspaces/${sid}`, nextWs[sid]);
    }
    return existing;
  }

  const entry = {
    id: `cli-${Date.now()}`,
    email,
    firstName,
    lastName,
    status: normalizeClientStatus(input.status || 'pending'),
    createdAt: new Date().toISOString(),
    notifiedAt: new Date().toISOString(),
    paymentClaimed: Boolean(input.paymentClaimed),
    paymentClaimedAt: input.paymentClaimedAt || undefined,
  };
  freshClients.unshift(entry);

  const deleted = new Set(
    toArray(await firebaseRead('lumo/deletedClients')).map((e) => String(e).toLowerCase()),
  );
  deleted.delete(email);

  const remoteWs = (await firebaseRead('lumo/store/workspaces')) || {};
  const nextWs = mirrorClientToSuperWorkspace(remoteWs, entry);
  const sid = 'LM-004821';

  await Promise.all([
    firebaseWrite('lumo/clients', freshClients),
    firebaseWrite('lumo/deletedClients', [...deleted]),
    nextWs[sid]
      ? firebaseWrite(`lumo/store/workspaces/${sid}`, nextWs[sid])
      : Promise.resolve(true),
    firebaseWrite('lumo/updatedAt', new Date().toISOString()),
  ]);
  return entry;
}

export async function firebasePatchClientById(id, patch) {
  const freshClients = toArray(await firebaseRead('lumo/clients'));
  const key = String(id || '').trim();
  const idx = freshClients.findIndex(
    (c) =>
      c.id === key ||
      String(c.email || '').toLowerCase() === key.toLowerCase(),
  );
  if (idx < 0) return null;
  const prev = freshClients[idx];
  const updated = mergeClientRecord(prev, {
    ...prev,
    ...patch,
    email: prev.email,
    id: prev.id,
  });
  freshClients[idx] = updated;

  const remoteWs = (await firebaseRead('lumo/store/workspaces')) || {};
  const nextWs = mirrorClientToSuperWorkspace(remoteWs, updated);
  const sid = 'LM-004821';

  await Promise.all([
    firebaseWrite('lumo/clients', freshClients),
    nextWs[sid]
      ? firebaseWrite(`lumo/store/workspaces/${sid}`, nextWs[sid])
      : Promise.resolve(true),
    firebaseWrite('lumo/updatedAt', new Date().toISOString()),
  ]);
  return updated;
}

export function adminRoleRank(role) {
  if (role === 'super') return 3;
  if (role === 'admin') return 2;
  return 1;
}

export function normalizeAdminRole(raw) {
  const value = String(raw ?? 'pending')
    .trim()
    .toLowerCase();
  if (value === 'super') return 'super';
  if (value === 'admin') return 'admin';
  return 'pending';
}

/** Never expose mentor passwords over the public API / client roster. */
export function publicAdminRecord(admin) {
  if (!admin || typeof admin !== 'object') return admin;
  const out = { ...admin };
  delete out.password;
  return out;
}

export function publicAdminList(list) {
  return toArray(list).map(publicAdminRecord);
}

export function publicDbSnapshot(db) {
  if (!db || typeof db !== 'object') return db;
  const next = { ...db };
  if (next.auth && typeof next.auth === 'object') {
    next.auth = {
      ...next.auth,
      admins: publicAdminList(next.auth.admins),
      admin: next.auth.admin ? publicAdminRecord(next.auth.admin) : null,
    };
  }
  return next;
}

export function findAdminByEmail(admins, email) {
  const normalized = String(email || '')
    .trim()
    .toLowerCase();
  if (!normalized) return null;
  return (
    toArray(admins).find(
      (row) =>
        String(row?.email || '')
          .trim()
          .toLowerCase() === normalized,
    ) || null
  );
}

export function passwordsMatch(stored, incoming) {
  return String(stored || '') === String(incoming || '');
}

export function loginResultFor(hit, email) {
  const normalized = String(email || '')
    .trim()
    .toLowerCase();
  const role = normalizeAdminRole(hit?.role);
  const admin = publicAdminRecord({ ...hit, email: normalized, role });
  if (role === 'pending' || (role !== 'admin' && role !== 'super')) {
    return { ok: false, error: 'pending', admin };
  }
  return { ok: true, admin };
}

/**
 * Verify mentor email+password against Firebase, then a durable backup roster.
 * If Firebase is missing the password (client roster sync wiped it), restore
 * the backup password and let the mentor in. Never overwrite a non-empty
 * Firebase password from backup — Super Admin reset must keep winning.
 */
export async function verifyMentorLogin(
  email,
  password,
  backupAdmins = [],
  io = { read: firebaseRead, write: firebaseWrite },
) {
  const normalized = String(email || '')
    .trim()
    .toLowerCase();
  const pass = String(password || '');
  if (!normalized || !pass) {
    return { ok: false, error: 'invalid_credentials' };
  }
  const curAuth = (await io.read('lumo/auth')) || { admins: [] };
  const fbAdmins = toArray(curAuth.admins);
  const hit = findAdminByEmail(fbAdmins, normalized);
  if (hit && passwordsMatch(hit.password, pass)) {
    return loginResultFor(hit, normalized);
  }

  const backupHit = findAdminByEmail(backupAdmins, normalized);
  const livePass = String(hit?.password || '');
  if (!livePass && backupHit && passwordsMatch(backupHit.password, pass)) {
    const healed = {
      ...hit,
      ...backupHit,
      email: normalized,
      password: backupHit.password,
      id: hit?.id || backupHit.id,
      role: pickAdminRole(hit?.role, backupHit.role),
    };
    const next = mergeAdminsLive(fbAdmins, [healed]);
    await io.write('lumo/auth', { admins: next, admin: null }).catch(() => false);
    return loginResultFor(healed, normalized);
  }

  if (!hit && backupHit && passwordsMatch(backupHit.password, pass)) {
    const next = mergeAdminsLive(fbAdmins, [{ ...backupHit, email: normalized }]);
    await io.write('lumo/auth', { admins: next, admin: null }).catch(() => false);
    return loginResultFor(backupHit, normalized);
  }

  if (hit && !livePass) {
    return { ok: false, error: 'password_reset_required' };
  }
  return { ok: false, error: 'invalid_credentials' };
}

export function pickAdminRole(a, b) {
  const left = normalizeAdminRole(a);
  const right = normalizeAdminRole(b);
  return adminRoleRank(left) >= adminRoleRank(right) ? left : right;
}

/** Never demote approved mentors — admin always beats pending. */
export function pickAdminRoleLive(liveRole, backupRole) {
  return pickAdminRole(liveRole, backupRole);
}

export function mergeAdminsLive(live, backup) {
  const byEmail = new Map();
  for (const item of toArray(live)) {
    const email = String(item?.email || '')
      .trim()
      .toLowerCase();
    if (!email) continue;
    byEmail.set(email, { ...item, email, role: normalizeAdminRole(item.role) });
  }
  for (const item of toArray(backup)) {
    const email = String(item?.email || '')
      .trim()
      .toLowerCase();
    if (!email) continue;
    const prev = byEmail.get(email);
    if (!prev) {
      byEmail.set(email, { ...item, email, role: normalizeAdminRole(item.role) });
      continue;
    }
    const merged = { ...prev, ...item, email };
    merged.role = pickAdminRole(prev.role, item.role);
    // Keep Firebase id so approve-by-id keeps matching
    if (prev.id) merged.id = prev.id;
    const livePass = String(prev.password || '');
    const backupPass = String(item.password || '');
    if (livePass || backupPass) merged.password = livePass || backupPass;
    for (const [k, v] of Object.entries(prev)) {
      const nextVal = item[k];
      if ((nextVal === '' || nextVal == null) && v !== '' && v != null) {
        merged[k] = v;
      }
    }
    byEmail.set(email, merged);
  }
  return [...byEmail.values()];
}

export async function firebasePatchAdminRole(idOrEmail, role, fallbackRecord = null) {
  const key = String(idOrEmail || '').trim();
  const keyLower = key.toLowerCase();
  const curAuth = (await firebaseRead('lumo/auth')) || { admins: [], admin: null };
  let admins = toArray(curAuth.admins);
  let hit = null;

  admins = admins.map((a) => {
    const match =
      a.id === key || String(a.email || '').trim().toLowerCase() === keyLower;
    if (!match) return a;
    hit = { ...a, role: pickAdminRole(a.role, role) };
    return hit;
  });

  // Id miss (local roster id ≠ Firebase id) — retry by fallback email, then upsert
  if (!hit && fallbackRecord?.email) {
    const email = String(fallbackRecord.email || '')
      .trim()
      .toLowerCase();
    admins = admins.map((a) => {
      if (String(a.email || '').trim().toLowerCase() !== email) return a;
      hit = { ...a, role: pickAdminRole(a.role, role) };
      return hit;
    });
  }

  if (!hit && fallbackRecord) {
    const email = String(fallbackRecord.email || '')
      .trim()
      .toLowerCase();
    hit = {
      ...fallbackRecord,
      email,
      role: pickAdminRole(fallbackRecord.role, role),
    };
    // Safe email upsert — never route through demoting mergeAdminsLive
    let found = false;
    admins = admins.map((a) => {
      if (String(a.email || '').trim().toLowerCase() !== email) return a;
      found = true;
      hit = {
        ...a,
        ...hit,
        id: a.id || hit.id,
        role: pickAdminRole(a.role, hit.role),
      };
      return hit;
    });
    if (!found) admins = [...admins, hit];
  }

  if (!hit) return null;

  const ok = await firebaseWrite('lumo/auth', { admins, admin: null });
  await firebaseWrite('lumo/updatedAt', new Date().toISOString()).catch(() => false);
  if (!ok) return null;
  // Return the row actually written — never a pre-merge optimistic object
  const email = String(hit.email || '')
    .trim()
    .toLowerCase();
  return (
    admins.find((a) => String(a.email || '').trim().toLowerCase() === email) || hit
  );
}

export async function firebaseRegisterMentor(entry, workspace) {
  const curAuth = (await firebaseRead('lumo/auth')) || { admins: [], admin: null };
  const admins = mergeAdminsLive(toArray(curAuth.admins), [entry]);
  const authOk = await firebaseWrite('lumo/auth', { admins, admin: null });
  const wsOk = await firebaseWrite(`lumo/store/workspaces/${entry.id}`, workspace);
  await firebaseWrite('lumo/updatedAt', new Date().toISOString()).catch(() => false);
  return authOk && wsOk;
}
