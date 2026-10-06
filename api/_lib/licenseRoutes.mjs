import { mergeDatabases } from './mergeDb.mjs';
import { vaultEntryToLicense } from './repairLicenses.mjs';
import {
  assignEntry,
  dbList,
  findVaultEntry,
  findWorkspaceLicense,
  keysMatch,
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
  return vaultArray((await savedRecoveryDb())?.vault);
}

async function saveFirebaseVault(entries) {
  // One private-database write. Do not also call firebaseWrite — that path
  // rewrites recovery/db.json a second time and makes phones time out.
  const saved = await rememberRecovery({ vault: entries, images: {} });
  if (!saved) throw new Error('Could not save license vault');
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
  return dbList(entries).map((entry) => {
    if (!entry?.key) return entry;
    const hit = revoked.some((key) => keysMatch(entry.key, key));
    return hit ? { ...entry, revoked: true, status: 'deleted' } : entry;
  });
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

    const currentVault = await loadFirebaseVault();
    const incomingVault = vaultEntries.length
      ? vaultEntries
      : key
        ? [
            {
              ...(findVaultEntry(currentVault, key) || {}),
              key,
              adminId,
              ownerAdminId: adminId,
              status: findVaultEntry(currentVault, key)?.status || 'active',
              createdAt: findVaultEntry(currentVault, key)?.createdAt || new Date().toISOString(),
            },
          ]
        : [];

    const existingWorkspace = adminId ? (await loadWorkspace(adminId)) || {} : {};
    const merged = mergeDatabases(
      {
        vault: currentVault,
        store: { workspaces: adminId ? { [adminId]: existingWorkspace } : {} },
        revokedKeys: [],
      },
      {
        vault: incomingVault,
        store: {
          workspaces: workspace && adminId ? { [adminId]: { ...workspace, id: adminId } } : {},
        },
        revokedKeys,
      },
    );
    merged.vault = applyRevokedKeys(merged.vault, revokedKeys);
    const workspaceToSave =
      adminId && merged.store?.workspaces?.[adminId] ? merged.store.workspaces[adminId] : null;
    const saved = await rememberRecovery({
      vault: merged.vault,
      images: {},
      ...(workspaceToSave ? { store: { workspaces: { [adminId]: workspaceToSave } } } : {}),
    });
    if (!saved) {
      json(res, 503, { ok: false, error: 'Could not save license vault' });
      return true;
    }

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
        const clientEmail = String(license?.clientEmail || license?.email || '').trim().toLowerCase();
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
      /* never block license publish */
    }

    try {
      const {
        tryQualifyCommission,
        findAssignedLicenseForEmail,
        isRecentAssignedLicense,
        normalizeEmail,
      } = await import('./commissionEngine.mjs');
      const emails = new Set();
      const inspect = (entry) => {
        if (!entry || String(entry.status || '').toLowerCase() !== 'assigned') return;
        const email = normalizeEmail(entry.assignedEmail);
        if (email) emails.add(email);
      };
      for (const entry of incomingVault) inspect(entry);
      if (workspace) {
        for (const license of dbList(workspace.licenses)) inspect(license);
      }
      if (key) inspect(findVaultEntry(merged.vault, key));
      const now = new Date().toISOString();
      const workspaces = merged.store?.workspaces || {};
      for (const email of emails) {
        const assigned = findAssignedLicenseForEmail(merged.vault, workspaces, email);
        if (!assigned || !isRecentAssignedLicense(assigned.assignedAt, now)) continue;
        await tryQualifyCommission({
          email,
          source: 'claim',
          actorId: 'system:license-publish',
        });
      }
    } catch (err) {
      console.warn('[commission] publish hook failed', err);
    }

    json(res, 200, {
      ok: true,
      key: key || vaultEntries[0]?.key || '',
    });
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

    // One download of the private database. Claim used to load and rewrite it
    // several times, so phones hit "Activation timed out" while the server was
    // still writing.
    const recovery = await savedRecoveryDb();
    const vault = vaultArray(recovery?.vault);
    const allWorkspaces =
      recovery?.store?.workspaces && typeof recovery.store.workspaces === 'object'
        ? recovery.store.workspaces
        : {};
    let entry = findVaultEntry(vault, key);
    let ownerId = entry?.ownerAdminId || entry?.adminId || '';
    let workspace = ownerId ? allWorkspaces[ownerId] || null : null;

    if (!entry) {
      const hit = findWorkspaceLicense(allWorkspaces, key);
      if (hit) {
        entry = hit.license;
        ownerId = hit.ownerId || ownerId;
        workspace = allWorkspaces[ownerId] || null;
      }
    }

    if (!entry) {
      json(res, 400, { ok: false, error: 'Invalid key' });
      return true;
    }
    if (entry.revoked || String(entry.status || '').toLowerCase() === 'revoked') {
      json(res, 403, { ok: false, error: 'License revoked' });
      return true;
    }

    const workspaces = ownerId ? workspaceMap(ownerId, workspace) : allWorkspaces;
    const emailError = validateEmailAccess(entry, email, vault, workspaces);
    if (emailError) {
      json(res, 403, { ok: false, error: emailError });
      return true;
    }

    // Already open for this email — return the license without rewriting db.json.
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

    const saved = await rememberRecovery({
      vault: nextVault,
      images: {},
      ...(ownerId && nextWorkspace
        ? { store: { workspaces: { [ownerId]: nextWorkspace } } }
        : {}),
    });
    if (!saved) {
      json(res, 503, {
        ok: false,
        error: 'Could not activate that license. Tap Activate again.',
      });
      return true;
    }

    json(res, 200, { ok: true, license: toClaimPayload(assigned) });
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

    const recovery = await savedRecoveryDb();
    const vault = vaultArray(recovery?.vault);
    const entry = findVaultEntry(vault, key);
    if (!entry) {
      json(res, 400, { ok: false, error: 'Invalid key' });
      return true;
    }

    const released = releaseEntry(entry, email);
    if (!released.ok) {
      json(res, 403, { ok: false, error: released.error });
      return true;
    }

    const nextVault = dbList(vault).map((item) =>
      keysMatch(item?.key, key) ? released.entry : item,
    );
    const adminId = released.entry.ownerAdminId || released.entry.adminId || '';
    const currentWs = adminId ? recovery?.store?.workspaces?.[adminId] || null : null;
    const nextWorkspace = adminId
      ? workspaceLicensePatch(
          currentWs,
          adminId,
          key,
          {
            assignedEmail: null,
            assignedAt: null,
            status: 'active',
            deviceId: null,
          },
          released.entry,
        )
      : null;
    const saved = await rememberRecovery({
      vault: nextVault,
      images: {},
      ...(adminId && nextWorkspace
        ? { store: { workspaces: { [adminId]: nextWorkspace } } }
        : {}),
    });
    if (!saved) {
      json(res, 503, { ok: false, error: 'Could not release that license.' });
      return true;
    }
    json(res, 200, { ok: true });
    return true;
  }

  return false;
}
