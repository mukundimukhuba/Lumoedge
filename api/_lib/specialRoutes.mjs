import { firebaseRead, firebaseWrite } from './clientMerge.mjs';
import { isPortalSuperAdminRequest, verifyAdminSession } from './adminSession.mjs';
import { dbList } from './licenseClaim.mjs';
import { listMentors } from './mentorVault.mjs';
import { isRegistrationEmail, normalizeRegistrationEmail } from './registrationEmail.mjs';
import {
  accessPath,
  grantSpecialAccess,
  licenseView,
  paystackChargeGrantsSpecial,
  SPECIAL_ADMIN_ID,
  SPECIAL_EA_NAME,
  SPECIAL_PRICE_CENTS,
  SPECIAL_SOURCE,
  specialLicenseRecord,
  uniqueEaNameForPerson,
  verifyPaystackSignature,
} from './specialAccess.mjs';
import { generateLicenseKey } from './websiteStore.mjs';
import { loadRecoveryDb, mergeRecoveryPatch } from './phoneRecover.mjs';

async function rawBody(req) {
  if (typeof req.rawBody === 'string') return req.rawBody;
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody.toString('utf8');
  if (typeof req.body === 'string') return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

function paidAmountLabel(cents) {
  const value = Number(cents);
  if (!Number.isFinite(value) || value <= 0) return 'R350';
  const rand = value / 100;
  return Number.isInteger(rand) ? `R${rand}` : `R${rand.toFixed(2)}`;
}

function uniqueEaNamesFromDb(db, mentorsByEmail, email) {
  const normalized = normalizeRegistrationEmail(email);
  const names = new Set();
  try {
    const match = mentorsByEmail.get(normalized);
    if (match?.id) {
      const workspace = db?.store?.workspaces?.[match.id];
      for (const ea of dbList(workspace?.eas)) {
        const name = String(ea?.name || ea?.eaName || ea?.robotName || '').trim();
        if (name && name.toLowerCase() !== SPECIAL_EA_NAME.toLowerCase()) names.add(name);
      }
    }
  } catch {
    /* ignore */
  }
  return [...names];
}

function resolveCustomerEaNames({ row, client, db, mentorsByEmail, usedNames }) {
  const email = normalizeRegistrationEmail(row?.email || client?.email);
  const fromLicense = String(row?.license?.eaName || row?.eaName || '').trim();
  if (fromLicense && fromLicense.toLowerCase() !== SPECIAL_EA_NAME.toLowerCase()) {
    usedNames?.add(fromLicense.toLowerCase());
    return [fromLicense];
  }
  const fromWs = uniqueEaNamesFromDb(db, mentorsByEmail, email);
  if (fromWs.length) {
    for (const name of fromWs) usedNames?.add(name.toLowerCase());
    return fromWs;
  }
  const generated = uniqueEaNameForPerson({
    firstName: client?.firstName || row?.firstName,
    lastName: client?.lastName || row?.lastName,
    email,
    usedNames,
  });
  return [generated];
}

function needsEaRename(eaName) {
  const name = String(eaName || '').trim();
  return !name || name.toLowerCase() === SPECIAL_EA_NAME.toLowerCase();
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

  // Super Admin list of R350 / Swagstack customers (shown on Cape Pulse).
  if (path === '/api/special/customers' && req.method === 'GET') {
    const session = await verifyAdminSession(req);
    if (!isPortalSuperAdminRequest(req, session)) {
      json(res, 401, { ok: false, error: 'unauthorized' });
      return true;
    }
    const db = await loadRecoveryDb();
    if (!db) {
      json(res, 503, { ok: false, error: 'recovery_unavailable' });
      return true;
    }
    const access = db.specialAccess && typeof db.specialAccess === 'object' ? db.specialAccess : {};
    let mentors = [];
    try {
      mentors = await listMentors();
    } catch {
      mentors = [];
    }
    const mentorsByEmail = new Map();
    for (const row of Array.isArray(mentors) ? mentors : []) {
      const em = normalizeRegistrationEmail(row?.email);
      if (em) mentorsByEmail.set(em, row);
    }
    const clientsByEmail = new Map();
    for (const row of dbList(db.clients)) {
      const em = normalizeRegistrationEmail(row?.email);
      if (em && !clientsByEmail.has(em)) clientsByEmail.set(em, row);
    }
    const websitesByEmail = new Map();
    try {
      const websitesRaw = (await firebaseRead('lumo/websites')) || {};
      const websites = Array.isArray(websitesRaw)
        ? websitesRaw
        : websitesRaw && typeof websitesRaw === 'object'
          ? Object.values(websitesRaw)
          : [];
      const mentorsById = new Map();
      for (const row of Array.isArray(mentors) ? mentors : []) {
        if (row?.id) mentorsById.set(String(row.id), row);
      }
      for (const site of websites) {
        if (!site || typeof site !== 'object') continue;
        const mentor = mentorsById.get(String(site.mentorId || ''));
        const em =
          normalizeRegistrationEmail(site.email) ||
          normalizeRegistrationEmail(mentor?.email);
        if (!em) continue;
        websitesByEmail.set(em, {
          websiteId: site.websiteId || '',
          status: site.status || 'draft',
          slug: site.slug || '',
          url: site.slug ? `https://lumoedge.com/store/${site.slug}` : '',
          robotName: site.robotName || '',
          mentorId: site.mentorId || '',
        });
      }
    } catch {
      /* ignore website join */
    }
    const usedNames = new Set();
    const customers = Object.values(access)
      .filter((row) => row && typeof row === 'object')
      .map((row) => {
        const email = normalizeRegistrationEmail(row.email);
        const client = clientsByEmail.get(email) || {};
        const eaNames = resolveCustomerEaNames({
          row,
          client,
          db,
          mentorsByEmail,
          usedNames,
        });
        const website = websitesByEmail.get(email) || null;
        return {
          email,
          firstName: String(client.firstName || '').trim(),
          lastName: String(client.lastName || '').trim(),
          fullName: String(client.fullName || [client.firstName, client.lastName].filter(Boolean).join(' ') || '').trim(),
          paidAt: row.paidAt || client.paymentClaimedAt || '',
          amount: row.amount || paidAmountLabel(row.amountCents || SPECIAL_PRICE_CENTS),
          amountCents: Number(row.amountCents || SPECIAL_PRICE_CENTS),
          eaNames,
          key: row.key || row.license?.key || '',
          status: row.status || 'paid',
          reference: row.reference || '',
          website,
        };
      })
      .sort((a, b) => String(b.paidAt || '').localeCompare(String(a.paidAt || '')));
    json(res, 200, {
      ok: true,
      count: customers.length,
      amount: paidAmountLabel(SPECIAL_PRICE_CENTS),
      ownerAdminId: SPECIAL_ADMIN_ID,
      customers,
    });
    return true;
  }

  // Super Admin: rewrite every "Unlimited bull" R350 license to a unique person-based EA name.
  if (path === '/api/special/fix-ea-names' && req.method === 'POST') {
    const session = await verifyAdminSession(req);
    if (!isPortalSuperAdminRequest(req, session)) {
      json(res, 401, { ok: false, error: 'unauthorized' });
      return true;
    }
    const db = await loadRecoveryDb();
    if (!db) {
      json(res, 503, { ok: false, error: 'recovery_unavailable' });
      return true;
    }
    const access = { ...(db.specialAccess && typeof db.specialAccess === 'object' ? db.specialAccess : {}) };
    const clientsByEmail = new Map();
    for (const row of dbList(db.clients)) {
      const em = normalizeRegistrationEmail(row?.email);
      if (em && !clientsByEmail.has(em)) clientsByEmail.set(em, row);
    }
    const usedNames = new Set();
    for (const row of Object.values(access)) {
      const current = String(row?.license?.eaName || '').trim();
      if (current && current.toLowerCase() !== SPECIAL_EA_NAME.toLowerCase()) {
        usedNames.add(current.toLowerCase());
      }
    }
    const keyToName = new Map();
    let renamed = 0;
    for (const [emailKey, row] of Object.entries(access)) {
      if (!row || typeof row !== 'object') continue;
      const email = normalizeRegistrationEmail(row.email || emailKey);
      const client = clientsByEmail.get(email) || {};
      const current = String(row?.license?.eaName || '').trim();
      if (!needsEaRename(current)) continue;
      const eaName = uniqueEaNameForPerson({
        firstName: client.firstName || row.firstName,
        lastName: client.lastName || row.lastName,
        email,
        usedNames,
      });
      const license = {
        ...(row.license && typeof row.license === 'object' ? row.license : {}),
        eaName,
      };
      access[emailKey] = { ...row, email, license, eaName };
      if (row.key || license.key) keyToName.set(String(row.key || license.key).toUpperCase(), eaName);
      renamed += 1;
    }
    const vaultPatch = dbList(db.vault).map((lic) => {
      if (!lic || lic.source !== SPECIAL_SOURCE) return lic;
      const key = String(lic.key || '').toUpperCase();
      const nextName = keyToName.get(key);
      if (!nextName && !needsEaRename(lic.eaName)) return lic;
      const email = normalizeRegistrationEmail(lic.assignedEmail || lic.clientEmail || lic.email);
      const client = clientsByEmail.get(email) || {};
      const eaName =
        nextName ||
        uniqueEaNameForPerson({
          firstName: client.firstName || lic.clientName,
          lastName: client.lastName,
          email,
          usedNames,
        });
      if (key) keyToName.set(key, eaName);
      return { ...lic, eaName };
    });
    const ws = db.store?.workspaces?.[SPECIAL_ADMIN_ID];
    const wsLicenses = dbList(ws?.licenses).map((lic) => {
      if (!lic) return lic;
      const key = String(lic.key || '').toUpperCase();
      const nextName = keyToName.get(key);
      if (!nextName) return lic;
      return { ...lic, eaName: nextName };
    });
    const saved = await mergeRecoveryPatch({
      vault: vaultPatch,
      specialAccess: access,
      specialVersion: Number(db.specialVersion || 0) + 1,
      store: ws
        ? {
            workspaces: {
              [SPECIAL_ADMIN_ID]: {
                ...ws,
                id: SPECIAL_ADMIN_ID,
                licenses: wsLicenses,
              },
            },
          }
        : undefined,
    });
    if (!saved) {
      json(res, 503, { ok: false, error: 'save_failed' });
      return true;
    }
    json(res, 200, { ok: true, renamed, total: Object.keys(access).length });
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
    if (row && row.__offline) {
      json(res, 503, {
        ok: false,
        error: 'unavailable',
        reason: 'special_store_offline',
        message:
          'Access storage is temporarily unavailable. Your payment was not cleared — try again shortly.',
      });
      return true;
    }
    if (!row || row.status !== 'paid' || !row.license?.key) {
      json(res, 404, { ok: false });
      return true;
    }
    json(res, 200, { ok: true, license: row.license });
    return true;
  }

  // Super Admin bulk import of Swagstack / Cape Pulse R350 payers under Mukundi.
  // One recovery DB load + one save so 100s of rows stay within the function timeout.
  if (path === '/api/special/import' && req.method === 'POST') {
    const session = await verifyAdminSession(req);
    if (!isPortalSuperAdminRequest(req, session)) {
      json(res, 401, { ok: false, error: 'unauthorized' });
      return true;
    }
    const payload = await rawBody(req);
    let body = {};
    try {
      body = JSON.parse(payload || '{}');
    } catch {
      body = {};
    }
    const rows = Array.isArray(body?.customers) ? body.customers : [];
    if (!rows.length) {
      json(res, 400, { ok: false, error: 'customers_required' });
      return true;
    }
    const startFrom = String(body?.startFrom || '').trim();
    const amountCents = Number(body?.amountCents || SPECIAL_PRICE_CENTS);
    const db = await loadRecoveryDb();
    if (!db) {
      json(res, 503, { ok: false, error: 'recovery_unavailable' });
      return true;
    }
    const results = [];
    const clientPatch = [];
    const vaultPatch = [];
    const specialAccess = { ...(db.specialAccess || {}) };
    const specialPayments = { ...(db.specialPayments || {}) };
    const ws = db.store?.workspaces?.[SPECIAL_ADMIN_ID];
    if (!ws || typeof ws !== 'object') {
      json(res, 503, { ok: false, error: 'workspace' });
      return true;
    }
    const wsLicenses = dbList(ws.licenses);
    const wsLicenseKeys = new Set(wsLicenses.map((row) => String(row?.key || '').toUpperCase()));
    const newWsLicenses = [];
    let mentors = [];
    try {
      mentors = await listMentors();
    } catch {
      mentors = [];
    }
    const mentorsByEmail = new Map();
    for (const row of Array.isArray(mentors) ? mentors : []) {
      const em = normalizeRegistrationEmail(row?.email);
      if (em) mentorsByEmail.set(em, row);
    }
    const usedEaNames = new Set();
    for (const row of Object.values(specialAccess)) {
      const name = String(row?.license?.eaName || '').trim();
      if (name && name.toLowerCase() !== SPECIAL_EA_NAME.toLowerCase()) {
        usedEaNames.add(name.toLowerCase());
      }
    }

    for (const row of rows.slice(0, 400)) {
      const email = normalizeRegistrationEmail(row?.email);
      const firstName = String(row?.firstName || '').trim();
      const lastName = String(row?.lastName || '').trim();
      const paidAtRaw = String(row?.paidAt || row?.createdDate || '').trim();
      const paidAt =
        paidAtRaw && !Number.isNaN(Date.parse(paidAtRaw))
          ? new Date(paidAtRaw).toISOString()
          : new Date().toISOString();
      if (startFrom && paidAtRaw && paidAtRaw < startFrom) {
        results.push({ email, ok: false, skipped: true, reason: 'before_start' });
        continue;
      }
      if (!isRegistrationEmail(email)) {
        results.push({ email, ok: false, error: 'email' });
        continue;
      }
      const reference = String(row?.reference || `swagstack-${email}-${paidAt.slice(0, 10)}`)
        .replace(/[^a-zA-Z0-9._@-]+/g, '-')
        .slice(0, 120);
      const existing = specialAccess[email];
      const preferredEa = String(row?.eaName || '').trim();
      let entry = existing?.license?.key
        ? {
            key: existing.license.key,
            eaId: existing.license.eaId,
            eaName: existing.license.eaName || '',
            eaImage: existing.license.eaImage || '',
            mainText: existing.license.mainText || '',
            symbols: existing.license.symbols || ['XAUUSD'],
            clientEmail: email,
            email,
            duration: existing.license.duration || 'Included',
            source: SPECIAL_SOURCE,
          }
        : null;
      const reused = Boolean(entry?.key);
      if (!entry?.key) {
        const fromVault = dbList(db.vault).find((lic) => {
          if (!lic || lic.source !== SPECIAL_SOURCE) return false;
          const bound = normalizeRegistrationEmail(lic.assignedEmail || lic.clientEmail || lic.email);
          return bound === email && lic.key;
        });
        entry =
          fromVault ||
          specialLicenseRecord({
            email,
            firstName,
            lastName,
            key: generateLicenseKey(),
            now: paidAt,
            eaName: preferredEa,
            usedNames: usedEaNames,
          });
      }
      if (needsEaRename(entry.eaName) || preferredEa) {
        entry = {
          ...entry,
          eaName:
            preferredEa ||
            uniqueEaNameForPerson({
              firstName,
              lastName,
              email,
              usedNames: usedEaNames,
            }),
        };
      } else if (entry.eaName) {
        usedEaNames.add(String(entry.eaName).toLowerCase());
      }
      const clientName = [firstName, lastName].filter(Boolean).join(' ').trim() || email;
      clientPatch.push({
        id: `cli-special-${email.replace(/[^a-z0-9]+/g, '').slice(0, 24)}`,
        email,
        firstName,
        lastName,
        fullName: clientName,
        status: 'approved',
        paymentClaimed: true,
        paymentClaimedAt: paidAt,
        paymentVerified: true,
        amountPaid: paidAmountLabel(amountCents),
        amountCents,
        source: SPECIAL_SOURCE,
        createdAt: paidAt,
      });
      vaultPatch.push(entry);
      if (!wsLicenseKeys.has(String(entry.key || '').toUpperCase())) {
        newWsLicenses.push(entry);
        wsLicenseKeys.add(String(entry.key || '').toUpperCase());
      }
      specialAccess[email] = {
        email,
        status: 'paid',
        reference,
        key: entry.key,
        license: licenseView(entry),
        paidAt: existing?.paidAt || paidAt,
        amount: paidAmountLabel(amountCents),
        amountCents,
      };
      specialPayments[reference] = {
        reference,
        email,
        status: 'paid',
        amount: amountCents,
        currency: 'ZAR',
        key: entry.key,
        paidAt,
      };
      results.push({
        email,
        firstName,
        lastName,
        paidAt,
        amount: paidAmountLabel(amountCents),
        amountCents,
        eaNames: [entry.eaName].filter(Boolean),
        ok: true,
        reused,
        error: '',
        key: entry.key || '',
      });
    }

    const saved = await mergeRecoveryPatch({
      clients: clientPatch,
      vault: vaultPatch,
      specialAccess,
      specialPayments,
      specialVersion: Number(db.specialVersion || 0) + 1,
      store: {
        workspaces: {
          [SPECIAL_ADMIN_ID]: {
            ...ws,
            id: SPECIAL_ADMIN_ID,
            licenses: [...newWsLicenses, ...wsLicenses],
          },
        },
      },
    });
    if (!saved) {
      json(res, 503, { ok: false, error: 'save_failed', results });
      return true;
    }
    json(res, 200, {
      ok: true,
      imported: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok && !r.skipped).length,
      skipped: results.filter((r) => r.skipped).length,
      amount: paidAmountLabel(amountCents),
      ownerAdminId: SPECIAL_ADMIN_ID,
      results,
    });
    return true;
  }

  return false;
}
