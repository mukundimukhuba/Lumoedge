function toList(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value && typeof value === 'object') return Object.values(value).filter(Boolean);
  return [];
}

export function ownedByMentor(item, adminId) {
  const owner = String(item?.ownerAdminId || item?.adminId || '').trim();
  return owner === String(adminId || '').trim();
}

function addImageKey(keys, raw) {
  const value = String(raw || '').trim();
  if (!value || value.startsWith('data:') || value.startsWith('blob:')) return;
  if (value.startsWith('img:')) {
    keys.add(value.slice(4));
    return;
  }
  if (value.startsWith('/api/images/')) {
    try {
      keys.add(decodeURIComponent(value.slice(12)));
    } catch {
      keys.add(value.slice(12));
    }
  }
}

export function collectImageKeys(workspace, adminId) {
  const keys = new Set();
  const id = String(adminId || '').trim();
  if (id) {
    keys.add(`profile-${id}`);
    keys.add(`${id}-bg-1`);
    keys.add(`${id}-bg-2`);
    keys.add(`${id}-bg-3`);
  }
  const ws = workspace && typeof workspace === 'object' ? workspace : {};
  addImageKey(keys, ws.profile?.eaImage);
  addImageKey(keys, ws.profile?.imageUrl);
  for (const ea of toList(ws.eas)) {
    addImageKey(keys, ea?.eaImage);
    addImageKey(keys, ea?.imageUrl);
    addImageKey(keys, ea?.image);
  }
  for (const license of toList(ws.licenses)) {
    addImageKey(keys, license?.eaImage);
    addImageKey(keys, license?.imageUrl);
    for (const media of toList(license?.customMedia)) addImageKey(keys, media?.url);
  }
  return [...keys].filter(Boolean);
}

function rewriteImageRef(value, adminId) {
  const id = String(adminId || '').trim();
  const raw = String(value || '').trim();
  if (!id || !raw) return raw;
  let key = raw;
  if (raw.startsWith('img:')) key = raw.slice(4);
  else if (raw.includes('/api/images/')) {
    try {
      key = decodeURIComponent(raw.split('/api/images/')[1].split('?')[0] || '');
    } catch {
      key = raw.split('/api/images/')[1] || raw;
    }
  }
  const mentorId = (key.match(/LM-\d+/i) || [])[0] || '';
  if (!mentorId || mentorId.toUpperCase() !== id.toUpperCase()) return raw;
  if (/^(web-)?robot[-_]/i.test(key) || key === mentorId || /^ea[-_]/i.test(key)) {
    return `/api/images/${encodeURIComponent(`profile-${id}`)}`;
  }
  return raw;
}

function ensureProfileRef(value, adminId) {
  const id = String(adminId || '').trim();
  const raw = String(value || '').trim();
  if (!id) return raw;
  // Keep local file previews while Setup is still uploading — never replace with the
  // cloud profile key (that previously showed the cyan placeholder over their photo).
  if (raw.startsWith('data:') || raw.startsWith('blob:')) return raw;
  if (!raw) {
    return `/api/images/${encodeURIComponent(`profile-${id}`)}`;
  }
  return rewriteImageRef(raw, id) || raw;
}

/** Point stale robot/EA image aliases at the mentor profile image key. */
export function healWorkspaceImageRefs(workspace, adminId) {
  const id = String(adminId || '').trim();
  const ws = workspace && typeof workspace === 'object' ? { ...workspace } : {};
  const profile = ws.profile && typeof ws.profile === 'object' ? { ...ws.profile } : {};
  profile.eaImage = ensureProfileRef(profile.eaImage, id);
  profile.imageUrl = ensureProfileRef(profile.imageUrl, id);
  if (Array.isArray(profile.customMedia)) {
    profile.customMedia = profile.customMedia.map((row) =>
      row && typeof row === 'object' ? { ...row, url: ensureProfileRef(row.url, id) } : row,
    );
  }
  ws.profile = profile;
  ws.eas = toList(ws.eas).map((row) => {
    if (!row || typeof row !== 'object') return row;
    return {
      ...row,
      eaImage: ensureProfileRef(row.eaImage, id),
      imageUrl: ensureProfileRef(row.imageUrl, id),
      image: ensureProfileRef(row.image, id),
    };
  });
  ws.licenses = toList(ws.licenses).map((row) => {
    if (!row || typeof row !== 'object') return row;
    const next = {
      ...row,
      eaImage: ensureProfileRef(row.eaImage, id),
      imageUrl: ensureProfileRef(row.imageUrl, id),
    };
    if (Array.isArray(row.customMedia)) {
      next.customMedia = row.customMedia.map((media) =>
        media && typeof media === 'object'
          ? { ...media, url: ensureProfileRef(media.url, id) }
          : media,
      );
    }
    return next;
  });
  return ws;
}

export function scopeWorkspace(workspace, adminId) {
  const id = String(adminId || '').trim();
  const ws = healWorkspaceImageRefs(
    workspace && typeof workspace === 'object' ? workspace : {},
    id,
  );
  const eas = toList(ws.eas)
    .filter((row) => ownedByMentor(row, id))
    .map((row) => ({ ...row, ownerAdminId: id }));
  const eaIds = new Set(eas.map((row) => String(row?.id || '').trim()).filter(Boolean));
  const licenses = toList(ws.licenses)
    .filter((row) => {
      if (ownedByMentor(row, id)) return true;
      // Legacy rows missing ownerAdminId may still belong to this mentor via eaId.
      const owner = String(row?.ownerAdminId || row?.adminId || '').trim();
      if (owner) return false;
      const eaId = String(row?.eaId || '').trim();
      return eaId && eaIds.has(eaId);
    })
    .map((row) => ({ ...row, ownerAdminId: id }));
  return {
    ...ws,
    id,
    eas,
    licenses,
    clientRequests: toList(ws.clientRequests),
    revokedKeys: toList(ws.revokedKeys),
  };
}

function isPortalLicense(row) {
  if (!row || typeof row !== 'object') return false;
  if (String(row.status || '') === 'deleted') return false;
  // R350 / Cape Pulse special licenses are listed on /cape-pulse — keep them out of
  // the Admin Portal hydrate so mobile login does not freeze on a ~1.5MB payload.
  if (String(row.source || '') === 'r350-special') return false;
  return true;
}

function slimLicense(row) {
  if (!row || typeof row !== 'object') return row;
  return {
    id: row.id,
    key: row.key,
    eaId: row.eaId,
    eaName: row.eaName,
    eaImage: row.eaImage,
    mainText: row.mainText,
    symbols: Array.isArray(row.symbols) ? row.symbols : [],
    ownerAdminId: row.ownerAdminId,
    clientName: row.clientName,
    clientEmail: row.clientEmail,
    duration: row.duration,
    status: row.status,
    assignedEmail: row.assignedEmail,
    assignedAt: row.assignedAt,
  };
}

function slimClientRequest(row) {
  if (!row || typeof row !== 'object') return row;
  return {
    id: row.id,
    email: row.email,
    firstName: row.firstName,
    lastName: row.lastName,
    status: row.status,
    createdAt: row.createdAt,
    paymentClaimed: row.paymentClaimed,
    paymentClaimedAt: row.paymentClaimedAt,
  };
}

/**
 * Portal hydrate bundle. `slim` (default true) keeps mobile login from freezing:
 * - no duplicated clients payload
 * - Super Admin drops the global subscriber queue (use GET /api/clients)
 * - mentors keep a capped clientRequests list
 * - skip full vault download when workspace licenses are present
 */
export async function loadMentorBundle(adminId, io, opts = {}) {
  const slim = opts.slim !== false;
  const id = String(adminId || '').trim();
  const empty = {
    workspace: {
      id,
      eas: [],
      licenses: [],
      clientRequests: [],
      mt5: {},
      profile: {},
      orders: [],
      revokedKeys: [],
    },
    vault: [],
    clients: [],
    imageKeys: id ? [`profile-${id}`, `${id}-bg-1`, `${id}-bg-2`, `${id}-bg-3`] : [],
    revokedKeys: [],
    updatedAt: new Date().toISOString(),
  };
  if (!id || !io?.read) return empty;

  const isSuper = id === 'LM-004821';
  // Slim hydrate: skip the global vault blob (often ~0.5–1MB) — workspace licenses
  // already carry what the Admin Portal needs after login.
  const reads = [
    io.read(`lumo/store/workspaces/${id}`),
    io.read('lumo/revokedKeys'),
    io.read('lumo/updatedAt'),
  ];
  if (!slim) reads.splice(1, 0, io.read('lumo/vault'));
  const settled = await Promise.all(reads);
  const ws = settled[0];
  const vaultRaw = slim ? [] : settled[1];
  const revoked = slim ? settled[1] : settled[2];
  const updatedAt = slim ? settled[2] : settled[3];

  const workspace = scopeWorkspace(ws, id);
  workspace.licenses = toList(workspace.licenses).filter(isPortalLicense).map(slimLicense);
  // When workspace licenses were wiped but vault still has this mentor's keys, refill.
  if (!workspace.licenses.length) {
    try {
      const vaultRows = toList(await io.read('lumo/vault'));
      const owned = vaultRows
        .filter((row) => ownedByMentor(row, id) && isPortalLicense(row))
        .map(slimLicense);
      if (owned.length) workspace.licenses = owned;
    } catch {
      /* keep empty */
    }
  }
  let clientRequests = toList(workspace.clientRequests).map(slimClientRequest);
  // Super Admin's workspace historically stored the global subscriber queue —
  // that alone was ~240KB duplicated as `clients`. Portal uses GET /api/clients.
  if (slim && isSuper) {
    clientRequests = [];
  } else if (slim && clientRequests.length > 80) {
    clientRequests = clientRequests.slice(0, 80);
  }
  workspace.clientRequests = clientRequests;
  workspace.orders = [];

  let vaultExtra = [];
  if (!slim) {
    const vault = toList(vaultRaw).filter(
      (row) => ownedByMentor(row, id) && isPortalLicense(row),
    );
    const licenseKeys = new Set(
      toList(workspace.licenses)
        .map((row) => String(row?.key || '').toUpperCase())
        .filter(Boolean),
    );
    vaultExtra = vault
      .filter((row) => {
        const key = String(row?.key || '').toUpperCase();
        return key && !licenseKeys.has(key);
      })
      .map(slimLicense);
  }

  return {
    workspace,
    vault: vaultExtra,
    // Never mirror clientRequests into clients — that doubled the hydrate payload.
    clients: [],
    imageKeys: collectImageKeys(workspace, id),
    revokedKeys: toList(revoked).slice(0, slim ? 400 : undefined),
    updatedAt: updatedAt || empty.updatedAt,
    hydrate: slim
      ? {
          slim: true,
          clientRequestsOmitted: isSuper,
          clientsVia: '/api/clients',
        }
      : undefined,
  };
}
