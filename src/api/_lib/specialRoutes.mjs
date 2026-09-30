import { firebaseRead, firebaseWrite } from './clientMerge.mjs';
import { isRegistrationEmail, normalizeRegistrationEmail } from './registrationEmail.mjs';
import {
  accessPath,
  grantSpecialAccess,
  paystackChargeGrantsSpecial,
  verifyPaystackSignature,
} from './specialAccess.mjs';

async function rawBody(req) {
  if (typeof req.rawBody === 'string') return req.rawBody;
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody.toString('utf8');
  if (typeof req.body === 'string') return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

export async function handleSpecialRoutes(req, res, { json, pathname }) {
  const path = String(pathname || '').replace(/\/+$/, '') || '/';

  if (path === '/api/special/paystack' && req.method === 'POST') {
    const secret = String(process.env.PAYSTACK_SECRET_KEY || '').trim();
    const payload = await rawBody(req);
    const signature = req.headers['x-paystack-signature'];
    if (!verifyPaystackSignature(payload, signature, secret)) {
      json(res, 401, { ok: false });
      return true;
    }
    let event = null;
    try {
      event = JSON.parse(payload || '{}');
    } catch {
      json(res, 400, { ok: false });
      return true;
    }
    const charge = paystackChargeGrantsSpecial(event);
    if (!charge.ok) {
      json(res, 200, { ok: true, ignored: charge.reason });
      return true;
    }
    const { notifyLicenseKey } = await import('./email/index.mjs');
    const granted = await grantSpecialAccess({
      email: charge.email,
      firstName: charge.firstName,
      lastName: charge.lastName,
      reference: charge.reference,
      deps: {
        notify: (license) =>
          notifyLicenseKey({ firebaseRead, firebaseWrite, firebasePush: null }, license),
      },
    });
    if (!granted.ok) {
      json(res, 503, { ok: false });
      return true;
    }
    json(res, 200, { ok: true });
    return true;
  }

  if (path === '/api/special/access' && req.method === 'POST') {
    const payload = await rawBody(req);
    let body = {};
    try {
      body = JSON.parse(payload || '{}');
    } catch {
      body = {};
    }
    const email = normalizeRegistrationEmail(body?.email);
    if (!isRegistrationEmail(email)) {
      json(res, 400, { ok: false, error: 'email' });
      return true;
    }
    const row = await firebaseRead(accessPath(email));
    if (!row || row.status !== 'paid' || !row.license?.key) {
      json(res, 404, { ok: false });
      return true;
    }
    json(res, 200, { ok: true, license: row.license });
    return true;
  }

  return false;
}
