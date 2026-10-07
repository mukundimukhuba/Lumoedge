import { randomBytes } from 'node:crypto';
import { SUPER_LOGIN, verifyAdminSession, isPortalSuperAdminRequest } from './adminSession.mjs';
import { firebaseRead, firebaseWrite, hashPassword, publicAdminRecord } from './clientMerge.mjs';
import { savePrivateMentor, listPrivateAdmins } from './supabaseRoster.mjs';
import { listMentors, saveMentor } from './mentorVault.mjs';

const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.values(value);
  return [];
}

export function generateMentorPassword() {
  const bytes = randomBytes(8);
  const chars = [...bytes].map((b) => PASSWORD_ALPHABET[b % PASSWORD_ALPHABET.length]);
  return `LE-${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`;
}

export function matchAdminRow(admin, idOrEmail) {
  const key = String(idOrEmail || '').trim();
  if (!key) return false;
  const lower = key.toLowerCase();
  return (
    String(admin?.id || '').trim() === key ||
    String(admin?.email || '').trim().toLowerCase() === lower
  );
}

export function isProtectedSuperAdmin(admin) {
  const id = String(admin?.id || '').trim();
  const email = String(admin?.email || '')
    .trim()
    .toLowerCase();
  return id === SUPER_LOGIN.user.id || email === SUPER_LOGIN.email;
}

export function applyMentorPassword(admins, idOrEmail, password, meta = {}) {
  let hit = null;
  const next = toArray(admins).map((row) => {
    if (!matchAdminRow(row, idOrEmail)) return row;
    hit = {
      ...row,
      password: hashPassword(password),
      passwordResetAt: meta.resetAt || new Date().toISOString(),
      passwordResetBy: meta.actorId || '',
    };
    return hit;
  });
  return { admins: next, hit };
}

export async function resetMentorPassword(idOrEmail, opts = {}) {
  const id = String(idOrEmail || '').trim();
  const password = String(opts.password || '').trim() || generateMentorPassword();
  const io = opts.io || { read: firebaseRead, write: firebaseWrite };
  const actorId = String(opts.actorId || '').trim();
  const resetAt = opts.resetAt || new Date().toISOString();
  if (!id) return { ok: false, error: 'mentor_required' };
  if (password.length < 8) return { ok: false, error: 'password_too_short' };

  const curAuth = (await io.read('lumo/auth')) || { admins: [], admin: null };
  let roster = toArray(curAuth.admins);
  if (!opts.roster) {
    try {
      roster = [...roster, ...(await listPrivateAdmins()), ...(await listMentors())];
    } catch {
      /* firebase row is still enough when the private read fails */
    }
  } else {
    roster = [...roster, ...toArray(opts.roster)];
  }
  const applied = applyMentorPassword(roster, id, password, {
    actorId,
    resetAt,
  });
  if (!applied.hit) return { ok: false, error: 'not_found' };
  if (isProtectedSuperAdmin(applied.hit)) return { ok: false, error: 'protected_super' };

  let authOk = false;
  try {
    authOk = Boolean(await io.write('lumo/auth', { admins: applied.admins, admin: null }));
  } catch {
    authOk = false;
  }
  let privateOk = false;
  const savePrivate = opts.savePrivate || savePrivateMentor;
  const stored = { ...applied.hit };
  delete stored.portalPassword;
  try {
    privateOk = Boolean(await savePrivate(stored));
  } catch {
    privateOk = false;
  }
  let vaultOk = false;
  try {
    vaultOk = Boolean(await saveMentor({ ...stored, portalPassword: password }));
  } catch {
    vaultOk = false;
  }
  if (!authOk && !privateOk && !vaultOk) return { ok: false, error: 'write_failed' };
  try {
    await io.write('lumo/updatedAt', resetAt);
  } catch {
    /* timestamp is best-effort */
  }

  return {
    ok: true,
    password,
    admin: publicAdminRecord(applied.hit),
    email: String(applied.hit.email || '').trim().toLowerCase(),
    mentorId: String(applied.hit.id || '').trim(),
  };
}

export function parseResetPasswordPath(pathname) {
  const path = String(pathname || '').replace(/\/+$/, '') || '/';
  const match = path.match(/^\/api\/auth\/admins\/(.+)\/reset-password$/);
  if (!match) return '';
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

export async function handleMentorPasswordRoutes(req, res, ctx) {
  const {
    json,
    pathname,
    verifySession = verifyAdminSession,
    resetPassword = resetMentorPassword,
  } = ctx || {};
  const path = String(pathname || '').replace(/\/+$/, '') || '/';
  if (path === '/api/auth/mentor-passwords' && req.method === 'GET') {
    const session = await verifySession(req);
    if (!isPortalSuperAdminRequest(req, session)) {
      json(res, session?.ok ? 403 : 401, {
        ok: false,
        error: session?.ok ? 'Access denied' : session?.error || 'unauthorized',
      });
      return true;
    }
    const mentors = await listMentors();
    json(res, 200, {
      ok: true,
      mentors: mentors.map((row) => ({
        id: String(row?.id || ''),
        email: String(row?.email || '').trim().toLowerCase(),
        fullName: String(row?.fullName || ''),
        role: String(row?.role || 'pending'),
        portalPassword: String(row?.portalPassword || ''),
      })),
    });
    return true;
  }
  const id = parseResetPasswordPath(pathname);
  if (!id || req.method !== 'POST') return false;

  const session = await verifySession(req);
  if (!isPortalSuperAdminRequest(req, session)) {
    json(res, session?.ok ? 403 : 401, {
      ok: false,
      error: session?.ok ? 'Access denied' : session?.error || 'unauthorized',
    });
    return true;
  }

  const result = await resetPassword(id, {
    actorId: session?.adminId || SUPER_LOGIN.user.id,
  });
  if (!result.ok) {
    const status =
      result.error === 'not_found'
        ? 404
        : result.error === 'protected_super'
          ? 400
          : result.error === 'write_failed'
            ? 502
            : 400;
    json(res, status, { ok: false, error: result.error });
    return true;
  }

  json(res, 200, {
    ok: true,
    password: result.password,
    email: result.email,
    mentorId: result.mentorId,
    admin: result.admin,
  });
  return true;
}
