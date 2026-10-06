import { createHash, randomBytes } from 'node:crypto';
import {
  isRegistrationEmail,
  normalizeRegistrationEmail,
  splitNameFromEmail,
} from './registrationEmail.mjs';


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

/** An approval sticks. A later pending or unpaid copy must not cancel it. */
export function pickClientStatusLive(live, backup) {
  return pickClientStatus(live, backup);
}

export function mergeClientRecordLive(backup, live) {
  const email = String(live.email || backup.email || '').toLowerCase();
  return {
    ...backup,
    ...live,
    email,
    status: pickClientStatusLive(live.status, backup.status),
    paymentClaimed: Boolean(backup.paymentClaimed) || Boolean(live.paymentClaimed),
    paymentClaimedAt: live.paymentClaimedAt || backup.paymentClaimedAt,
    paymentVerified:
      'paymentVerified' in live
        ? Boolean(live.paymentVerified)
        : Boolean(backup.paymentVerified),
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
    paymentClaimed: Boolean(prev.paymentClaimed) || Boolean(incoming.paymentClaimed),
    paymentClaimedAt: incoming.paymentClaimedAt || prev.paymentClaimedAt,
    paymentVerified:
      'paymentVerified' in incoming
        ? Boolean(incoming.paymentVerified)
        : Boolean(prev.paymentVerified),
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

/** Supabase is the database. These names stay so older callers do not contact Firebase. */
export async function firebaseRead(path) {
  const { readStoredPath } = await import('./supabasePaths.mjs');
  return readStoredPath(path);
}

export async function firebaseWrite(path, value) {
  const { writeStoredPath } = await import('./supabasePaths.mjs');
  return writeStoredPath(path, value);
}

/** Never let a stale pending push wipe a saved license key. */
export function mergeSessionPreferLicense(prev, incoming) {
  if (!incoming || typeof incoming !== 'object') return prev || incoming;
  if (!prev || typeof prev !== 'object') return incoming;
  const prevBot = prev.bot && typeof prev.bot === 'object' ? prev.bot : {};
  const nextBot = incoming.bot && typeof incoming.bot === 'object' ? incoming.bot : {};
  const incomingKey = String(nextBot.licenseKey || '').trim();
  const prevKey = String(prevBot.licenseKey || '').trim();
  const intentionalClear =
    nextBot.licenseKey !== undefined &&
    !incomingKey &&
    String(incoming.accessStatus || '') !== 'licensed';
  const licenseKey = intentionalClear ? '' : incomingKey || prevKey;
  const accessStatus = licenseKey
    ? 'licensed'
    : intentionalClear
      ? incoming.accessStatus || 'pending'
      : incoming.accessStatus || prev.accessStatus || 'pending';
  const merged = {
    ...prev,
    ...incoming,
    accessStatus,
    bot: {
      ...prevBot,
      ...nextBot,
      licenseKey,
    },
  };
  if (incoming.device == null) {
    if (prev.device) merged.device = prev.device;
  } else {
    merged.device = preferSessionDevice(prev.device, incoming.device);
  }
  return merged;
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
/** Firebase session keys cannot contain . # $ [ ] / */
export function sessionEmailKey(email) {
  return String(email || '')
    .trim()
    .toLowerCase()
    .replace(/[.#$[\]/]/g, '_');
}

export function sessionDeviceKeys(email) {
  const normalized = String(email || '')
    .trim()
    .toLowerCase();
  const keys = [];
  const push = (key) => {
    if (key && !keys.includes(key)) keys.push(key);
  };
  push(sessionEmailKey(normalized));
  if (normalized.endsWith('.com')) push(normalized.slice(0, -4));
  return keys;
}

/** Payment or an explicit approval upgrades a client who is already on file. */
export function clientEntryPatch(existing, input) {
  const wantApproved = normalizeClientStatus(input?.status || '') === 'approved';
  const wantPaid = Boolean(input?.paymentClaimed);
  if (!wantApproved && !wantPaid) return null;
  const firstName = String(input?.firstName || '').trim() || existing?.firstName;
  const lastName = String(input?.lastName || '').trim() || existing?.lastName;
  return {
    firstName,
    lastName,
    status: wantApproved ? 'approved' : existing?.status || 'pending',
    paymentClaimed: wantPaid ? true : Boolean(existing?.paymentClaimed),
    paymentClaimedAt: wantPaid
      ? input?.paymentClaimedAt || existing?.paymentClaimedAt || new Date().toISOString()
      : existing?.paymentClaimedAt,
  };
}

/** Newer sign-in wins. A heartbeat keeps claimedAt, so it cannot take the email from another phone. */
export function preferSessionDevice(stored, incoming) {
  if (!incoming || typeof incoming !== 'object' || !incoming.id) return stored || incoming;
  if (!stored || typeof stored !== 'object' || !stored.id) return incoming;
  if (stored.id === incoming.id) {
    return {
      ...stored,
      ...incoming,
      claimedAt: incoming.claimedAt || stored.claimedAt,
    };
  }
  const nextClaim = Date.parse(incoming.claimedAt || '');
  const prevClaim = Date.parse(stored.claimedAt || '');
  const next = Number.isFinite(nextClaim) ? nextClaim : 0;
  const prev = Number.isFinite(prevClaim) ? prevClaim : 0;
  return next > prev ? incoming : stored;
}

export function sessionWithoutDevice(session) {
  if (!session || typeof session !== 'object') return { session, previousLabel: '' };
  const previousLabel = String(session.device?.label || '');
  const next = { ...session, deviceReleasedAt: new Date().toISOString() };
  delete next.device;
  return { session: next, previousLabel };
}

/** Drop the phone lock so the same email can sign in on a new device. */
export async function firebaseClearSessionDevice(email) {
  const normalized = String(email || '')
    .trim()
    .toLowerCase();
  let previousLabel = '';
  for (const key of sessionDeviceKeys(normalized)) {
    const session = await firebaseRead(`lumo/sessions/${key}`);
    if (session && typeof session === 'object' && session.device?.label) {
      previousLabel = previousLabel || String(session.device.label);
    }
    await firebaseWrite(`lumo/sessions/${key}/device`, null);
  }
  return { ok: true, email: normalized, previousLabel };
}

export async function firebasePostClientEntry(input) {
  const email = normalizeRegistrationEmail(input.email);
  if (!isRegistrationEmail(email)) return null;
  const fromEmail = splitNameFromEmail(email);
  const firstName = String(input.firstName || '').trim() || fromEmail.firstName;
  const lastName = String(input.lastName || '').trim() || fromEmail.lastName;

  const freshClients = toArray(await firebaseRead('lumo/clients'));
  const existing = freshClients.find((c) => String(c.email || '').toLowerCase() === email);
  if (existing) {
    const upgrade = clientEntryPatch(existing, { ...input, firstName, lastName });
    if (upgrade) {
      return firebasePatchClientById(email, upgrade);
    }
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
    paymentVerified: Boolean(input.paymentVerified),
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
  delete out.portalPassword;
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
  delete next.passwordResets;
  delete next.passwordResetLimits;
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

export function isHashedPassword(stored) {
  return String(stored || '').startsWith('sha256$');
}

export function hashPassword(password, salt) {
  const s = String(salt || randomBytes(16).toString('hex'));
  const digest = createHash('sha256').update(`${s}:${String(password || '')}`, 'utf8').digest('hex');
  return `sha256$${s}$${digest}`;
}

export function passwordsMatch(stored, incoming) {
  const value = String(stored || '');
  const pass = String(incoming || '');
  if (!value || !pass) return false;
  if (isHashedPassword(value)) {
    const parts = value.split('$');
    const salt = parts[1] || '';
    const digest = parts[2] || '';
    const next = createHash('sha256').update(`${salt}:${pass}`, 'utf8').digest('hex');
    return next === digest;
  }
  return value === pass;
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
  if (role !== 'super' && String(hit?.activityStatus || '').toLowerCase() === 'inactive') {
    return { ok: false, error: 'inactive', admin };
  }
  return { ok: true, admin };
}

/**
 * Verify mentor email+password against Firebase, then the private roster.
 * A later password reset wins over an older hash. An empty Firebase password
 * can still be healed from the backup roster.
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
  const { applyMentorActivitySweep } = await import('./mentorActivity.mjs');
  const swept = applyMentorActivitySweep(fbAdmins);
  if (swept.changed) {
    await io.write('lumo/auth', { admins: swept.admins, admin: null }).catch(() => false);
  }
  const liveAdmins = swept.admins;
  const hit = findAdminByEmail(liveAdmins, normalized);
  const backupHit = findAdminByEmail(backupAdmins, normalized);
  const chosen =
    hit && backupHit ? mergeAdminsLive([hit], [backupHit])[0] : hit || backupHit || null;
  if (chosen && passwordsMatch(chosen.password, pass)) {
    const durable = isHashedPassword(chosen.password) ? chosen.password : hashPassword(pass);
    const healed = { ...chosen, email: normalized, password: durable };
    if (!hit || String(hit.password || '') !== durable) {
      const next = mergeAdminsLive(liveAdmins, [healed]);
      await io.write('lumo/auth', { admins: next, admin: null }).catch(() => false);
    }
    return loginResultFor(healed, normalized);
  }

  if (!chosen) return { ok: false, error: 'not_registered' };
  if (!String(chosen.password || '')) {
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

export function resetStamp(admin) {
  const stamp = Date.parse(admin?.passwordResetAt || '');
  return Number.isFinite(stamp) ? stamp : 0;
}

/** Keep a stored password unless the incoming row was reset later. */
export function choosePassword(prev, incoming) {
  const prevPass = String(prev?.password || '');
  const nextPass = String(incoming?.password || '');
  if (!nextPass) return prevPass;
  if (!prevPass) return nextPass;
  if (resetStamp(incoming) > resetStamp(prev)) return nextPass;
  return prevPass;
}

export function keepNewerPassword(prev, incoming, merged) {
  merged.password = choosePassword(prev, incoming);
  if (resetStamp(incoming) > resetStamp(prev)) {
    if (incoming?.passwordResetAt) merged.passwordResetAt = incoming.passwordResetAt;
    if (incoming?.passwordResetBy) merged.passwordResetBy = incoming.passwordResetBy;
  } else {
    if (prev?.passwordResetAt) merged.passwordResetAt = prev.passwordResetAt;
    if (prev?.passwordResetBy) merged.passwordResetBy = prev.passwordResetBy;
  }
  return merged;
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
    for (const [k, v] of Object.entries(prev)) {
      const nextVal = item[k];
      if ((nextVal === '' || nextVal == null) && v !== '' && v != null) {
        merged[k] = v;
      }
    }
    keepNewerPassword(prev, item, merged);
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
