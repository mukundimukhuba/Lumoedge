/**
 * PayPal REST (Orders v2) — app checkout + webhook helpers.
 * Uses PAYPAL_CLIENT_ID + PAYPAL_CLIENT_SECRET from the developer app.
 */

import {
  APP_PRICE_CURRENCY,
  appPriceCents,
  appPriceLabel,
  appPriceMajor,
} from './paymentWebhook.mjs';

const LIVE = 'https://api-m.paypal.com';
const SANDBOX = 'https://api-m.sandbox.paypal.com';

export function paypalConfigured() {
  return Boolean(paypalClientId() && paypalClientSecret());
}

export function paypalClientId() {
  return String(process.env.PAYPAL_CLIENT_ID || '').trim();
}

export function paypalClientSecret() {
  return String(process.env.PAYPAL_CLIENT_SECRET || '').trim();
}

export function paypalWebhookId() {
  return String(process.env.PAYPAL_WEBHOOK_ID || '').trim();
}

export function paypalApiBase() {
  const mode = String(process.env.PAYPAL_MODE || process.env.PAYPAL_ENV || 'live')
    .trim()
    .toLowerCase();
  return mode === 'sandbox' || mode === 'test' ? SANDBOX : LIVE;
}

export function paypalPublicOrigin() {
  return String(process.env.PUBLIC_APP_URL || process.env.APP_ORIGIN || 'https://lumoedge.com')
    .trim()
    .replace(/\/+$/, '');
}

let cachedToken = { value: '', exp: 0 };

export async function paypalAccessToken() {
  const id = paypalClientId();
  const secret = paypalClientSecret();
  if (!id || !secret) {
    const err = new Error('paypal_not_configured');
    err.code = 'paypal_not_configured';
    throw err;
  }
  const now = Date.now();
  if (cachedToken.value && cachedToken.exp > now + 30_000) return cachedToken.value;

  const auth = Buffer.from(`${id}:${secret}`).toString('base64');
  const res = await fetch(`${paypalApiBase()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    const err = new Error(body.error_description || body.error || 'paypal_auth_failed');
    err.code = 'paypal_auth_failed';
    err.status = res.status;
    err.details = body;
    throw err;
  }
  const expiresIn = Number(body.expires_in || 300);
  cachedToken = {
    value: String(body.access_token),
    exp: now + Math.max(60, expiresIn - 60) * 1000,
  };
  return cachedToken.value;
}

async function paypalFetch(path, { method = 'GET', body, headers } = {}) {
  const token = await paypalAccessToken();
  const res = await fetch(`${paypalApiBase()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(headers || {}),
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  return { ok: res.ok, status: res.status, data };
}

export function amountMajorUsd() {
  return appPriceMajor().toFixed(2);
}

export async function createPayPalOrder({ email, returnPath = '/waiting', sdk = false } = {}) {
  const origin = paypalPublicOrigin();
  const customId = String(email || '')
    .trim()
    .toLowerCase()
    .slice(0, 127);
  const returnUrl = `${origin}/api/payments/paypal/return?next=${encodeURIComponent(returnPath)}`;
  const cancelUrl = `${origin}/waiting?cancelled=1`;

  const purchase_units = [
    {
      amount: {
        currency_code: APP_PRICE_CURRENCY,
        value: amountMajorUsd(),
      },
      description: `Lumo Edge access — ${appPriceLabel()}`,
      custom_id: customId || undefined,
    },
  ];

  // SDK card fields / buttons supply payment_source in the browser — keep order bare.
  // Redirect checkout uses GUEST_CHECKOUT so buyers can pay by card without a PayPal login.
  const body = sdk
    ? { intent: 'CAPTURE', purchase_units }
    : {
        intent: 'CAPTURE',
        purchase_units,
        payment_source: {
          paypal: {
            experience_context: {
              brand_name: 'Lumo Edge',
              landing_page: 'GUEST_CHECKOUT',
              user_action: 'PAY_NOW',
              shipping_preference: 'NO_SHIPPING',
              payment_method_preference: 'IMMEDIATE_PAYMENT_REQUIRED',
              return_url: returnUrl,
              cancel_url: cancelUrl,
            },
          },
        },
      };

  const { ok, status, data } = await paypalFetch('/v2/checkout/orders', {
    method: 'POST',
    body,
  });

  if (!ok || !data?.id) {
    const err = new Error(data?.message || data?.error || 'paypal_create_failed');
    err.code = 'paypal_create_failed';
    err.status = status;
    err.details = data;
    throw err;
  }

  const links = Array.isArray(data.links) ? data.links : [];
  const approve =
    links.find((l) => String(l.rel).toLowerCase() === 'payer-action') ||
    links.find((l) => String(l.rel).toLowerCase() === 'approve');
  return {
    orderId: String(data.id),
    approveUrl: approve?.href || '',
    status: data.status || '',
    raw: data,
  };
}

export async function capturePayPalOrder(orderId) {
  const id = String(orderId || '').trim();
  if (!id) {
    const err = new Error('missing_order');
    err.code = 'missing_order';
    throw err;
  }
  const { ok, status, data } = await paypalFetch(`/v2/checkout/orders/${encodeURIComponent(id)}/capture`, {
    method: 'POST',
    body: {},
  });
  // ORDER_ALREADY_CAPTURED is fine — treat as success and read order
  if (!ok && data?.name !== 'UNPROCESSABLE_ENTITY') {
    const already =
      Array.isArray(data?.details) &&
      data.details.some((d) => String(d.issue || '').includes('ORDER_ALREADY_CAPTURED'));
    if (!already) {
      const err = new Error(data?.message || 'paypal_capture_failed');
      err.code = 'paypal_capture_failed';
      err.status = status;
      err.details = data;
      throw err;
    }
  }
  if (!ok) {
    const get = await paypalFetch(`/v2/checkout/orders/${encodeURIComponent(id)}`);
    return get.data || data;
  }
  return data;
}

export function extractPaidFromPayPalOrder(order) {
  if (!order || typeof order !== 'object') return { ok: false, reason: 'body' };
  const status = String(order.status || '').toUpperCase();
  const unit = Array.isArray(order.purchase_units) ? order.purchase_units[0] : null;
  const capture =
    unit?.payments?.captures?.[0] ||
    (Array.isArray(order.purchase_units)
      ? order.purchase_units.flatMap((u) => u?.payments?.captures || [])[0]
      : null);
  const captureStatus = String(capture?.status || status || '').toUpperCase();
  const paid =
    ['COMPLETED', 'APPROVED'].includes(status) ||
    ['COMPLETED', 'PENDING'].includes(captureStatus);
  if (!paid && status !== 'COMPLETED') return { ok: false, reason: 'status' };

  const amountValue = capture?.amount?.value ?? unit?.amount?.value;
  const currency = capture?.amount?.currency_code ?? unit?.amount?.currency_code ?? 'USD';
  const cents = Math.round(Number(amountValue) * 100);
  const expected = appPriceCents();
  const major = appPriceMajor();
  if (String(currency).toUpperCase() === 'USD' && amountValue != null) {
    if (cents !== expected && Math.abs(Number(amountValue) - major) > 0.01) {
      return { ok: false, reason: 'amount' };
    }
  }

  const email = String(
    unit?.custom_id ||
      order?.payer?.email_address ||
      capture?.custom_id ||
      '',
  )
    .trim()
    .toLowerCase();
  const reference = String(capture?.id || order.id || '').trim();
  if (!email) return { ok: false, reason: 'email' };
  if (!reference) return { ok: false, reason: 'reference' };
  return {
    ok: true,
    email,
    firstName: String(order?.payer?.name?.given_name || '').trim(),
    lastName: String(order?.payer?.name?.surname || '').trim(),
    reference,
    amountCents: expected,
    currency: 'USD',
  };
}

/**
 * Verify PayPal webhook transmission (requires PAYPAL_WEBHOOK_ID = WH-...).
 */
export async function verifyPayPalWebhook({ headers, rawBody }) {
  const webhookId = paypalWebhookId();
  if (!webhookId || !webhookId.startsWith('WH-')) return { ok: false, reason: 'webhook_id' };
  if (!paypalConfigured()) return { ok: false, reason: 'not_configured' };

  const transmissionId = headers['paypal-transmission-id'] || headers['PayPal-Transmission-Id'];
  const transmissionTime = headers['paypal-transmission-time'] || headers['PayPal-Transmission-Time'];
  const certUrl = headers['paypal-cert-url'] || headers['PayPal-Cert-Url'];
  const authAlgo = headers['paypal-auth-algo'] || headers['PayPal-Auth-Algo'];
  const transmissionSig = headers['paypal-transmission-sig'] || headers['PayPal-Transmission-Sig'];
  if (!transmissionId || !transmissionTime || !certUrl || !authAlgo || !transmissionSig) {
    return { ok: false, reason: 'headers' };
  }

  let event;
  try {
    event = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;
  } catch {
    return { ok: false, reason: 'json' };
  }

  const { ok, data } = await paypalFetch('/v1/notifications/verify-webhook-signature', {
    method: 'POST',
    body: {
      transmission_id: String(transmissionId),
      transmission_time: String(transmissionTime),
      cert_url: String(certUrl),
      auth_algo: String(authAlgo),
      transmission_sig: String(transmissionSig),
      webhook_id: webhookId,
      webhook_event: event,
    },
  });
  if (!ok) return { ok: false, reason: 'verify_http', details: data };
  const status = String(data?.verification_status || '').toUpperCase();
  return { ok: status === 'SUCCESS', reason: status || 'failed', event };
}

export function parsePayPalWebhookEvent(event) {
  if (!event || typeof event !== 'object') return { ok: false, reason: 'body' };
  const name = String(event.event_type || event.event || '').toUpperCase();
  if (
    name &&
    ![
      'PAYMENT.CAPTURE.COMPLETED',
      'CHECKOUT.ORDER.APPROVED',
      'CHECKOUT.ORDER.COMPLETED',
      'PAYMENT.CAPTURE.PENDING',
    ].includes(name)
  ) {
    return { ok: false, reason: 'event' };
  }
  const resource = event.resource && typeof event.resource === 'object' ? event.resource : event;

  // Capture resource
  if (resource.amount || resource.custom_id || resource.supplementary_data) {
    const email = String(
      resource.custom_id ||
        resource.supplementary_data?.related_ids?.order_id ||
        resource.payee?.email_address ||
        '',
    ).trim();
    // custom_id on capture may be empty — look in supplementary / related order later
    const value = resource.amount?.value;
    const currency = resource.amount?.currency_code || 'USD';
    const reference = String(resource.id || event.id || '').trim();
    if (email && email.includes('@')) {
      if (String(currency).toUpperCase() === 'USD' && value != null) {
        const expected = appPriceCents();
        const major = appPriceMajor();
        if (Math.abs(Number(value) - major) > 0.01 && Math.round(Number(value) * 100) !== expected) {
          return { ok: false, reason: 'amount' };
        }
      }
      return {
        ok: true,
        email: email.toLowerCase(),
        firstName: '',
        lastName: '',
        reference,
        amountCents: appPriceCents(),
        currency: 'USD',
      };
    }
  }

  // Order resource
  return extractPaidFromPayPalOrder(resource);
}
