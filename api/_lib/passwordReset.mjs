import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { firebaseRead, firebaseWrite, findAdminByEmail, passwordsMatch, hashPassword, mergeAdminsLive } from './clientMerge.mjs';
import { isValidEmail } from './email/send.mjs';
import { supabaseConfig } from './supabase.mjs';
import { loadRecoveryDb, loadResetStore, mergeRecoveryPatch, updateResetStore } from './phoneRecover.mjs';
import { saveMentor } from './mentorVault.mjs';

export const RESET_TTL_MS = 3 * 60 * 60 * 1000;
export const RESET_REQUEST_WINDOW_MS = 60 * 60 * 1000;
export const RESET_MAX_PER_EMAIL = 5;

export function emailQuotaReached(error) {
  return /quota|credit|daily limit|too many emails|emails are finished/i.test(String(error || ''));
}
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

function accountsOf(opts) {
  return opts.accounts || null;
}

/** One private read for the mentor roster, reset codes, and send limits. */
async function privateBundle(opts) {
  if (opts.accounts || !supabaseConfig().secretKey) return null;
  const db = await loadRecoveryDb();
  if (!db) return { failed: true, admins: [], resets: {}, limits: {} };
  return {
    failed: false,
    admins: toArray(db.auth?.admins),
    resets: asMap(db.passwordResets),
    limits: asMap(db.passwordResetLimits),
    async save(patch) {
      return Boolean(await mergeRecoveryPatch(patch));
    },
  };
}

async function durableAdmins(io, accounts, extraAdmins = [], bundle = null) {
  const curAuth = (await io.read('lumo/auth')) || { admins: [] };
  let saved = bundle?.admins || [];
  if (accounts?.list) {
    try {
      saved = toArray(await accounts.list());
    } catch {
      saved = [];
    }
  }
  return mergeAdminsLive(mergeAdminsLive(toArray(curAuth.admins), saved), toArray(extraAdmins));
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

export function normalizeResetCode(code) {
  return String(code || '').replace(/\D/g, '');
}

export function hashResetCode(code) {
  return sha256Hex(normalizeResetCode(code));
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
  if (!normalized) return { ok: false, error: 'not_registered' };
  const accounts = await accountsOf(opts);
  const bundle = await privateBundle(opts);
  if (bundle?.failed) return { ok: false, error: 'send_failed' };
  const limitId = normalized.replace(/[^a-z0-9]/g, '_');

  const admins = await durableAdmins(io, accounts, opts.extraAdmins, bundle);
  const hit = findAdminByEmail(admins, normalized);
  if (!hit) return { ok: false, error: 'not_registered' };

  const ioBucket = (await io.read(`lumo/passwordResetLimits/${limitId}`)) || { requests: [] };
  let privateBucket = bundle?.limits?.[limitId] || { requests: [] };
  let sideStore = null;
  if (!accounts && bundle) {
    try {
      sideStore = await loadResetStore();
    } catch {
      sideStore = null;
    }
  }
  if (accounts?.listLimit) {
    try {
      privateBucket = (await accounts.listLimit(limitId)) || { requests: [] };
    } catch {
      privateBucket = { requests: [] };
    }
  }
  const sideBucket = sideStore?.passwordResetLimits?.[limitId] || { requests: [] };
  const seenAt = new Set();
  const requests = [
    ...toArray(ioBucket.requests),
    ...toArray(privateBucket.requests),
    ...toArray(sideBucket.requests),
  ].filter((row) => {
    const at = Number(row.at || 0);
    if (!at || now - at >= RESET_REQUEST_WINDOW_MS || seenAt.has(at)) return false;
    seenAt.add(at);
    return true;
  });
  if (recentCount(requests, now, RESET_REQUEST_WINDOW_MS) >= RESET_MAX_PER_EMAIL) {
    return { ok: false, error: 'rate_limited' };
  }

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
  const all = {
    ...(await readResetMap(io, accounts)),
    ...(bundle?.resets || {}),
    ...(sideStore?.passwordResets || {}),
    [requestId]: record,
  };
  let privateOk = false;
  if (accounts?.saveReset) {
    try {
      privateOk = Boolean(await accounts.saveReset(requestId, record));
    } catch {
      privateOk = false;
    }
  } else if (bundle) {
    try {
      const saved = await updateResetStore((store) => {
        store.passwordResets[requestId] = record;
        return store;
      });
      privateOk = Boolean(saved?.passwordResets?.[requestId]);
    } catch {
      privateOk = false;
    }
    if (!privateOk && bundle.save) {
      try {
        privateOk = Boolean(await bundle.save({ passwordResets: { [requestId]: record } }));
      } catch {
        privateOk = false;
      }
    }
  }
  const ioOk = accounts || bundle ? false : await writeIo(io, 'lumo/passwordResets', all);
  const durable = accounts || bundle ? privateOk : ioOk;
  if (!durable) return { ok: false, error: 'send_failed' };
  if (typeof notify === 'function') {
    try {
      const sent = await notify({
        email: normalized,
        resetCode: code,
        userId: hit.id,
        firstName: hit.fullName || hit.firstName,
        fullName: hit.fullName,
        requestId,
      });
      if (sent && sent.ok === false) {
        return { ok: false, error: emailQuotaReached(sent.error) ? 'email_quota' : 'send_failed' };
      }
    } catch {
      return { ok: false, error: 'send_failed' };
    }
  }
  const nextBucket = { requests: [...requests, { at: now }] };
  if (accounts?.saveLimit) {
    try {
      await accounts.saveLimit(limitId, nextBucket);
    } catch {
      /* the code was already emailed */
    }
  } else if (bundle) {
    try {
      await updateResetStore((store) => {
        store.passwordResetLimits[limitId] = nextBucket;
        return store;
      });
    } catch {
      /* the code was already emailed */
    }
  } else {
    await writeIo(io, `lumo/passwordResetLimits/${limitId}`, nextBucket);
  }
  return GENERIC_OK;
}

export async function completePasswordReset({ email, code, password, confirm }, opts = {}) {
  const io = opts.io || { read: firebaseRead, write: firebaseWrite };
  const now = opts.now || Date.now();
  const normalized = isValidEmail(email);
  const incoming = normalizeResetCode(code);
  const nextPassword = String(password || '');
  const confirmPassword = String(confirm || nextPassword);
  if (!normalized || incoming.length !== 6) {
    return { ok: false, error: 'invalid_code' };
  }
  if (nextPassword.length < 8) return { ok: false, error: 'password_too_short' };
  if (nextPassword !== confirmPassword) return { ok: false, error: 'password_mismatch' };

  const accounts = await accountsOf(opts);
  const bundle = await privateBundle(opts);
  if (bundle?.failed) return { ok: false, error: 'save_failed' };
  let sideStore = null;
  if (!accounts && bundle) {
    try {
      sideStore = await loadResetStore();
    } catch {
      sideStore = null;
    }
    if (sideStore === null) return { ok: false, error: 'save_failed' };
  }
  const all = {
    ...(await readResetMap(io, accounts)),
    ...(bundle?.resets || {}),
    ...(sideStore?.passwordResets || {}),
  };
  const entries = Object.entries(all || {}).filter(([, row]) => row && typeof row === 'object');
  const forEmail = (row) => String(row.email || '').toLowerCase() === normalized;
  const sameCode = entries.filter(
    ([, row]) => forEmail(row) && resetCodesMatch(row.codeHash, incoming),
  );
  const match = sameCode.find(
    ([, row]) => !row.usedAt && Number(row.expiresAt || 0) > now,
  );
  if (!match) {
    if (sameCode.some(([, row]) => row.usedAt)) return { ok: false, error: 'code_used' };
    if (sameCode.some(([, row]) => Number(row.expiresAt || 0) <= now)) {
      return { ok: false, error: 'expired' };
    }
    return { ok: false, error: 'invalid_code' };
  }

  const [requestId, row] = match;
  const admins = await durableAdmins(io, accounts, opts.extraAdmins, bundle);
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
  if (!hit) return { ok: false, error: 'invalid_code' };
  const used = { ...row, usedAt: new Date(now).toISOString() };
  let privateOk = false;
  if (accounts?.save) {
    try {
      privateOk = Boolean(await accounts.save(hit));
    } catch {
      privateOk = false;
    }
  } else if (bundle?.save) {
    try {
      privateOk = Boolean(await bundle.save({ auth: { admins: [hit] } }));
    } catch {
      privateOk = false;
    }
  }
  const ioOk = await writeIo(io, 'lumo/auth', { admins: next, admin: null });
  if ((accounts || bundle) ? !privateOk : !ioOk) {
    return { ok: false, error: 'save_failed' };
  }
  if (accounts?.saveReset) {
    try {
      await accounts.saveReset(requestId, used);
    } catch {
      /* password is already stored; a second submit says the code was used once this write lands */
    }
  } else if (bundle) {
    try {
      await updateResetStore((store) => {
        if (store.passwordResets[requestId] || !bundle?.resets?.[requestId]) {
          store.passwordResets[requestId] = used;
        }
        return store;
      });
    } catch {
      /* password is already stored */
    }
    if (bundle?.resets?.[requestId] && bundle.save) {
      try {
        await bundle.save({ passwordResets: { [requestId]: used } });
      } catch {
        /* legacy copy in the main database */
      }
    }
  } else {
    await writeIo(io, 'lumo/passwordResets', { ...all, [requestId]: used });
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
  try {
    await saveMentor({ ...hit, portalPassword: nextPassword });
  } catch {
    /* the hash is already stored */
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
