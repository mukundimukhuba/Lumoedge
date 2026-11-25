import { loadRecoveryDb, mergeRecoveryPatch, keepImageRef } from './phoneRecover.mjs';
import { loadPhoneSessionStore, putPhoneSession } from './phoneSessions.mjs';

function mentorIdOf(row) {
  return String(row?.ownerAdminId || row?.adminId || row?.mentorId || '').trim();
}

function profileRef(mentorId) {
  const id = String(mentorId || '').trim();
  if (!id || !/^LM-\d+/i.test(id)) return '';
  return `/api/images/${encodeURIComponent(`profile-${id}`)}`;
}

function needsImage(value) {
  return !keepImageRef(value);
}

function fillImageFields(row, mentorId) {
  if (!row || typeof row !== 'object') return { row, changed: false };
  const ref = profileRef(mentorId || mentorIdOf(row));
  if (!ref) return { row, changed: false };
  let changed = false;
  const next = { ...row };
  if (needsImage(next.imageUrl)) {
    next.imageUrl = ref;
    changed = true;
  }
  if (needsImage(next.eaImage)) {
    next.eaImage = ref;
    changed = true;
  }
  if (needsImage(next.eaImageUrl)) {
    next.eaImageUrl = ref;
    changed = true;
  }
  if (needsImage(next.image)) {
    next.image = ref;
    changed = true;
  }
  if (Array.isArray(next.customMedia) && next.customMedia.length) {
    next.customMedia = next.customMedia.map((slot) => {
      if (!slot || typeof slot !== 'object') return slot;
      if (!needsImage(slot.url)) return slot;
      changed = true;
      return { ...slot, url: ref };
    });
  }
  return { row: next, changed };
}

function licenseOwnerMap(vault) {
  const byKey = new Map();
  for (const license of Array.isArray(vault) ? vault : []) {
    const key = String(license?.key || license?.licenseKey || '').trim();
    const owner = mentorIdOf(license);
    if (key && owner) byKey.set(key, owner);
  }
  return byKey;
}

async function restorePhoneSessions(owners) {
  const phoneStore = await loadPhoneSessionStore();
  if (!phoneStore) return { ok: false, error: 'phone_store_unavailable', phoneFixed: 0 };
  const phoneSessions = phoneStore.sessions || {};
  let phoneFixed = 0;
  let scanned = 0;
  for (const [email, session] of Object.entries(phoneSessions)) {
    scanned += 1;
    if (!session || typeof session !== 'object') continue;
    const bot = session.bot && typeof session.bot === 'object' ? { ...session.bot } : null;
    if (!bot) continue;
    const licenseKey = String(bot.licenseKey || bot.key || '').trim();
    const owner =
      mentorIdOf(bot) ||
      owners.get(licenseKey) ||
      String(session.mentorId || session.adminId || '').trim();
    const filled = fillImageFields(bot, owner);
    if (!filled.changed) continue;
    const ok = await putPhoneSession(
      email,
      { ...session, bot: filled.row, updatedAt: new Date().toISOString() },
      { force: true },
    );
    if (ok) phoneFixed += 1;
  }
  return { ok: true, phoneFixed, scanned };
}

async function restoreRecoverySessions(db, owners) {
  const sessions = db.sessions || {};
  const changed = {};
  let sessionFixed = 0;
  for (const [email, session] of Object.entries(sessions)) {
    if (!session || typeof session !== 'object') continue;
    const bot = session.bot && typeof session.bot === 'object' ? { ...session.bot } : null;
    if (!bot) continue;
    const licenseKey = String(bot.licenseKey || bot.key || '').trim();
    const owner =
      mentorIdOf(bot) ||
      owners.get(licenseKey) ||
      String(session.mentorId || session.adminId || '').trim();
    const filled = fillImageFields(bot, owner);
    if (!filled.changed) continue;
    changed[email] = { ...session, bot: filled.row, updatedAt: new Date().toISOString() };
    sessionFixed += 1;
  }
  if (!sessionFixed) return { ok: true, sessionFixed: 0, saved: false };
  const saved = await mergeRecoveryPatch({ sessions: changed }, db);
  return { ok: Boolean(saved), sessionFixed, saved: Boolean(saved) };
}

async function restoreVault(db, offset = 0, limit = 400) {
  const vault = Array.isArray(db.vault) ? db.vault : [];
  const slice = vault.slice(offset, offset + limit);
  const changed = [];
  for (const license of slice) {
    const filled = fillImageFields(license, mentorIdOf(license));
    if (filled.changed) changed.push(filled.row);
  }
  if (!changed.length) {
    return {
      ok: true,
      vaultFixed: 0,
      offset,
      nextOffset: offset + slice.length,
      done: offset + slice.length >= vault.length,
      total: vault.length,
    };
  }
  const saved = await mergeRecoveryPatch({ vault: changed }, db);
  return {
    ok: Boolean(saved),
    vaultFixed: changed.length,
    offset,
    nextOffset: offset + slice.length,
    done: offset + slice.length >= vault.length,
    total: vault.length,
    saved: Boolean(saved),
  };
}

async function restoreWorkspaces(db, offset = 0, limit = 80) {
  const entries = Object.entries(db.store?.workspaces || {});
  const slice = entries.slice(offset, offset + limit);
  const workspaces = {};
  let workspaceFixed = 0;
  for (const [id, workspace] of slice) {
    if (!workspace || typeof workspace !== 'object') continue;
    const mentorId = String(id || '').trim();
    let changed = false;
    const next = { ...workspace };
    if (next.profile && typeof next.profile === 'object') {
      const filled = fillImageFields(next.profile, mentorId);
      next.profile = filled.row;
      if (filled.changed) changed = true;
    }
    if (Array.isArray(next.eas)) {
      next.eas = next.eas.map((ea) => {
        const filled = fillImageFields(ea, mentorIdOf(ea) || mentorId);
        if (filled.changed) changed = true;
        return filled.row;
      });
    }
    if (Array.isArray(next.licenses)) {
      next.licenses = next.licenses.map((license) => {
        const filled = fillImageFields(license, mentorIdOf(license) || mentorId);
        if (filled.changed) changed = true;
        return filled.row;
      });
    }
    if (changed) {
      workspaces[id] = next;
      workspaceFixed += 1;
    }
  }
  if (!workspaceFixed) {
    return {
      ok: true,
      workspaceFixed: 0,
      offset,
      nextOffset: offset + slice.length,
      done: offset + slice.length >= entries.length,
      total: entries.length,
    };
  }
  const saved = await mergeRecoveryPatch({ store: { workspaces } }, db);
  return {
    ok: Boolean(saved),
    workspaceFixed,
    offset,
    nextOffset: offset + slice.length,
    done: offset + slice.length >= entries.length,
    total: entries.length,
    saved: Boolean(saved),
  };
}

/**
 * Re-point empty / wiped people + EA image fields at durable profile-{mentorId}
 * objects. Use scope=phone|sessions|vault|workspaces|all to stay under serverless limits.
 */
export async function restorePersonas(opts = {}) {
  const scope = String(opts.scope || 'all').trim().toLowerCase() || 'all';
  const offset = Math.max(0, Number(opts.offset) || 0);
  const limit = Math.max(1, Math.min(Number(opts.limit) || 400, 800));

  // Phone sessions can heal without the heavy recovery/db.json download.
  if (scope === 'phone') {
    const phone = await restorePhoneSessions(new Map());
    return { ok: phone.ok, scope, ...phone };
  }

  const db = await loadRecoveryDb();
  if (!db) return { ok: false, error: 'recovery_unavailable' };
  const owners = licenseOwnerMap(db.vault);

  if (scope === 'sessions') {
    const sessions = await restoreRecoverySessions(db, owners);
    return { ok: sessions.ok, scope, ...sessions };
  }
  if (scope === 'vault') {
    const vault = await restoreVault(db, offset, limit);
    return { ok: vault.ok, scope, ...vault };
  }
  if (scope === 'workspaces') {
    const ws = await restoreWorkspaces(db, offset, Math.min(limit, 120));
    return { ok: ws.ok, scope, ...ws };
  }

  // Default: phone + sessions only (what students see). Vault/workspaces are paged separately.
  const phone = await restorePhoneSessions(owners);
  if (!db) {
    return {
      ok: Boolean(phone.ok),
      scope: 'phone',
      phoneFixed: phone.phoneFixed || 0,
      sessionFixed: 0,
      note: 'recovery offline — phone only; retry sessions/vault/workspaces later',
    };
  }
  const sessions = await restoreRecoverySessions(db, owners);
  return {
    ok: Boolean(phone.ok && sessions.ok),
    scope: 'phone+sessions',
    phoneFixed: phone.phoneFixed || 0,
    sessionFixed: sessions.sessionFixed || 0,
    note: 'Call scope=vault and scope=workspaces with offset paging for full heal',
  };
}
