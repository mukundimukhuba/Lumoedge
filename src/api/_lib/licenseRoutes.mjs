import { firebaseRead, firebaseWrite } from './clientMerge.mjs';
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

export async function loadFirebaseVault() {
  try {
    return vaultArray(await firebaseRead('lumo/vault'));
  } catch {
    return [];
  }
}

async function saveFirebaseVault(entries) {
  const ok = await firebaseWrite('lumo/vault', entries);
  if (!ok) throw new Error('Could not save license vault');
}

async function loadWorkspace(adminId) {
  if (!adminId) return null;
  try {
    const row = await firebaseRead(`lumo/store/workspaces/${encodeURIComponent(adminId)}`);
    return row && typeof row === 'object' ? row : null;
  } catch {
    return null;
  }
}

async function saveWorkspace(adminId, workspace) {
  const ok = await firebaseWrite(
    `lumo/store/workspaces/${encodeURIComponent(adminId)}`,
    workspace,
  );
  if (!ok) throw new Error('Could not save workspace licenses');
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
  const workspace = (await loadWorkspace(adminId)) || {
    id: adminId,
    eas: [],
    licenses: [],
    clientRequests: [],
    mt5: {},
    profile: {},
    orders: [],
    revokedKeys: [],
  };
  const licenses = dbList(workspace.licenses);
  const existing = licenses.find(
    (license) => license && keysMatch(String(license.key || ''), key) && license.status !== 'deleted',
  );
  const base = existing || (vaultEntry ? vaultEntryToLicense(vaultEntry) : null);
  if (!base) return workspace;
  const nextLicense = { ...base, ...patch, ownerAdminId: base.ownerAdminId || adminId };
  const nextLicenses = existing
    ? licenses.map((license) =>
        keysMatch(String(license?.key || ''), key) ? nextLicense : license,
      )
    : [nextLicense, ...licenses];
  const next = { ...workspace, id: adminId, licenses: nextLicenses };
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
    await saveFirebaseVault(merged.vault);
    if (adminId && merged.store?.workspaces?.[adminId]) {
      await saveWorkspace(adminId, merged.store.workspaces[adminId]);
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

    const vault = await loadFirebaseVault();
    let entry = findVaultEntry(vault, key);
    let ownerId = entry?.ownerAdminId || entry?.adminId || '';
    let workspace = ownerId ? await loadWorkspace(ownerId) : null;

    if (!entry) {
      if (ownerId && workspace) {
        const hit = findWorkspaceLicense(workspaceMap(ownerId, workspace), key);
        if (hit) {
          entry = hit.license;
          ownerId = hit.ownerId || ownerId;
        }
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

    const workspaces = workspaceMap(ownerId, workspace);
    const emailError = validateEmailAccess(entry, email, vault, workspaces);
    if (emailError) {
      json(res, 403, { ok: false, error: emailError });
      return true;
    }

    const assigned = assignEntry(entry, email);
    const nextVault = dbList(vault).map((item) => (keysMatch(item?.key, key) ? assigned : item));
    if (!findVaultEntry(nextVault, key)) nextVault.unshift(assigned);
    await saveFirebaseVault(nextVault);

    ownerId = assigned.ownerAdminId || assigned.adminId || ownerId;
    await upsertWorkspaceLicense(
      ownerId,
      key,
      {
        assignedEmail: assigned.assignedEmail || email,
        assignedAt: assigned.assignedAt,
        status: assigned.status || 'assigned',
      },
      assigned,
    );

    json(res, 200, { ok: true, license: toClaimPayload(assigned) });
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

    const vault = await loadFirebaseVault();
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

    await saveFirebaseVault(
      dbList(vault).map((item) => (keysMatch(item?.key, key) ? released.entry : item)),
    );

    const adminId = released.entry.ownerAdminId || released.entry.adminId || '';
    await upsertWorkspaceLicense(
      adminId,
      key,
      {
        assignedEmail: null,
        assignedAt: null,
        status: 'active',
        deviceId: null,
      },
      released.entry,
    );
    json(res, 200, { ok: true });
    return true;
  }

  return false;
}
