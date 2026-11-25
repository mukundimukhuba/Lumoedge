import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
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
  // Signed tokens: payload.sig — store under a short fingerprint, not the whole token.
  const raw = String(token || '').trim();
  if (raw.includes('.')) {
    const fp = createHash('sha256').update(raw).digest('hex').slice(0, 40);
    return `lumo/adminSessions/${fp}`;
  }
  const safe = raw.replace(/[^a-zA-Z0-9_-]/g, '');
  return safe ? `lumo/adminSessions/${safe}` : '';
}

function sessionSecret() {
  return (
    String(process.env.SESSION_HMAC_SECRET || '').trim() ||
    String(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim() ||
    ''
  );
}

function b64url(value) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function fromB64url(value) {
  return Buffer.from(String(value || ''), 'base64url').toString('utf8');
}

function signPayload(payloadB64) {
  const secret = sessionSecret();
  if (!secret) return '';
  return createHmac('sha256', secret).update(payloadB64).digest('base64url');
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (left.length !== right.length) return false;
  try {
    return timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

function parseSignedToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;
  const expected = signPayload(payloadB64);
  if (!expected || !safeEqual(sig, expected)) return null;
  try {
    const row = JSON.parse(fromB64url(payloadB64));
    if (!row || typeof row !== 'object') return null;
    return row;
  } catch {
    return null;
  }
}

/**
 * Mint a signed session token instantly (no storage round-trip on the hot path).
 * Optionally mirrors to admin-sessions.json in the background for revoke/audit.
 */
export async function mintAdminSession(admin, io = { read: firebaseRead, write: firebaseWrite }) {
  const adminId = String(admin?.id || '').trim();
  const role = normalizeAdminRole(admin?.role);
  if (!adminId || (role !== 'admin' && role !== 'super')) return null;
  const secret = sessionSecret();
  if (!secret) return null;

  const now = Date.now();
  const record = {
    adminId,
    role,
    email: String(admin?.email || '').trim().toLowerCase(),
    createdAt: new Date(now).toISOString(),
    exp: now + SESSION_TTL_MS,
    nonce: randomBytes(8).toString('hex'),
  };
  const payloadB64 = b64url(JSON.stringify(record));
  const sig = signPayload(payloadB64);
  if (!sig) return null;
  const token = `${payloadB64}.${sig}`;

  // Fire-and-forget durable mirror — never block login on JSON rewrite races.
  const path = tokenPath(token);
  void Promise.resolve()
    .then(() => io.write(path, { ...record, tokenFp: path.slice('lumo/adminSessions/'.length) }))
    .catch(() => undefined);

  return { token, ...record };
}

export async function verifyAdminSession(req, io = { read: firebaseRead, write: firebaseWrite }) {
  const token = readBearerToken(req);
  if (!token) return { ok: false, error: 'unauthorized' };

  // Fast path: HMAC-signed tokens (no storage read).
  const signed = parseSignedToken(token);
  if (signed) {
    const exp = Number(signed.exp || 0);
    if (exp && exp < Date.now()) return { ok: false, error: 'expired' };
    const role = normalizeAdminRole(signed.role);
    if (role !== 'admin' && role !== 'super') return { ok: false, error: 'unauthorized' };
    return {
      ok: true,
      adminId: String(signed.adminId || '').trim(),
      role,
      email: String(signed.email || '').trim().toLowerCase(),
      token,
    };
  }

  // Legacy random hex tokens stored in admin-sessions.json
  const path = tokenPath(token);
  if (!path) return { ok: false, error: 'unauthorized' };
  const row = await io.read(path);
  if (row && row.__offline) return { ok: false, error: 'unavailable', offline: true };
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

/** Portal Super Admin header when the session token failed to mint. */
export function readSuperAdminIdHeader(req) {
  const headers = req?.headers || {};
  return String(headers[ADMIN_ID_HEADER] || headers['X-Lumo-Admin-Id'] || '').trim();
}

/**
 * Super Admin authorization. Prefer a minted session.
 * Raw x-lumo-admin-id alone is only allowed when durable session storage is
 * not configured (local/dev). In production this must not grant privilege.
 */
export function isPortalSuperAdminRequest(req, session) {
  if (requireSuper(session)) return true;
  const hasDurableSessions = Boolean(
    String(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim(),
  );
  if (hasDurableSessions) return false;
  return readSuperAdminIdHeader(req) === SUPER_LOGIN.user.id;
}

export function matchSuperPassword(email, password) {
  const normalized = String(email || '')
    .trim()
    .toLowerCase();
  if (normalized !== SUPER_LOGIN.email) return false;
  return sha256Hex(password) === SUPER_LOGIN.passwordSha256;
}
