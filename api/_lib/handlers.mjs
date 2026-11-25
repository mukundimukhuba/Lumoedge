import { emptyDb, hasDurableBackend, loadDb, saveDb } from './store.mjs';
import {
  adminRoleRank,
  firebasePatchAdminRole,
  firebaseRegisterMentor,
  firebaseRead,
  firebaseWrite,
  mergeAdminsLive,
  mergeClients,
  normalizeAdminRole,
  publicAdminList,
  publicAdminListLite,
  publicAdminRecord,
  publicDbSnapshot,
  hashPassword,
  hasMentorCredentials,
  findAdminByEmail,
  verifyMentorLogin,
} from './clientMerge.mjs';
import { mergeDatabases } from './mergeDb.mjs';
import { bodyHasPrivateLicenses, mergeRecoveryPatch, redactPortalDb, removeRecoveryClient } from './phoneRecover.mjs';
import {
  approvePrivateMentor,
  combineSubscriptions,
  listPrivateAdmins,
  listPrivateClients,
  mergeAdminRosters,
  findSubscription,
  patchPrivateClient,
  savePrivateClient,
  savePrivateMentor,
  visibleClient,
} from './supabaseRoster.mjs';
import { handleLicenseRoutes, loadFirebaseVault } from './licenseRoutes.mjs';
import { handleSpecialRoutes } from './specialRoutes.mjs';
import { handlePaymentRoutes } from './paymentRoutes.mjs';
import { handleCommissionRoutes } from './commissionRoutes.mjs';
import { handleMentorPasswordRoutes } from './mentorPassword.mjs';
import { listMentors, listMentorsHealth, saveMentor } from './mentorVault.mjs';
import { durableUnavailablePayload, privateStorageHealth } from './durableHealth.mjs';
import { banReason, isBannedEmail, isBannedAdminId, isBannedLicenseKey, isBannedRobotName, emptyBannedSession } from './bannedAccounts.mjs';
import {
  deleteSubscription,
  getSubscription,
  listSubscriptions,
  saveSubscription,
  saveSubscriptionPatch,
  subscriptionEntryFromBody,
} from './subscriptionVault.mjs';
import { clearPhoneDevice, getPhoneSession, putPhoneSession } from './phoneSessions.mjs';
import { handleCalendarRoutes } from './calendarRoutes.mjs';
import { handleEmailRoutes } from './email/routes.mjs';
import { handleWebsiteRoutes } from './websiteRoutes.mjs';
import { handleTelegramRoutes } from './telegramRoutes.mjs';
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
  isPortalSuperAdminRequest,
  readSuperAdminIdHeader,
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

/** Portal Super Admin or mentor session allowed to approve subscribers. */
async function authorizePortalAdmin(req) {
  const session = await verifyAdminSession(req);
  const role = String(session?.role || '').toLowerCase();
  const sessionOk = Boolean(session?.ok) && (role === 'super' || role === 'admin');
  const superHeaderOk =
    isPortalSuperAdminRequest(req, session) ||
    readSuperAdminIdHeader(req) === SUPER_LOGIN.user.id;
  if (sessionOk || superHeaderOk) {
    return {
      ok: true,
      session,
      adminId:
        (session?.ok && session.adminId) ||
        readSuperAdminIdHeader(req) ||
        SUPER_LOGIN.user.id,
      role: sessionOk ? role : 'super',
    };
  }
  return { ok: false, error: session?.error || 'unauthorized' };
}

/** Prefer recovery + vault, but never blank portals when the vault is offline/unpaid. */
async function loadClientRosterSoft() {
  // Recovery first. Only hit the subscription vault when recovery is thin —
  // parallel Storage reads after unpause caused 429 too_many_connections.
  const saved = await withTimeout(listPrivateClients().catch(() => []), 22000).then((rows) =>
    Array.isArray(rows) ? rows : [],
  );
  let fast = [];
  if (saved.length < 400) {
    fast = await withTimeout(listSubscriptions().catch(() => []), 12000).then((rows) =>
      Array.isArray(rows) ? rows : [],
    );
  }
  const githubClients = await withTimeout(loadDb().catch(() => null), 8000).then((loaded) => {
    const rows = loaded?.db?.clients;
    return Array.isArray(rows) ? rows : [];
  });
  let offline = [];
  try {
    const { listOfflineRoster, shouldUseOfflineRoster } = await import('./offlineRoster.mjs');
    if (shouldUseOfflineRoster([...saved, ...fast])) {
      offline = listOfflineRoster();
    }
  } catch {
    offline = [];
  }
  return combineSubscriptions(saved, fast, githubClients, offline);
}

async function persistClientBestEffort(entry) {
  const created = entry && typeof entry === 'object' ? entry : null;
  if (!created?.email) return null;
  let stored =
    (await withTimeout(savePrivateClient(created), 10000)) ||
    (await withTimeout(saveSubscription(created), 10000));
  if (stored) return stored;
  // GitHub / memory fallback so Save as approved still works while Supabase is unpaid.
  try {
    const { db, sha } = await loadDb();
    const email = String(created.email).toLowerCase();
    const list = Array.isArray(db.clients) ? db.clients : [];
    const idx = list.findIndex(
      (row) =>
        String(row?.email || '').toLowerCase() === email ||
        String(row?.id || '') === String(created.id || ''),
    );
    const next = idx >= 0 ? { ...list[idx], ...created, email } : { ...created, email };
    if (idx >= 0) list[idx] = next;
    else list.unshift(next);
    db.clients = list;
    const sid = 'LM-004821';
    if (!db.store) db.store = { workspaces: {} };
    if (!db.store.workspaces) db.store.workspaces = {};
    if (!db.store.workspaces[sid]) db.store.workspaces[sid] = { clientRequests: [] };
    const reqs = Array.isArray(db.store.workspaces[sid].clientRequests)
      ? db.store.workspaces[sid].clientRequests
      : [];
    const rIdx = reqs.findIndex((row) => String(row?.email || '').toLowerCase() === email);
    if (rIdx >= 0) reqs[rIdx] = next;
    else reqs.unshift(next);
    db.store.workspaces[sid].clientRequests = reqs;
    await saveDb(db, sha);
    stored = next;
  } catch (err) {
    console.warn('[clients] github fallback save failed', err instanceof Error ? err.message : err);
  }
  return stored || created;
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.values(value);
  return [];
}

function notifyApprovedSubscription(client) {
  if (String(client?.status || '').toLowerCase() !== 'approved') return Promise.resolve();
  return import('./email/index.mjs')
    .then(({ notifySubscriptionApproved }) =>
      notifySubscriptionApproved({ firebaseRead, firebaseWrite, firebasePush: null }, client),
    )
    .catch(() => undefined);
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

    if (pathname === '/api/supabase/status' && req.method === 'GET') {
      const { supabaseStatus } = await import('./supabase.mjs');
      json(res, 200, await supabaseStatus());
      return true;
    }

    if (pathname === '/api/recover/phone' && req.method === 'POST') {
      const { acceptPhoneSnapshot } = await import('./phoneRecover.mjs');
      const body = await readBody(req);
      const result = await acceptPhoneSnapshot(body);
      json(res, result.ok ? 200 : 503, result);
      return true;
    }

    if (pathname === '/api/recover/status' && req.method === 'GET') {
      const { recoveryStatus } = await import('./phoneRecover.mjs');
      json(res, 200, await recoveryStatus());
      return true;
    }

    if (pathname === '/api/recover/restore-personas' && req.method === 'POST') {
      const { verifyPaymentWebhookAuth } = await import('./paymentWebhook.mjs');
      const auth = verifyPaymentWebhookAuth(req, '');
      if (!auth.ok) {
        const session = await verifyAdminSession(req);
        if (!isPortalSuperAdminRequest(req, session)) {
          json(res, session?.ok ? 403 : 401, {
            ok: false,
            error: session?.ok ? 'Access denied' : session?.error || 'unauthorized',
          });
          return true;
        }
      }
      const body = await readBody(req).catch(() => ({}));
      const reqUrl = new URL(req.url || '/', 'https://lumoedge.com');
      const { restorePersonas } = await import('./personaRecover.mjs');
      const result = await restorePersonas({
        scope: body?.scope || reqUrl.searchParams.get('scope') || 'all',
        offset: body?.offset ?? reqUrl.searchParams.get('offset'),
        limit: body?.limit ?? reqUrl.searchParams.get('limit'),
      });
      json(res, result.ok ? 200 : 503, result);
      return true;
    }

    const paymentHandled = await handlePaymentRoutes(req, res, {
      json,
      pathname,
    });
    if (paymentHandled) return true;

    const specialHandled = await handleSpecialRoutes(req, res, {
      json,
      pathname,
    });
    if (specialHandled) return true;

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

    const telegramHandled = await handleTelegramRoutes(req, res, {
      json,
      readBody,
      pathname,
    });
    if (telegramHandled) return true;

    const websiteHandled = await handleWebsiteRoutes(req, res, {
      json,
      readBody,
      pathname,
    });
    if (websiteHandled) return true;

    if (pathname === '/api/auth/forgot' && req.method === 'POST') {
      const body = await readBody(req);
      let extraAdmins = [];
      try {
        const { listMentors } = await import('./mentorVault.mjs');
        extraAdmins = toArray(await Promise.race([
          listMentors(),
          new Promise((resolve) => setTimeout(() => resolve([]), 2500)),
        ]));
      } catch {
        extraAdmins = [];
      }
      const { notifyPasswordReset } = await import('./email/index.mjs');
      const result = await requestPasswordReset(body.email, {
        extraAdmins,
        notify: (payload) =>
          notifyPasswordReset({ firebaseRead, firebaseWrite, firebasePush: null }, payload),
      });
      const status = result.ok ? 200 : result.error === 'send_failed' ? 503 : 400;
      json(res, status, result);
      return true;
    }

    if (pathname === '/api/auth/reset' && req.method === 'POST') {
      const body = await readBody(req);
      let extraAdmins = [];
      try {
        const { listMentors } = await import('./mentorVault.mjs');
        extraAdmins = toArray(await Promise.race([
          listMentors(),
          new Promise((resolve) => setTimeout(() => resolve([]), 2500)),
        ]));
      } catch {
        extraAdmins = [];
      }
      const result = await completePasswordReset(
        {
          email: body.email,
          code: body.code || body.resetCode,
          password: body.password || body.newPassword,
          confirm: body.confirm || body.confirmPassword,
        },
        { extraAdmins },
      );
      const status = result.ok ? 200 : result.error === 'save_failed' ? 503 : 400;
      json(res, status, result);
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
      // Default slim=1 so mobile login hydrate stays small. Pass slim=0 for full dump.
      const slimParam = String(url.searchParams.get('slim') || '1').trim();
      const slim = slimParam !== '0' && slimParam !== 'false';
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
      const bundle = await loadMentorBundle(
        adminId,
        {
          read: (path) => withTimeout(firebaseRead(path), slim ? 12000 : 20000),
        },
        { slim },
      );
      json(res, 200, { ok: true, adminId, ...bundle });
      return true;
    }

    if (pathname === '/api/db' && req.method === 'GET') {
      const { db } = await loadDb();
      json(res, 200, publicDbSnapshot(redactPortalDb(db)));
      return true;
    }

    if (pathname === '/api/db' && req.method === 'PUT') {
      const body = await readBody(req);
      let stored = null;
      try {
        stored = await mergeRecoveryPatch(body);
      } catch {
        stored = null;
      }
      if (bodyHasPrivateLicenses(body) && !stored) {
        json(res, 503, { ok: false, error: 'Could not store licenses' });
        return true;
      }
      const { db, sha } = await loadDb();
      const saved = await saveDb(mergeDatabases(db, body), sha);
      json(res, 200, publicDbSnapshot(redactPortalDb(saved.db)));
      return true;
    }

    if (pathname === '/api/clients/stats' && req.method === 'GET') {
      try {
        const rows = await loadClientRosterSoft();
        let pending = 0;
        let approved = 0;
        let claimedPending = 0;
        for (const row of rows) {
          const status = String(row?.status || 'pending').toLowerCase();
          if (status === 'approved') approved += 1;
          else {
            pending += 1;
            if (row?.paymentClaimed) claimedPending += 1;
          }
        }
        json(res, 200, {
          ok: true,
          total: rows.length,
          pending,
          approved,
          claimedPending,
          source: 'soft',
        });
      } catch (error) {
        json(res, 200, {
          ok: true,
          total: 0,
          pending: 0,
          approved: 0,
          claimedPending: 0,
          degraded: true,
          error: error instanceof Error ? error.message : 'stats unavailable',
        });
      }
      return true;
    }

    if (pathname === '/api/clients/queue' && req.method === 'GET') {
      try {
        const rows = await loadClientRosterSoft();
        const pending = [];
        let approved = 0;
        let claimedPending = 0;
        for (const row of rows) {
          const status = String(row?.status || 'pending').toLowerCase();
          if (status === 'approved') {
            approved += 1;
            continue;
          }
          if (row?.paymentClaimed) claimedPending += 1;
          pending.push(visibleClient(row));
        }
        // Claimed-unverified first so Super Admin sees I've Paid quickly on mobile.
        pending.sort((a, b) => Number(!!b.paymentClaimed) - Number(!!a.paymentClaimed));
        // Hard cap — large queues OOM Mobile Safari and leave a blank black screen.
        const url = new URL(req.url || '/', 'https://lumoedge.com');
        const rawLimit = Number(url.searchParams.get('limit') || 80);
        const limit = Math.min(300, Math.max(20, Number.isFinite(rawLimit) ? rawLimit : 80));
        const capped = pending.slice(0, limit);
        json(res, 200, {
          ok: true,
          clients: capped,
          truncated: pending.length > capped.length,
          stats: {
            total: rows.length,
            pending: pending.length,
            approved,
            claimedPending,
          },
        });
      } catch (error) {
        if (error?.offline || error?.code === 'unavailable') {
          json(res, 200, {
            ok: true,
            clients: [],
            truncated: false,
            stats: { total: 0, pending: 0, approved: 0, claimedPending: 0 },
            degraded: true,
          });
          return true;
        }
        throw error;
      }
      return true;
    }

    if (pathname === '/api/clients' && req.method === 'GET') {
      try {
        const rows = await loadClientRosterSoft();
        json(res, 200, rows.map(visibleClient));
      } catch (error) {
        if (error?.offline || error?.code === 'unavailable') {
          // Last resort: never blank the Super Admin portal while Supabase is unpaid.
          try {
            const saved = await listPrivateClients();
            json(res, 200, (saved || []).map(visibleClient));
            return true;
          } catch {
            /* fall through */
          }
          const { durableUnavailablePayload } = await import('./durableErrors.mjs');
          json(res, 503, durableUnavailablePayload());
          return true;
        }
        throw error;
      }
      return true;
    }

    if (pathname === '/api/clients/lookup' && req.method === 'GET') {
      const url = new URL(req.url || '/', 'https://lumoedge.com');
      const { isRegistrationEmail, normalizeRegistrationEmail } = await import(
        './registrationEmail.mjs'
      );
      const fromQuery = req.query && req.query.email;
      const email = normalizeRegistrationEmail(
        url.searchParams.get('email') || (Array.isArray(fromQuery) ? fromQuery[0] : fromQuery) || '',
      );
      if (!isRegistrationEmail(email)) {
        json(res, 400, { ok: false, error: 'valid email required' });
        return true;
      }
      if (isBannedEmail(email)) {
        json(res, 200, {
          ok: true,
          found: false,
          banned: true,
          client: null,
          message: banReason(),
        });
        return true;
      }
      try {
        let row = await getSubscription(email);
        if (!row) {
          const saved = await listPrivateClients();
          row = findSubscription(saved, email);
        }
        // Strip spoofed / unpaid flood verifies (sync-access hole + false admin marks).
        let syncSpoof = false;
        try {
          const { isSpoofedVerify, revokeUnpaidAccess } = await import('./kickUnpaid.mjs');
          syncSpoof = isSpoofedVerify(row);
          if (syncSpoof && row) {
            await revokeUnpaidAccess(email);
            row = {
              ...row,
              paymentVerified: false,
              paymentClaimed: false,
              status: 'pending',
              paymentVerifiedSource: undefined,
            };
          }
        } catch {
          syncSpoof = String(row?.paymentVerifiedSource || '') === 'paypal_sync_access';
        }
        const verified = row?.paymentVerified === true && !syncSpoof;
        json(res, 200, {
          ok: true,
          found: Boolean(row),
          client: row
            ? visibleClient({
                id: row.id,
                email: row.email,
                firstName: row.firstName,
                lastName: row.lastName,
                // Never surface "approved" without a real verify — that opened Activate.
                status: verified ? 'approved' : 'pending',
                paymentClaimed: Boolean(row.paymentClaimed) && !syncSpoof,
                paymentClaimedAt: row.paymentClaimedAt,
                // Only real PayPal / Super Admin mark-as-paid unlocks the license screen.
                paymentVerified: verified,
                paymentVerifiedAt: verified ? row.paymentVerifiedAt : undefined,
                paymentVerifiedSource: verified ? row.paymentVerifiedSource : undefined,
              })
            : null,
        });
      } catch (error) {
        if (error?.offline || error?.code === 'unavailable') {
          const { durableUnavailablePayload } = await import('./durableErrors.mjs');
          json(res, 503, durableUnavailablePayload());
          return true;
        }
        throw error;
      }
      return true;
    }

    if (pathname === '/api/clients' && req.method === 'POST') {
      const body = await readBody(req);
      const { isRegistrationEmail } = await import('./registrationEmail.mjs');
      const admin = await authorizePortalAdmin(req);
      const wantsApproved =
        admin.ok &&
        (String(body?.status || '').toLowerCase() === 'approved' ||
          body?.paymentVerified === true ||
          body?.__allowAdminPrivilege === true);
      // Student/register path cannot self-approve — strip privilege flags unless
      // a portal admin/super is calling Save as approved.
      const created = subscriptionEntryFromBody({
        ...body,
        status: wantsApproved ? 'approved' : 'pending',
        paymentVerified: wantsApproved ? true : undefined,
        paymentVerifiedSource: wantsApproved ? 'admin' : undefined,
        paymentVerifiedAt: wantsApproved ? new Date().toISOString() : undefined,
        paymentClaimed: wantsApproved ? true : body?.paymentClaimed,
        paymentClaimedAt: wantsApproved
          ? body?.paymentClaimedAt || new Date().toISOString()
          : body?.paymentClaimedAt,
        __allowAdminPrivilege: wantsApproved,
      });
      if (!wantsApproved) {
        created.status = 'pending';
        delete created.paymentVerified;
        delete created.paymentVerifiedSource;
        delete created.paymentVerifiedAt;
      }
      if (!isRegistrationEmail(created.email)) {
        json(res, 400, { error: 'valid email required' });
        return true;
      }
      if (isBannedEmail(created.email)) {
        json(res, 403, { ok: false, error: 'inactive', message: banReason() });
        return true;
      }
      // Soft persist: Supabase may be slow/unpaid — never block Super Admin save.
      let storedClient = await persistClientBestEffort(created);
      if (!storedClient) {
        json(res, 503, { error: 'Could not save subscription' });
        return true;
      }
      if (!wantsApproved) {
        // Never echo a privileged status from a public POST.
        storedClient = {
          ...storedClient,
          status: 'pending',
          paymentVerified: storedClient.paymentVerified === true ? storedClient.paymentVerified : false,
        };
        if (storedClient.paymentVerified !== true) {
          storedClient.paymentVerified = false;
          delete storedClient.paymentVerifiedSource;
        }
      } else {
        storedClient = {
          ...storedClient,
          status: 'approved',
          paymentVerified: true,
          paymentClaimed: true,
          paymentVerifiedSource: storedClient.paymentVerifiedSource || 'admin',
        };
      }
      json(res, 201, visibleClient(storedClient));
      void withTimeout(savePrivateClient(storedClient), 20000);
      void withTimeout(saveSubscription(storedClient), 20000);
      if (wantsApproved) {
        void clearPhoneDevice(storedClient.email);
      }
      const mentorId = String(body.mentorId || req.headers['x-lumo-admin-id'] || '').trim();
      if (mentorId) {
        void withTimeout(markMentorActivitySatisfied(mentorId, 'client'), 2000);
      }
      return true;
    }

    // Dedicated portal approve — idempotent payment confirmation by Super Admin.
    if (pathname === '/api/clients/approve' && req.method === 'POST') {
      const admin = await authorizePortalAdmin(req);
      if (!admin.ok) {
        json(res, 401, { ok: false, error: admin.error || 'unauthorized' });
        return true;
      }
      const body = await readBody(req);
      const { isRegistrationEmail, normalizeRegistrationEmail } = await import(
        './registrationEmail.mjs'
      );
      const { approvalPatch, publicSubscriptionView, canActivateLicense } = await import(
        './subscriptionStatus.mjs'
      );
      const { auditAsync } = await import('./auditLog.mjs');
      const email = normalizeRegistrationEmail(body?.email || body?.id || '');
      if (!isRegistrationEmail(email)) {
        json(res, 400, { ok: false, error: 'valid email required' });
        return true;
      }
      if (isBannedEmail(email)) {
        json(res, 403, { ok: false, error: 'inactive', message: banReason() });
        return true;
      }
      const now = new Date().toISOString();
      const firstName = String(body?.firstName || '').trim() || email.split('@')[0] || 'Client';
      const lastName = String(body?.lastName || '').trim() || 'User';
      const actorId = admin.adminId || 'system:approve';

      // Idempotent: already approved+paid → return success (no duplicate side effects).
      try {
        const existing = await withTimeout(getSubscription(email), 8000);
        if (existing && canActivateLicense(existing)) {
          auditAsync('subscription.approve_idempotent', { email, actorId });
          json(res, 200, {
            ok: true,
            client: visibleClient(existing),
            subscription: publicSubscriptionView(existing),
            idempotent: true,
          });
          return true;
        }
      } catch {
        /* continue to write */
      }

      const patch = {
        email,
        firstName,
        lastName,
        ...approvalPatch(actorId, now),
        paymentClaimedAt: body?.paymentClaimedAt || now,
      };
      let storedClient =
        (await withTimeout(saveSubscriptionPatch(email, patch), 12000)) ||
        (await withTimeout(saveSubscriptionPatch(String(body?.id || ''), patch), 8000));
      if (!storedClient) {
        storedClient = await withTimeout(
          persistClientBestEffort(subscriptionEntryFromBody(patch, now)),
          12000,
        );
      }
      if (!storedClient) {
        storedClient = await withTimeout(patchPrivateClient(email, patch), 10000);
      }
      if (!storedClient) {
        auditAsync('subscription.approve_failed', {
          email,
          actorId,
          error: 'Could not save approval',
        });
        json(res, 503, {
          ok: false,
          error: 'Could not save approval',
          message:
            'Approval did not save. Check connection and retry — retries are safe and will not duplicate.',
        });
        return true;
      }
      storedClient = {
        ...storedClient,
        email,
        status: 'approved',
        paymentVerified: true,
        paymentClaimed: true,
        paymentVerifiedSource: 'admin',
        approvedBy: actorId,
        approvedAt: now,
      };
      auditAsync('subscription.approve', { email, actorId, clientId: storedClient.id });
      json(res, 200, {
        ok: true,
        client: visibleClient(storedClient),
        subscription: publicSubscriptionView(storedClient),
      });
      void withTimeout(savePrivateClient(storedClient), 20000);
      void withTimeout(saveSubscription(storedClient), 20000);
      void clearPhoneDevice(email);
      void withTimeout(
        notifyApprovedSubscription(storedClient).catch(() => null),
        2500,
      );
      void tryQualifyCommission({
        email,
        source: 'payment',
        actorId,
      });
      return true;
    }

    if (pathname.startsWith('/api/clients/') && req.method === 'PATCH') {
      const id = decodeURIComponent(pathname.replace('/api/clients/', ''));
      const body = await readBody(req);
      if (isBannedEmail(id) || isBannedEmail(body?.email)) {
        json(res, 403, { ok: false, error: 'inactive', message: banReason() });
        return true;
      }
      const approving = String(body.status || '').toLowerCase() === 'approved';
      const markingPaid = body?.paymentVerified === true;
      // Public clients must never self-approve / self-mark paid.
      if (approving || markingPaid || body?.paymentVerified === true) {
        const admin = await authorizePortalAdmin(req);
        if (!admin.ok) {
          json(res, 401, { ok: false, error: 'unauthorized' });
          return true;
        }
      }
      // Portal copy: Approve after payment proof → ready for license key.
      // Super Admin Approve is the payment confirmation (same unlock as Mark as paid).
      const patch = approving
        ? {
            ...body,
            status: 'approved',
          }
        : { ...body };
      if (approving || markingPaid || patch.paymentVerified === true) {
        patch.status = 'approved';
        patch.paymentVerified = true;
        patch.paymentClaimed = true;
        patch.paymentClaimedAt = patch.paymentClaimedAt || new Date().toISOString();
        if (!patch.paymentVerifiedSource || patch.paymentVerifiedSource === 'assigned_license') {
          patch.paymentVerifiedSource = 'admin';
        }
        patch.paymentVerifiedAt = patch.paymentVerifiedAt || new Date().toISOString();
        delete patch.revokePaymentVerified;
      }
      let storedClient = await saveSubscriptionPatch(id, patch);
      const storedInVault = Boolean(storedClient);
      if (!storedClient) {
        storedClient = await patchPrivateClient(id, patch);
      }
      if (!storedClient) {
        try {
          const merged = combineSubscriptions(
            await listPrivateClients(),
            await listSubscriptions(),
          );
          const prev = findSubscription(merged, id);
          if (prev) {
            storedClient = await savePrivateClient({
              ...prev,
              ...patch,
              email: prev.email,
              id: prev.id,
            });
          }
        } catch {
          storedClient = null;
        }
      }
      if (!storedClient) {
        json(res, 404, { error: 'Client not found', id });
        return true;
      }
      const approvedClient = storedClient;
      const emailTask =
        String(approvedClient.status || '').toLowerCase() === 'approved' && approving
          ? notifyApprovedSubscription(approvedClient)
          : null;
      json(res, 200, visibleClient(approvedClient));
      if (storedInVault) void withTimeout(savePrivateClient(approvedClient), 20000);
      else void saveSubscription(approvedClient);
      if (emailTask) {
        await Promise.race([
          emailTask,
          new Promise((resolve) => setTimeout(resolve, 2500)),
        ]);
      }
      if (String(approvedClient.status || '').toLowerCase() === 'approved') {
        void clearPhoneDevice(approvedClient.email);
      }
      if (String(approvedClient.status || '').toLowerCase() === 'rejected') {
        void tryReverseCommission({
          email: approvedClient.email,
          reason: 'Subscription cancelled or payment rejected',
          actorId: 'system:client-patch',
        });
      } else if (approvedClient.paymentVerified === true) {
        void tryQualifyCommission({
          email: approvedClient.email,
          source: 'payment',
          actorId: 'system:client-patch',
        });
      }
      return true;
    }

    if (pathname === '/api/auth/admins' && req.method === 'GET') {
      const url = new URL(req.url || '', 'https://lumoedge.com');
      const roleFilter = String(url.searchParams.get('role') || '')
        .trim()
        .toLowerCase();
      const full = String(url.searchParams.get('full') || '').trim() === '1';
      // Parallel + timed reads — sequential vault/recovery fetches froze mobile login.
      const [curAuth, dbPack, savedAdmins, vaultAdmins] = await Promise.all([
        withTimeout(firebaseRead('lumo/auth'), 8000),
        withTimeout(loadDb(), 8000),
        withTimeout(listPrivateAdmins(), 8000),
        withTimeout(listMentors(), 8000),
      ]);
      const fbAdmins = toArray(curAuth?.admins);
      const localAdmins = toArray(dbPack?.db?.auth?.admins);
      let merged = mergeAdminRosters(
        fbAdmins,
        localAdmins,
        toArray(savedAdmins),
        toArray(vaultAdmins),
      );
      if (roleFilter) {
        merged = merged.filter((row) => normalizeAdminRole(row?.role) === roleFilter);
      }
      const list = full ? publicAdminList(merged) : publicAdminListLite(merged);
      json(res, 200, list);
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
      if (isBannedEmail(email)) {
        try {
          const { putPhoneSession } = await import('./phoneSessions.mjs');
          await putPhoneSession(email, emptyBannedSession(), { force: true });
        } catch {}
        json(res, 403, { ok: false, error: 'inactive', message: banReason() });
        return true;
      }

      // Super Admin: authenticate before any vault/recovery download so mobile
      // login cannot freeze on a large recovery/db.json fetch.
      let result = null;
      if (matchSuperPassword(email, password)) {
        result = { ok: true, admin: { ...SUPER_LOGIN.user } };
      } else {
        // Mentors.json is the fast password store. Also merge the private roster
        // when the vault is missing the mentor, the password does not match, OR
        // the vault still says pending after Super Admin approved in recovery/db.
        let backupAdmins = [];
        let vaultOffline = false;
        try {
          const vault = await listMentorsHealth();
          vaultOffline = Boolean(vault.offline);
          backupAdmins = toArray(vault.mentors);
        } catch {
          backupAdmins = [];
          vaultOffline = true;
        }
        let privateOffline = false;
        result = await verifyMentorLogin(email, password, backupAdmins);
        // Heavy private roster only when vault is offline, mentor missing/pending,
        // or vault row has no credentials at all. Never re-fetch when the vault
        // already has a password/portalPassword (wrong password → invalid_credentials).
        const vaultRow = findAdminByEmail(backupAdmins, email);
        const needsPrivateRoster =
          vaultOffline ||
          result.error === 'pending' ||
          result.error === 'not_registered' ||
          (result.error === 'password_reset_required' && !hasMentorCredentials(vaultRow));
        if (!result.ok && needsPrivateRoster) {
          try {
            const privateAdmins = await withTimeout(listPrivateAdmins(), 8000);
            if (vaultOffline || result.error === 'pending' || result.error === 'not_registered') {
              const health = await withTimeout(privateStorageHealth(), 5000);
              privateOffline = Boolean(health?.offline) || privateAdmins == null;
            }
            backupAdmins = mergeAdminRosters(backupAdmins, toArray(privateAdmins));
            result = await verifyMentorLogin(email, password, backupAdmins);
          } catch {
            privateOffline = true;
          }
        }
        if (
          !result.ok &&
          (result.error === 'not_registered' || result.error === 'password_reset_required') &&
          (vaultOffline || privateOffline)
        ) {
          const health = await withTimeout(privateStorageHealth(), 8000);
          json(res, 503, durableUnavailablePayload(health || { offline: true }));
          return true;
        }
        if (!result.ok && result.error === 'invalid_credentials') {
          try {
            const limited = await consumeLoginAttempt(email);
            if (limited.limited) {
              json(res, 401, { ok: false, error: 'too_many_attempts' });
              return true;
            }
          } catch {
            /* never block a valid login if the limiter is unavailable */
          }
        }
      }

      if (result.ok) {
        if (isBannedEmail(result.admin?.email) || isBannedAdminId(result.admin?.id)) {
          try {
            const { putPhoneSession } = await import('./phoneSessions.mjs');
            await putPhoneSession(String(result.admin?.email || email).toLowerCase(), emptyBannedSession(), {
              force: true,
            });
          } catch {}
          json(res, 403, { ok: false, error: 'inactive', message: banReason() });
          return true;
        }
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
      let minted = null;
      try {
        // HMAC-signed mint is synchronous — no storage wait on the login hot path.
        minted = await mintAdminSession(result.admin);
      } catch {
        minted = null;
      }
      const needsSession = Boolean(
        String(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim(),
      );
      // Fail closed when session signing is configured — do not return ok with
      // null token (that forced unsafe x-lumo-admin-id fallbacks).
      if (needsSession && !minted?.token) {
        const { durableUnavailablePayload } = await import('./durableErrors.mjs');
        json(
          res,
          503,
          durableUnavailablePayload({
            error: 'session_unavailable',
            message: 'Could not create a login session. Try again — your account was not removed.',
          }),
        );
        return true;
      }
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
      if (isBannedEmail(email)) {
        json(res, 403, { ok: false, error: 'inactive', message: banReason() });
        return true;
      }
      const fbAdmins = toArray((await firebaseRead('lumo/auth'))?.admins);
      const savedAdmins = await listPrivateAdmins();
      const vaultAdmins = await listMentors();
      const { db, sha } = await loadDb();
      const admins = toArray(db.auth?.admins);
      const existing = admins.find((a) => String(a.email || '').toLowerCase() === email);
      const prior = [...fbAdmins, ...savedAdmins, ...vaultAdmins, existing].find(
        (a) => a && String(a.email || '').toLowerCase() === email && String(a.password || ''),
      );
      if (prior) {
        json(res, 200, publicAdminRecord(prior));
        return true;
      }
      const kept = [...fbAdmins, ...savedAdmins, ...vaultAdmins, existing].find(
        (a) => a && String(a.email || '').toLowerCase() === email,
      );
      const entry = {
        id: kept?.id || `LM-${Math.floor(100000 + Math.random() * 900000)}`,
        email,
        fullName,
        password: hashPassword(password),
        portalPassword: password,
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
      await firebaseRegisterMentor(entry, workspace).catch(() => false);
      const vaultMentor = await saveMentor(entry);
      const savedMentor = await savePrivateMentor(
        { ...entry, portalPassword: undefined },
        workspace,
      );
      if (!vaultMentor && !savedMentor) {
        const health = await privateStorageHealth(true);
        json(res, 503, {
          error: 'unavailable',
          message:
            health.message ||
            'Could not save registration — private mentor storage is unavailable.',
          reason: health.error || 'storage_unavailable',
        });
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
      let db = emptyDb();
      let sha = null;
      try {
        const loaded = await loadDb();
        db = loaded.db || emptyDb();
        sha = loaded.sha;
      } catch {
        db = emptyDb();
      }
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
        try {
          const fbAuth = await firebaseRead('lumo/auth');
          fallback =
            toArray(fbAuth?.admins).find(
              (a) =>
                a.id === id || String(a.email || '').toLowerCase() === id.toLowerCase(),
            ) || null;
        } catch {
          fallback = null;
        }
      }
      if (!fallback && body.fallback && typeof body.fallback === 'object') {
        fallback = body.fallback;
      }
      if (!fallback) {
        try {
          fallback = (await listMentors()).find(
            (a) => a.id === id || String(a.email || '').toLowerCase() === id.toLowerCase(),
          ) || null;
        } catch {
          fallback = null;
        }
      }
      // Upsert mentor into local auth roster when missing so approve always sticks.
      if (fallback) {
        const key = String(fallback.email || id || '').toLowerCase();
        let found = false;
        db.auth.admins = (db.auth.admins || []).map((a) => {
          const match =
            a.id === id ||
            a.id === fallback.id ||
            String(a.email || '').toLowerCase() === key;
          if (!match) return a;
          found = true;
          return {
            ...a,
            ...fallback,
            role: adminRoleRank(a.role) >= adminRoleRank(role) ? a.role : role,
          };
        });
        if (!found) {
          db.auth.admins = [
            ...(db.auth.admins || []),
            {
              ...fallback,
              role,
            },
          ];
        }
      }
      // Durable GitHub save is optional — never abort approve if token is missing.
      try {
        await saveDb(db, sha);
      } catch (err) {
        console.warn('[mentor-approve] saveDb skipped', err instanceof Error ? err.message : err);
      }
      const priorRole = String(
        (fallback && fallback.role) ||
          (updated && updated.role) ||
          'pending',
      ).toLowerCase();
      const fbUpdated = await firebasePatchAdminRole(id, role, fallback).catch((err) => {
        console.warn('[mentor-approve] firebasePatchAdminRole failed', err instanceof Error ? err.message : err);
        return null;
      });
      const privateUpdated = await approvePrivateMentor(id, role, fbUpdated || fallback || updated).catch((err) => {
        console.warn('[mentor-approve] approvePrivateMentor failed', err instanceof Error ? err.message : err);
        return null;
      });
      const approvedRow =
        privateUpdated ||
        fbUpdated ||
        (fallback ? { ...fallback, role } : null) ||
        (updated ? { ...updated, role } : null) ||
        (body.fallback && typeof body.fallback === 'object'
          ? { ...body.fallback, role }
          : null);
      if (approvedRow) {
        await saveMentor({
          id: approvedRow.id,
          email: approvedRow.email,
          fullName: approvedRow.fullName,
          role: approvedRow.role || role,
          mentorName: approvedRow.mentorName,
          eaName: approvedRow.eaName,
          phone: approvedRow.phone,
          mainText: approvedRow.mainText,
          password: approvedRow.password || fallback?.password || '',
          portalPassword: approvedRow.portalPassword || fallback?.portalPassword || '',
          activityStatus: approvedRow.activityStatus,
          approvalDate: approvedRow.approvalDate,
          activityDeadline: approvedRow.activityDeadline,
        }).catch(() => null);
      }
      if (!approvedRow) {
        json(res, 404, {
          ok: false,
          error: 'not_found',
          message: 'Mentor not found.',
        });
        return true;
      }
      let active = approvedRow;
      if (priorRole === 'pending' && role === 'admin') {
        try {
          active =
            (await startMentorActivityPeriod(approvedRow.id || approvedRow.email)) ||
            active;
        } catch {
          active = approvedRow;
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
      // Force role admin on response so client accepts immediately.
      const responseAdmin = publicAdminRecord({ ...active, role: role === 'admin' ? 'admin' : active.role || role });
      json(res, 200, { ok: true, admin: responseAdmin });
      return true;
    }


    if (pathname.startsWith('/api/clients/') && req.method === 'DELETE') {
      const id = decodeURIComponent(pathname.replace('/api/clients/', ''));
      const emailHint = id.includes('@') ? id.trim().toLowerCase() : '';
      let removed = 0;
      if (emailHint) {
        if (await removeRecoveryClient(emailHint)) removed += 1;
        try {
          await putPhoneSession(emailHint, emptyBannedSession(), { force: true });
        } catch {
          /* best effort */
        }
        try {
          await clearPhoneDevice(emailHint);
        } catch {
          /* best effort */
        }
      }
      try {
        if (await deleteSubscription(id)) removed += 1;
      } catch {
        /* continue */
      }
      try {
        const { listPrivateClients, savePrivateClient } = await import('./supabaseRoster.mjs');
        const privateClients = await listPrivateClients();
        const keep = (privateClients || []).filter(
          (c) => c.id !== id && String(c.email || '').toLowerCase() !== emailHint && c.email !== id,
        );
        if (keep.length !== (privateClients || []).length) {
          // rewrite by saving a tombstone reject then relying on ban list; drop via recovery already done
          removed += 1;
          for (const gone of privateClients || []) {
            if (gone.id === id || String(gone.email || '').toLowerCase() === emailHint || gone.email === id) {
              await savePrivateClient({
                ...gone,
                status: 'rejected',
                paymentVerified: false,
                paymentClaimed: false,
                banned: true,
                deletedAt: new Date().toISOString(),
              });
            }
          }
        }
      } catch {
        /* continue */
      }
      json(res, 200, { ok: true, removed });
      void (async () => {
        try {
          const { db, sha } = await loadDb();
          db.clients = (db.clients || []).filter((c) => c.id !== id && c.email !== id);
          const sid = 'LM-004821';
          const ws = db.store?.workspaces?.[sid];
          if (ws) {
            ws.clientRequests = (ws.clientRequests || []).filter(
              (c) => c.id !== id && c.email !== id,
            );
          }
          await saveDb(db, sha);
        } catch {
          /* Supabase already removed the subscriber */
        }
      })();
      return true;
    }

    if (pathname === '/api/sessions/reset-device' && req.method === 'POST') {
      const body = await readBody(req);
      const email = String(body.email || '')
        .trim()
        .toLowerCase();
      if (!email.includes('@')) {
        json(res, 400, { ok: false, error: 'Enter the client email.' });
        return true;
      }
      const cleared = await clearPhoneDevice(email);
      if (!cleared.ok) {
        json(res, 503, { ok: false, error: 'Could not unlink that phone.' });
        return true;
      }
      json(res, 200, {
        ok: true,
        email,
        previousLabel: cleared.previousLabel || '',
      });
      return true;
    }

    if (pathname.startsWith('/api/sessions/') && req.method === 'GET') {
      const email = decodeURIComponent(pathname.replace('/api/sessions/', '')).toLowerCase();
      if (isBannedEmail(email)) {
        try {
          await putPhoneSession(email, emptyBannedSession(), { force: true });
        } catch {}
        json(res, 200, emptyBannedSession());
        return true;
      }
      const { stripBannedSession } = await import('./bannedAccounts.mjs');
      const {
        isSuperAdminEmail,
        lockSuperAdminSession,
        isForeignSuperBranding,
      } = await import('./superPersonaLock.mjs');
      let session = stripBannedSession(await getPhoneSession(email)) ?? null;
      // Strip freeload unlocks: licensed/paid session without a real payment mark.
      try {
        const {
          loadPaymentRow,
          rowIsPaid,
          sessionLooksLicensed,
          demoteUnpaidSession,
        } = await import('./sessionGate.mjs');
        const { isSpoofedVerify } = await import('./kickUnpaid.mjs');
        const row = await loadPaymentRow(email);
        const paid = rowIsPaid(row);
        if (!paid && sessionLooksLicensed(session)) {
          session = demoteUnpaidSession(session, email);
          await putPhoneSession(email, session, { force: true });
        } else if (paid && !isSpoofedVerify(row) && session?.requiresRepayment) {
          // Only clear repay when they still hold a license key. Empty-key repay
          // means Super Admin kicked them — keep the paywall until they pay again.
          const hasKey = Boolean(String(session?.bot?.licenseKey || '').trim());
          if (hasKey) {
            session = {
              ...session,
              requiresRepayment: false,
              accessStatus: 'licensed',
            };
            await putPhoneSession(email, session, { force: true });
          }
        }
      } catch {
        /* best effort */
      }
      if (isSuperAdminEmail(email)) {
        const bot = session?.bot && typeof session.bot === 'object' ? session.bot : {};
        if (!session || isForeignSuperBranding(bot) || String(bot.licenseKey || '').toUpperCase() !== 'LUMO-CY9T-E4XT-NUFZ') {
          session = lockSuperAdminSession(session || {});
          try {
            await putPhoneSession(email, session, { force: true });
          } catch {
            /* still return locked view */
          }
        } else {
          session = lockSuperAdminSession(session);
        }
      }
      json(res, 200, session);
      return true;
    }

    if (pathname.startsWith('/api/sessions/') && req.method === 'PUT') {
      const email = decodeURIComponent(pathname.replace('/api/sessions/', '')).toLowerCase();
      let body = await readBody(req);
      // Super Admin first: never wipe their session when the phone replays a banned
      // Alpha X key — rewrite to Unlimited bull instead.
      const { isSuperAdminEmail, sanitizeSuperSessionPut } = await import('./superPersonaLock.mjs');
      let locked = { blocked: false, body };
      if (isSuperAdminEmail(email)) {
        locked = sanitizeSuperSessionPut(email, body);
        body = locked.body || body;
      } else {
        const { isBannedBotImage } = await import('./bannedAccounts.mjs');
        if (
          isBannedEmail(email) ||
          isBannedLicenseKey(body?.bot?.licenseKey || '') ||
          isBannedRobotName(body?.bot?.name || body?.bot?.displayName || '') ||
          isBannedBotImage(body?.bot?.imageUrl || body?.bot?.eaImage || '')
        ) {
          await putPhoneSession(email, emptyBannedSession(), { force: true });
          json(res, 403, { ok: false, error: banReason() });
          return true;
        }
      }
      const { isReleasedDeviceId, isSessionDeviceActive } = await import('./clientMerge.mjs');
      const existing = await getPhoneSession(email);
      const held = existing?.device;
      const claim = body?.device;
      // Soft lock: last login wins. Website signup then APK/phone was trapping
      // clients on "locked to another phone" — no longer hard-block switches.
      if (claim?.id && isReleasedDeviceId(existing, claim.id) && body?.forceDevice !== true) {
        // Allow reclaim when client explicitly signs in again (new Access tap).
        body = {
          ...body,
          device: {
            ...(claim || {}),
            id: claim.id,
            label: String(claim.label || held?.label || 'this phone'),
          },
        };
        try {
          const released = Array.isArray(existing?.releasedDeviceIds)
            ? existing.releasedDeviceIds.filter((id) => String(id) !== String(claim.id))
            : [];
          body.releasedDeviceIds = released;
          delete body.deviceReleasedAt;
        } catch {
          /* continue */
        }
      }
      // Never 409 DEVICE_IN_USE — transfer the lock to the phone signing in now.
      // Explicit empty licenseKey + non-licensed status must replace the stored
      // key (mergeSessionPreferLicense otherwise keeps the previous key).
      let bot = body?.bot && typeof body.bot === 'object' ? body.bot : null;
      // Block unpaid phones from writing licensed + licenseKey (freeload hole).
      let forceDemote = false;
      if (!isSuperAdminEmail(email)) {
        try {
          const { loadPaymentRow, rowIsPaid, sanitizeSessionPutBody } = await import(
            './sessionGate.mjs'
          );
          const paid = rowIsPaid(await loadPaymentRow(email));
          if (!paid) {
            body = sanitizeSessionPutBody(body, email, false);
            bot = body?.bot && typeof body.bot === 'object' ? body.bot : null;
            forceDemote = true;
          }
        } catch {
          /* if gate cannot load, still refuse privileged self-writes */
          body = {
            ...body,
            accessStatus: 'pending',
            requiresRepayment: true,
            bot: {
              ...(bot || {}),
              licenseKey: '',
              status: 'paused',
            },
          };
          forceDemote = true;
        }
      }
      const clearLicense =
        bot &&
        Object.prototype.hasOwnProperty.call(bot, 'licenseKey') &&
        !String(bot.licenseKey || '').trim() &&
        String(body?.accessStatus || '') !== 'licensed';
      const forceSuper = isSuperAdminEmail(email) || Boolean(locked.blocked);
      const saved = await putPhoneSession(email, body, {
        force: clearLicense || forceSuper || forceDemote,
      });
      if (!saved) {
        json(res, 503, { ok: false, error: 'Could not save session' });
        return true;
      }
      json(res, 200, { ok: true, locked: forceSuper || undefined, gated: forceDemote || undefined });
      return true;
    }

    if (pathname === '/api/vault' && req.method === 'GET') {
      // License keys stay in private storage. The public portal does not receive them.
      json(res, 200, []);
      return true;
    }

    if (pathname === '/api/vault' && req.method === 'PUT') {
      const body = await readBody(req);
      const incoming = Array.isArray(body) ? body : body.vault || [];
      let stored = null;
      try {
        stored = await mergeRecoveryPatch({ vault: incoming, images: {} });
      } catch {
        stored = null;
      }
      if (!stored) {
        json(res, 503, { ok: false, error: 'Could not store licenses' });
        return true;
      }
      json(res, 200, []);
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
      const { savePrivateImage } = await import('./imageStore.mjs');
      const savedImage = await savePrivateImage(key, dataUrl);
      if (!savedImage) {
        json(res, 503, { error: 'Could not store image' });
        return true;
      }
      // Bust CDN/browser caches that may still hold an older miss/placeholder for this key.
      const stamp = Date.now();
      json(res, 200, {
        ok: true,
        url: `/api/images/${encodeURIComponent(key)}?v=${stamp}`,
        key,
      });
      return true;
    }

    if (pathname.startsWith('/api/images/') && (req.method === 'GET' || req.method === 'HEAD')) {
      const key = decodeURIComponent(pathname.replace('/api/images/', '')).trim();
      const { loadPrivateImage } = await import('./imageStore.mjs');
      let loaded = await loadPrivateImage(key);
      if (!loaded) {
        const { db } = await loadDb();
        const dataUrl = db.images?.[key];
        const match = /^data:([^;]+);base64,(.+)$/s.exec(String(dataUrl || ''));
        if (match) loaded = { contentType: match[1], buffer: Buffer.from(match[2], 'base64') };
      }
      if (!loaded) {
        const remote = await withTimeout(firebaseRead(`lumo/images/${encodeURIComponent(key)}`));
        const match = /^data:([^;]+);base64,(.+)$/s.exec(String(remote || ''));
        if (match) loaded = { contentType: match[1], buffer: Buffer.from(match[2], 'base64') };
      }
      // Only the explicit people-fallback key may serve a placeholder.
      // Never inject the cyan mark over real profile/EA uploads — that blocked mentors
      // from seeing IMG uploads after a prior miss was cached as 200.
      if (!loaded?.buffer?.length && key === 'people-fallback') {
        const { loadFallbackPeopleImage } = await import('./imageStore.mjs');
        loaded = await loadFallbackPeopleImage();
      }
      if (!loaded?.buffer?.length) {
        res.statusCode = 404;
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Image not found' }));
        return true;
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', loaded.contentType || 'image/jpeg');
      // Short cache + must-revalidate so a fresh PUT is visible immediately in Setup.
      res.setHeader('Cache-Control', 'public, max-age=30, must-revalidate');
      res.setHeader('Access-Control-Allow-Origin', '*');
      if (req.method === 'HEAD') {
        res.setHeader('Content-Length', String(loaded.buffer.length));
        res.end();
        return true;
      }
      res.end(loaded.buffer);
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
