import { createHash, randomBytes } from 'node:crypto';
import { firebaseRead, firebaseWrite } from './clientMerge.mjs';
import { dbList, keysMatch } from './licenseClaim.mjs';

export const DEFAULT_COMMISSION_SETTINGS = {
  commissionPerReferral: 50,
  minimumQualifyingReferrals: 5,
  withdrawalEnabled: true,
  holdHours: 0,
  currency: 'ZAR',
  requireApproval: true,
};

export const PROFILE_STATUSES = new Set(['pending', 'active', 'inactive', 'rejected']);
export const ACCOUNT_TYPES = new Set(['mentor', 'admin']);

export const QUALIFYING_STATUSES = new Set(['pending', 'available', 'paid']);
export const OPEN_PAYOUT_STATUSES = new Set(['requested', 'approved']);

export const firebaseIo = {
  now: () => new Date().toISOString(),
  read: firebaseRead,
  write: firebaseWrite,
  id: () => `id_${randomBytes(10).toString('hex')}`,
};

export function toList(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value && typeof value === 'object') return Object.values(value).filter(Boolean);
  return [];
}

export function normalizeEmail(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

export function emailFingerprint(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return '';
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

export function commissionEventId(email) {
  const fp = emailFingerprint(email);
  return fp ? `fp:${fp.slice(0, 20)}` : '';
}

export function clientRefFor(client, email) {
  const id = String(client?.id || '').trim();
  if (id) return id;
  const fp = emailFingerprint(email);
  return fp ? `ref-${fp.slice(0, 10)}` : '';
}

export function maskLicenseKey(key) {
  const raw = String(key || '').trim().toUpperCase();
  if (!raw) return '';
  const compact = raw.replace(/[^A-Z0-9]/g, '');
  const last = compact.slice(-4);
  return last ? `LUMO-****-****-${last}` : 'LUMO-****-****-****';
}

export function maskAccountNumber(value) {
  const digits = String(value || '').replace(/\s+/g, '');
  if (!digits) return '';
  const last = digits.slice(-4);
  return last ? `••••${last}` : '••••';
}

export function isPaidConfirmed(client) {
  if (!client || typeof client !== 'object') return false;
  const status = String(client.status || '').trim().toLowerCase();
  if (status === 'rejected') return false;
  return status === 'approved' || client.paymentClaimed === true;
}

export function parseIsoMs(value) {
  if (!value) return 0;
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : 0;
}

export function normalizeSettings(raw, nowIso) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const commissionPerReferral = Number(src.commissionPerReferral);
  const minimumQualifyingReferrals = Number(src.minimumQualifyingReferrals);
  const holdHours = Number(src.holdHours);
  return {
    commissionPerReferral:
      Number.isFinite(commissionPerReferral) && commissionPerReferral >= 0
        ? commissionPerReferral
        : DEFAULT_COMMISSION_SETTINGS.commissionPerReferral,
    minimumQualifyingReferrals:
      Number.isFinite(minimumQualifyingReferrals) && minimumQualifyingReferrals >= 0
        ? Math.floor(minimumQualifyingReferrals)
        : DEFAULT_COMMISSION_SETTINGS.minimumQualifyingReferrals,
    withdrawalEnabled:
      src.withdrawalEnabled === false ? false : DEFAULT_COMMISSION_SETTINGS.withdrawalEnabled,
    holdHours:
      Number.isFinite(holdHours) && holdHours >= 0
        ? holdHours
        : DEFAULT_COMMISSION_SETTINGS.holdHours,
    currency: String(src.currency || DEFAULT_COMMISSION_SETTINGS.currency).trim() || 'ZAR',
    launchedAt: src.launchedAt || nowIso,
    requireApproval: src.requireApproval === false ? false : true,
  };
}

export function withdrawalProgress(qualifyingReferrals, minimumQualifyingReferrals) {
  const qualifying = Math.max(0, Number(qualifyingReferrals) || 0);
  const minimum = Math.max(0, Number(minimumQualifyingReferrals) || 0);
  const remaining = Math.max(minimum - qualifying, 0);
  const unlocked = remaining === 0;
  return {
    qualifyingReferrals: qualifying,
    minimumQualifyingReferrals: minimum,
    remaining,
    unlocked,
    message: unlocked
      ? 'Withdrawal unlocked'
      : `${remaining} more qualifying subscription${remaining === 1 ? '' : 's'} to unlock withdrawals`,
  };
}

export function findClientByEmail(clients, email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  return (
    toList(clients).find((row) => normalizeEmail(row?.email) === normalized) || null
  );
}

export function findAssignedLicenseForEmail(vault, workspaces, email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const hits = [];
  for (const entry of dbList(vault)) {
    if (!entry || String(entry.status || '').toLowerCase() !== 'assigned') continue;
    if (normalizeEmail(entry.assignedEmail) !== normalized) continue;
    hits.push({
      license: entry,
      mentorId: String(entry.ownerAdminId || entry.adminId || '').trim(),
      assignedAt: entry.assignedAt || '',
    });
  }
  for (const [ownerId, workspace] of Object.entries(workspaces || {})) {
    for (const license of dbList(workspace?.licenses)) {
      if (!license || String(license.status || '').toLowerCase() !== 'assigned') continue;
      if (normalizeEmail(license.assignedEmail) !== normalized) continue;
      hits.push({
        license,
        mentorId: String(license.ownerAdminId || license.adminId || ownerId || '').trim(),
        assignedAt: license.assignedAt || '',
      });
    }
  }
  hits.sort((a, b) => parseIsoMs(b.assignedAt) - parseIsoMs(a.assignedAt));
  const hit = hits[0];
  if (!hit?.mentorId || !hit.license) return null;
  return hit;
}

export function previouslyPaidBeforeLaunch(client, launchedAt) {
  if (!isPaidConfirmed(client) || !launchedAt) return false;
  const launchMs = parseIsoMs(launchedAt);
  if (!launchMs) return false;
  const paidAt = parseIsoMs(client.paymentClaimedAt);
  if (paidAt && paidAt < launchMs) return true;
  return false;
}

export function payoutDetailsComplete(details) {
  if (!details || typeof details !== 'object') return false;
  const fields = ['accountHolderName', 'bankName', 'accountNumber', 'branchCode', 'accountType'];
  return fields.every((key) => String(details[key] || '').trim().length > 0);
}

export function publicPayoutDetails(details) {
  if (!details || typeof details !== 'object') return null;
  return {
    accountHolderName: String(details.accountHolderName || '').trim(),
    bankName: String(details.bankName || '').trim(),
    accountNumberMasked: maskAccountNumber(details.accountNumber),
    branchCode: String(details.branchCode || '').trim(),
    accountType: String(details.accountType || '').trim(),
    updatedAt: details.updatedAt || null,
    hasAccountNumber: Boolean(String(details.accountNumber || '').trim()),
  };
}

function money(amount) {
  const n = Number(amount);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

export function clientSubscriptionAmount(client) {
  const keys = ['subscriptionAmount', 'paidAmount', 'amount', 'price', 'planPrice', 'invoiceAmount'];
  for (const key of keys) {
    const n = Number(client?.[key]);
    if (Number.isFinite(n) && n > 0) return money(n);
  }
  return 0;
}

export function clientDisplayName(client, email) {
  const name = [client?.firstName, client?.lastName].filter(Boolean).join(' ').trim();
  if (name) return name;
  const fallback = String(client?.email || email || '').trim();
  return fallback || 'Client';
}

export function normalizeAccountType(raw, fallback = 'mentor') {
  const value = String(raw || '').trim().toLowerCase();
  if (ACCOUNT_TYPES.has(value)) return value;
  return ACCOUNT_TYPES.has(fallback) ? fallback : 'mentor';
}

export function normalizeProfileStatus(raw) {
  const value = String(raw || '').trim().toLowerCase();
  return PROFILE_STATUSES.has(value) ? value : 'pending';
}

export function splitAdminName(admin, profile) {
  const first = String(profile?.firstName || '').trim();
  const last = String(profile?.lastName || '').trim();
  if (first || last) {
    return {
      firstName: first,
      lastName: last,
      fullName: [first, last].filter(Boolean).join(' '),
    };
  }
  const full = String(admin?.fullName || admin?.mentorName || '').trim();
  const parts = full.split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || '',
    lastName: parts.slice(1).join(' '),
    fullName: full || String(admin?.id || profile?.mentorId || ''),
  };
}

export function publicProfile(profile) {
  if (!profile || typeof profile !== 'object') return null;
  return {
    mentorId: String(profile.mentorId || '').trim(),
    firstName: String(profile.firstName || '').trim(),
    lastName: String(profile.lastName || '').trim(),
    fullName: [profile.firstName, profile.lastName].filter(Boolean).join(' ').trim(),
    email: normalizeEmail(profile.email),
    phone: String(profile.phone || '').trim(),
    source: String(profile.source || '').trim(),
    status: normalizeProfileStatus(profile.status),
    accountType: normalizeAccountType(profile.accountType),
    roleSnapshot: String(profile.roleSnapshot || 'admin'),
    rateOverride:
      profile.rateOverride == null || profile.rateOverride === ''
        ? null
        : money(profile.rateOverride),
    joinedAt: profile.joinedAt || null,
    appliedAt: profile.appliedAt || null,
    approvedAt: profile.approvedAt || null,
    approvedBy: profile.approvedBy || null,
    rejectedAt: profile.rejectedAt || null,
    rejectedReason: profile.rejectedReason || null,
    deactivatedAt: profile.deactivatedAt || null,
    termsAcceptedAt: profile.termsAcceptedAt || null,
    implicit: Boolean(profile.implicit),
  };
}

export function profileCanEarn(profile) {
  if (!profile) return true;
  return normalizeProfileStatus(profile.status) === 'active';
}

export function rankEarners(rows) {
  const sorted = [...(rows || [])].sort((a, b) => {
    const earnedDiff = money(b?.totals?.totalEarned) - money(a?.totals?.totalEarned);
    if (earnedDiff !== 0) return earnedDiff;
    const refDiff =
      (Number(b?.totals?.qualifyingReferrals) || 0) - (Number(a?.totals?.qualifyingReferrals) || 0);
    if (refDiff !== 0) return refDiff;
    return String(a?.mentorId || '').localeCompare(String(b?.mentorId || ''));
  });
  return sorted.map((row, index) => ({ ...row, rank: index + 1 }));
}

export function matchesEarnerSearch(row, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  const hay = [
    row.fullName,
    row.firstName,
    row.lastName,
    row.email,
    row.mentorId,
    row.id,
  ]
    .join(' ')
    .toLowerCase();
  return hay.includes(q);
}

export function filterEarners(rows, filter) {
  const key = String(filter || 'all')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ');
  const list = Array.isArray(rows) ? rows : [];
  if (!key || key === 'all') return list;
  if (key === 'mentors') return list.filter((row) => row.accountType === 'mentor');
  if (key === 'admins') return list.filter((row) => row.accountType === 'admin');
  if (key === 'active') return list.filter((row) => row.status === 'active');
  if (key === 'inactive') return list.filter((row) => row.status === 'inactive' || row.status === 'rejected');
  if (key === 'highest earners' || key === 'highest') {
    return list.filter((row) => money(row?.totals?.totalEarned) > 0);
  }
  if (key === 'pending payouts' || key === 'pending') {
    return list.filter(
      (row) => money(row?.totals?.pending) > 0 || Boolean(row?.openPayout),
    );
  }
  if (key === 'pending approval' || key === 'applications') {
    return list.filter((row) => row.status === 'pending');
  }
  return list;
}

function commissionsMap(raw) {
  if (!raw || typeof raw !== 'object') return {};
  if (Array.isArray(raw)) {
    const out = {};
    for (const row of raw) {
      if (row?.eventId) out[row.eventId] = row;
    }
    return out;
  }
  return { ...raw };
}

function objectMap(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return { ...raw };
}

export function createCommissionEngine(io = firebaseIo) {
  const nowIso = () => io.now?.() || new Date().toISOString();
  const newId = (prefix) => `${prefix}_${(io.id?.() || randomBytes(10).toString('hex')).replace(/^id_/, '')}`;

  async function ensureSettings() {
    const existing = await io.read('lumo/commissionSettings');
    const next = normalizeSettings(existing, existing?.launchedAt || nowIso());
    if (!existing || typeof existing !== 'object' || !existing.launchedAt) {
      await io.write('lumo/commissionSettings', next);
    }
    return next;
  }

  async function writeSettings(patch, actorId) {
    const current = await ensureSettings();
    const next = normalizeSettings({ ...current, ...patch, launchedAt: current.launchedAt }, current.launchedAt);
    await io.write('lumo/commissionSettings', next);
    await writeAudit({
      action: 'settings_updated',
      actorId: actorId || 'admin',
      reason: patch?.reason || 'Commission settings updated',
      meta: {
        commissionPerReferral: next.commissionPerReferral,
        minimumQualifyingReferrals: next.minimumQualifyingReferrals,
        withdrawalEnabled: next.withdrawalEnabled,
        holdHours: next.holdHours,
      },
    });
    return next;
  }

  async function loadCommissions() {
    return commissionsMap(await io.read('lumo/commissions'));
  }

  async function loadPayouts() {
    return objectMap(await io.read('lumo/payouts'));
  }

  async function loadPayoutDetails() {
    return objectMap(await io.read('lumo/payoutDetails'));
  }

  async function loadAudit() {
    return objectMap(await io.read('lumo/commissionAudit'));
  }

  async function loadProfiles() {
    return objectMap(await io.read('lumo/commissionProfiles'));
  }

  async function loadAdmins() {
    const auth = (await io.read('lumo/auth')) || {};
    return toList(auth.admins);
  }

  function findAdmin(admins, mentorId) {
    const id = String(mentorId || '').trim();
    if (!id) return null;
    return (
      admins.find((row) => String(row?.id || '').trim() === id) ||
      admins.find((row) => normalizeEmail(row?.email) === normalizeEmail(id)) ||
      null
    );
  }

  async function saveProfile(row) {
    const mentorId = String(row?.mentorId || '').trim();
    if (!mentorId) return null;
    await io.write(`lumo/commissionProfiles/${mentorId}`, row);
    return row;
  }

  function commissionRateFor(profile, settings) {
    const override = profile?.rateOverride;
    if (override == null || override === '') return money(settings.commissionPerReferral);
    const n = Number(override);
    return Number.isFinite(n) && n >= 0 ? money(n) : money(settings.commissionPerReferral);
  }

  function enrichCommission(row, clients) {
    if (!row || typeof row !== 'object') return row;
    const client =
      toList(clients).find((item) => String(item?.id || '') === String(row.clientRef || '')) ||
      toList(clients).find((item) => clientRefFor(item, item?.email) === String(row.clientRef || '')) ||
      null;
    return {
      ...row,
      clientName: row.clientName || (client ? clientDisplayName(client, client.email) : row.clientRef || 'Client'),
      subscriptionAmount:
        row.subscriptionAmount != null ? money(row.subscriptionAmount) : clientSubscriptionAmount(client),
    };
  }

  async function writeAudit(entry) {
    const id = newId('aud');
    const row = {
      id,
      action: String(entry.action || '').trim(),
      actorId: String(entry.actorId || 'system').trim(),
      timestamp: nowIso(),
      commissionId: entry.commissionId || null,
      payoutId: entry.payoutId || null,
      reason: entry.reason || null,
      meta: entry.meta || null,
    };
    await io.write(`lumo/commissionAudit/${id}`, row);
    return row;
  }

  async function saveCommission(row) {
    await io.write(`lumo/commissions/${row.eventId}`, row);
    return row;
  }

  async function savePayout(row) {
    await io.write(`lumo/payouts/${row.payoutId}`, row);
    return row;
  }

  async function promoteHeld(all) {
    const now = parseIsoMs(nowIso());
    const next = { ...all };
    let changed = false;
    for (const [id, row] of Object.entries(next)) {
      if (!row || row.status !== 'pending') continue;
      const availableAt = parseIsoMs(row.availableAt);
      if (availableAt && availableAt <= now) {
        next[id] = { ...row, status: 'available', promotedAt: nowIso() };
        await saveCommission(next[id]);
        changed = true;
      }
    }
    return { map: next, changed };
  }

  async function loadWorkspaceMap() {
    const raw = await io.read('lumo/store/workspaces');
    return raw && typeof raw === 'object' ? raw : {};
  }

  async function tryQualify({ email, source = 'claim', actorId = 'system' } = {}) {
    const normalized = normalizeEmail(email);
    const eventId = commissionEventId(normalized);
    if (!eventId) return { ok: false, created: false, reason: 'email_required' };

    const settings = await ensureSettings();
    const existingMap = await loadCommissions();
    if (existingMap[eventId]) {
      return { ok: true, created: false, reason: 'already_exists', commission: existingMap[eventId] };
    }

    const clients = toList(await io.read('lumo/clients'));
    const client = findClientByEmail(clients, normalized);
    const paid = isPaidConfirmed(client);
    if (!paid) {
      return { ok: true, created: false, reason: 'not_paid' };
    }

    if (previouslyPaidBeforeLaunch(client, settings.launchedAt)) {
      const skipped = {
        eventId,
        mentorId: '',
        eaId: '',
        eaName: '',
        licenseKeyRef: '',
        clientRef: clientRefFor(client, normalized),
        paymentRef: client?.id || eventId,
        amount: 0,
        currency: settings.currency,
        status: 'rejected',
        reason: 'previously_paid',
        source: source || 'payment',
        createdAt: nowIso(),
        availableAt: nowIso(),
      };
      await saveCommission(skipped);
      await writeAudit({
        action: 'commission_rejected',
        actorId,
        commissionId: eventId,
        reason: 'Client already had paid access before commissions launched',
      });
      return { ok: true, created: false, reason: 'previously_paid', commission: skipped };
    }

    const vault = await io.read('lumo/vault');
    const workspaces = await loadWorkspaceMap();
    const assigned = findAssignedLicenseForEmail(vault, workspaces, normalized);
    if (!assigned) {
      return { ok: true, created: false, reason: 'no_license' };
    }

    const profiles = await loadProfiles();
    const profile = profiles[assigned.mentorId] || null;
    if (!profileCanEarn(profile)) {
      return { ok: true, created: false, reason: 'not_enrolled', mentorId: assigned.mentorId };
    }

    const holdHours = Number(settings.holdHours) || 0;
    const createdAt = nowIso();
    const availableAt = new Date(parseIsoMs(createdAt) + holdHours * 3600 * 1000).toISOString();
    const status = holdHours > 0 ? 'pending' : 'available';
    const amount = commissionRateFor(profile, settings);
    const commission = {
      eventId,
      mentorId: assigned.mentorId,
      accountType: normalizeAccountType(profile?.accountType, 'mentor'),
      eaId: String(assigned.license.eaId || '').trim(),
      eaName: String(assigned.license.eaName || '').trim(),
      licenseKeyRef: maskLicenseKey(assigned.license.key),
      licenseFingerprint: String(assigned.license.key || '')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .slice(-8),
      clientRef: clientRefFor(client, normalized),
      clientName: clientDisplayName(client, normalized),
      paymentRef: String(client?.id || eventId),
      subscriptionAmount: clientSubscriptionAmount(client),
      amount,
      currency: settings.currency,
      status,
      source: source === 'payment' ? 'payment' : 'claim',
      createdAt,
      availableAt,
      payoutId: null,
    };
    await saveCommission(commission);
    await writeAudit({
      action: 'commission_created',
      actorId,
      commissionId: eventId,
      reason: 'Qualifying first-time paid subscription with mentor license',
      meta: { mentorId: commission.mentorId, amount: commission.amount },
    });
    return { ok: true, created: true, commission };
  }

  async function tryReverse({ email, eventId, reason, actorId = 'system' } = {}) {
    const id = eventId || commissionEventId(email);
    if (!id) return { ok: false, error: 'missing_id' };
    const existingMap = await loadCommissions();
    const row = existingMap[id];
    if (!row) return { ok: true, reversed: false, reason: 'not_found' };
    if (row.status === 'reversed') return { ok: true, reversed: false, reason: 'already_reversed', commission: row };
    const next = {
      ...row,
      status: 'reversed',
      reversedAt: nowIso(),
      reverseReason: String(reason || 'Payment refunded or cancelled').trim(),
    };
    await saveCommission(next);
    await writeAudit({
      action: 'commission_reversed',
      actorId,
      commissionId: id,
      reason: next.reverseReason,
    });
    return { ok: true, reversed: true, commission: next };
  }

  function summarizeMentor(allCommissions, allPayouts, details, settings, mentorId) {
    const rows = toList(allCommissions).filter((row) => String(row?.mentorId || '') === mentorId);
    const payouts = toList(allPayouts).filter((row) => String(row?.mentorId || '') === mentorId);
    const reserved = new Set();
    for (const payout of payouts) {
      if (!OPEN_PAYOUT_STATUSES.has(String(payout.status || ''))) continue;
      for (const id of payout.commissionIds || []) reserved.add(id);
    }
    let totalEarned = 0;
    let available = 0;
    let pending = 0;
    let paidOut = 0;
    let qualifying = 0;
    for (const row of rows) {
      const amount = money(row.amount);
      const status = String(row.status || '');
      if (row.reason === 'previously_paid' && amount === 0) continue;
      if (QUALIFYING_STATUSES.has(status)) {
        totalEarned += amount;
        if (row.source !== 'adjustment') qualifying += 1;
      }
      if (status === 'pending') pending += amount;
      if (status === 'available' && !reserved.has(row.eventId) && !row.payoutId) available += amount;
      if (status === 'available' && (reserved.has(row.eventId) || row.payoutId)) {
        /* reserved for an open payout — not spendable, still earned */
      }
      if (status === 'paid') paidOut += amount;
    }
    const progress = withdrawalProgress(qualifying, settings.minimumQualifyingReferrals);
    const openPayout = payouts.find((row) => OPEN_PAYOUT_STATUSES.has(String(row.status || ''))) || null;
    const canRequest =
      Boolean(settings.withdrawalEnabled) &&
      progress.unlocked &&
      available > 0 &&
      payoutDetailsComplete(details) &&
      !openPayout;
    return {
      mentorId,
      totals: {
        totalEarned: money(totalEarned),
        available: money(available),
        pending: money(pending),
        paidOut: money(paidOut),
        qualifyingReferrals: qualifying,
        successfulSubscriptions: qualifying,
      },
      progress,
      canRequestPayout: canRequest,
      requestBlockedReason: !settings.withdrawalEnabled
        ? 'Withdrawals are currently paused'
        : !progress.unlocked
          ? progress.message
          : openPayout
            ? 'A payout request is already in progress'
            : !payoutDetailsComplete(details)
              ? 'Add payout details before requesting a withdrawal'
              : available <= 0
                ? 'Available balance must be greater than 0'
                : null,
      openPayout,
      commissions: rows
        .filter((row) => !(row.reason === 'previously_paid' && money(row.amount) === 0))
        .sort((a, b) => parseIsoMs(b.createdAt) - parseIsoMs(a.createdAt)),
      payouts: payouts.sort((a, b) => parseIsoMs(b.requestedAt) - parseIsoMs(a.requestedAt)),
      payoutDetails: publicPayoutDetails(details),
      settings: {
        commissionPerReferral: settings.commissionPerReferral,
        minimumQualifyingReferrals: settings.minimumQualifyingReferrals,
        withdrawalEnabled: settings.withdrawalEnabled,
        currency: settings.currency,
        holdHours: settings.holdHours,
      },
    };
  }

  async function getMentorSummary(mentorId) {
    const settings = await ensureSettings();
    const promoted = await promoteHeld(await loadCommissions());
    const payouts = await loadPayouts();
    const detailsMap = await loadPayoutDetails();
    const profiles = await loadProfiles();
    const admins = await loadAdmins();
    const clients = toList(await io.read('lumo/clients'));
    const profile = profiles[mentorId] || null;
    const admin = findAdmin(admins, mentorId) || { id: mentorId };
    const names = splitAdminName(admin, profile);
    const summary = summarizeMentor(promoted.map, payouts, detailsMap[mentorId] || null, settings, mentorId);
    const enrolled = Boolean(profile) || summary.commissions.length > 0;
    const status = profile ? normalizeProfileStatus(profile.status) : enrolled ? 'active' : 'none';
    const canEarn = profileCanEarn(profile);
    const canJoin = (!profile && !enrolled) || status === 'rejected';
    const effectiveRate = commissionRateFor(profile, settings);
    return {
      ...summary,
      commissions: summary.commissions.map((row) => enrichCommission(row, clients)),
      enrollment: {
        enrolled,
        canJoin,
        canEarn,
        status,
        accountType: normalizeAccountType(profile?.accountType, enrolled ? 'mentor' : 'admin'),
        rate: effectiveRate,
        joinedAt: profile?.joinedAt || null,
        appliedAt: profile?.appliedAt || null,
        approvedAt: profile?.approvedAt || null,
        profile: publicProfile(profile),
        fullName: names.fullName || mentorId,
        email: normalizeEmail(profile?.email || admin.email),
        phone: String(profile?.phone || '').trim(),
      },
    };
  }

  async function savePayoutDetails(mentorId, input) {
    const currentMap = await loadPayoutDetails();
    const prev = currentMap[mentorId] || {};
    const next = {
      mentorId,
      accountHolderName: String(input.accountHolderName || '').trim(),
      bankName: String(input.bankName || '').trim(),
      accountNumber: String(input.accountNumber || prev.accountNumber || '').replace(/\s+/g, ''),
      branchCode: String(input.branchCode || '').trim(),
      accountType: String(input.accountType || '').trim(),
      updatedAt: nowIso(),
    };
    if (String(input.accountNumber || '').trim()) {
      next.accountNumber = String(input.accountNumber).replace(/\s+/g, '');
    }
    if (!payoutDetailsComplete(next)) {
      return { ok: false, error: 'Complete account holder, bank, account number, branch code, and account type.' };
    }
    await io.write(`lumo/payoutDetails/${mentorId}`, next);
    await writeAudit({
      action: 'payout_details_updated',
      actorId: mentorId,
      reason: 'Mentor updated payout details',
    });
    return { ok: true, payoutDetails: publicPayoutDetails(next) };
  }

  async function requestPayout(mentorId) {
    const summary = await getMentorSummary(mentorId);
    if (!summary.canRequestPayout) {
      return { ok: false, error: summary.requestBlockedReason || 'Withdrawal is not available yet' };
    }
    const amount = money(summary.totals.available);
    const detailsMap = await loadPayoutDetails();
    const details = detailsMap[mentorId];
    const reservedIds = summary.commissions
      .filter((row) => row.status === 'available' && !row.payoutId)
      .map((row) => row.eventId);
    const payoutId = newId('po');
    const payout = {
      payoutId,
      mentorId,
      amount,
      requestedAt: nowIso(),
      status: 'requested',
      payoutDetails: publicPayoutDetails(details),
      payoutDetailsFull: {
        accountHolderName: details.accountHolderName,
        bankName: details.bankName,
        accountNumber: details.accountNumber,
        branchCode: details.branchCode,
        accountType: details.accountType,
      },
      commissionIds: reservedIds,
      adminNotes: '',
      processedAt: null,
      processedBy: null,
    };
    await savePayout(payout);
    const all = await loadCommissions();
    for (const id of reservedIds) {
      if (!all[id]) continue;
      await saveCommission({ ...all[id], payoutId });
    }
    await writeAudit({
      action: 'payout_requested',
      actorId: mentorId,
      payoutId,
      reason: 'Mentor requested withdrawal',
      meta: { amount },
    });
    const { payoutDetailsFull, ...publicPayout } = payout;
    return { ok: true, payout: publicPayout };
  }

  async function processPayout(payoutId, action, { actorId, reason, notes } = {}) {
    const payouts = await loadPayouts();
    const payout = payouts[payoutId];
    if (!payout) return { ok: false, error: 'Payout not found' };
    const allowed = {
      approve: ['requested'],
      paid: ['requested', 'approved'],
      reject: ['requested', 'approved'],
    };
    if (!allowed[action]?.includes(String(payout.status))) {
      return { ok: false, error: `Cannot ${action} a payout with status ${payout.status}` };
    }
    const nextStatus = action === 'approve' ? 'approved' : action === 'paid' ? 'paid' : 'rejected';
    const next = {
      ...payout,
      status: nextStatus,
      adminNotes: String(notes || payout.adminNotes || '').trim(),
      processedAt: nowIso(),
      processedBy: actorId || 'super',
      rejectReason: action === 'reject' ? String(reason || notes || 'Rejected by admin').trim() : payout.rejectReason || null,
    };
    await savePayout(next);
    const all = await loadCommissions();
    if (action === 'paid') {
      for (const id of payout.commissionIds || []) {
        if (!all[id]) continue;
        await saveCommission({ ...all[id], status: 'paid', paidAt: nowIso(), payoutId });
      }
    }
    if (action === 'reject') {
      for (const id of payout.commissionIds || []) {
        if (!all[id]) continue;
        await saveCommission({ ...all[id], payoutId: null });
      }
    }
    await writeAudit({
      action: action === 'approve' ? 'payout_approved' : action === 'paid' ? 'payout_paid' : 'payout_rejected',
      actorId: actorId || 'super',
      payoutId,
      reason: reason || notes || null,
    });
    const { payoutDetailsFull, ...publicPayout } = next;
    return { ok: true, payout: publicPayout };
  }

  async function addAdjustment({ mentorId, amount, reason, actorId }) {
    const value = money(amount);
    const why = String(reason || '').trim();
    if (!mentorId) return { ok: false, error: 'mentorId required' };
    if (!why) return { ok: false, error: 'A reason is required for manual adjustments' };
    if (!value) return { ok: false, error: 'Adjustment amount cannot be 0' };
    const eventId = `adj_${randomBytes(8).toString('hex')}`;
    const createdAt = nowIso();
    const row = {
      eventId,
      mentorId,
      eaId: '',
      eaName: 'Manual adjustment',
      licenseKeyRef: '',
      clientRef: eventId,
      paymentRef: eventId,
      amount: value,
      currency: (await ensureSettings()).currency,
      status: value < 0 ? 'available' : 'available',
      source: 'adjustment',
      createdAt,
      availableAt: createdAt,
      reason: why,
      payoutId: null,
    };
    await saveCommission(row);
    await writeAudit({
      action: 'manual_adjustment',
      actorId: actorId || 'super',
      commissionId: eventId,
      reason: why,
      meta: { amount: value, mentorId },
    });
    return { ok: true, commission: row };
  }

  function buildEarnerRow({ mentorId, admin, profile, summary, settings }) {
    const names = splitAdminName(admin, profile);
    const status = profile
      ? normalizeProfileStatus(profile.status)
      : summary.commissions.length > 0
        ? 'active'
        : 'active';
    const accountType = normalizeAccountType(
      profile?.accountType,
      profile ? 'admin' : 'mentor',
    );
    const firstCommission = [...summary.commissions].sort(
      (a, b) => parseIsoMs(a.createdAt) - parseIsoMs(b.createdAt),
    )[0];
    return {
      mentorId,
      id: mentorId,
      firstName: names.firstName,
      lastName: names.lastName,
      fullName: names.fullName || mentorId,
      email: normalizeEmail(profile?.email || admin?.email),
      phone: String(profile?.phone || '').trim(),
      accountType,
      systemRole: String(admin?.role || profile?.roleSnapshot || 'admin'),
      status,
      rate: commissionRateFor(profile, settings),
      joinedAt: profile?.joinedAt || admin?.createdAt || firstCommission?.createdAt || null,
      appliedAt: profile?.appliedAt || null,
      approvedAt: profile?.approvedAt || null,
      totals: summary.totals,
      progress: summary.progress,
      payoutDetails: summary.payoutDetails,
      openPayout: summary.openPayout
        ? {
            payoutId: summary.openPayout.payoutId,
            amount: summary.openPayout.amount,
            status: summary.openPayout.status,
            requestedAt: summary.openPayout.requestedAt,
          }
        : null,
      canRequestPayout: summary.canRequestPayout,
      referrals: summary.totals.qualifyingReferrals,
      successfulSubscriptions: summary.totals.successfulSubscriptions,
    };
  }

  async function enrolledIds(promotedMap, payouts, detailsMap, profiles) {
    const ids = new Set();
    for (const id of Object.keys(profiles || {})) {
      if (id) ids.add(String(id));
    }
    for (const row of toList(promotedMap)) {
      if (row?.mentorId) ids.add(String(row.mentorId));
    }
    for (const row of toList(payouts)) {
      if (row?.mentorId) ids.add(String(row.mentorId));
    }
    for (const id of Object.keys(detailsMap || {})) {
      if (id) ids.add(String(id));
    }
    return ids;
  }

  async function getAdminOverview({
    mentorQuery = '',
    referenceQuery = '',
    status = '',
    from = '',
    to = '',
    filter = 'all',
  } = {}) {
    const settings = await ensureSettings();
    const promoted = await promoteHeld(await loadCommissions());
    const payouts = await loadPayouts();
    const detailsMap = await loadPayoutDetails();
    const profiles = await loadProfiles();
    const admins = await loadAdmins();
    const clients = toList(await io.read('lumo/clients'));
    const mentorIds = await enrolledIds(promoted.map, payouts, detailsMap, profiles);

    const q = String(mentorQuery || '').trim();
    const ref = String(referenceQuery || '').trim().toLowerCase();
    const statusFilter = String(status || '').trim().toLowerCase();
    const fromMs = parseIsoMs(from);
    const toMs = parseIsoMs(to);

    const mentorRows = [];
    for (const mentorId of mentorIds) {
      const admin = findAdmin(admins, mentorId) || { id: mentorId };
      const profile = profiles[mentorId] || null;
      const summary = summarizeMentor(promoted.map, payouts, detailsMap[mentorId] || null, settings, mentorId);
      mentorRows.push(buildEarnerRow({ mentorId, admin, profile, summary, settings }));
    }

    const ranked = rankEarners(mentorRows);
    const searched = ranked.filter((row) => matchesEarnerSearch(row, q));
    const filtered = filterEarners(searched, filter);

    const history = toList(promoted.map)
      .filter((row) => !(row.reason === 'previously_paid' && money(row.amount) === 0))
      .map((row) => enrichCommission(row, clients))
      .filter((row) => {
        if (q) {
          const allowedIds = new Set(searched.map((item) => item.mentorId));
          if (!allowedIds.has(row.mentorId) && !String(row.mentorId || '').toLowerCase().includes(q.toLowerCase())) {
            return false;
          }
        }
        if (statusFilter && String(row.status || '').toLowerCase() !== statusFilter) return false;
        if (fromMs && parseIsoMs(row.createdAt) < fromMs) return false;
        if (toMs && parseIsoMs(row.createdAt) > toMs + 24 * 3600 * 1000) return false;
        if (ref) {
          const blob = [row.eventId, row.clientRef, row.clientName, row.licenseKeyRef, row.paymentRef, row.mentorId, row.eaName]
            .join(' ')
            .toLowerCase();
          if (!blob.includes(ref)) return false;
        }
        return true;
      })
      .sort((a, b) => parseIsoMs(b.createdAt) - parseIsoMs(a.createdAt));

    const payoutHistory = toList(payouts)
      .filter((row) => {
        if (statusFilter && !['requested', 'approved', 'paid', 'rejected'].includes(statusFilter)) return true;
        if (statusFilter && ['requested', 'approved', 'paid', 'rejected'].includes(statusFilter) && String(row.status) !== statusFilter) {
          return false;
        }
        if (q && !matchesEarnerSearch({ mentorId: row.mentorId, fullName: '', email: '', firstName: '', lastName: '', id: row.mentorId }, q)) {
          return false;
        }
        if (ref) {
          const blob = [row.payoutId, row.mentorId].join(' ').toLowerCase();
          if (!blob.includes(ref)) return false;
        }
        return true;
      })
      .map((row) => {
        const { payoutDetailsFull, ...rest } = row;
        return rest;
      })
      .sort((a, b) => parseIsoMs(b.requestedAt) - parseIsoMs(a.requestedAt));

    const audit = toList(await loadAudit()).sort((a, b) => parseIsoMs(b.timestamp) - parseIsoMs(a.timestamp));

    const totals = ranked.reduce(
      (acc, row) => {
        acc.totalEarned += row.totals.totalEarned;
        acc.pending += row.totals.pending;
        acc.available += row.totals.available;
        acc.paidOut += row.totals.paidOut;
        acc.qualifyingReferrals += row.totals.qualifyingReferrals;
        return acc;
      },
      { totalEarned: 0, pending: 0, available: 0, paidOut: 0, qualifyingReferrals: 0 },
    );

    const visibleEarners = ranked.filter((row) => row.status !== 'rejected');
    const top = ranked[0] || null;
    const applications = ranked.filter((row) => row.status === 'pending');

    return {
      settings,
      totals: {
        totalEarned: money(totals.totalEarned),
        pending: money(totals.pending),
        available: money(totals.available),
        paidOut: money(totals.paidOut),
        qualifyingReferrals: totals.qualifyingReferrals,
        mentorCount: visibleEarners.length,
        earnerCount: visibleEarners.length,
      },
      dashboard: {
        totalEarners: visibleEarners.length,
        totalCommissionsGenerated: money(totals.totalEarned),
        totalPaid: money(totals.paidOut),
        totalPending: money(totals.pending),
        topEarner: top
          ? {
              rank: top.rank,
              mentorId: top.mentorId,
              fullName: top.fullName,
              totalEarned: top.totals.totalEarned,
            }
          : null,
      },
      mentors: filtered,
      earners: filtered,
      applications,
      commissions: history,
      payouts: payoutHistory,
      audit: audit.slice(0, 300),
      sort: 'totalEarned_desc',
    };
  }

  async function getEarnerProfile(mentorId) {
    const id = String(mentorId || '').trim();
    if (!id) return { ok: false, error: 'mentorId required' };
    const settings = await ensureSettings();
    const promoted = await promoteHeld(await loadCommissions());
    const payouts = await loadPayouts();
    const detailsMap = await loadPayoutDetails();
    const profiles = await loadProfiles();
    const admins = await loadAdmins();
    const clients = toList(await io.read('lumo/clients'));
    const overview = await getAdminOverview();
    const ranked = overview.earners.find((row) => row.mentorId === id) || overview.applications.find((row) => row.mentorId === id);
    const allRanked = rankEarners(
      (overview.earners || []).concat(overview.applications || []).filter(
        (row, index, list) => list.findIndex((item) => item.mentorId === row.mentorId) === index,
      ),
    );
    const admin = findAdmin(admins, id) || { id };
    const profile = profiles[id] || null;
    const summary = summarizeMentor(promoted.map, payouts, detailsMap[id] || null, settings, id);
    const row = buildEarnerRow({ mentorId: id, admin, profile, summary, settings });
    const rankedRow = allRanked.find((item) => item.mentorId === id) || ranked || { ...row, rank: null };
    return {
      ok: true,
      profile: {
        ...row,
        rank: rankedRow.rank || null,
        rate: commissionRateFor(profile, settings),
        commissionHistory: summary.commissions.map((item) => enrichCommission(item, clients)),
        payoutHistory: summary.payouts.map((item) => {
          const { payoutDetailsFull, ...rest } = item;
          return rest;
        }),
        dateJoined: row.joinedAt,
        currentStatus: row.status,
      },
    };
  }

  async function joinProgram(sessionAdmin, input = {}) {
    const mentorId = String(sessionAdmin?.adminId || '').trim();
    const role = String(sessionAdmin?.role || 'admin').toLowerCase();
    if (!mentorId) return { ok: false, error: 'Admin ID required' };
    if (input.acceptTerms !== true) {
      return { ok: false, error: 'Accept the Commission Program Terms to continue.' };
    }
    const requestedId = String(input.adminId || mentorId).trim();
    if (requestedId !== mentorId) {
      return { ok: false, error: 'Admin ID must match your signed-in account.' };
    }
    const profiles = await loadProfiles();
    const existing = profiles[mentorId];
    const existingStatus = existing ? normalizeProfileStatus(existing.status) : '';
    if (existingStatus === 'active') return { ok: false, error: 'Already enrolled in the commission program.' };
    if (existingStatus === 'pending') return { ok: false, error: 'Application already pending approval.' };
    if (existingStatus === 'inactive') {
      return { ok: false, error: 'This commission account is inactive. Ask Super Admin to reactivate it.' };
    }
    const existingCommissions = toList(await loadCommissions()).filter(
      (row) => String(row?.mentorId || '') === mentorId && QUALIFYING_STATUSES.has(String(row?.status || '')),
    );
    if (existingCommissions.length) {
      return { ok: false, error: 'Already enrolled in the commission program.' };
    }

    const admins = await loadAdmins();
    const admin = findAdmin(admins, mentorId);
    const names = splitAdminName(admin, {
      firstName: input.firstName,
      lastName: input.lastName,
    });
    const firstName = names.firstName;
    const lastName = names.lastName;
    const email = normalizeEmail(input.email) || normalizeEmail(admin?.email) || normalizeEmail(sessionAdmin.email);
    const phone = String(input.phone || input.phoneNumber || '').trim();
    if (!firstName || !lastName || !email || !phone) {
      return { ok: false, error: 'First name, last name, email, and phone number are required.' };
    }

    const settings = await ensureSettings();
    const needsApproval = settings.requireApproval !== false && role !== 'super';
    const now = nowIso();
    const profile = {
      mentorId,
      firstName,
      lastName,
      email,
      phone,
      source: String(input.source || input.referralSource || '').trim(),
      status: needsApproval ? 'pending' : 'active',
      accountType: 'admin',
      roleSnapshot: role === 'super' ? 'super' : 'admin',
      rateOverride: existing?.rateOverride ?? null, // never taken from the signup body
      joinedAt: existing?.joinedAt || now,
      appliedAt: now,
      approvedAt: needsApproval ? null : now,
      approvedBy: needsApproval ? null : 'auto',
      rejectedAt: null,
      rejectedReason: null,
      deactivatedAt: null,
      termsAcceptedAt: now,
    };
    await saveProfile(profile);
    await writeAudit({
      action: needsApproval ? 'commission_application_submitted' : 'commission_profile_activated',
      actorId: mentorId,
      reason: 'Joined commission program',
      meta: { mentorId, status: profile.status, roleUnchanged: true },
    });
    return { ok: true, profile: publicProfile(profile), roleUnchanged: true };
  }

  async function reviewApplication(mentorId, action, { actorId, reason } = {}) {
    const id = String(mentorId || '').trim();
    if (!id) return { ok: false, error: 'mentorId required' };
    const profiles = await loadProfiles();
    const existing = profiles[id];
    if (!existing) return { ok: false, error: 'Application not found' };
    if (action === 'approve') {
      const next = {
        ...existing,
        status: 'active',
        approvedAt: nowIso(),
        approvedBy: actorId || 'super',
        rejectedAt: null,
        rejectedReason: null,
        deactivatedAt: null,
      };
      await saveProfile(next);
      await writeAudit({
        action: 'commission_application_approved',
        actorId: actorId || 'super',
        reason: reason || 'Commission application approved',
        meta: { mentorId: id, roleUnchanged: true },
      });
      return { ok: true, profile: publicProfile(next) };
    }
    if (action === 'reject') {
      const next = {
        ...existing,
        status: 'rejected',
        rejectedAt: nowIso(),
        rejectedReason: String(reason || 'Rejected by Super Admin').trim(),
      };
      await saveProfile(next);
      await writeAudit({
        action: 'commission_application_rejected',
        actorId: actorId || 'super',
        reason: next.rejectedReason,
        meta: { mentorId: id, roleUnchanged: true },
      });
      return { ok: true, profile: publicProfile(next) };
    }
    return { ok: false, error: 'Unknown application action' };
  }

  async function setProfileStatus(mentorId, status, { actorId, reason } = {}) {
    const id = String(mentorId || '').trim();
    const nextStatus = normalizeProfileStatus(status);
    if (!id) return { ok: false, error: 'mentorId required' };
    if (nextStatus !== 'active' && nextStatus !== 'inactive') {
      return { ok: false, error: 'Status must be active or inactive' };
    }
    const profiles = await loadProfiles();
    const admins = await loadAdmins();
    const admin = findAdmin(admins, id) || { id };
    const names = splitAdminName(admin, profiles[id]);
    const existing = profiles[id] || {
      mentorId: id,
      firstName: names.firstName,
      lastName: names.lastName,
      email: normalizeEmail(admin.email),
      phone: '',
      source: '',
      accountType: 'mentor',
      roleSnapshot: String(admin.role || 'admin'),
      rateOverride: null,
      joinedAt: nowIso(),
    };
    const next = {
      ...existing,
      mentorId: id,
      status: nextStatus,
      approvedAt: nextStatus === 'active' ? existing.approvedAt || nowIso() : existing.approvedAt || null,
      approvedBy: nextStatus === 'active' ? existing.approvedBy || actorId || 'super' : existing.approvedBy || null,
      deactivatedAt: nextStatus === 'inactive' ? nowIso() : null,
    };
    await saveProfile(next);
    await writeAudit({
      action: nextStatus === 'active' ? 'commission_profile_activated' : 'commission_profile_deactivated',
      actorId: actorId || 'super',
      reason: reason || (nextStatus === 'active' ? 'Commission earner activated' : 'Commission earner deactivated'),
      meta: { mentorId: id, roleUnchanged: true },
    });
    return { ok: true, profile: publicProfile(next) };
  }

  async function setProfileRate(mentorId, rate, { actorId } = {}) {
    const id = String(mentorId || '').trim();
    if (!id) return { ok: false, error: 'mentorId required' };
    const value = rate == null || rate === '' ? null : Number(rate);
    if (value != null && (!Number.isFinite(value) || value < 0)) {
      return { ok: false, error: 'Commission rate must be 0 or greater' };
    }
    const profiles = await loadProfiles();
    const admins = await loadAdmins();
    const admin = findAdmin(admins, id) || { id };
    const names = splitAdminName(admin, profiles[id]);
    const existing = profiles[id] || {
      mentorId: id,
      firstName: names.firstName,
      lastName: names.lastName,
      email: normalizeEmail(admin.email),
      status: 'active',
      accountType: 'mentor',
      roleSnapshot: String(admin.role || 'admin'),
      joinedAt: nowIso(),
    };
    const next = {
      ...existing,
      mentorId: id,
      status: existing.status || 'active',
      rateOverride: value,
    };
    await saveProfile(next);
    await writeAudit({
      action: 'commission_rate_updated',
      actorId: actorId || 'super',
      reason: 'Per-earner commission rate updated',
      meta: { mentorId: id, rateOverride: value },
    });
    return { ok: true, profile: publicProfile(next) };
  }

  async function markCommissionPaid(eventId, { actorId } = {}) {
    const id = String(eventId || '').trim();
    if (!id) return { ok: false, error: 'eventId required' };
    const all = await loadCommissions();
    const row = all[id];
    if (!row) return { ok: false, error: 'Commission not found' };
    const status = String(row.status || '');
    if (status === 'reversed' || status === 'rejected') {
      return { ok: false, error: 'Cannot mark this commission as paid' };
    }
    if (status === 'paid') return { ok: true, commission: row };
    const next = { ...row, status: 'paid', paidAt: nowIso() };
    await saveCommission(next);
    await writeAudit({
      action: 'commission_marked_paid',
      actorId: actorId || 'super',
      commissionId: id,
      reason: 'Super Admin marked commission as paid',
    });
    return { ok: true, commission: next };
  }

  async function getAudit(limit = 200) {
    return toList(await loadAudit())
      .sort((a, b) => parseIsoMs(b.timestamp) - parseIsoMs(a.timestamp))
      .slice(0, limit);
  }

  async function getPayoutForAdmin(payoutId) {
    const payouts = await loadPayouts();
    return payouts[payoutId] || null;
  }

  return {
    ensureSettings,
    writeSettings,
    tryQualify,
    tryReverse,
    getMentorSummary,
    savePayoutDetails,
    requestPayout,
    processPayout,
    addAdjustment,
    getAdminOverview,
    getEarnerProfile,
    joinProgram,
    reviewApplication,
    setProfileStatus,
    setProfileRate,
    markCommissionPaid,
    getAudit,
    getPayoutForAdmin,
    writeAudit,
  };
}

export const defaultEngine = createCommissionEngine(firebaseIo);

export async function tryQualifyCommission(opts) {
  try {
    return await defaultEngine.tryQualify(opts);
  } catch (err) {
    console.warn('[commission] qualify failed', err);
    return { ok: false, created: false, error: err instanceof Error ? err.message : 'qualify_failed' };
  }
}

export async function tryReverseCommission(opts) {
  try {
    return await defaultEngine.tryReverse(opts);
  } catch (err) {
    console.warn('[commission] reverse failed', err);
    return { ok: false, reversed: false, error: err instanceof Error ? err.message : 'reverse_failed' };
  }
}
