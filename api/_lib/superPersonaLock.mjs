/**
 * Super Admin phone branding is locked to Unlimited bull.
 * Mentors must not assign foreign keys / robot names onto mukundimukhuba8@gmail.com.
 */

export const SUPER_ADMIN_EMAIL = 'mukundimukhuba8@gmail.com';
export const SUPER_ADMIN_ID = 'LM-004821';
export const SUPER_EA_ID = 'ea-1784470635215';
export const SUPER_EA_NAME = 'Unlimited bull';
export const SUPER_LICENSE_KEY = 'LUMO-CY9T-E4XT-NUFZ';
export const SUPER_IMAGE = '/api/images/profile-LM-004821';

export function normalizeEmail(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

export function isSuperAdminEmail(email) {
  return normalizeEmail(email) === SUPER_ADMIN_EMAIL;
}

function foldName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

export function isSuperOwnedLicense(entry) {
  if (!entry || typeof entry !== 'object') return false;
  const owner = String(entry.ownerAdminId || entry.adminId || '').trim();
  return owner === SUPER_ADMIN_ID;
}

/** True when a license/session bot is trying to paint Super Admin as another mentor. */
export function isForeignSuperBranding(botOrLicense) {
  if (!botOrLicense || typeof botOrLicense !== 'object') return false;
  const owner = String(botOrLicense.ownerAdminId || botOrLicense.adminId || '').trim();
  if (owner && owner !== SUPER_ADMIN_ID) return true;
  const img = String(botOrLicense.imageUrl || botOrLicense.eaImage || '');
  if (/LM-\d+/i.test(img) && !img.includes(SUPER_ADMIN_ID)) return true;
  const name = foldName(botOrLicense.displayName || botOrLicense.name || botOrLicense.eaName);
  if (name && name !== foldName(SUPER_EA_NAME) && name !== 'unlimitedbullv1') {
    // Person-based R350 names under Super Admin are OK only when owner is Super.
    // Foreign mentor names (Alpha x Bot etc.) are blocked when image/owner points elsewhere
    // or when license key is not the locked Super key and owner is foreign.
    if (owner && owner !== SUPER_ADMIN_ID) return true;
    if (/LM-\d+/i.test(img) && !img.includes(SUPER_ADMIN_ID)) return true;
  }
  return false;
}

export function lockedSuperBot(prevBot = null) {
  const prev = prevBot && typeof prevBot === 'object' ? prevBot : {};
  return {
    ...prev,
    name: SUPER_EA_NAME,
    displayName: SUPER_EA_NAME,
    licenseKey: SUPER_LICENSE_KEY,
    status: prev.status || 'active',
    symbols: Array.isArray(prev.symbols) && prev.symbols.length ? prev.symbols : ['XAUUSD'],
    imageUrl: SUPER_IMAGE,
    eaImage: SUPER_IMAGE,
    mainText: prev.mainText || '',
    ownerAdminId: SUPER_ADMIN_ID,
    eaId: SUPER_EA_ID,
    customMedia: [
      {
        slot: 'bg-1',
        kind: 'image',
        url: '/api/images/LM-004821-bg-1',
        updatedAt: new Date().toISOString(),
      },
    ],
  };
}

export function lockSuperAdminSession(session) {
  const base = session && typeof session === 'object' ? { ...session } : {};
  const user =
    base.user && typeof base.user === 'object'
      ? { ...base.user }
      : { email: SUPER_ADMIN_EMAIL };
  user.email = SUPER_ADMIN_EMAIL;
  user.id = SUPER_ADMIN_ID;
  user.role = 'super';
  if (!user.fullName) user.fullName = 'Mukundi';
  return {
    ...base,
    user,
    accessStatus: 'licensed',
    requiresRepayment: false,
    bot: lockedSuperBot(base.bot),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Sanitize a session PUT body for Super Admin.
 * Foreign mentor keys/names are discarded; Unlimited bull is forced.
 */
export function sanitizeSuperSessionPut(email, body) {
  if (!isSuperAdminEmail(email)) return { blocked: false, body };
  const incoming = body && typeof body === 'object' ? { ...body } : {};
  const bot = incoming.bot && typeof incoming.bot === 'object' ? incoming.bot : {};
  const key = String(bot.licenseKey || '').trim().toUpperCase();
  const foreignKey = key && key !== SUPER_LICENSE_KEY && isForeignSuperBranding(bot);
  const foreignName = isForeignSuperBranding(bot);
  const locked = lockSuperAdminSession({
    ...incoming,
    bot,
    user: incoming.user,
  });
  return {
    blocked: Boolean(foreignKey || foreignName || (key && key !== SUPER_LICENSE_KEY)),
    reason: 'Super Admin EA is locked to Unlimited bull',
    body: locked,
  };
}

/** Mentors cannot bind any license to the Super Admin email. */
export function blocksAssignToSuperAdmin(email, entry) {
  if (!isSuperAdminEmail(email)) return false;
  // Super Admin may only keep keys they themselves own.
  return !isSuperOwnedLicense(entry);
}
