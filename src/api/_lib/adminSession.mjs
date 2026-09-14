import { createHash, randomBytes } from 'node:crypto';
import { firebaseRead, firebaseWrite, normalizeAdminRole } from './clientMerge.mjs';

export const SESSION_HEADER = 'x-lumo-session';
export const ADMIN_ID_HEADER = 'x-lumo-admin-id';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Same Super Admin identity the portal uses for local SHA-256 login. */
export const SUPER_LOGIN = {
  email: 'mukundimukhuba8@gmail.com',
  passwordSha256: '18026064be7ec28f428f49e9c93cc0c1f86d3883f11189805f592298467663c9',
  user: {
    id: 'LM-004821',
    email: 'mukundimukhuba8@gmail.com',
    fullName: 'Mukundi',
    role: 'super',
  },
};

export function sha256Hex(value) {
  return createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

export function corsAllowHeaders() {
  return 'Content-Type, Authorization, x-lumo-session, x-lumo-admin-id';
}

export function readBearerToken(req) {
  const headers = req?.headers || {};
  const named = String(headers[SESSION_HEADER] || headers['X-Lumo-Session'] || '').trim();
  if (named) return named;
  const auth = String(headers.authorization || headers.Authorization || '').trim();
  if (/^bearer\s+/i.test(auth)) return auth.replace(/^bearer\s+/i, '').trim();
  return '';
}

export function tokenPath(token) {
  const safe = String(token || '').replace(/[^a-zA-Z0-9_-]/g, '');
  return safe ? `lumo/adminSessions/${safe}` : '';
}

export async function mintAdminSession(admin, io = { read: firebaseRead, write: firebaseWrite }) {
  const adminId = String(admin?.id || '').trim();
  const role = normalizeAdminRole(admin?.role);
  if (!adminId || (role !== 'admin' && role !== 'super')) return null;
  const token = randomBytes(24).toString('hex');
  const now = Date.now();
  const record = {
    adminId,
    role,
    email: String(admin?.email || '').trim().toLowerCase(),
    createdAt: new Date(now).toISOString(),
    exp: now + SESSION_TTL_MS,
  };
  const path = tokenPath(token);
  const ok = await io.write(path, record);
  if (!ok) return null;
  return { token, ...record };
}

export async function verifyAdminSession(req, io = { read: firebaseRead, write: firebaseWrite }) {
  const token = readBearerToken(req);
  if (!token) return { ok: false, error: 'unauthorized' };
  const path = tokenPath(token);
  if (!path) return { ok: false, error: 'unauthorized' };
  const row = await io.read(path);
  if (!row || typeof row !== 'object') return { ok: false, error: 'unauthorized' };
  const exp = Number(row.exp || 0);
  if (exp && exp < Date.now()) {
    try {
      await io.write(path, null);
    } catch {
      /* ignore */
    }
    return { ok: false, error: 'expired' };
  }
  const role = normalizeAdminRole(row.role);
  if (role !== 'admin' && role !== 'super') return { ok: false, error: 'unauthorized' };
  return {
    ok: true,
    adminId: String(row.adminId || '').trim(),
    role,
    email: String(row.email || '').trim().toLowerCase(),
    token,
  };
}

export function requireSuper(session) {
  return Boolean(session?.ok && session.role === 'super');
}

export function matchSuperPassword(email, password) {
  const normalized = String(email || '')
    .trim()
    .toLowerCase();
  if (normalized !== SUPER_LOGIN.email) return false;
  return sha256Hex(password) === SUPER_LOGIN.passwordSha256;
}
