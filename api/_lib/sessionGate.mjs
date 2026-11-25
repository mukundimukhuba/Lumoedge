import { normalizeRegistrationEmail } from './registrationEmail.mjs';
import { isSpoofedVerify } from './kickUnpaid.mjs';

const SUPER_KEEP = new Set([
  'mukundimukhuba8@gmail.com',
  'mukundimukhuba8@icloud.com',
]);

export function isPrivilegedAccessStatus(value) {
  const status = String(value || '')
    .trim()
    .toLowerCase();
  return status === 'licensed' || status === 'paid' || status === 'approved';
}

export function sessionLooksLicensed(session) {
  if (!session || typeof session !== 'object') return false;
  if (isPrivilegedAccessStatus(session.accessStatus)) return true;
  const key = String(session?.bot?.licenseKey || '').trim();
  return Boolean(key);
}

/** True when this email has a real payment mark (not sync-spoof). */
export function rowIsPaid(row) {
  if (!row || row.paymentVerified !== true) return false;
  if (isSpoofedVerify(row)) return false;
  return true;
}

export async function loadPaymentRow(email) {
  const key = normalizeRegistrationEmail(email);
  if (!key.includes('@')) return null;
  if (SUPER_KEEP.has(key)) {
    return {
      email: key,
      paymentVerified: true,
      paymentVerifiedSource: 'super',
      status: 'approved',
    };
  }
  let row = null;
  try {
    const { getSubscription } = await import('./subscriptionVault.mjs');
    row = await getSubscription(key).catch(() => null);
  } catch {
    row = null;
  }
  try {
    const { listPrivateClients, findSubscription } = await import('./supabaseRoster.mjs');
    const saved = await listPrivateClients();
    const priv = findSubscription(saved, key);
    if (priv?.paymentVerified === true && row?.paymentVerified !== true) row = priv;
    else if (!row && priv) row = priv;
  } catch {
    /* keep vault */
  }
  if (!rowIsPaid(row)) {
    try {
      const { getOfflineRosterClient } = await import('./offlineRoster.mjs');
      const hit = getOfflineRosterClient(key);
      if (hit?.paymentVerified === true) row = { ...(row || {}), ...hit, paymentVerified: true };
    } catch {
      /* ignore */
    }
  }
  return row;
}

export function demoteUnpaidSession(session, email) {
  const prev = session && typeof session === 'object' ? session : {};
  const bot = prev.bot && typeof prev.bot === 'object' ? prev.bot : {};
  return {
    ...prev,
    email: normalizeRegistrationEmail(email) || prev.email,
    accessStatus: 'pending',
    requiresRepayment: true,
    bot: {
      ...bot,
      licenseKey: '',
      status: 'paused',
    },
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Strip freeload unlocks from a phone-session PUT body when payment is not verified.
 */
export function sanitizeSessionPutBody(body, email, paid) {
  const next = body && typeof body === 'object' ? { ...body } : {};
  if (paid) {
    if (next.requiresRepayment) next.requiresRepayment = false;
    return next;
  }
  const bot = next.bot && typeof next.bot === 'object' ? { ...next.bot } : {};
  bot.licenseKey = '';
  if (bot.status === 'active') bot.status = 'paused';
  next.bot = bot;
  if (isPrivilegedAccessStatus(next.accessStatus)) next.accessStatus = 'pending';
  next.requiresRepayment = true;
  next.email = normalizeRegistrationEmail(email) || next.email;
  return next;
}
