import { mergeClients, pickAdminRole } from './clientMerge.mjs';

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.values(value);
  return [];
}

function mergeVault(existing = [], incoming = []) {
  const byId = new Map();
  const byKey = new Map();
  const put = (v) => {
    if (!v) return;
    const key = String(v.key || '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
    const id = v.id || key;
    if (!id) return;
    const prev = byId.get(id) || (key ? byKey.get(key) : null);
    if (!prev) {
      byId.set(id, v);
      if (key) byKey.set(key, v);
      return;
    }
    const merged = { ...prev, ...v };
    if (prev.status === 'assigned' && v.status !== 'assigned') merged.status = prev.status;
    byId.set(id, merged);
    if (key) byKey.set(key, merged);
  };
  for (const v of [...toArray(existing), ...toArray(incoming)]) put(v);
  return [...byId.values()];
}

function mergeWorkspaces(existing = {}, incoming = {}) {
  const ids = new Set([...Object.keys(existing || {}), ...Object.keys(incoming || {})]);
  const out = {};
  for (const id of ids) {
    const a = existing?.[id] || {};
    const b = incoming?.[id] || {};
    const licenseMap = new Map();
    for (const l of [...toArray(a.licenses), ...toArray(b.licenses)]) {
      if (!l) continue;
      const key = String(l.key || '')
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '');
      const k = l.id || key;
      if (!k) continue;
      const prev = licenseMap.get(k);
      if (!prev || (l.status === 'active' && prev.status !== 'active')) licenseMap.set(k, l);
      else licenseMap.set(k, { ...prev, ...l });
    }
    const easA = toArray(a.eas);
    const easB = toArray(b.eas);
    const licA = toArray(a.licenses);
    const licB = toArray(b.licenses);
    const ownEa = (ea) =>
      ea?.id && (!ea.ownerAdminId || String(ea.ownerAdminId) === String(id));
    out[id] = {
      ...a,
      ...b,
      deletedEaIds: [...new Set([...toArray(a.deletedEaIds), ...toArray(b.deletedEaIds)])],
      eas:
        easB.length === 0 && easA.length
          ? easA.filter((e, i, arr) => ownEa(e) && arr.findIndex((x) => x.id === e.id) === i)
          : [...easA, ...easB].filter(
              (e, i, arr) => ownEa(e) && arr.findIndex((x) => x.id === e.id) === i,
            ),
      licenses:
        licB.length === 0 && licA.length
          ? licA.filter((l) => l?.key)
          : [...licenseMap.values()],
      clientRequests: mergeClients(toArray(a.clientRequests), toArray(b.clientRequests)),
      profile: { ...(a.profile || {}), ...(b.profile || {}) },
      mt5: { ...(a.mt5 || {}), ...(b.mt5 || {}) },
      orders: [...toArray(b.orders), ...toArray(a.orders)].filter(
        (o, i, arr) => o?.id && arr.findIndex((x) => x.id === o.id) === i,
      ),
      revokedKeys: [...new Set([...toArray(a.revokedKeys), ...toArray(b.revokedKeys)])],
    };
  }
  return out;
}

function mergeAdmins(current, incoming) {
  const byEmail = new Map();
  for (const item of [...toArray(current), ...toArray(incoming)]) {
    const email = String(item?.email || '')
      .trim()
      .toLowerCase();
    if (!email) continue;
    const prev = byEmail.get(email);
    if (!prev) {
      byEmail.set(email, { ...item, email });
      continue;
    }
    const merged = { ...prev, ...item, email };
    merged.role = pickAdminRole(prev.role, item.role);
    for (const [k, v] of Object.entries(prev)) {
      const nextVal = item[k];
      if ((nextVal === '' || nextVal == null) && v !== '' && v != null) {
        merged[k] = v;
      }
    }
    byEmail.set(email, merged);
  }
  return [...byEmail.values()];
}

/** Safe merge for PUT /api/db — never replace whole lists with partial patches. */
export function mergeDatabases(base, patch) {
  const a = base && typeof base === 'object' ? base : {};
  const b = patch && typeof patch === 'object' ? patch : {};
  return {
    ...a,
    ...b,
    auth: {
      ...(a.auth || {}),
      ...(b.auth || {}),
      admins: mergeAdmins(a.auth?.admins, b.auth?.admins),
    },
    store: {
      workspaces: mergeWorkspaces(a.store?.workspaces, b.store?.workspaces),
    },
    clients: mergeClients(a.clients, b.clients),
    vault: mergeVault(a.vault, b.vault),
    sessions: { ...(a.sessions || {}), ...(b.sessions || {}) },
    images: { ...(a.images || {}), ...(b.images || {}) },
    revokedKeys: [...new Set([...(a.revokedKeys || []), ...(b.revokedKeys || [])])],
    scanAdmin: {
      ...(a.scanAdmin || {}),
      ...(b.scanAdmin || {}),
      quotaResets: { ...(a.scanAdmin?.quotaResets || {}), ...(b.scanAdmin?.quotaResets || {}) },
      historyClears: {
        ...(a.scanAdmin?.historyClears || {}),
        ...(b.scanAdmin?.historyClears || {}),
      },
    },
    updatedAt: b.updatedAt || a.updatedAt || new Date().toISOString(),
  };
}
