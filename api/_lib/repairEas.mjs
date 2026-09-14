import { healLicensesFromVault, vaultEntryToLicense } from './repairLicenses';

export { healLicensesFromVault, vaultEntryToLicense };

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.values(value);
  return [];
}

function mergeEasById(existing = [], incoming = []) {
  const byId = new Map();
  for (const ea of [...toArray(existing), ...toArray(incoming)]) {
    if (!ea?.id) continue;
    const prev = byId.get(ea.id);
    byId.set(ea.id, prev ? { ...prev, ...ea } : ea);
  }
  return [...byId.values()];
}

function licenseSources(workspace, ownerAdminId = '', vaultEntries = []) {
  const wsLicenses = toArray(workspace?.licenses).filter((l) => l?.status !== 'deleted');
  const vaultLicenses = toArray(vaultEntries)
    .filter(
      (v) =>
        v?.eaId &&
        v.status !== 'deleted' &&
        (!ownerAdminId || !v.ownerAdminId || v.ownerAdminId === ownerAdminId),
    )
    .map((v) => ({
      eaId: v.eaId,
      eaName: v.eaName,
      symbols: v.symbols,
      eaImage: v.eaImage,
      ownerAdminId: v.ownerAdminId,
      status: v.status,
    }));
  const byEaId = new Map();
  for (const lic of [...wsLicenses, ...vaultLicenses]) {
    const eaId = String(lic?.eaId || '').trim();
    if (!eaId) continue;
    const prev = byEaId.get(eaId);
    byEaId.set(eaId, prev ? { ...prev, ...lic } : lic);
  }
  return [...byEaId.values()];
}

/** Rebuild missing EA rows from license + vault metadata — never delete existing EAs. */
export function repairWorkspaceEas(workspace, ownerAdminId = '', vaultEntries = []) {
  const ws = workspace && typeof workspace === 'object' ? { ...workspace } : {};
  const tombstones = new Set(toArray(ws.deletedEaIds).map(String));
  const eas = mergeEasById(ws.eas, []);
  const easById = new Map(eas.map((ea) => [ea.id, ea]));
  const licenses = licenseSources(ws, ownerAdminId, vaultEntries);
  let restored = 0;

  for (const lic of licenses) {
    const eaId = String(lic?.eaId || '').trim();
    if (!eaId || tombstones.has(eaId) || easById.has(eaId)) continue;
    const rebuilt = {
      id: eaId,
      name: String(lic.eaName || lic.name || 'EA').trim() || 'EA',
      symbols: Array.isArray(lic.symbols) && lic.symbols.length ? lic.symbols : ['XAUUSD'],
      lotSize: 0.01,
      direction: 'both',
      imageUrl: String(lic.eaImage || '').trim(),
      ownerAdminId: String(lic.ownerAdminId || ownerAdminId || '').trim() || undefined,
    };
    easById.set(eaId, rebuilt);
    restored += 1;
  }

  return {
    workspace: {
      ...ws,
      eas: [...easById.values()].filter((ea) => !tombstones.has(String(ea.id))),
    },
    restored,
  };
}

export function repairWorkspace(workspace, ownerAdminId = '', vaultEntries = []) {
  const licenseHeal = healLicensesFromVault(workspace, ownerAdminId, vaultEntries);
  const withLicenses = { ...workspace, licenses: licenseHeal.licenses };
  const eaHeal = repairWorkspaceEas(withLicenses, ownerAdminId, vaultEntries);
  return {
    workspace: eaHeal.workspace,
    restoredEas: eaHeal.restored,
    restoredLicenses: licenseHeal.restored,
  };
}

export function repairAllWorkspaces(workspaces = {}, vault = []) {
  const out = {};
  let totalRestoredEas = 0;
  let totalRestoredLicenses = 0;
  let workspacesTouched = 0;
  for (const [id, ws] of Object.entries(workspaces || {})) {
    const vaultForOwner = toArray(vault).filter(
      (v) => !v?.ownerAdminId || v.ownerAdminId === id,
    );
    const { workspace, restoredEas, restoredLicenses } = repairWorkspace(
      ws,
      id,
      vaultForOwner,
    );
    out[id] = workspace;
    if (restoredEas > 0 || restoredLicenses > 0) workspacesTouched += 1;
    totalRestoredEas += restoredEas;
    totalRestoredLicenses += restoredLicenses;
  }
  return {
    workspaces: out,
    totalRestored: totalRestoredEas + totalRestoredLicenses,
    totalRestoredEas,
    totalRestoredLicenses,
    workspacesTouched,
  };
}
