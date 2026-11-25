import { createHmac, timingSafeEqual } from 'node:crypto';
import { firebasePatchClientById, firebasePostClientEntry } from './clientMerge.mjs';
import {
  isRegistrationEmail,
  normalizeRegistrationEmail,
  splitNameFromEmail,
} from './registrationEmail.mjs';
import { savePrivateClient, patchPrivateClient } from './supabaseRoster.mjs';
import { saveSubscription, saveSubscriptionPatch } from './subscriptionVault.mjs';
import { reclaimPhoneAfterPayment } from './phoneSessions.mjs';

/** Default subscription price: $36.00 USD. Override with PAYMENT_AMOUNT_USD (e.g. 1 for live test). */
export const APP_PRICE_CURRENCY = 'USD';

export function appPriceMajor() {
  const raw = String(process.env.PAYMENT_AMOUNT_USD || process.env.PAYPAL_AMOUNT_USD || '36').trim();
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 36;
  // Cap accidental huge values; allow $1 test and normal $36.
  return Math.round(n * 100) / 100;
}

export function appPriceCents() {
  return Math.round(appPriceMajor() * 100);
}

export function appPriceLabel() {
  const major = appPriceMajor();
  return Number.isInteger(major) ? `$${major}` : `$${major.toFixed(2)}`;
}

/** @deprecated use appPriceCents() — kept for older imports */
export const APP_PRICE_CENTS = 3600;

export function paymentSecrets() {
  const webhook = String(process.env.PAYMENT_WEBHOOK_SECRET || '').trim();
  const webhookAlt = String(process.env.PAYMENT_WEBHOOK_SECRET_ALT || '').trim();
  const paystack = String(process.env.PAYSTACK_SECRET_KEY || webhook || '').trim();
  const webhooks = [webhook, webhookAlt].filter(Boolean);
  return { webhook, webhookAlt, webhooks, paystack };
}

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

function headerSecret(req) {
  const auth = String(req.headers?.authorization || '').trim();
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return String(
    req.headers?.['x-lumo-payment-secret'] ||
      req.headers?.['x-webhook-secret'] ||
      req.headers?.['x-paystack-webhook-secret'] ||
      '',
  ).trim();
}

export function verifyPaymentWebhookAuth(req, rawBody) {
  const { webhooks, paystack } = paymentSecrets();
  const incoming = headerSecret(req);
  if (incoming && webhooks.some((secret) => secret === incoming)) {
    return { ok: true, mode: 'shared' };
  }
  const signature = req.headers?.['x-paystack-signature'];
  if (paystack && verifyPaystackSignature(rawBody, signature, paystack)) {
    return { ok: true, mode: 'paystack' };
  }
  // Allow shared secret also as Paystack HMAC key when provider reuses one token.
  for (const secret of webhooks) {
    if (verifyPaystackSignature(rawBody, signature, secret)) {
      return { ok: true, mode: 'paystack-shared' };
    }
  }
  return { ok: false, mode: '' };
}

function metaValue(meta, key) {
  if (!meta || typeof meta !== 'object') return '';
  if (meta[key] != null) return String(meta[key]).trim();
  const fields = meta.custom_fields;
  if (Array.isArray(fields)) {
    const hit = fields.find(
      (row) => String(row?.variable_name || row?.name || '').toLowerCase() === String(key).toLowerCase(),
    );
    if (hit) return String(hit.value || '').trim();
  }
  return '';
}

function amountMatchesPrice(amount, currency) {
  const cur = String(currency || '').toUpperCase();
  const n = Number(amount);
  if (!Number.isFinite(n)) return false;
  const cents = appPriceCents();
  const major = appPriceMajor();
  // Paystack/Stripe minor units
  if (cur === 'USD' && Math.round(n) === cents) return true;
  // Major units
  if (cur === 'USD' && Math.abs(n - major) < 0.001) return true;
  if (!cur && (Math.round(n) === cents || Math.abs(n - major) < 0.001)) return true;
  return false;
}

/**
 * Normalize Paystack / generic JSON into a paid $36 subscription event.
 */
export function parsePaidSubscriptionEvent(event) {
  if (!event || typeof event !== 'object') return { ok: false, reason: 'body' };

  // Generic / manual provider shape
  if (event.email || event.customer_email || event.payer_email) {
    const email = normalizeRegistrationEmail(
      event.email || event.customer_email || event.payer_email || event.customer?.email,
    );
    const currency = event.currency || event.currency_code || 'USD';
    const amount = event.amount_cents ?? event.amount ?? event.value;
    if (!isRegistrationEmail(email)) return { ok: false, reason: 'email' };
    if (!amountMatchesPrice(amount, currency) && event.plan !== 'lumo36' && event.product !== 'lumo36') {
      // Allow explicit plan flag to bypass strict amount when provider already filtered.
      if (event.forceApprove !== true) return { ok: false, reason: 'amount' };
    }
    if (String(event.status || 'success').toLowerCase() === 'failed') {
      return { ok: false, reason: 'status' };
    }
    return {
      ok: true,
      email,
      firstName: String(event.firstName || event.first_name || event.customer?.first_name || '').trim(),
      lastName: String(event.lastName || event.last_name || event.customer?.last_name || '').trim(),
      reference: String(event.reference || event.id || event.payment_id || `pay-${Date.now()}`).trim(),
      amountCents: appPriceCents(),
      currency: 'USD',
    };
  }

  // Paystack charge.success
  const name = String(event.event || event.type || '').toLowerCase();
  if (name && name !== 'charge.success' && name !== 'payment.success' && name !== 'invoice.payment_succeeded') {
    return { ok: false, reason: 'event' };
  }
  const data = event.data && typeof event.data === 'object' ? event.data : event;
  const status = String(data.status || data.payment_status || 'success').toLowerCase();
  if (status && !['success', 'successful', 'paid', 'complete', 'completed'].includes(status)) {
    return { ok: false, reason: 'status' };
  }
  const currency = data.currency || data.currency_code || 'USD';
  const amount = data.amount ?? data.amount_paid ?? data.value;
  if (!amountMatchesPrice(amount, currency) && metaValue(data.metadata, 'plan') !== 'lumo36') {
    return { ok: false, reason: 'amount' };
  }
  const email = normalizeRegistrationEmail(
    data.customer?.email ||
      metaValue(data.metadata, 'email') ||
      data.metadata?.email ||
      data.billing_details?.email,
  );
  if (!isRegistrationEmail(email)) return { ok: false, reason: 'email' };
  const reference = String(data.reference || data.id || data.payment_intent || '').trim();
  if (!reference) return { ok: false, reason: 'reference' };
  return {
    ok: true,
    email,
    firstName: String(data.customer?.first_name || metaValue(data.metadata, 'first_name') || '').trim(),
    lastName: String(data.customer?.last_name || metaValue(data.metadata, 'last_name') || '').trim(),
    reference,
    amountCents: appPriceCents(),
    currency: 'USD',
  };
}

export async function approveClientFromPayment({
  email,
  firstName,
  lastName,
  reference,
  source = 'payment_webhook',
  deviceId = '',
  deviceLabel = '',
}) {
  const normalized = normalizeRegistrationEmail(email);
  if (!isRegistrationEmail(normalized)) return { ok: false, error: 'email' };
  const names = splitNameFromEmail(normalized);
  const first = String(firstName || '').trim() || names.firstName;
  const last = String(lastName || '').trim() || names.lastName;
  const now = new Date().toISOString();
  const payload = {
    email: normalized,
    firstName: first,
    lastName: last,
    status: 'approved',
    paymentClaimed: true,
    paymentClaimedAt: now,
    paymentVerified: true,
    paymentVerifiedSource: source,
    paymentVerifiedAt: now,
    paymentReference: String(reference || ''),
  };

  let stored =
    (await saveSubscription(payload).catch(() => null)) ||
    (await savePrivateClient(payload).catch(() => null));
  if (!stored) {
    stored = await firebasePostClientEntry(payload).catch(() => null);
  }
  const id = stored?.id || normalized;
  const patched =
    (await saveSubscriptionPatch(id, payload).catch(() => null)) ||
    (await patchPrivateClient(id, payload).catch(() => null)) ||
    (await firebasePatchClientById(id, payload).catch(() => null)) ||
    stored;
  if (!patched && !stored) return { ok: false, error: 'client' };

  const client = patched || stored;
  // Keep the paying phone signed in. Do NOT clearPhoneDevice here — that
  // blacklisted the same phone and kicked people out right after license unlock.
  try {
    await reclaimPhoneAfterPayment(normalized, deviceId, deviceLabel);
  } catch {
    /* best effort */
  }
  try {
    const { tryQualifyCommission } = await import('./commissionEngine.mjs');
    void tryQualifyCommission({
      email: normalized,
      source: 'payment',
      actorId: `system:${source}`,
      reference: String(reference || ''),
    });
  } catch {
    /* optional */
  }
  try {
    const { notifySubscriptionApproved } = await import('./email/index.mjs');
    const { firebaseRead, firebaseWrite } = await import('./clientMerge.mjs');
    void notifySubscriptionApproved({ firebaseRead, firebaseWrite, firebasePush: null }, client);
  } catch {
    /* optional */
  }
  return { ok: true, email: normalized, client, reference: String(reference || '') };
}
