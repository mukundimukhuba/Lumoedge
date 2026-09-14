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

export function scopeWorkspace(workspace, adminId) {
  const id = String(adminId || '').trim();
  const ws = workspace && typeof workspace === 'object' ? workspace : {};
  return {
    ...ws,
    id,
    eas: toList(ws.eas).filter((row) => ownedByMentor(row, id)),
    licenses: toList(ws.licenses).filter((row) => ownedByMentor(row, id)),
    clientRequests: toList(ws.clientRequests),
    revokedKeys: toList(ws.revokedKeys),
  };
}

export async function loadMentorBundle(adminId, io) {
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

  const [ws, vaultRaw, revoked, updatedAt] = await Promise.all([
    io.read(`lumo/store/workspaces/${id}`),
    io.read('lumo/vault'),
    io.read('lumo/revokedKeys'),
    io.read('lumo/updatedAt'),
  ]);

  const workspace = scopeWorkspace(ws, id);
  const vault = toList(vaultRaw).filter(
    (row) => ownedByMentor(row, id) && String(row?.status || '') !== 'deleted',
  );
  return {
    workspace,
    vault,
    clients: workspace.clientRequests || [],
    imageKeys: collectImageKeys(workspace, id),
    revokedKeys: toList(revoked),
    updatedAt: updatedAt || empty.updatedAt,
  };
}
