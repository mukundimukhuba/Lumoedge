import { vaultEntryToLicense } from './repairLicenses.mjs';
import { banReason, isBannedAdminId, isBannedEmail, isBannedLicenseKey } from './bannedAccounts.mjs';
import {
  assignEntry,
  dbList,
  findVaultEntry,
  findWorkspaceLicense,
  keysMatch,
  keysMatchExact,
  keyFingerprint,
  releaseEntry,
  toClaimPayload,
  validateEmailAccess,
} from './licenseClaim.mjs';

function vaultArray(raw) {
  if (Array.isArray(raw)) return raw.filter(Boolean);
  if (raw && typeof raw === 'object') {
    return Object.values(raw).filter((entry) => entry && typeof entry === 'object');
  }
  return [];
}

async function savedRecoveryDb() {
  try {
    const { loadRecoveryDb } = await import('./phoneRecover.mjs');
    return await loadRecoveryDb();
  } catch {
    return null;
  }
}

async function rememberRecovery(patch) {
  try {
    const { mergeRecoveryPatch } = await import('./phoneRecover.mjs');
    return Boolean(await mergeRecoveryPatch(patch));
  } catch {
    return false;
  }
}

export async function loadFirebaseVault() {
  const { loadLicenseVault } = await import('./licenseVaultStore.mjs');
  const vault = await loadLicenseVault();
  if (Array.isArray(vault) && vault.length) return vaultArray(vault);
  return [];
}

async function saveFirebaseVault(entries) {
  const { mergeLicenseVault } = await import('./licenseVaultStore.mjs');
  const list = vaultArray(entries);
  const saved = await mergeLicenseVault(list);
  if (!saved) throw new Error('Could not save license vault');
}

async function loadLicenseEntry(key) {
  // Per-key store ONLY — never touch recovery/db.json here (8MB+ → 429/timeout).
  const { loadLicenseByKey } = await import('./licenseVaultStore.mjs');
  const direct = await loadLicenseByKey(key);
  if (direct) return direct;
  return null;
}

async function loadWorkspace(adminId, recovery = null) {
  if (!adminId) return null;
  const db = recovery || (await savedRecoveryDb());
  const saved = db?.store?.workspaces?.[adminId];
  return saved && typeof saved === 'object' ? saved : null;
}

async function saveWorkspace(adminId, workspace) {
  const saved = await rememberRecovery({
    images: {},
    store: { workspaces: { [adminId]: workspace } },
  });
  if (!saved) throw new Error('Could not save workspace licenses');
}

function workspaceLicensePatch(workspace, adminId, key, patch, vaultEntry) {
  const baseWs = workspace || {
    id: adminId,
    eas: [],
    licenses: [],
    clientRequests: [],
    mt5: {},
    profile: {},
    orders: [],
    revokedKeys: [],
  };
  const licenses = dbList(baseWs.licenses);
  const existing = licenses.find(
    (license) => license && keysMatch(String(license.key || ''), key) && license.status !== 'deleted',
  );
  const base = existing || (vaultEntry ? vaultEntryToLicense(vaultEntry) : null);
  if (!base) return baseWs;
  const nextLicense = { ...base, ...patch, ownerAdminId: base.ownerAdminId || adminId };
  const nextLicenses = existing
    ? licenses.map((license) =>
        keysMatch(String(license?.key || ''), key) ? nextLicense : license,
      )
    : [nextLicense, ...licenses];
  return { ...baseWs, id: adminId, licenses: nextLicenses };
}

function applyRevokedKeys(entries, revokedKeys) {
  const revoked = dbList(revokedKeys)
    .map((key) => String(key || '').trim())
    .filter(Boolean);
  if (!revoked.length) return entries;
  const revokedFp = new Set(revoked.map((key) => keyFingerprint(key)).filter(Boolean));
  return dbList(entries).map((entry) => {
    if (!entry?.key) return entry;
    const fp = keyFingerprint(entry.key);
    const hit = fp && revokedFp.has(fp);
    if (hit) return { ...entry, revoked: true, status: 'deleted' };
    // Undo false deletes from older fuzzy revoke matching.
    if (
      String(entry.status || '').toLowerCase() === 'deleted' &&
      entry.revoked &&
      fp &&
      !revokedFp.has(fp)
    ) {
      return {
        ...entry,
        revoked: false,
        status: entry.assignedEmail ? 'assigned' : 'active',
      };
    }
    return entry;
  });
}

function findVaultEntryAny(vault, key) {
  return dbList(vault).find((entry) => entry && keysMatchExact(String(entry.key || ''), key));
}

function workspaceMap(adminId, workspace) {
  if (!adminId || !workspace) return {};
  return { [adminId]: workspace };
}

async function upsertWorkspaceLicense(adminId, key, patch, vaultEntry) {
  if (!adminId || !key) return null;
  const workspace = await loadWorkspace(adminId);
  const next = workspaceLicensePatch(workspace, adminId, key, patch, vaultEntry);
  await saveWorkspace(adminId, next);
  return next;
}

export async function handleLicenseRoutes(req, res, { json, readBody, pathname }) {
  const path = String(pathname || '').replace(/\/+$/, '') || '/';

  if (path === '/api/licenses/publish' && req.method === 'POST') {
    const body = await readBody(req);
    const adminId = String(body?.adminId || '').trim();
    const key = String(body?.key || body?.licenseKey || '').trim();
    const vaultEntries = Array.isArray(body?.vaultEntries)
      ? body.vaultEntries.filter((entry) => entry && entry.key)
      : [];
    const workspace = body?.workspace && typeof body.workspace === 'object' ? body.workspace : null;
    const revokedKeys = Array.isArray(body?.revokedKeys) ? body.revokedKeys : [];

    if (!adminId || (!key && !vaultEntries.length && !workspace)) {
      json(res, 400, { ok: false, error: 'adminId and license key required' });
      return true;
    }

    // Prefer a single key from the body — never hydrate from recovery/db.json.
    let prior = null;
    if (key && !vaultEntries.length) {
      try {
        prior = await loadLicenseEntry(key);
      } catch {
        prior = null;
      }
    }
    const incomingVault = vaultEntries.length
      ? vaultEntries
      : key
        ? [
            {
              ...(prior || {}),
              key,
              adminId,
              ownerAdminId: adminId,
              status: 'active',
              clientEmail:
                String(body?.clientEmail || body?.email || prior?.clientEmail || '').trim() ||
                prior?.clientEmail ||
                null,
              email:
                String(body?.clientEmail || body?.email || prior?.email || '').trim() ||
                prior?.email ||
                null,
              plan: body?.plan || prior?.plan || null,
              createdAt: prior?.createdAt || new Date().toISOString(),
              assignedEmail: null,
              assignedAt: null,
              __forceRelease: true,
            },
          ]
        : [];
    // Cap workspace fan-out — publish must stay a small per-key write.
    const fromWorkspace = dbList(workspace?.licenses)
      .filter((lic) => lic && (!key || keysMatch(String(lic.key || ''), key)))
      .slice(0, 5)
      .map((lic) => ({
        ...lic,
        ownerAdminId: lic?.ownerAdminId || adminId,
        adminId: lic?.adminId || adminId,
      }));
    const toSave = [...vaultArray(incomingVault), ...fromWorkspace];
    if (!toSave.length) {
      json(res, 400, { ok: false, error: 'adminId and license key required' });
      return true;
    }

    // Per-key objects — Claim reads these without touching recovery/db.json.
    const { mergeLicenseVault } = await import('./licenseVaultStore.mjs');
    const compactVault = await mergeLicenseVault(toSave);
    if (!compactVault || !compactVault.length) {
      json(res, 503, { ok: false, error: 'Could not save license vault' });
      return true;
    }
    // Do NOT mirror into recovery/db.json on the request path — that object is
    // overloaded and aborts Generate/Claim with timeouts.
    const merged = { vault: compactVault };

    // Respond first — email / mentor / commission must never delay Generate.
    json(res, 200, {
      ok: true,
      key: key || vaultEntries[0]?.key || '',
    });

    void (async () => {
      try {
        const { notifyLicenseKey } = await import('./email/index.mjs');
        const { markMentorActivitySatisfied } = await import('./mentorActivity.mjs');
        const { firebaseRead, firebaseWrite } = await import('./clientMerge.mjs');
        const licenses = [
          ...incomingVault,
          ...dbList(workspace?.licenses),
          ...(key ? [findVaultEntry(merged.vault, key)].filter(Boolean) : []),
        ];
        const seen = new Set();
        for (const license of licenses) {
          const clientEmail = String(license?.clientEmail || license?.email || '')
            .trim()
            .toLowerCase();
          const licenseKey = String(license?.key || '').trim();
          if (!clientEmail || !licenseKey) continue;
          const stamp = licenseKey.toUpperCase().replace(/[^A-Z0-9]/g, '');
          if (seen.has(stamp)) continue;
          seen.add(stamp);
          void notifyLicenseKey(
            { firebaseRead, firebaseWrite, firebasePush: null },
            {
              ...license,
              email: clientEmail,
              clientEmail,
              key: licenseKey,
              ownerAdminId: adminId,
            },
          ).catch(() => undefined);
        }
        if (adminId && seen.size) {
          await markMentorActivitySatisfied(adminId, 'license');
        }
      } catch {
        /* ignore */
      }
    })();
    return true;
  }

  // Revalidate an already-stored key without re-assigning — Android / web boot gate.
  if (path === '/api/licenses/verify' && req.method === 'POST') {
    const body = await readBody(req);
    const key = String(body?.key || '').trim();
    const email = String(body?.email || '').trim().toLowerCase();
    if (!key || !email) {
      json(res, 400, { ok: false, error: 'Invalid key', valid: false });
      return true;
    }
    if (isBannedEmail(email) || isBannedLicenseKey(key)) {
      json(res, 403, { ok: false, error: banReason(), valid: false });
      return true;
    }
    const { loadLicenseByKey } = await import('./licenseVaultStore.mjs');
    const entry = await loadLicenseByKey(key);
    if (entry === null) {
      json(res, 503, { ok: false, error: 'unavailable', valid: false });
      return true;
    }
    if (!entry) {
      json(res, 200, { ok: true, valid: false, reason: 'not_found' });
      return true;
    }
    if (
      entry.revoked ||
      String(entry.status || '').toLowerCase() === 'deleted' ||
      String(entry.status || '').toLowerCase() === 'revoked'
    ) {
      json(res, 200, { ok: true, valid: false, reason: 'revoked' });
      return true;
    }
    const assigned = String(entry.assignedEmail || '').toLowerCase();
    const status = String(entry.status || '').toLowerCase();
    if (status === 'assigned' && assigned && assigned !== email) {
      json(res, 200, { ok: true, valid: false, reason: 'other_account' });
      return true;
    }
    if (status === 'assigned' && assigned === email) {
      json(res, 200, { ok: true, valid: true, license: toClaimPayload(entry) });
      return true;
    }
    // Active but unassigned — not a live session grant.
    json(res, 200, { ok: true, valid: false, reason: 'not_assigned' });
    return true;
  }

  if (path === '/api/licenses/claim' && req.method === 'POST') {
    const body = await readBody(req);
    const key = String(body?.key || '').trim();
    const email = String(body?.email || '').trim().toLowerCase();
    if (!key) {
      json(res, 400, { ok: false, error: 'Invalid key' });
      return true;
    }
    if (isBannedEmail(email) || isBannedLicenseKey(key)) {
      json(res, 403, { ok: false, error: banReason() });
      return true;
    }

    // Per-key object only — does not depend on overloaded recovery/db.json.
    const { loadLicenseByKey } = await import('./licenseVaultStore.mjs');
    const probe = await loadLicenseByKey(key);
    if (probe === null) {
      json(res, 503, {
        ok: false,
        error: 'unavailable',
        reason: 'vault_unavailable',
        message:
          'License storage is temporarily unavailable. Your key was not rejected — try Activate again shortly.',
      });
      return true;
    }
    if (!probe) {
      json(res, 400, { ok: false, error: 'Invalid key' });
      return true;
    }
    let entry = probe;
    let allWorkspaces = {};
    let vault = [entry];

    if (
      entry.revoked ||
      String(entry.status || '').toLowerCase() === 'deleted' ||
      String(entry.status || '').toLowerCase() === 'revoked'
    ) {
      json(res, 403, { ok: false, error: 'License revoked' });
      return true;
    }

    let ownerId = entry?.ownerAdminId || entry?.adminId || '';
    let workspace = null;

    const ownerAdmin = String(entry.ownerAdminId || entry.adminId || ownerId || '').trim();
    if (isBannedAdminId(ownerAdmin)) {
      json(res, 403, { ok: false, error: banReason() });
      return true;
    }

    // Super Admin email is locked to Super Admin–owned keys only (Unlimited bull).
    // Blocks mentors (e.g. Alpha X) from binding their keys onto mukundimukhuba8@.
    try {
      const { blocksAssignToSuperAdmin } = await import('./superPersonaLock.mjs');
      if (blocksAssignToSuperAdmin(email, entry)) {
        json(res, 403, {
          ok: false,
          error: 'super_admin_locked',
          message:
            'This email belongs to Super Admin. Only Unlimited bull licenses under LM-004821 can activate here.',
        });
        return true;
      }
    } catch {
      /* fail open only if module missing — claim still gated below */
    }

    const workspaces = ownerId ? workspaceMap(ownerId, workspace) : allWorkspaces;
    const emailError = validateEmailAccess(entry, email, vault, workspaces);
    if (emailError) {
      json(res, 403, { ok: false, error: emailError });
      return true;
    }

    // Payment wall — authoritative subscriptionStatus only (never trust UI "approved").
    if (email) {
      let paidOk = false;
      let subStatus = 'pending_payment';
      let storeOffline = false;
      try {
        const { findSubscription } = await import('./supabaseRoster.mjs');
        const { getSubscription } = await import('./subscriptionVault.mjs');
        const { canActivateLicense, resolveSubscriptionStatus } = await import(
          './subscriptionStatus.mjs'
        );
        // Prefer single-email read — never treat a storage timeout as "unpaid".
        let client = null;
        try {
          client = await Promise.race([
            getSubscription(email),
            new Promise((_, reject) =>
              setTimeout(() => reject(Object.assign(new Error('sub_timeout'), { offline: true })), 8000),
            ),
          ]);
        } catch (err) {
          if (err?.offline || err?.code === 'unavailable' || err?.message === 'sub_timeout') {
            storeOffline = true;
          }
        }
        if (!storeOffline) {
          subStatus = resolveSubscriptionStatus(client);
          paidOk = canActivateLicense(client);
        }
      } catch {
        storeOffline = true;
      }
      if (!paidOk && !storeOffline) {
        try {
          const { accessPath } = await import('./specialAccess.mjs');
          const { firebaseRead } = await import('./clientMerge.mjs');
          const special = await Promise.race([
            firebaseRead(accessPath(email)),
            new Promise((resolve) => setTimeout(() => resolve(null), 4000)),
          ]);
          paidOk = Boolean(
            special &&
              special.status === 'paid' &&
              special.license?.key &&
              keysMatchExact(special.license.key, key),
          );
        } catch {
          /* ignore */
        }
      }
      if (storeOffline && !paidOk) {
        const { auditAsync } = await import('./auditLog.mjs');
        auditAsync('license.claim_blocked', {
          email,
          keyFingerprint: keyFingerprint(key),
          reason: 'subscription_store_offline',
        });
        json(res, 503, {
          ok: false,
          error: 'unavailable',
          reason: 'subscription_store_offline',
          message:
            'Payment status could not be verified right now. Your key was not rejected — try Activate again shortly.',
        });
        return true;
      }
      if (!paidOk) {
        const { auditAsync } = await import('./auditLog.mjs');
        auditAsync('license.claim_blocked', {
          email,
          keyFingerprint: keyFingerprint(key),
          reason: 'payment_required',
          subscriptionStatus: subStatus,
        });
        json(res, 402, {
          ok: false,
          error: 'payment_required',
          subscriptionStatus: subStatus,
          message:
            subStatus === 'declined'
              ? 'This subscription was declined. Contact Super Admin.'
              : 'Payment must be confirmed by Super Admin before this license can activate. Account approval alone is not payment.',
        });
        return true;
      }
    }

    // Already open for this email — return key only after payment confirmed above.
    if (
      String(entry.status || '').toLowerCase() === 'assigned' &&
      String(entry.assignedEmail || '').toLowerCase() === email
    ) {
      json(res, 200, { ok: true, license: toClaimPayload(entry) });
      return true;
    }

    const assigned = assignEntry(entry, email);
    const nextVault = dbList(vault).map((item) => (keysMatch(item?.key, key) ? assigned : item));
    if (!findVaultEntry(nextVault, key)) nextVault.unshift(assigned);

    ownerId = assigned.ownerAdminId || assigned.adminId || ownerId;
    const nextWorkspace = ownerId
      ? workspaceLicensePatch(
          workspace || allWorkspaces[ownerId] || null,
          ownerId,
          key,
          {
            assignedEmail: assigned.assignedEmail || email,
            assignedAt: assigned.assignedAt,
            status: assigned.status || 'assigned',
          },
          assigned,
        )
      : null;

    let saved = false;
    try {
      await saveFirebaseVault(nextVault);
      saved = true;
    } catch {
      saved = false;
    }
    if (!saved) {
      json(res, 503, {
        ok: false,
        error: 'Could not activate that license. Tap Activate again.',
      });
      return true;
    }

    json(res, 200, { ok: true, license: toClaimPayload(assigned) });
    void import('./auditLog.mjs').then(({ auditAsync }) =>
      auditAsync('license.claim', {
        email,
        keyFingerprint: keyFingerprint(key),
        ownerAdminId: assigned.ownerAdminId || assigned.adminId || '',
      }),
    );
    void import('./commissionEngine.mjs')
      .then(({ tryQualifyCommission }) =>
        tryQualifyCommission({
          email,
          source: 'claim',
          actorId: 'system:license-claim',
        }),
      )
      .catch((err) => console.warn('[commission] claim hook failed', err));
    return true;
  }

  if (path === '/api/licenses/release' && req.method === 'POST') {
    const body = await readBody(req);
    const key = String(body?.key || '').trim();
    const email = String(body?.email || '').trim().toLowerCase();
    if (!key || !email) {
      json(res, 400, { ok: false, error: 'key and email required' });
      return true;
    }

    const entry = await loadLicenseEntry(key);
    if (!entry) {
      json(res, 400, { ok: false, error: 'Invalid key' });
      return true;
    }

    const released = releaseEntry(entry, email);
    if (!released.ok) {
      json(res, 403, { ok: false, error: released.error });
      return true;
    }

    const { saveLicenseEntry } = await import('./licenseVaultStore.mjs');
    const savedRow = await saveLicenseEntry(released.entry);
    if (!savedRow) {
      json(res, 503, { ok: false, error: 'Could not release that license.' });
      return true;
    }
    json(res, 200, { ok: true });
    return true;
  }

  return false;
}
