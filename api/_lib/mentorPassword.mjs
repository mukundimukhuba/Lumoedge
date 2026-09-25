import { randomBytes } from 'node:crypto';
import { requireSuper, SUPER_LOGIN, verifyAdminSession } from './adminSession.mjs';
import { firebaseRead, firebaseWrite, hashPassword, publicAdminRecord } from './clientMerge.mjs';

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
  const applied = applyMentorPassword(toArray(curAuth.admins), id, password, {
    actorId,
    resetAt,
  });
  if (!applied.hit) return { ok: false, error: 'not_found' };
  if (isProtectedSuperAdmin(applied.hit)) return { ok: false, error: 'protected_super' };

  const authOk = await io.write('lumo/auth', { admins: applied.admins, admin: null });
  if (!authOk) return { ok: false, error: 'write_failed' };
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
  const id = parseResetPasswordPath(pathname);
  if (!id || req.method !== 'POST') return false;

  const session = await verifySession(req);
  if (!session?.ok) {
    json(res, 401, { ok: false, error: session?.error || 'unauthorized' });
    return true;
  }
  if (!requireSuper(session)) {
    json(res, 403, { ok: false, error: 'Access denied' });
    return true;
  }

  const result = await resetPassword(id, { actorId: session.adminId });
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
