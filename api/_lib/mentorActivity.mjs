import { firebaseRead, firebaseWrite, normalizeAdminRole } from './clientMerge.mjs';

export const MENTOR_ACTIVITY_DAYS = 40;
const DAY_MS = 24 * 60 * 60 * 1000;

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.values(value);
  return [];
}

function matchAdmin(admin, idOrEmail) {
  const key = String(idOrEmail || '').trim();
  if (!key) return false;
  return (
    String(admin?.id || '').trim() === key ||
    String(admin?.email || '').trim().toLowerCase() === key.toLowerCase()
  );
}

export function addDaysIso(iso, days, now = new Date()) {
  const start = iso ? new Date(iso) : now;
  const base = Number.isNaN(start.getTime()) ? now : start;
  return new Date(base.getTime() + days * DAY_MS).toISOString();
}

export function formatActivityDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso || '');
  return date.toISOString().slice(0, 10);
}

export function activityFieldsOnApprove(now = new Date()) {
  const approvalDate = now.toISOString();
  return {
    approvalDate,
    deadlineDate: addDaysIso(approvalDate, MENTOR_ACTIVITY_DAYS, now),
    activityStatus: 'active',
    activitySatisfiedAt: '',
    inactiveReason: '',
  };
}

export function mentorHasSatisfiedActivity(admin) {
  return Boolean(String(admin?.activitySatisfiedAt || '').trim());
}

export function isMentorInactive(admin, now = new Date()) {
  if (normalizeAdminRole(admin?.role) === 'super') return false;
  if (String(admin?.activityStatus || '').toLowerCase() === 'inactive') return true;
  const deadline = String(admin?.deadlineDate || '').trim();
  if (!deadline) return false;
  if (mentorHasSatisfiedActivity(admin)) return false;
  const due = new Date(deadline);
  return !Number.isNaN(due.getTime()) && now.getTime() > due.getTime();
}

export function applyMentorActivitySweep(admins, now = new Date()) {
  let changed = false;
  const next = toArray(admins).map((row) => {
    if (normalizeAdminRole(row?.role) !== 'admin') return row;
    if (mentorHasSatisfiedActivity(row)) return row;
    if (!String(row?.deadlineDate || '').trim()) return row;
    if (!isMentorInactive(row, now)) return row;
    if (String(row.activityStatus || '').toLowerCase() === 'inactive') return row;
    changed = true;
    return {
      ...row,
      activityStatus: 'inactive',
      inactiveReason:
        '40-day inactivity: no license generated and no client acquired before the deadline.',
      inactiveAt: now.toISOString(),
    };
  });
  return { admins: next, changed };
}

async function writeAdmins(admins, io) {
  const ok = await io.write('lumo/auth', { admins, admin: null });
  try {
    await io.write('lumo/updatedAt', new Date().toISOString());
  } catch {
    /* best-effort */
  }
  return ok;
}

export async function startMentorActivityPeriod(idOrEmail, opts = {}) {
  const io = opts.io || { read: firebaseRead, write: firebaseWrite };
  const now = opts.now || new Date();
  const curAuth = (await io.read('lumo/auth')) || { admins: [] };
  let hit = null;
  const fields = activityFieldsOnApprove(now);
  const admins = toArray(curAuth.admins).map((row) => {
    if (!matchAdmin(row, idOrEmail)) return row;
    hit = { ...row, ...fields, role: normalizeAdminRole(row.role) === 'super' ? row.role : 'admin' };
    return hit;
  });
  if (!hit) return null;
  await writeAdmins(admins, io);
  return hit;
}

export async function markMentorActivitySatisfied(idOrEmail, reason, opts = {}) {
  const io = opts.io || { read: firebaseRead, write: firebaseWrite };
  const now = opts.now || new Date();
  const key = String(idOrEmail || '').trim();
  if (!key) return null;
  const curAuth = (await io.read('lumo/auth')) || { admins: [] };
  let hit = null;
  const admins = toArray(curAuth.admins).map((row) => {
    if (!matchAdmin(row, key)) return row;
    if (mentorHasSatisfiedActivity(row) && String(row.activityStatus || '') !== 'inactive') {
      hit = row;
      return row;
    }
    hit = {
      ...row,
      activitySatisfiedAt: row.activitySatisfiedAt || now.toISOString(),
      activitySatisfiedBy: String(reason || 'activity'),
      activityStatus: 'active',
      inactiveReason: '',
    };
    return hit;
  });
  if (!hit) return null;
  await writeAdmins(admins, io);
  return hit;
}

export async function sweepMentorActivity(opts = {}) {
  const io = opts.io || { read: firebaseRead, write: firebaseWrite };
  const now = opts.now || new Date();
  const curAuth = (await io.read('lumo/auth')) || { admins: [] };
  const swept = applyMentorActivitySweep(curAuth.admins, now);
  if (swept.changed) await writeAdmins(swept.admins, io);
  return swept;
}

export function loginBlockForActivity(admin, now = new Date()) {
  if (!admin) return null;
  if (normalizeAdminRole(admin.role) === 'super') return null;
  if (isMentorInactive(admin, now)) {
    return {
      error: 'inactive',
      message:
        'This mentor account is inactive because the 40-day activity requirement was not completed.',
    };
  }
  return null;
}
