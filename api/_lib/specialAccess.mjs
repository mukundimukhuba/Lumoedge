import { createHmac, timingSafeEqual } from 'node:crypto';
import { firebasePatchClientById, firebasePostClientEntry, firebaseRead, firebaseWrite } from './clientMerge.mjs';
import { dbList } from './licenseClaim.mjs';
import { isRegistrationEmail, normalizeRegistrationEmail, splitNameFromEmail } from './registrationEmail.mjs';
import { generateLicenseKey } from './websiteStore.mjs';

export const SPECIAL_PRICE_CENTS = 35000;
export const SPECIAL_ADMIN_ID = 'LM-004821';
export const SPECIAL_EA_ID = 'ea-1784470635215';
export const SPECIAL_EA_NAME = 'Unlimited bull';
export const SPECIAL_SOURCE = 'r350-special';

export function verifyPaystackSignature(rawBody, signature, secret) {
  const key = String(secret || '');
  const given = String(signature || '').trim().toLowerCase();
  if (!key || !given || !rawBody) return false;
  const digest = createHmac('sha512', key).update(rawBody).digest('hex');
  const left = Buffer.from(digest);
  const right = Buffer.from(given);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function paystackChargeGrantsSpecial(event) {
  if (!event || event.event !== 'charge.success') return { ok: false, reason: 'event' };
  const data = event.data && typeof event.data === 'object' ? event.data : {};
  if (String(data.status || '').toLowerCase() !== 'success') return { ok: false, reason: 'status' };
  if (String(data.currency || '').toUpperCase() !== 'ZAR') return { ok: false, reason: 'currency' };
  if (Number(data.amount) !== SPECIAL_PRICE_CENTS) return { ok: false, reason: 'amount' };
  const email = normalizeRegistrationEmail(data.customer?.email || data.metadata?.custom_fields?.email || data.metadata?.email);
  if (!isRegistrationEmail(email)) return { ok: false, reason: 'email' };
  const reference = String(data.reference || '').trim();
  if (!reference) return { ok: false, reason: 'reference' };
  const meta = data.metadata && typeof data.metadata === 'object' ? data.metadata : {};
  const firstName = String(data.customer?.first_name || meta.first_name || '').trim();
  const lastName = String(data.customer?.last_name || meta.last_name || '').trim();
  return { ok: true, email, firstName, lastName, reference };
}

export function accessPath(email) {
  return `lumo/specialAccess/${encodeURIComponent(normalizeRegistrationEmail(email))}`;
}

export function paymentPath(reference) {
  return `lumo/specialPayments/${encodeURIComponent(String(reference || '').trim())}`;
}

function namesFor(email, firstName, lastName) {
  const fallback = splitNameFromEmail(email);
  return {
    firstName: String(firstName || '').trim() || fallback.firstName,
    lastName: String(lastName || '').trim() || fallback.lastName,
  };
}

export function findSpecialLicense(vault, email) {
  const normalized = normalizeRegistrationEmail(email);
  return dbList(vault).find((entry) => {
    if (!entry || entry.status === 'deleted' || entry.source !== SPECIAL_SOURCE) return false;
    const bound = normalizeRegistrationEmail(entry.assignedEmail || entry.clientEmail || entry.email);
    return bound === normalized && entry.key;
  });
}

export function specialLicenseRecord({ email, firstName, lastName, key, now }) {
  const names = namesFor(email, firstName, lastName);
  const clientName = [names.firstName, names.lastName].filter(Boolean).join(' ').trim();
  return {
    id: `lic-special-${now.replace(/[^0-9]/g, '').slice(0, 14)}`,
    key,
    eaId: SPECIAL_EA_ID,
    eaName: SPECIAL_EA_NAME,
    eaImage: 'img:profile-LM-004821',
    mainText: '',
    symbols: ['XAUUSD'],
    ownerAdminId: SPECIAL_ADMIN_ID,
    adminId: SPECIAL_ADMIN_ID,
    clientName,
    clientEmail: email,
    email,
    duration: 'Included',
    status: 'assigned',
    assignedEmail: email,
    assignedAt: now,
    source: SPECIAL_SOURCE,
    createdAt: now,
  };
}

export function licenseView(entry) {
  return {
    key: entry.key,
    eaId: entry.eaId || SPECIAL_EA_ID,
    eaName: entry.eaName || SPECIAL_EA_NAME,
    eaImage: entry.eaImage || '',
    mainText: entry.mainText || '',
    symbols: Array.isArray(entry.symbols) && entry.symbols.length ? entry.symbols : ['XAUUSD'],
    duration: entry.duration || 'Included',
    clientEmail: entry.clientEmail || entry.email || '',
  };
}

/**
 * Issue one included license for a confirmed R350 payment.
 * A second payment for the same email reuses the same key.
 */
export async function grantSpecialAccess({ email, firstName, lastName, reference, deps }) {
  const normalized = normalizeRegistrationEmail(email);
  if (!isRegistrationEmail(normalized)) {
    return { ok: false, error: 'email' };
  }
  const io = deps || {};
  const read = io.read || firebaseRead;
  const write = io.write || firebaseWrite;
  const postClient = io.postClient || firebasePostClientEntry;
  const patchClient = io.patchClient || firebasePatchClientById;
  const makeKey = io.makeKey || generateLicenseKey;
  const now = io.now || new Date().toISOString();
  const names = namesFor(normalized, firstName, lastName);

  const existingAccess = await read(accessPath(normalized));
  let entry = existingAccess?.license?.key ? existingAccess.license : null;
  if (!entry?.key) {
    const vault = await read('lumo/vault');
    if (vault == null) return { ok: false, error: 'vault' };
    entry = findSpecialLicense(vault, normalized) || null;
    if (!entry) {
      entry = specialLicenseRecord({
        email: normalized,
        firstName: names.firstName,
        lastName: names.lastName,
        key: makeKey(),
        now,
      });
    }
  }

  const created = await postClient({
    email: normalized,
    firstName: names.firstName,
    lastName: names.lastName,
    status: 'approved',
    paymentClaimed: true,
    paymentClaimedAt: now,
    paymentVerified: true,
  });
  const clientId = created?.id || normalized;
  const patched = await patchClient(clientId, {
    status: 'approved',
    paymentClaimed: true,
    paymentClaimedAt: created?.paymentClaimedAt || now,
    paymentVerified: true,
  });
  if (!patched && !created) return { ok: false, error: 'client' };

  const vault = await read('lumo/vault');
  if (vault == null) return { ok: false, error: 'vault' };
  if (!findSpecialLicense(vault, normalized)) {
    const savedVault = await write('lumo/vault', [entry, ...dbList(vault).filter((row) => row?.key !== entry.key)]);
    if (!savedVault) return { ok: false, error: 'vault' };
  }
  const workspace = await read(`lumo/store/workspaces/${SPECIAL_ADMIN_ID}`);
  if (!workspace || typeof workspace !== 'object') return { ok: false, error: 'workspace' };
  const licenses = dbList(workspace.licenses);
  if (!licenses.some((row) => row?.key === entry.key)) {
    const savedWorkspace = await write(`lumo/store/workspaces/${SPECIAL_ADMIN_ID}`, {
      ...workspace,
      id: SPECIAL_ADMIN_ID,
      licenses: [entry, ...licenses],
    });
    if (!savedWorkspace) return { ok: false, error: 'workspace' };
  }

  const access = {
    email: normalized,
    status: 'paid',
    reference: String(reference || existingAccess?.reference || ''),
    key: entry.key,
    license: licenseView(entry),
    paidAt: existingAccess?.paidAt || now,
  };
  const savedAccess = await write(accessPath(normalized), access);
  if (!savedAccess) return { ok: false, error: 'access' };
  if (reference) {
    await write(paymentPath(reference), {
      reference: String(reference),
      email: normalized,
      status: 'paid',
      amount: SPECIAL_PRICE_CENTS,
      currency: 'ZAR',
      key: entry.key,
      paidAt: now,
    });
  }

  if (io.notify) {
    const sent = await io.notify({
      ...entry,
      email: normalized,
      clientEmail: normalized,
      clientName: [names.firstName, names.lastName].filter(Boolean).join(' '),
      portalUrl: 'https://lumoedge.com/',
      ownerAdminId: SPECIAL_ADMIN_ID,
    });
    if (!sent?.ok) return { ok: false, error: 'email', license: licenseView(entry) };
  }

  return { ok: true, email: normalized, license: licenseView(entry), reused: Boolean(existingAccess?.key) };
}
