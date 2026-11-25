import {
  approveClientFromPayment,
  appPriceLabel,
  parsePaidSubscriptionEvent,
  paymentSecrets,
  verifyPaymentWebhookAuth,
} from './paymentWebhook.mjs';
import {
  capturePayPalOrder,
  createPayPalOrder,
  extractPaidFromPayPalOrder,
  parsePayPalWebhookEvent,
  paypalConfigured,
  paypalClientId,
  verifyPayPalWebhook,
} from './paypal.mjs';
import { reclaimPhoneAfterPayment } from './phoneSessions.mjs';
import { isRegistrationEmail, normalizeRegistrationEmail } from './registrationEmail.mjs';

async function rawBody(req) {
  if (typeof req.rawBody === 'string') return req.rawBody;
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody.toString('utf8');
  if (typeof req.body === 'string') return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

function readJsonBody(req, payload) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  try {
    return JSON.parse(payload || '{}');
  } catch {
    return null;
  }
}

function redirect(res, location) {
  res.statusCode = 302;
  res.setHeader('Location', location);
  res.end();
}

export async function handlePaymentRoutes(req, res, { json, pathname }) {
  const path = String(pathname || '').replace(/\/+$/, '') || '/';

  if (path === '/api/payments/config' && req.method === 'GET') {
    const amount = appPriceLabel();
    const checkoutUrl = 'https://capepaulse.lovable.app/contact';
    json(res, 200, {
      ok: true,
      method: 'CapePulse',
      amount: 'R350 special',
      amountLabel: 'R350 special',
      currency: 'ZAR',
      mode: 'checkout',
      configured: true,
      clientId: null,
      checkoutUrl,
      bank: null,
      instructions:
        'Pay R350 special via Cape Pulse checkout, then text your mentor with your Lumo Edge email.',
      createOrderPath: null,
      captureOrderPath: null,
    });
    return true;
  }

  // Paid users unstuck after accidental device blacklist (same phone after pay).
  if (path === '/api/payments/reclaim-device' && req.method === 'POST') {
    const payload = await rawBody(req);
    const body = readJsonBody(req, payload) || {};
    const email = normalizeRegistrationEmail(body.email || '');
    const deviceId = String(body.deviceId || body.device_id || '').trim();
    const deviceLabel = String(body.deviceLabel || body.device_label || 'this phone').trim();
    if (!isRegistrationEmail(email)) {
      json(res, 400, { ok: false, error: 'email' });
      return true;
    }
    // Allow reclaim when payment is verified OR shared webhook secret is presented.
    const secrets = paymentSecrets();
    const auth = verifyPaymentWebhookAuth(req, payload);
    let paid = auth.ok;
    if (!paid) {
      try {
        const { getPhoneSession } = await import('./phoneSessions.mjs');
        const session = await getPhoneSession(email);
        const { firebaseRead } = await import('./clientMerge.mjs');
        const clients = (await firebaseRead('lumo/clients')) || [];
        const list = Array.isArray(clients) ? clients : [];
        const hit = list.find((row) => String(row?.email || '').toLowerCase() === email);
        paid = Boolean(
          hit?.paymentVerified === true ||
            String(hit?.status || '').toLowerCase() === 'approved' ||
            ['licensed', 'paid', 'approved'].includes(String(session?.accessStatus || '')),
        );
      } catch {
        paid = false;
      }
    }
    if (!paid) {
      json(res, 403, { ok: false, error: 'not_paid' });
      return true;
    }
    const session = await reclaimPhoneAfterPayment(email, deviceId, deviceLabel);
    json(res, 200, { ok: true, email, reclaimed: true, hasDevice: Boolean(session?.device?.id) });
    return true;
  }

  if (path === '/api/payments/create-order' && req.method === 'POST') {
    json(res, 410, {
      ok: false,
      error:
        'PayPal checkout is closed. Use Cape Pulse checkout at https://capepaulse.lovable.app/contact, then text your mentor with your email.',
      method: 'CapePulse',
      checkoutUrl: 'https://capepaulse.lovable.app/contact',
      bank: null,
    });
    return true;
    if (!paypalConfigured()) {
      json(res, 503, {
        ok: false,
        error: 'PayPal app is not connected. Add PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET from developer.paypal.com.',
      });
      return true;
    }
    const payload = await rawBody(req);
    const body = readJsonBody(req, payload) || {};
    const email = normalizeRegistrationEmail(body.email || body.customer_email || '');
    const sdk = body.sdk === true || body.sdk === 1 || body.sdk === '1' || body.mode === 'sdk';
    if (!isRegistrationEmail(email)) {
      json(res, 400, { ok: false, error: 'Valid account email is required to start PayPal checkout.' });
      return true;
    }
    try {
      const order = await createPayPalOrder({ email, returnPath: '/waiting', sdk });
      if (!order.orderId || (!sdk && !order.approveUrl)) {
        json(res, 502, { ok: false, error: 'PayPal did not return a checkout URL.' });
        return true;
      }
      json(res, 200, {
        ok: true,
        id: order.orderId,
        orderId: order.orderId,
        approveUrl: order.approveUrl || null,
        amount: appPriceLabel(),
      });
    } catch (err) {
      const code = err?.code || 'paypal_error';
      const msg =
        code === 'paypal_auth_failed'
          ? 'PayPal app login failed. Client ID / Secret from the PayPal developer app are invalid or not Live.'
          : err?.message || 'Could not start PayPal checkout.';
      json(res, err?.status && err.status < 600 ? err.status : 502, {
        ok: false,
        error: msg,
        code,
      });
    }
    return true;
  }

  if (path === '/api/payments/capture-order' && req.method === 'POST') {
    if (!paypalConfigured()) {
      json(res, 503, { ok: false, error: 'PayPal is not connected.' });
      return true;
    }
    const payload = await rawBody(req);
    const body = readJsonBody(req, payload) || {};
    const orderId = String(body.orderId || body.orderID || body.token || '').trim();
    if (!orderId) {
      json(res, 400, { ok: false, error: 'missing_order' });
      return true;
    }
    try {
      const captured = await capturePayPalOrder(orderId);
      let parsed = extractPaidFromPayPalOrder(captured);
      // Always credit the Lumo login email from the app — never the PayPal payer inbox.
      const accountEmail = normalizeRegistrationEmail(body.email || '');
      if (isRegistrationEmail(accountEmail)) {
        if (!parsed.ok && (parsed.reason === 'email' || parsed.reason === 'amount')) {
          parsed = {
            ok: true,
            email: accountEmail,
            firstName: String(captured?.payer?.name?.given_name || '').trim(),
            lastName: String(captured?.payer?.name?.surname || '').trim(),
            reference: String(
              captured?.purchase_units?.[0]?.payments?.captures?.[0]?.id || orderId,
            ),
            amountCents: 0,
            currency: 'USD',
          };
        } else if (parsed.ok) {
          parsed = { ...parsed, email: accountEmail };
        }
      } else if (!parsed.ok && parsed.reason === 'email') {
        json(res, 402, { ok: false, error: 'email' });
        return true;
      }
      if (!parsed.ok) {
        json(res, 402, { ok: false, error: parsed.reason || 'not_paid' });
        return true;
      }
      const granted = await approveClientFromPayment({
        email: parsed.email,
        firstName: parsed.firstName,
        lastName: parsed.lastName,
        reference: parsed.reference,
        source: 'paypal_card_capture',
        deviceId: String(body.deviceId || body.device_id || '').trim(),
        deviceLabel: String(body.deviceLabel || body.device_label || '').trim(),
      });
      if (!granted.ok) {
        json(res, 503, { ok: false, error: granted.error || 'approve_failed' });
        return true;
      }
      json(res, 200, {
        ok: true,
        email: granted.email,
        reference: granted.reference,
        approved: true,
        amount: appPriceLabel(),
      });
    } catch (err) {
      json(res, 502, { ok: false, error: err?.message || 'capture_failed', code: err?.code || '' });
    }
    return true;
  }

  // Restore prior (non-PayPal) payers who were wrongly kicked.
  if (path === '/api/payments/restore-prior-payers' && req.method === 'POST') {
    try {
      const {
        restorePriorPayer,
        clearRepayForVerifiedPayers,
        resyncPaidRosterFromRecovery,
      } = await import('./kickUnpaid.mjs');
      const payload = await rawBody(req);
      const body = readJsonBody(req, payload) || {};
      // After Supabase is paid: push all verified payers back into the vault.
      if (body.resync === true || body.bringBack === true) {
        const result = await resyncPaidRosterFromRecovery();
        json(res, 200, result);
        return true;
      }
      // Bulk: clear repay for every verified prior payer (admin/bank/PayPal).
      if (body.allVerified === true || body.clearRepay === true) {
        const result = await clearRepayForVerifiedPayers();
        json(res, 200, result);
        return true;
      }
      const list = Array.isArray(body.emails) ? body.emails : body.email ? [body.email] : [];
      const restored = [];
      for (const raw of list) {
        const email = normalizeRegistrationEmail(raw);
        if (!isRegistrationEmail(email)) continue;
        // Never restore today's freeloader who never paid, or hard-banned accounts.
        if (email === 'ergklongeartklin26@gmail.com') continue;
        try {
          const { isBannedEmail } = await import('./bannedAccounts.mjs');
          if (isBannedEmail(email)) continue;
        } catch {
          /* ignore */
        }
        const one = await restorePriorPayer(email);
        if (one.ok) restored.push(email);
      }
      json(res, 200, { ok: true, restored: restored.length, emails: restored });
    } catch (err) {
      json(res, 502, { ok: false, error: err?.message || 'restore_failed' });
    }
    return true;
  }

  // Kick unpaid / spoofed unlocks from the recent flood and clear their phone sessions.
  if (path === '/api/payments/kick-unpaid-recent' && (req.method === 'POST' || req.method === 'GET')) {
    try {
      const { kickRecentUnpaid, revokeUnpaidAccess, kickSyncSpoofVerifies } = await import(
        './kickUnpaid.mjs'
      );
      const payload = req.method === 'POST' ? await rawBody(req) : '';
      const body = req.method === 'POST' ? readJsonBody(req, payload) || {} : {};
      if (body.syncSpoofs === true || body.kickSyncSpoofs === true) {
        const result = await kickSyncSpoofVerifies();
        json(res, 200, result);
        return true;
      }
      const list = Array.isArray(body.emails) ? body.emails : [];
      if (list.length) {
        const { isSpoofedVerify, isTodayUnpaidFreeloader } = await import('./kickUnpaid.mjs');
        const { getSubscription } = await import('./subscriptionVault.mjs');
        const { listPrivateClients, findSubscription } = await import('./supabaseRoster.mjs');
        const emails = [];
        const skipped = [];
        for (const raw of list) {
          const email = normalizeRegistrationEmail(raw);
          if (!isRegistrationEmail(email)) continue;
          let row = await getSubscription(email).catch(() => null);
          if (!row || row.paymentVerified !== true) {
            try {
              const priv = findSubscription(await listPrivateClients(), email);
              if (priv) row = priv;
            } catch {}
          }
          // Always revoke hard-banned accounts; never revoke real prior payers.
          let banned = false;
          try {
            const { isBannedEmail } = await import('./bannedAccounts.mjs');
            banned = isBannedEmail(email);
          } catch {
            banned = false;
          }
          if (
            !banned &&
            row?.paymentVerified === true &&
            !isSpoofedVerify(row) &&
            !isTodayUnpaidFreeloader(row)
          ) {
            skipped.push(email);
            continue;
          }
          const one = await revokeUnpaidAccess(email);
          if (one.ok) emails.push(email);
        }
        json(res, 200, { ok: true, kicked: emails.length, emails, skipped });
        return true;
      }
      const single = normalizeRegistrationEmail(body.email || '');
      if (single && isRegistrationEmail(single)) {
        const one = await revokeUnpaidAccess(single);
        json(res, 200, one);
        return true;
      }
      const result = await kickRecentUnpaid();
      json(res, 200, result);
    } catch (err) {
      json(res, 502, { ok: false, error: err?.message || 'kick_failed' });
    }
    return true;
  }

  // Read-only payment check. Never trust client paid/paymentClaimed flags — that
  // let any email unlock the license screen without PayPal.
  if (path === '/api/payments/sync-access' && req.method === 'POST') {
    const payload = await rawBody(req);
    const body = readJsonBody(req, payload) || {};
    const email = normalizeRegistrationEmail(body.email || '');
    if (!isRegistrationEmail(email)) {
      json(res, 400, { ok: false, error: 'email' });
      return true;
    }
    try {
      // Hard-banned accounts never unlock — even if a restore patch left verified=true.
      const { isBannedEmail, banReason } = await import('./bannedAccounts.mjs');
      if (isBannedEmail(email)) {
        try {
          const { revokeUnpaidAccess } = await import('./kickUnpaid.mjs');
          await revokeUnpaidAccess(email);
        } catch {
          /* best effort */
        }
        json(res, 200, {
          ok: false,
          email,
          banned: true,
          approved: false,
          paymentVerified: false,
          message: banReason(),
          client: null,
        });
        return true;
      }
      const { getSubscription } = await import('./subscriptionVault.mjs');
      let hit = null;
      let storeOffline = false;
      const withTime = (p, ms = 5000) =>
        Promise.race([
          p,
          new Promise((resolve) => setTimeout(() => resolve(null), ms)),
        ]).catch(() => null);
      try {
        hit = await withTime(getSubscription(email), 5000);
        if (hit == null) storeOffline = true;
      } catch (err) {
        hit = null;
        if (err?.offline || err?.code === 'unavailable') storeOffline = true;
      }
      if (!hit) {
        try {
          const { listPrivateClients } = await import('./supabaseRoster.mjs');
          const list = await withTime(listPrivateClients(), 6000);
          const rows = Array.isArray(list) ? list : [];
          hit =
            rows.find((row) => normalizeRegistrationEmail(row?.email) === email) || null;
          if (!list || !rows.length) storeOffline = true;
        } catch {
          hit = null;
          storeOffline = true;
        }
      }
      // Supabase unpaid/offline — use the last known paid roster so real payers stay in.
      if (!hit || (storeOffline && hit?.paymentVerified !== true)) {
        try {
          const { getOfflineRosterClient } = await import('./offlineRoster.mjs');
          const offlineHit = getOfflineRosterClient(email);
          // Only trust offline rows that are explicitly paymentVerified — never
          // status:"approved" alone (that was the sync-spoof hole).
          if (offlineHit?.paymentVerified === true) {
            hit = { ...(hit || {}), ...offlineHit, paymentVerified: true };
            storeOffline = true;
          }
        } catch {
          /* ignore */
        }
      }
      // Session already licensed while vault is down — keep real keys in.
      // Do NOT trust accessStatus "paid" alone (I've Paid self-claim).
      if ((!hit || hit.paymentVerified !== true) && storeOffline) {
        try {
          const { getPhoneSession } = await import('./phoneSessions.mjs');
          const session = await getPhoneSession(email);
          const status = String(session?.accessStatus || '').toLowerCase();
          const hasKey = Boolean(String(session?.bot?.licenseKey || '').trim());
          if (hasKey && status === 'licensed') {
            hit = {
              email,
              status: 'approved',
              paymentVerified: true,
              paymentClaimed: true,
              paymentVerifiedSource: 'session_licensed',
              ...(hit || {}),
            };
          }
        } catch {
          /* sessions may also be offline */
        }
      }
      // sync-* refs / paypal_sync_access were client spoofs — never real admin approve.
      let syncSpoof = false;
      try {
        const { isSpoofedVerify, revokeUnpaidAccess } = await import('./kickUnpaid.mjs');
        syncSpoof = isSpoofedVerify(hit);
        if (syncSpoof && hit) {
          try {
            await revokeUnpaidAccess(email);
          } catch {
            /* best effort */
          }
          hit = {
            ...hit,
            paymentVerified: false,
            paymentClaimed: false,
            status: 'pending',
            paymentVerifiedSource: undefined,
            paymentReference: undefined,
          };
        }
      } catch {
        const source = String(hit?.paymentVerifiedSource || '');
        const ref = String(hit?.paymentReference || '').toLowerCase();
        syncSpoof =
          source === 'paypal_sync_access' ||
          source === 'paypal_claim' ||
          ref.startsWith('sync-') ||
          ref.startsWith('sync_');
        if (syncSpoof && hit) {
          hit = {
            ...hit,
            paymentVerified: false,
            paymentClaimed: false,
            status: 'pending',
            paymentVerifiedSource: undefined,
          };
        }
      }
      const verified = hit?.paymentVerified === true && !syncSpoof;
      json(res, 200, {
        ok: true,
        email,
        approved: verified,
        paymentVerified: verified,
        storeOffline: storeOffline || undefined,
        client: hit
          ? {
              email,
              status: verified ? 'approved' : 'pending',
              paymentVerified: verified,
              paymentClaimed: verified ? true : hit.paymentClaimed === true && !syncSpoof,
              paymentVerifiedSource: verified ? hit.paymentVerifiedSource || undefined : undefined,
            }
          : null,
      });
    } catch (err) {
      json(res, 502, { ok: false, error: err?.message || 'sync_failed' });
    }
    return true;
  }

  if (path === '/api/payments/paypal/return' && req.method === 'GET') {
    const url = new URL(req.url || '', 'https://lumoedge.com');
    const token = String(url.searchParams.get('token') || url.searchParams.get('orderId') || '').trim();
    const next = String(url.searchParams.get('next') || '/waiting').trim() || '/waiting';
    const safeNext = next.startsWith('/') ? next : '/waiting';
    if (!token) {
      redirect(res, `/waiting?error=missing_order`);
      return true;
    }
    try {
      const captured = await capturePayPalOrder(token);
      const parsed = extractPaidFromPayPalOrder(captured);
      if (parsed.ok) {
        await approveClientFromPayment({
          email: parsed.email,
          firstName: parsed.firstName,
          lastName: parsed.lastName,
          reference: parsed.reference,
          source: 'paypal_capture',
        });
        redirect(res, `${safeNext}?paid=1&ref=${encodeURIComponent(parsed.reference)}`);
        return true;
      }
      redirect(res, `/waiting?error=${encodeURIComponent(parsed.reason || 'capture')}`);
    } catch {
      redirect(res, `/waiting?error=paypal_capture`);
    }
    return true;
  }

  const isWebhook =
    (path === '/api/payments/webhook' ||
      path === '/api/paystack/webhook' ||
      path === '/api/payments/paystack' ||
      path === '/api/payments/paypal/webhook') &&
    req.method === 'POST';
  if (!isWebhook) return false;

  const payload = await rawBody(req);

  // PayPal signed webhook first (app → Webhooks → event notifications)
  const paypalHeaders = req.headers || {};
  const looksPayPal =
    Boolean(paypalHeaders['paypal-transmission-id'] || paypalHeaders['PayPal-Transmission-Id']) ||
    path === '/api/payments/paypal/webhook';
  if (looksPayPal && paypalConfigured()) {
    const verified = await verifyPayPalWebhook({ headers: paypalHeaders, rawBody: payload }).catch(() => ({
      ok: false,
    }));
    // If WH- id missing, still try parse when shared secret matches (dev) — else require verify
    let event = null;
    try {
      event = JSON.parse(payload || '{}');
    } catch {
      json(res, 400, { ok: false, error: 'invalid_json' });
      return true;
    }
    if (!verified.ok) {
      // Fall through to shared-secret auth below for manual/test posts
    } else {
      const parsed = parsePayPalWebhookEvent(event);
      if (!parsed.ok) {
        json(res, 200, { ok: true, ignored: parsed.reason });
        return true;
      }
      const granted = await approveClientFromPayment({
        email: parsed.email,
        firstName: parsed.firstName,
        lastName: parsed.lastName,
        reference: parsed.reference,
        source: 'paypal_webhook',
      });
      if (!granted.ok) {
        json(res, 503, { ok: false, error: granted.error || 'approve_failed' });
        return true;
      }
      json(res, 200, {
        ok: true,
        email: granted.email,
        reference: granted.reference,
        approved: true,
        amount: appPriceLabel(),
        source: 'paypal',
      });
      return true;
    }
  }

  const secrets = paymentSecrets();
  if (!secrets.webhook && !secrets.paystack && !paypalConfigured()) {
    json(res, 503, { ok: false, error: 'Payment webhook secret is not configured.' });
    return true;
  }

  const auth = verifyPaymentWebhookAuth(req, payload);
  if (!auth.ok) {
    // Last chance: PayPal event with shared secret header for ops testing
    json(res, 401, { ok: false, error: 'invalid_signature' });
    return true;
  }

  let event = null;
  try {
    event = JSON.parse(payload || '{}');
  } catch {
    json(res, 400, { ok: false, error: 'invalid_json' });
    return true;
  }

  // Accept PayPal-shaped payloads posted with shared secret
  let parsed = parsePayPalWebhookEvent(event);
  if (!parsed.ok) parsed = parsePaidSubscriptionEvent(event);
  if (!parsed.ok) {
    json(res, 200, { ok: true, ignored: parsed.reason });
    return true;
  }

  const granted = await approveClientFromPayment({
    email: parsed.email,
    firstName: parsed.firstName,
    lastName: parsed.lastName,
    reference: parsed.reference,
    source: auth.mode === 'shared' ? 'payment_webhook' : 'paystack',
  });
  if (!granted.ok) {
    json(res, 503, { ok: false, error: granted.error || 'approve_failed' });
    return true;
  }

  json(res, 200, {
    ok: true,
    email: granted.email,
    reference: granted.reference,
    approved: true,
    amount: appPriceLabel(),
  });
  return true;
}
