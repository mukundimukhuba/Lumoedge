import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { firebaseRead, firebaseWrite, findAdminByEmail, passwordsMatch, hashPassword, mergeAdminsLive } from './clientMerge.mjs';
import { isValidEmail } from './email/send.mjs';
import { supabaseConfig } from './supabase.mjs';
import {
  listPrivateAdmins,
  listPrivateResetLimit,
  listPrivateResets,
  savePrivateMentor,
  savePrivateReset,
  savePrivateResetLimit,
} from './supabaseRoster.mjs';

export const RESET_TTL_MS = 15 * 60 * 1000;
export const RESET_REQUEST_WINDOW_MS = 60 * 60 * 1000;
export const RESET_MAX_PER_EMAIL = 5;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_MAX_ATTEMPTS = 8;
const GENERIC_OK = {
  ok: true,
  message: 'If that email is registered with Lumo Edge, a reset code has been sent.',
};

function sha256Hex(value) {
  return createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
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

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.values(value);
  return [];
}

function asMap(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

async function accountsOf(opts) {
  if (opts.accounts) return opts.accounts;
  if (!supabaseConfig().secretKey) return null;
  return {
    async list() {
      return listPrivateAdmins();
    },
    async save(admin) {
      return savePrivateMentor(admin);
    },
    async listResets() {
      return listPrivateResets();
    },
    async saveReset(id, row) {
      return savePrivateReset(id, row);
    },
    async listLimit(id) {
      return listPrivateResetLimit(id);
    },
    async saveLimit(id, bucket) {
      return savePrivateResetLimit(id, bucket);
    },
  };
}

async function durableAdmins(io, accounts) {
  const curAuth = (await io.read('lumo/auth')) || { admins: [] };
  let saved = [];
  if (accounts?.list) {
    try {
      saved = toArray(await accounts.list());
    } catch {
      saved = [];
    }
  }
  return mergeAdminsLive(toArray(curAuth.admins), saved);
}

async function readResetMap(io, accounts) {
  const fromIo = asMap(await io.read('lumo/passwordResets'));
  let fromPrivate = {};
  if (accounts?.listResets) {
    try {
      fromPrivate = asMap(await accounts.listResets());
    } catch {
      fromPrivate = {};
    }
  }
  return { ...fromIo, ...fromPrivate };
}

async function writeIo(io, path, value) {
  try {
    return Boolean(await io.write(path, value));
  } catch {
    return false;
  }
}

export function generateResetCode() {
  const n = randomBytes(4).readUInt32BE(0) % 1_000_000;
  return String(n).padStart(6, '0');
}

export function hashResetCode(code) {
  return sha256Hex(String(code || '').trim());
}

export function resetCodesMatch(storedHash, incomingCode) {
  return safeEqual(storedHash, hashResetCode(incomingCode));
}

function readIp(req) {
  const headers = req?.headers || {};
  const forwarded = String(headers['x-forwarded-for'] || '')
    .split(',')[0]
    .trim();
  return forwarded || String(headers['x-real-ip'] || req?.socket?.remoteAddress || '').trim();
}

function recentCount(rows, now, windowMs) {
  return rows.filter((row) => now - Number(row.at || 0) < windowMs).length;
}

export async function requestPasswordReset(email, opts = {}) {
  const io = opts.io || { read: firebaseRead, write: firebaseWrite };
  const now = opts.now || Date.now();
  const notify = opts.notify;
  const normalized = isValidEmail(email);
  if (!normalized) return GENERIC_OK;
  const accounts = await accountsOf(opts);
  const limitId = normalized.replace(/[^a-z0-9]/g, '_');

  const admins = await durableAdmins(io, accounts);
  const hit = findAdminByEmail(admins, normalized);
  const ioBucket = (await io.read(`lumo/passwordResetLimits/${limitId}`)) || { requests: [] };
  let privateBucket = { requests: [] };
  if (accounts?.listLimit) {
    try {
      privateBucket = (await accounts.listLimit(limitId)) || { requests: [] };
    } catch {
      privateBucket = { requests: [] };
    }
  }
  const requests = [...toArray(ioBucket.requests), ...toArray(privateBucket.requests)].filter(
    (row) => now - Number(row.at || 0) < RESET_REQUEST_WINDOW_MS,
  );
  if (recentCount(requests, now, RESET_REQUEST_WINDOW_MS) >= RESET_MAX_PER_EMAIL) {
    return GENERIC_OK;
  }
  requests.push({ at: now });
  const nextBucket = { requests };
  await writeIo(io, `lumo/passwordResetLimits/${limitId}`, nextBucket);
  if (accounts?.saveLimit) {
    try {
      await accounts.saveLimit(limitId, nextBucket);
    } catch {
      /* rate-limit storage must not block a reset */
    }
  }

  if (!hit) return GENERIC_OK;

  const code = opts.code || generateResetCode();
  const requestId = `rst-${now}-${randomBytes(4).toString('hex')}`;
  const record = {
    email: normalized,
    userId: String(hit.id || ''),
    codeHash: hashResetCode(code),
    expiresAt: now + RESET_TTL_MS,
    usedAt: '',
    createdAt: new Date(now).toISOString(),
  };
  const all = { ...(await readResetMap(io, accounts)), [requestId]: record };
  const ioOk = await writeIo(io, 'lumo/passwordResets', all);
  let privateOk = true;
  if (accounts?.saveReset) {
    try {
      privateOk = Boolean(await accounts.saveReset(requestId, record));
    } catch {
      privateOk = false;
    }
  }
  const durable = accounts ? privateOk : ioOk;
  if (durable && typeof notify === 'function') {
    try {
      await notify({
        email: normalized,
        resetCode: code,
        userId: hit.id,
        firstName: hit.fullName || hit.firstName,
        fullName: hit.fullName,
        requestId,
      });
    } catch {
      /* never reveal delivery failures */
    }
  }
  return GENERIC_OK;
}

export async function completePasswordReset({ email, code, password, confirm }, opts = {}) {
  const io = opts.io || { read: firebaseRead, write: firebaseWrite };
  const now = opts.now || Date.now();
  const normalized = isValidEmail(email);
  const incoming = String(code || '').trim();
  const nextPassword = String(password || '');
  const confirmPassword = String(confirm || nextPassword);
  if (!normalized || !incoming) {
    return { ok: false, error: 'invalid_or_expired_code' };
  }
  if (nextPassword.length < 8) return { ok: false, error: 'password_too_short' };
  if (nextPassword !== confirmPassword) return { ok: false, error: 'password_mismatch' };

  const accounts = await accountsOf(opts);
  const all = await readResetMap(io, accounts);
  const entries = Object.entries(all || {}).filter(([, row]) => row && typeof row === 'object');
  const match = entries.find(
    ([, row]) =>
      String(row.email || '').toLowerCase() === normalized &&
      !row.usedAt &&
      Number(row.expiresAt || 0) > now &&
      resetCodesMatch(row.codeHash, incoming),
  );
  if (!match) return { ok: false, error: 'invalid_or_expired_code' };

  const [requestId, row] = match;
  const admins = await durableAdmins(io, accounts);
  let hit = null;
  const next = admins.map((admin) => {
    if (String(admin?.email || '').trim().toLowerCase() !== normalized) return admin;
    hit = {
      ...admin,
      password: hashPassword(nextPassword),
      passwordResetAt: new Date(now).toISOString(),
      passwordResetBy: 'self-reset',
    };
    return hit;
  });
  if (!hit) return { ok: false, error: 'invalid_or_expired_code' };
  let privateOk = false;
  if (accounts?.save) {
    try {
      privateOk = Boolean(await accounts.save(hit));
    } catch {
      privateOk = false;
    }
  }
  const ioOk = await writeIo(io, 'lumo/auth', { admins: next, admin: null });
  if (accounts ? !privateOk : !ioOk) {
    return { ok: false, error: 'save_failed' };
  }
  const used = { ...row, usedAt: new Date(now).toISOString() };
  const nextResets = { ...all, [requestId]: used };
  await writeIo(io, 'lumo/passwordResets', nextResets);
  if (accounts?.saveReset) {
    try {
      await accounts.saveReset(requestId, used);
    } catch {
      /* the password is already stored; a reused code still has to match usedAt */
    }
  }
  try {
    await io.write(`lumo/audit/passwordResets/${requestId}`, {
      email: normalized,
      userId: hit.id || '',
      at: new Date(now).toISOString(),
      kind: 'password_reset',
    });
  } catch {
    /* audit is best-effort */
  }
  return { ok: true };
}

export function verifyResetPasswordInput(stored, incoming) {
  return passwordsMatch(stored, incoming);
}

function limitKey(email) {
  return String(email || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '_');
}

/** Count login attempts per email. Always returns a generic outcome. */
export async function consumeLoginAttempt(email, opts = {}) {
  const io = opts.io || { read: firebaseRead, write: firebaseWrite };
  const now = opts.now || Date.now();
  const normalized = isValidEmail(email);
  if (!normalized) return { limited: false };
  const path = `lumo/loginLimits/${limitKey(normalized)}`;
  const bucket = (await io.read(path)) || { attempts: [] };
  const attempts = toArray(bucket.attempts).filter((row) => now - Number(row.at || 0) < LOGIN_WINDOW_MS);
  const limited = attempts.length >= LOGIN_MAX_ATTEMPTS;
  attempts.push({ at: now });
  try {
    await io.write(path, { attempts });
  } catch {
    /* never block login on limiter storage */
  }
  return { limited };
}

export { readIp };
