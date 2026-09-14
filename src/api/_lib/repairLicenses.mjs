function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.values(value);
  return [];
}

function keyFingerprint(key) {
  return String(key || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

export function vaultEntryToLicense(v) {
  const email = String(v.email || v.clientEmail || '').trim().toLowerCase();
  return {
    id: v.id,
    key: v.key,
    eaId: v.eaId,
    eaName: v.eaName,
    eaImage: v.eaImage || '',
    mainText: v.mainText || '',
    symbols: Array.isArray(v.symbols) ? v.symbols : [],
    customMedia: v.customMedia,
    ownerAdminId: v.ownerAdminId,
    clientName: v.clientName || '',
    clientEmail: email,
    duration: v.duration || '',
    status: v.status === 'assigned' ? 'assigned' : v.status === 'deleted' ? 'deleted' : 'active',
    assignedEmail: v.assignedEmail,
    assignedAt: v.assignedAt,
  };
}

/** Rebuild missing workspace license rows from vault — never delete existing keys. */
export function healLicensesFromVault(workspace, ownerAdminId, vaultEntries = [], wsRevoked = []) {
  const revoked = toArray(wsRevoked);
  const licByKey = new Map();
  for (const lic of toArray(workspace?.licenses)) {
    if (!lic?.key || lic.status === 'deleted') continue;
    const mergeKey = keyFingerprint(lic.key) || lic.id || lic.key;
    if (mergeKey) licByKey.set(mergeKey, lic);
  }

  let restored = 0;
  for (const v of toArray(vaultEntries)) {
    if (!v?.key || v.status === 'deleted') continue;
    if (ownerAdminId && v.ownerAdminId && v.ownerAdminId !== ownerAdminId) continue;
    const mergeKey = keyFingerprint(v.key) || v.id || v.key;
    if (!mergeKey || licByKey.has(mergeKey)) continue;
    licByKey.set(mergeKey, vaultEntryToLicense(v));
    restored += 1;
  }

  return { licenses: [...licByKey.values()], restored };
}
