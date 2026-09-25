import { emptyDb, hasDurableBackend, loadDb, saveDb } from './store.mjs';
import {
  adminRoleRank,
  firebasePatchAdminRole,
  firebasePatchClientById,
  firebasePostClientEntry,
  firebaseRegisterMentor,
  firebaseRead,
  firebaseWrite,
  loadMergedClients,
  mergeAdminsLive,
  mergeClients,
  normalizeAdminRole,
  publicAdminList,
  publicAdminRecord,
  publicDbSnapshot,
  hashPassword,
  verifyMentorLogin,
} from './clientMerge.mjs';
import { mergeDatabases } from './mergeDb.mjs';
import { handleLicenseRoutes, loadFirebaseVault } from './licenseRoutes.mjs';
import { handleCommissionRoutes } from './commissionRoutes.mjs';
import { handleMentorPasswordRoutes } from './mentorPassword.mjs';
import { handleCalendarRoutes } from './calendarRoutes.mjs';
import { handleEmailRoutes } from './email/routes.mjs';
import { handleWebsiteRoutes } from './websiteRoutes.mjs';
import {
  formatActivityDate,
  loginBlockForActivity,
  markMentorActivitySatisfied,
  startMentorActivityPeriod,
  sweepMentorActivity,
} from './mentorActivity.mjs';
import { completePasswordReset, consumeLoginAttempt, requestPasswordReset } from './passwordReset.mjs';
import { tryQualifyCommission, tryReverseCommission } from './commissionEngine.mjs';
import {
  matchSuperPassword,
  mintAdminSession,
  verifyAdminSession,
  SUPER_LOGIN,
  corsAllowHeaders,
} from './adminSession.mjs';
import { loadMentorBundle } from './mentorWorkspace.mjs';

/** Never let a Firebase fallback read/write hang a request — fail fast instead. */
function withTimeout(promise, ms = 4000) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(null), ms)),
  ]).catch(() => null);
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.values(value);
  return [];
}

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', corsAllowHeaders());
  res.end(JSON.stringify(data));
}

/** Base64 data URLs for mentor media — ~6 MB decoded image budget */
const MAX_DATA_URL_CHARS = 8_000_000;

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    return {};
  }
}

/** Never let a stale pending push wipe a saved license key. */
function mergeSessionPreferLicense(prev, incoming) {
  if (!incoming || typeof incoming !== 'object') return prev || incoming;
  if (!prev || typeof prev !== 'object') return incoming;
  const prevBot = prev.bot && typeof prev.bot === 'object' ? prev.bot : {};
  const nextBot = incoming.bot && typeof incoming.bot === 'object' ? incoming.bot : {};
  const incomingKey = String(nextBot.licenseKey || '').trim();
  const prevKey = String(prevBot.licenseKey || '').trim();
  // deleteBot clears license + demotes access — allow empty key when not licensed.
  const intentionalClear =
    nextBot.licenseKey !== undefined &&
    !incomingKey &&
    String(incoming.accessStatus || '') !== 'licensed';
  const licenseKey = intentionalClear ? '' : incomingKey || prevKey;
  const accessStatus = licenseKey
    ? 'licensed'
    : intentionalClear
      ? incoming.accessStatus || 'pending'
      : incoming.accessStatus || prev.accessStatus || 'pending';
  return {
    ...prev,
    ...incoming,
    accessStatus,
    bot: {
      ...prevBot,
      ...nextBot,
      licenseKey,
    },
  };
}

function mirrorClientToSuper(db, entry) {
  const sid = 'LM-004821';
  db.store = db.store || { workspaces: {} };
  db.store.workspaces = db.store.workspaces || {};
  const ws = db.store.workspaces[sid] || {
    eas: [],
    licenses: [],
    clientRequests: [],
    mt5: {},
    profile: {},
    orders: [],
    revokedKeys: [],
  };
  const rest = (ws.clientRequests || []).filter((c) => c.id !== entry.id && c.email !== entry.email);
  ws.clientRequests = [entry, ...rest];
  db.store.workspaces[sid] = ws;
}

/** Shared API router used by Vercel serverless + local server.mjs */
export async function handleApi(req, res, pathname) {
  if (req.method === 'OPTIONS') {
    json(res, 204, {});
    return true;
  }

  try {
    if (pathname === '/api/github-deploy' && req.method === 'POST') {
      const { handleGithubDeploy } = await import('./githubDeploy.mjs');
      return handleGithubDeploy(req, res);
    }

    if (pathname === '/api/health') {
      const { db, backend } = await loadDb();
      json(res, 200, {
        ok: true,
        durable: hasDurableBackend(),
        backend,
        updatedAt: db.updatedAt || new Date().toISOString(),
      });
      return true;
    }

    const licenseHandled = await handleLicenseRoutes(req, res, {
      json,
      readBody,
      pathname,
    });
    if (licenseHandled) return true;

    const commissionHandled = await handleCommissionRoutes(req, res, {
      json,
      readBody,
      pathname,
    });
    if (commissionHandled) return true;

    const passwordHandled = await handleMentorPasswordRoutes(req, res, {
      json,
      pathname,
    });
    if (passwordHandled) return true;

    const emailHandled = await handleEmailRoutes(req, res, {
      json,
      readBody,
      pathname,
    });
    if (emailHandled) return true;

    const websiteHandled = await handleWebsiteRoutes(req, res, {
      json,
      readBody,
      pathname,
    });
    if (websiteHandled) return true;

    if (pathname === '/api/auth/forgot' && req.method === 'POST') {
      const body = await readBody(req);
      const { notifyPasswordReset } = await import('./email/index.mjs');
      const result = await requestPasswordReset(body.email, {
        notify: (payload) =>
          notifyPasswordReset({ firebaseRead, firebaseWrite, firebasePush: null }, payload),
      });
      json(res, 200, result);
      return true;
    }

    if (pathname === '/api/auth/reset' && req.method === 'POST') {
      const body = await readBody(req);
      const result = await completePasswordReset({
        email: body.email,
        code: body.code || body.resetCode,
        password: body.password || body.newPassword,
        confirm: body.confirm || body.confirmPassword,
      });
      json(res, result.ok ? 200 : 400, result);
      return true;
    }

    if (pathname === '/api/cron/mentor-activity' && req.method === 'GET') {
      const swept = await sweepMentorActivity();
      json(res, 200, { ok: true, changed: swept.changed });
      return true;
    }

    const calendarHandled = await handleCalendarRoutes(req, res, {
      json,
      readBody,
      pathname,
    });
    if (calendarHandled) return true;

    if (pathname === '/api/mt5/connect') {
      if (req.method !== 'POST') {
        json(res, 405, { error: 'Method not allowed' });
        return true;
      }
      const { connectMt5Broker } = await import('./mt5Bridge.mjs');
      const body = await readBody(req);
      const result = await connectMt5Broker({
        user: body.user,
        password: body.password,
        server: body.server,
      });
      if (result.ok && result.token) {
        json(res, 200, { token: result.token });
      } else {
        json(res, 502, { error: result.error || 'Connect failed' });
      }
      return true;
    }

    if (pathname === '/api/admin/workspace' && req.method === 'GET') {
      const url = new URL(req.url || '', 'https://lumoedge.com');
      const requested = String(
        url.searchParams.get('adminId') || req.headers['x-lumo-admin-id'] || '',
      ).trim();
      const session = await verifyAdminSession(req);
      let adminId = requested;
      if (session.ok) {
        if (session.role !== 'super' && requested && requested !== session.adminId) {
          json(res, 403, { ok: false, error: 'forbidden' });
          return true;
        }
        adminId = session.role === 'super' && requested ? requested : session.adminId;
      }
      if (!adminId) {
        json(res, 400, { ok: false, error: 'adminId required' });
        return true;
      }
      const bundle = await loadMentorBundle(adminId, {
        read: (path) => withTimeout(firebaseRead(path), 8000),
      });
      json(res, 200, { ok: true, adminId, ...bundle });
      return true;
    }

    if (pathname === '/api/db' && req.method === 'GET') {
      const { db } = await loadDb();
      json(res, 200, publicDbSnapshot({
        ...db,
        vault: [],
        images: {},
        clients: [],
        sessions: {},
        store: { workspaces: {} },
      }));
      return true;
    }

    if (pathname === '/api/db' && req.method === 'PUT') {
      const body = await readBody(req);
      const { db, sha } = await loadDb();
      const saved = await saveDb(mergeDatabases(db, body), sha);
      json(res, 200, publicDbSnapshot(saved.db));
      return true;
    }

    if (pathname === '/api/clients' && req.method === 'GET') {
      const merged = await loadMergedClients(loadDb);
      json(res, 200, merged);
      return true;
    }

    if (pathname === '/api/clients' && req.method === 'POST') {
      const body = await readBody(req);
      const { isRegistrationEmail, normalizeRegistrationEmail } = await import(
        './registrationEmail.mjs'
      );
      const email = normalizeRegistrationEmail(body.email);
      if (!isRegistrationEmail(email)) {
        json(res, 400, { error: 'valid email required' });
        return true;
      }
      let created = await firebasePostClientEntry({
        email,
        firstName: String(body.firstName).trim(),
        lastName: String(body.lastName).trim(),
        status: body.status || 'pending',
        paymentClaimed: body.paymentClaimed,
        paymentClaimedAt: body.paymentClaimedAt,
        paymentVerified: false,
      });
      if (String(body.status || '').toLowerCase() === 'approved') {
        created =
          (await firebasePatchClientById(email, {
            status: 'approved',
          })) || created;
      }
      if (!created) {
        json(res, 503, { error: 'Could not save client to Firebase' });
        return true;
      }
      const { db, sha } = await loadDb();
      db.clients = mergeClients(db.clients || [], [created]);
      mirrorClientToSuper(db, created);
      await saveDb(db, sha);
      const mentorId = String(body.mentorId || req.headers['x-lumo-admin-id'] || '').trim();
      if (mentorId) {
        try {
          await markMentorActivitySatisfied(mentorId, 'client');
        } catch {
          /* never block client create */
        }
      }
      json(res, 201, created);
      return true;
    }

    if (pathname.startsWith('/api/clients/') && req.method === 'PATCH') {
      const id = decodeURIComponent(pathname.replace('/api/clients/', ''));
      const body = await readBody(req);
      const fbUpdated = await firebasePatchClientById(id, body);
      if (!fbUpdated) {
        json(res, 404, { error: 'Client not found in Firebase', id, table: 'lumo/clients' });
        return true;
      }
      const { db, sha } = await loadDb();
      db.clients = mergeClients(db.clients || [], [fbUpdated]);
      mirrorClientToSuper(db, fbUpdated);
      await saveDb(db, sha);
      if (String(fbUpdated.status || '').toLowerCase() === 'rejected') {
        await tryReverseCommission({
          email: fbUpdated.email,
          reason: 'Subscription cancelled or payment rejected',
          actorId: 'system:client-patch',
        });
      } else if (fbUpdated.paymentVerified === true) {
        await tryQualifyCommission({
          email: fbUpdated.email,
          source: 'payment',
          actorId: 'system:client-patch',
        });
      }
      json(res, 200, fbUpdated);
      return true;
    }

    if (pathname === '/api/auth/admins' && req.method === 'GET') {
      const curAuth = await firebaseRead('lumo/auth');
      const fbAdmins = toArray(curAuth?.admins);
      const { db } = await loadDb();
      const localAdmins = toArray(db.auth?.admins);
      json(res, 200, publicAdminList(mergeAdminsLive(fbAdmins, localAdmins)));
      return true;
    }

    if (pathname === '/api/auth/login' && req.method === 'POST') {
      const body = await readBody(req);
      const email = String(body.email || '').trim();
      const password = String(body.password || '');
      if (!email || !password) {
        json(res, 400, { error: 'email and password required' });
        return true;
      }
      try {
        const limited = await consumeLoginAttempt(email);
        if (limited.limited) {
          json(res, 401, { ok: false, error: 'invalid_credentials' });
          return true;
        }
      } catch {
        /* never block a valid login if the limiter is unavailable */
      }
      let backupAdmins = [];
      try {
        const { db } = await loadDb();
        backupAdmins = toArray(db.auth?.admins);
      } catch {
        backupAdmins = [];
      }
      let result = await verifyMentorLogin(email, password, backupAdmins);
      if (!result.ok && matchSuperPassword(email, password)) {
        result = { ok: true, admin: { ...SUPER_LOGIN.user } };
      }
      if (result.ok) {
        const blocked = loginBlockForActivity(result.admin);
        if (blocked) {
          json(res, 403, { ok: false, error: blocked.error, message: blocked.message });
          return true;
        }
      }
      if (!result.ok) {
        const status = result.error === 'pending' || result.error === 'inactive' ? 403 : 401;
        json(res, status, {
          ok: false,
          error: result.error || 'invalid_credentials',
          admin: result.admin || null,
        });
        return true;
      }
      const minted = await mintAdminSession(result.admin);
      json(res, 200, {
        ok: true,
        admin: result.admin,
        sessionToken: minted?.token || null,
      });
      return true;
    }

    if (pathname === '/api/auth/admins/repair-sync' && req.method === 'POST') {
      const curAuth = await firebaseRead('lumo/auth');
      const fbAdmins = toArray(curAuth?.admins);
      const { db, sha } = await loadDb();
      const localAdmins = toArray(db.auth?.admins);
      const merged = mergeAdminsLive(fbAdmins, localAdmins);
      db.auth = db.auth || { admins: [], admin: null };
      db.auth.admins = merged;
      try {
        await saveDb(db, sha);
      } catch {
        // Firebase still holds the live mentor queue even if local write fails
      }
      json(res, 200, {
        ok: true,
        total: merged.length,
        pending: merged.filter((a) => normalizeAdminRole(a?.role) === 'pending').length,
        approved: merged.filter((a) => normalizeAdminRole(a?.role) === 'admin').length,
      });
      return true;
    }

    if (pathname === '/api/auth/register' && req.method === 'POST') {
      const body = await readBody(req);
      const { isRegistrationEmail, normalizeRegistrationEmail } = await import(
        './registrationEmail.mjs'
      );
      const email = normalizeRegistrationEmail(body.email);
      const fullName = String(body.fullName || '').trim();
      const password = String(body.password || '');
      if (!isRegistrationEmail(email) || !password || !fullName) {
        json(res, 400, { error: 'email, password, fullName required' });
        return true;
      }
      if (email === 'mukundimukhuba8@gmail.com') {
        json(res, 403, { error: 'This email is reserved for Super Admin.' });
        return true;
      }
      const fbAdmins = toArray((await firebaseRead('lumo/auth'))?.admins);
      const existingFb = fbAdmins.find((a) => String(a.email || '').toLowerCase() === email);
      if (existingFb) {
        json(res, 200, publicAdminRecord(existingFb));
        return true;
      }
      const { db, sha } = await loadDb();
      const admins = toArray(db.auth?.admins);
      const existing = admins.find((a) => String(a.email || '').toLowerCase() === email);
      if (existing) {
        json(res, 200, publicAdminRecord(existing));
        return true;
      }
      const entry = {
        id: `LM-${Math.floor(100000 + Math.random() * 900000)}`,
        email,
        fullName,
        password: hashPassword(password),
        role: 'pending',
        mentorName: String(body.mentorName || '').trim(),
        eaName: String(body.eaName || '').trim(),
        phone: String(body.phone || '').trim(),
        mainText: String(body.mainText || '').trim(),
      };
      const nameParts = fullName.split(/\s+/).filter(Boolean);
      const workspace = {
        eas: [],
        licenses: [],
        clientRequests: [],
        mt5: {},
        profile: {
          firstName: nameParts[0] || '',
          lastName: nameParts.slice(1).join(' '),
          email,
          phone: entry.phone,
          mentorName: entry.mentorName,
          mentorId: entry.id,
          eaDisplayName: entry.eaName,
          mainText: entry.mainText,
          eaImage: '',
          customMedia: [],
        },
        orders: [],
        revokedKeys: [],
      };
      const savedToFirebase = await firebaseRegisterMentor(entry, workspace);
      if (!savedToFirebase) {
        json(res, 503, { error: 'Could not save registration to cloud database' });
        return true;
      }
      db.auth = db.auth || { admins: [], admin: null };
      db.auth.admins = mergeAdminsLive(admins, [entry]);
      db.store = db.store || { workspaces: {} };
      db.store.workspaces = db.store.workspaces || {};
      db.store.workspaces[entry.id] = workspace;
      try {
        await saveDb(db, sha);
      } catch {
        // Firebase is the source of truth for live mentor registrations
      }
      try {
        const { notifyMentorReceived } = await import('./email/index.mjs');
        void notifyMentorReceived(
          { firebaseRead, firebaseWrite, firebasePush: null },
          entry,
        ).catch(() => undefined);
      } catch {
        /* never block registration */
      }
      json(res, 201, publicAdminRecord(entry));
      return true;
    }

    if (pathname.startsWith('/api/auth/admins/') && req.method === 'PATCH') {
      const id = decodeURIComponent(pathname.replace('/api/auth/admins/', ''));
      const body = await readBody(req);
      const role = body.role === 'admin' ? 'admin' : body.role === 'pending' ? 'pending' : null;
      if (!role || !id) {
        json(res, 400, { error: 'id and role (admin|pending) required' });
        return true;
      }
      const { db, sha } = await loadDb();
      db.auth = db.auth || { admins: [], admin: null };
      db.auth.admins = (db.auth.admins || []).map((a) => {
        const match =
          a.id === id || String(a.email || '').toLowerCase() === id.toLowerCase();
        if (!match) return a;
        return {
          ...a,
          role: adminRoleRank(a.role) >= adminRoleRank(role) ? a.role : role,
        };
      });
      const updated =
        (db.auth.admins || []).find(
          (a) =>
            a.id === id || String(a.email || '').toLowerCase() === id.toLowerCase(),
        ) || null;
      let fallback = updated;
      if (!fallback) {
        const fbAuth = await firebaseRead('lumo/auth');
        fallback =
          toArray(fbAuth?.admins).find(
            (a) =>
              a.id === id || String(a.email || '').toLowerCase() === id.toLowerCase(),
          ) || null;
      }
      if (!fallback && body.fallback && typeof body.fallback === 'object') {
        fallback = body.fallback;
      }
      await saveDb(db, sha);
      const priorRole = String(
        (fallback && fallback.role) ||
          (updated && updated.role) ||
          'pending',
      ).toLowerCase();
      const fbUpdated = await firebasePatchAdminRole(id, role, fallback).catch(() => null);
      if (!fbUpdated) {
        console.warn('[api] mentor approve failed', { id, role, email: updated?.email });
        json(res, 502, { ok: false, error: 'approve_failed' });
        return true;
      }
      let active = fbUpdated;
      if (priorRole === 'pending' && role === 'admin') {
        try {
          active =
            (await startMentorActivityPeriod(fbUpdated.id || fbUpdated.email)) || fbUpdated;
        } catch {
          active = fbUpdated;
        }
        try {
          const { notifyMentorApproved } = await import('./email/index.mjs');
          void notifyMentorApproved(
            { firebaseRead, firebaseWrite, firebasePush: null },
            {
              ...active,
              approvalDate: formatActivityDate(active.approvalDate),
              deadlineDate: formatActivityDate(active.deadlineDate),
            },
          ).catch(() => undefined);
        } catch {
          /* never block approve */
        }
      }
      json(res, 200, { ok: true, admin: publicAdminRecord(active || fbUpdated) });
      return true;
    }

    if (pathname.startsWith('/api/clients/') && req.method === 'DELETE') {
      const id = decodeURIComponent(pathname.replace('/api/clients/', ''));
      const { db, sha } = await loadDb();
      const before = (db.clients || []).length;
      db.clients = (db.clients || []).filter((c) => c.id !== id && c.email !== id);
      const sid = 'LM-004821';
      const ws = db.store?.workspaces?.[sid];
      if (ws) {
        ws.clientRequests = (ws.clientRequests || []).filter(
          (c) => c.id !== id && c.email !== id,
        );
      }
      await saveDb(db, sha);
      json(res, 200, { ok: true, removed: before - (db.clients || []).length });
      return true;
    }

    if (pathname.startsWith('/api/sessions/') && req.method === 'GET') {
      const email = decodeURIComponent(pathname.replace('/api/sessions/', '')).toLowerCase();
      const { db } = await loadDb();
      json(res, 200, db.sessions?.[email] ?? null);
      return true;
    }

    if (pathname.startsWith('/api/sessions/') && req.method === 'PUT') {
      const email = decodeURIComponent(pathname.replace('/api/sessions/', '')).toLowerCase();
      const body = await readBody(req);
      const { db, sha } = await loadDb();
      const prev = db.sessions?.[email];
      db.sessions = {
        ...(db.sessions || {}),
        [email]: mergeSessionPreferLicense(prev, body),
      };
      await saveDb(db, sha);
      json(res, 200, { ok: true });
      return true;
    }

    if (pathname === '/api/vault' && req.method === 'GET') {
      const { db } = await loadDb();
      const remoteVault = await withTimeout(loadFirebaseVault(), 8000);
      json(res, 200, (Array.isArray(remoteVault) && remoteVault.length ? remoteVault : db.vault) || []);
      return true;
    }

    if (pathname === '/api/vault' && req.method === 'PUT') {
      const body = await readBody(req);
      const { db, sha } = await loadDb();
      const incoming = Array.isArray(body) ? body : body.vault || db.vault;
      const remoteVault = await withTimeout(loadFirebaseVault(), 8000);
      db.vault = mergeDatabases(
        { vault: Array.isArray(remoteVault) && remoteVault.length ? remoteVault : db.vault },
        { vault: incoming },
      ).vault;
      await saveDb(db, sha);
      if (Array.isArray(db.vault)) {
        await withTimeout(firebaseWrite('lumo/vault', db.vault), 8000);
      }
      json(res, 200, db.vault);
      return true;
    }

    if (pathname.startsWith('/api/images/') && req.method === 'PUT') {
      const key = decodeURIComponent(pathname.replace('/api/images/', '')).trim();
      if (!key) {
        json(res, 400, { error: 'image key required' });
        return true;
      }
      const body = await readBody(req);
      const dataUrl = String(body.dataUrl || '');
      if (!dataUrl.startsWith('data:')) {
        json(res, 400, { error: 'dataUrl required' });
        return true;
      }
      if (dataUrl.length > MAX_DATA_URL_CHARS) {
        json(res, 413, { error: 'File too large for cloud upload (max ~6 MB image)' });
        return true;
      }
      const { db, sha } = await loadDb();
      db.images = { ...(db.images || {}), [key]: dataUrl };
      await saveDb(db, sha);
      // Memory-only store is wiped on every cold start / redeploy — mirror
      // into Firebase RTDB (the same durable store the client already reads
      // EA branding images from) so an upload survives past this instance.
      await withTimeout(firebaseWrite(`lumo/images/${encodeURIComponent(key)}`, dataUrl));
      json(res, 200, { ok: true, url: `/api/images/${encodeURIComponent(key)}` });
      return true;
    }

    if (pathname.startsWith('/api/images/') && (req.method === 'GET' || req.method === 'HEAD')) {
      const key = decodeURIComponent(pathname.replace('/api/images/', '')).trim();
      const { db } = await loadDb();
      let dataUrl = db.images?.[key];
      if (!dataUrl || !String(dataUrl).startsWith('data:')) {
        // Cold-start miss — fall back to the durable Firebase copy.
        const remote = await withTimeout(firebaseRead(`lumo/images/${encodeURIComponent(key)}`));
        if (remote && String(remote).startsWith('data:')) dataUrl = remote;
      }
      if (!dataUrl || !String(dataUrl).startsWith('data:')) {
        json(res, 404, { error: 'Image not found' });
        return true;
      }
      const m = /^data:([^;]+);base64,(.+)$/s.exec(String(dataUrl));
      if (!m) {
        json(res, 404, { error: 'Invalid image' });
        return true;
      }
      const buf = Buffer.from(m[2], 'base64');
      res.statusCode = 200;
      res.setHeader('Content-Type', m[1] || 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.setHeader('Access-Control-Allow-Origin', '*');
      if (req.method === 'HEAD') {
        res.setHeader('Content-Length', String(buf.length));
        res.end();
        return true;
      }
      res.end(buf);
      return true;
    }

    return false;
  } catch (err) {
    json(res, 500, {
      error: err instanceof Error ? err.message : 'API error',
      durable: hasDurableBackend(),
    });
    return true;
  }
}

export { emptyDb };
