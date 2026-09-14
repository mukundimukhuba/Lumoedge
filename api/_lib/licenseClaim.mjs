const KEY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function keyFingerprint(key) {
  return String(key || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

export function canonicalKeyFingerprint(key) {
  return keyFingerprint(key)
    .replace(/S/g, '5')
    .replace(/B/g, '8')
    .replace(/Z/g, '2')
    .replace(/8/g, '6');
}

export function keysMatch(a, b) {
  const fa = keyFingerprint(a);
  const fb = keyFingerprint(b);
  if (fa && fb && fa === fb) return true;
  const ca = canonicalKeyFingerprint(a);
  const cb = canonicalKeyFingerprint(b);
  return Boolean(ca && cb && ca === cb);
}

export function normalizeLicenseKey(key) {
  const cleaned = keyFingerprint(key);
  if (!cleaned) return '';
  const body = cleaned.startsWith('LUMO') ? cleaned.slice(4) : cleaned;
  const parts = body.match(/.{1,4}/g) ?? [];
  return ['LUMO', ...parts.slice(0, 3)].join('-');
}

export function dbList(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.values(value);
  return [];
}

export function findVaultEntry(vault, key) {
  return dbList(vault).find(
    (entry) =>
      entry &&
      keysMatch(String(entry.key || ''), key) &&
      entry.status !== 'deleted',
  );
}

export function findWorkspaceLicense(workspaces, key) {
  if (!workspaces || typeof workspaces !== 'object') return null;
  for (const [ownerId, ws] of Object.entries(workspaces)) {
    const licenses = dbList(ws?.licenses);
    const hit = licenses.find(
      (lic) => lic && keysMatch(String(lic.key || ''), key) && lic.status !== 'deleted',
    );
    if (hit) return { license: hit, ownerId };
  }
  return null;
}

export function validateEmailAccess(license, email, vault, workspaces) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) return 'Email required.';

  if (license.status === 'assigned') {
    if (String(license.assignedEmail || '').toLowerCase() === normalizedEmail) return null;
    return 'This license key is already used by another account.';
  }

  const issuedFor = String(license.clientEmail || license.email || '').trim().toLowerCase();
  if (issuedFor && issuedFor !== normalizedEmail) {
    return `This key was issued for ${license.clientEmail || license.email}. Log in as that email, or ask your admin for a key for ${normalizedEmail}.`;
  }

  for (const entry of dbList(vault)) {
    if (
      entry?.status === 'assigned' &&
      String(entry.assignedEmail || '').toLowerCase() === normalizedEmail &&
      !keysMatch(String(entry.key || ''), String(license.key || '')) &&
      String(entry.ownerAdminId || '') === String(license.ownerAdminId || '')
    ) {
      return 'This email already has an active license. Use that key or contact your admin.';
    }
  }

  for (const ws of Object.values(workspaces || {})) {
    for (const lic of dbList(ws?.licenses)) {
      if (
        lic?.status === 'assigned' &&
        String(lic.assignedEmail || '').toLowerCase() === normalizedEmail &&
        !keysMatch(String(lic.key || ''), String(license.key || '')) &&
        String(lic.ownerAdminId || '') === String(license.ownerAdminId || '')
      ) {
        return 'This email already has an active license. Use that key or contact your admin.';
      }
    }
  }

  return null;
}

export function toClaimPayload(entry) {
  return {
    id: entry.id,
    key: normalizeLicenseKey(entry.key),
    eaId: entry.eaId,
    eaName: entry.eaName,
    eaImage: entry.eaImage || '',
    mainText: entry.mainText || '',
    symbols: Array.isArray(entry.symbols) ? entry.symbols : ['XAUUSD'],
    customMedia: Array.isArray(entry.customMedia) ? entry.customMedia : [],
    ownerAdminId: entry.ownerAdminId || '',
    clientName: entry.clientName || '',
    clientEmail: entry.email || entry.clientEmail || '',
    duration: entry.duration || '',
    status: entry.status,
    assignedEmail: entry.assignedEmail,
    assignedAt: entry.assignedAt,
  };
}

export function assignEntry(entry, email) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (
    entry.status === 'assigned' &&
    String(entry.assignedEmail || '').toLowerCase() === normalizedEmail
  ) {
    return entry;
  }
  return {
    ...entry,
    status: 'assigned',
    assignedEmail: normalizedEmail,
    assignedAt: new Date().toISOString(),
  };
}

/** Client removed license — unassign so they must pay + activate again. */
export function releaseEntry(entry, email) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (
    entry.status === 'assigned' &&
    String(entry.assignedEmail || '').toLowerCase() !== normalizedEmail
  ) {
    return { ok: false, error: 'This license is not assigned to your account.' };
  }
  return {
    ok: true,
    entry: {
      ...entry,
      status: 'active',
      assignedEmail: null,
      assignedAt: null,
    },
  };
}

/** Unassign any other keys already bound to this email so a new mentor key can take over. */
export function releaseOtherAssignedForEmail(vault, workspaces, email, keepKey) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const nextVault = dbList(vault).map((entry) => {
    if (
      entry?.status === 'assigned' &&
      String(entry.assignedEmail || '').toLowerCase() === normalizedEmail &&
      !keysMatch(String(entry.key || ''), String(keepKey || ''))
    ) {
      return {
        ...entry,
        status: 'active',
        assignedEmail: null,
        assignedAt: null,
      };
    }
    return entry;
  });

  const nextWorkspaces =
    workspaces && typeof workspaces === 'object' ? { ...workspaces } : {};
  for (const [ownerId, ws] of Object.entries(nextWorkspaces)) {
    const licenses = dbList(ws?.licenses).map((lic) => {
      if (
        lic?.status === 'assigned' &&
        String(lic.assignedEmail || '').toLowerCase() === normalizedEmail &&
        !keysMatch(String(lic.key || ''), String(keepKey || ''))
      ) {
        return {
          ...lic,
          status: 'active',
          assignedEmail: null,
          assignedAt: null,
        };
      }
      return lic;
    });
    nextWorkspaces[ownerId] = { ...ws, licenses };
  }

  return { vault: nextVault, workspaces: nextWorkspaces };
}
