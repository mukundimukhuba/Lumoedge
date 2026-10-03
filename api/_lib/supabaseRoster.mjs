import { mergeClientRecord, mergeAdminsLive, pickAdminRole } from './clientMerge.mjs';
import { loadRecoveryDb, mergeRecoveryPatch } from './phoneRecover.mjs';
import { activityFieldsOnApprove } from './mentorActivity.mjs';

const SUPER_ID = 'LM-004821';

function emailOf(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

export function visibleClient(entry) {
  if (!entry || typeof entry !== 'object') return entry;
  const next = { ...entry };
  delete next.licenseKey;
  delete next.key;
  delete next.password;
  delete next.passwordSha256;
  delete next.sessionToken;
  delete next.token;
  return next;
}

export function combineSubscriptions(...lists) {
  const byEmail = new Map();
  for (const list of lists) {
    const rows = Array.isArray(list) ? list : [];
    for (const item of rows) {
      const email = emailOf(item?.email);
      if (!email) continue;
      const prev = byEmail.get(email);
      if (!prev) {
        byEmail.set(email, { ...item, email });
        continue;
      }
      const merged = mergeClientRecord(prev, { ...item, email });
      if (prev.id) merged.id = prev.id;
      if (prev.paymentClaimed || item.paymentClaimed) {
        merged.paymentClaimed = true;
        merged.paymentClaimedAt = item.paymentClaimedAt || prev.paymentClaimedAt;
      }
      byEmail.set(email, merged);
    }
  }
  return [...byEmail.values()];
}

export function findSubscription(clients, id) {
  const key = String(id || '').trim();
  const lower = key.toLowerCase();
  return (
    (clients || []).find(
      (row) => row?.id === key || emailOf(row?.email) === lower,
    ) || null
  );
}

export function nextAdminRecord(admins, id, role, fallback = null) {
  const key = String(id || '').trim();
  const keyLower = key.toLowerCase();
  let hit = null;
  const mapped = (admins || []).map((row) => {
    const match = row?.id === key || emailOf(row?.email) === keyLower;
    if (!match) return row;
    hit = { ...row, role: pickAdminRole(row.role, role) };
    return hit;
  });
  if (!hit && fallback?.email) {
    const email = emailOf(fallback.email);
    for (let i = 0; i < mapped.length; i += 1) {
      if (emailOf(mapped[i]?.email) !== email) continue;
      hit = { ...mapped[i], role: pickAdminRole(mapped[i].role, role) };
      mapped[i] = hit;
      break;
    }
    if (!hit) {
      hit = {
        ...fallback,
        email,
        role: pickAdminRole(fallback.role, role),
      };
      mapped.push(hit);
    }
  }
  return { admins: mapped, hit };
}

async function privateDb() {
  try {
    return (await loadRecoveryDb()) || null;
  } catch {
    return null;
  }
}

export async function listPrivateClients() {
  const db = await privateDb();
  return Array.isArray(db?.clients) ? db.clients : [];
}

export async function listPrivateAdmins() {
  const db = await privateDb();
  return Array.isArray(db?.auth?.admins) ? db.auth.admins : [];
}

export async function savePrivateClient(entry) {
  const email = emailOf(entry?.email);
  if (!email) return null;
  const current = (await listPrivateClients()) || [];
  const prev = findSubscription(current, email);
  const next = prev ? combineSubscriptions([prev], [{ ...entry, email }])[0] : { ...entry, email };
  if (prev?.id) next.id = prev.id;
  const saved = await mergeRecoveryPatch({
    clients: [next],
    store: {
      workspaces: {
        [SUPER_ID]: { clientRequests: [next] },
      },
    },
  });
  return saved ? next : null;
}

export async function patchPrivateClient(id, patch) {
  const current = await listPrivateClients();
  const prev = findSubscription(current, id);
  if (!prev) return null;
  const updated = mergeClientRecord(prev, {
    ...prev,
    ...patch,
    email: prev.email,
    id: prev.id,
  });
  if (patch?.paymentClaimed === true || prev.paymentClaimed) {
    updated.paymentClaimed = patch?.paymentClaimed === true ? true : Boolean(prev.paymentClaimed);
    updated.paymentClaimedAt =
      patch?.paymentClaimed === true
        ? patch.paymentClaimedAt || prev.paymentClaimedAt || new Date().toISOString()
        : prev.paymentClaimedAt;
  }
  const saved = await savePrivateClient(updated);
  return saved ? updated : null;
}

export async function savePrivateMentor(entry, workspace = null) {
  const email = emailOf(entry?.email);
  if (!email) return null;
  const record = { ...entry, email };
  const patch = { auth: { admins: [record] } };
  if (workspace && record.id) {
    patch.store = { workspaces: { [record.id]: workspace } };
  }
  const saved = await mergeRecoveryPatch(patch);
  return saved ? record : null;
}

export async function approvePrivateMentor(id, role, fallback = null, now = new Date()) {
  const current = await listPrivateAdmins();
  const { hit } = nextAdminRecord(current, id, role, fallback);
  if (!hit) return null;
  const next =
    role === 'admin'
      ? { ...hit, ...activityFieldsOnApprove(now), role: 'admin' }
      : hit;
  const saved = await savePrivateMentor(next);
  return saved ? next : null;
}

export function mergeAdminRosters(...lists) {
  return lists.reduce((acc, list) => mergeAdminsLive(acc, list || []), []);
}
