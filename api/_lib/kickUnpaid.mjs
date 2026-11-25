/**
 * Kick only unpaid freeloaders from TODAY — not people who paid earlier
 * via Super Admin mark-as-paid / bank / other non-PayPal methods.
 */
import { normalizeRegistrationEmail, isRegistrationEmail } from './registrationEmail.mjs';
import { saveSubscriptionPatch, listSubscriptions } from './subscriptionVault.mjs';
import { clearPhoneDevice, putPhoneSession } from './phoneSessions.mjs';

/** Only these were self-serve spoof unlocks — never real bank/admin marks. */
const SPOOF_SOURCES = new Set([
  'paypal_sync_access',
  'paypal_claim',
  'sync_access',
  'client_sync',
]);

/** Today (Africa/Johannesburg) unpaid flood window start — UTC. */
/** Johannesburg calendar day start for 2026-11-18 (UTC+2). */
const TODAY_START_MS = Date.parse('2026-11-17T22:00:00.000Z');

const SUPER_KEEP = new Set([
  'mukundimukhuba8@gmail.com',
  'mukundimukhuba8@icloud.com',
]);

/**
 * Spoofed = free unlock via the old sync-access / I've Paid hole.
 * Those rows often stored paymentVerifiedSource:"admin" with paymentReference
 * "sync-…" — that is NOT a Super Admin approve.
 */
export function isSpoofedVerify(row) {
  if (!row || row.paymentVerified !== true) return false;
  const email = normalizeRegistrationEmail(row.email);
  if (SUPER_KEEP.has(email)) return false;
  const source = String(row.paymentVerifiedSource || '');
  if (SPOOF_SOURCES.has(source)) return true;
  const ref = String(row.paymentReference || '').trim().toLowerCase();
  if (ref.startsWith('sync-') || ref.startsWith('sync_')) return true;
  return false;
}

/** First-time freeloader from today: never had a real prior verify, pending now or spoof. */
export function isTodayUnpaidFreeloader(row) {
  if (!row) return false;
  const email = normalizeRegistrationEmail(row.email);
  if (SUPER_KEEP.has(email)) return false;
  if (row.paymentVerified === true && !isSpoofedVerify(row)) return false;
  const source = String(row.paymentVerifiedSource || '');
  if (SPOOF_SOURCES.has(source)) return true;
  const at = Date.parse(
    String(row.paymentVerifiedAt || row.paymentClaimedAt || row.createdAt || ''),
  );
  // Only today's unpaid claims — older pending customers are left alone.
  if (!Number.isFinite(at) || at < TODAY_START_MS) return false;
  // Claimed payment today without verified PayPal / admin mark.
  return row.paymentClaimed === true && row.paymentVerified !== true;
}

export async function revokeUnpaidAccess(email) {
  const key = normalizeRegistrationEmail(email);
  if (!isRegistrationEmail(key)) return { ok: false, email: key, error: 'email' };
  if (SUPER_KEEP.has(key)) return { ok: false, email: key, error: 'super_keep' };

  const patch = {
    revokePaymentVerified: true,
    status: 'pending',
    paymentClaimed: false,
  };
  let patched = null;
  try {
    patched = await saveSubscriptionPatch(key, patch);
  } catch {
    patched = null;
  }
  try {
    const { patchPrivateClient } = await import('./supabaseRoster.mjs');
    await patchPrivateClient(key, patch);
  } catch {
    /* best effort */
  }
  try {
    const { firebasePatchClientById } = await import('./clientMerge.mjs');
    await firebasePatchClientById(key, patch);
  } catch {
    /* best effort */
  }

  try {
    await putPhoneSession(
      key,
      {
        email: key,
        accessStatus: 'pending',
        requiresRepayment: true,
        user: { email: key },
        bot: {
          name: 'LUMOEDGE',
          displayName: 'Lumo Edge',
          mainText: 'LUMO EDGE',
          licenseKey: '',
          status: 'paused',
          symbols: ['XAUUSD'],
          imageUrl: '',
          customMedia: [],
        },
        updatedAt: new Date().toISOString(),
      },
      { force: true },
    );
  } catch {
    /* best effort */
  }

  try {
    await clearPhoneDevice(key);
  } catch {
    /* best effort */
  }

  return { ok: true, email: key, revoked: true, patched: Boolean(patched) };
}

/** Restore a prior payer who was wrongly kicked (admin / bank mark). */
export async function restorePriorPayer(email, { firstName = '', lastName = '' } = {}) {
  const key = normalizeRegistrationEmail(email);
  if (!isRegistrationEmail(key)) return { ok: false, email: key, error: 'email' };
  try {
    const { isBannedEmail } = await import('./bannedAccounts.mjs');
    if (isBannedEmail(key)) return { ok: false, email: key, error: 'banned' };
  } catch {
    /* continue */
  }
  const now = new Date().toISOString();
  const patch = {
    status: 'approved',
    paymentClaimed: true,
    paymentClaimedAt: now,
    paymentVerified: true,
    paymentVerifiedAt: now,
    paymentVerifiedSource: 'admin',
    revokePaymentVerified: false,
  };
  let patched = null;
  try {
    patched = await saveSubscriptionPatch(key, patch);
  } catch {
    patched = null;
  }
  if (!patched) {
    try {
      const { saveSubscription } = await import('./subscriptionVault.mjs');
      patched = await saveSubscription({ email: key, firstName, lastName, ...patch });
    } catch {
      patched = null;
    }
  }
  try {
    const { patchPrivateClient, savePrivateClient } = await import('./supabaseRoster.mjs');
    (await patchPrivateClient(key, patch)) ||
      (await savePrivateClient({ email: key, firstName, lastName, ...patch }));
  } catch {
    /* best effort */
  }
  try {
    const { firebasePatchClientById } = await import('./clientMerge.mjs');
    await firebasePatchClientById(key, patch);
  } catch {
    /* best effort */
  }
  try {
    const { getPhoneSession } = await import('./phoneSessions.mjs');
    const prev = (await getPhoneSession(key).catch(() => null)) || {};
    const prevBot = prev.bot && typeof prev.bot === 'object' ? prev.bot : {};
    const hasLicense = Boolean(String(prevBot.licenseKey || '').trim());
    await putPhoneSession(
      key,
      {
        ...prev,
        email: key,
        accessStatus: hasLicense ? 'licensed' : 'paid',
        requiresRepayment: false,
        user: {
          ...(prev.user && typeof prev.user === 'object' ? prev.user : {}),
          email: key,
          firstName: firstName || prev.user?.firstName || '',
          lastName: lastName || prev.user?.lastName || '',
        },
        bot: {
          name: prevBot.name || 'LUMOEDGE',
          displayName: prevBot.displayName || 'Lumo Edge',
          mainText: prevBot.mainText || 'LUMO EDGE',
          licenseKey: prevBot.licenseKey || '',
          status: hasLicense ? prevBot.status || 'active' : 'paused',
          symbols: Array.isArray(prevBot.symbols) ? prevBot.symbols : ['XAUUSD'],
          imageUrl: prevBot.imageUrl || '',
          customMedia: Array.isArray(prevBot.customMedia) ? prevBot.customMedia : [],
        },
        updatedAt: now,
      },
      { force: true },
    );
  } catch {
    /* best effort */
  }
  return { ok: true, email: key, restored: true, patched: Boolean(patched) };
}

/**
 * Clear repay flags for everyone who already paid (admin / bank / PayPal / etc).
 * Does NOT touch today's unpaid freeloaders or sync-access spoof unlocks.
 */
export async function clearRepayForVerifiedPayers() {
  let rows = [];
  try {
    const { listPrivateClients } = await import('./supabaseRoster.mjs');
    const list = await listPrivateClients();
    rows = Array.isArray(list) ? list : [];
  } catch {
    rows = [];
  }
  if (!rows.length) {
    try {
      rows = await listSubscriptions();
    } catch {
      rows = [];
    }
  }

  let isBannedEmail = () => false;
  try {
    ({ isBannedEmail } = await import('./bannedAccounts.mjs'));
  } catch {
    /* ignore */
  }
  const verified = [];
  for (const row of rows) {
    const email = normalizeRegistrationEmail(row?.email);
    if (!email || !isRegistrationEmail(email)) continue;
    if (isBannedEmail(email)) continue;
    if (row?.paymentVerified !== true) continue;
    if (isSpoofedVerify(row)) continue;
    verified.push(email);
  }

  const { clearRepaymentFlagsForEmails } = await import('./phoneSessions.mjs');
  const result = await clearRepaymentFlagsForEmails(verified);
  return {
    ok: Boolean(result?.ok),
    verified: verified.length,
    cleared: result?.cleared || 0,
    emails: result?.emails || [],
  };
}

/**
 * After Supabase is paid again: copy every real verified payer from recovery
 * into the subscription vault, then clear requiresRepayment on their sessions.
 */
export async function resyncPaidRosterFromRecovery() {
  let rows = [];
  try {
    const { listPrivateClients } = await import('./supabaseRoster.mjs');
    const list = await listPrivateClients();
    rows = Array.isArray(list) ? list : [];
  } catch {
    rows = [];
  }
  if (!rows.length) {
    try {
      const { listOfflineRoster } = await import('./offlineRoster.mjs');
      rows = listOfflineRoster();
    } catch {
      rows = [];
    }
  }

  let isBannedEmail = () => false;
  try {
    ({ isBannedEmail } = await import('./bannedAccounts.mjs'));
  } catch {
    /* ignore */
  }

  const paid = [];
  for (const row of rows) {
    const email = normalizeRegistrationEmail(row?.email);
    if (!email || !isRegistrationEmail(email)) continue;
    if (isBannedEmail(email)) continue;
    if (row?.paymentVerified !== true) continue;
    if (isSpoofedVerify(row)) continue;
    paid.push({ ...row, email });
  }

  let vaultWritten = 0;
  let vaultOk = false;
  let vaultError = '';
  try {
    const { upsertSubscription, emptySubscriptionStore } = await import(
      './subscriptionVault.mjs'
    );
    const { uploadPrivateJson } = await import('./supabase.mjs');
    // Prefer building from paid rows even if the live vault read is overloaded.
    let store = emptySubscriptionStore();
    try {
      const { loadSubscriptionStore } = await import('./subscriptionVault.mjs');
      const current = await loadSubscriptionStore();
      if (current && !current.__offline) {
        store = {
          clients: { ...(current.clients || {}) },
          version: Number(current.version || 0),
        };
      } else if (current?.__offline) {
        vaultError = current.reason || 'vault_offline';
      }
    } catch (err) {
      vaultError = err?.message || 'vault_read_failed';
    }
    for (const row of paid) {
      store = upsertSubscription(store, {
        ...row,
        status: 'approved',
        paymentClaimed: true,
        paymentVerified: true,
        paymentVerifiedSource:
          row.paymentVerifiedSource && row.paymentVerifiedSource !== 'paypal_sync_access'
            ? row.paymentVerifiedSource
            : 'admin',
      });
      vaultWritten += 1;
    }
    store = { ...store, version: Number(store.version || 0) + 1 };
    vaultOk = Boolean(await uploadPrivateJson('recovery/subscriptions.json', store));
    if (!vaultOk && !vaultError) vaultError = 'vault_upload_failed';
  } catch (err) {
    vaultOk = false;
    vaultError = err?.message || 'vault_resync_failed';
  }

  const clear = await clearRepayForVerifiedPayers();
  return {
    ok: vaultOk || clear?.ok === true,
    recoveryClients: rows.length,
    paid: paid.length,
    vaultWritten,
    vaultOk,
    vaultError: vaultError || undefined,
    repayCleared: clear?.cleared || 0,
    verifiedSeen: clear?.verified || paid.length,
  };
}

export async function kickRecentUnpaid() {
  let rows = [];
  try {
    rows = await listSubscriptions();
  } catch {
    rows = [];
  }
  if (!Array.isArray(rows) || !rows.length) {
    try {
      const { listPrivateClients } = await import('./supabaseRoster.mjs');
      const list = await listPrivateClients();
      rows = Array.isArray(list) ? list : [];
    } catch {
      rows = [];
    }
  }

  const kicked = [];
  for (const row of rows) {
    const email = normalizeRegistrationEmail(row?.email);
    if (!email || SUPER_KEEP.has(email)) continue;
    if (!isSpoofedVerify(row) && !isTodayUnpaidFreeloader(row)) continue;
    // Only act on today's activity for freeloaders; spoof sources anytime.
    const at = Date.parse(String(row.paymentVerifiedAt || row.paymentClaimedAt || ''));
    if (isTodayUnpaidFreeloader(row) && Number.isFinite(at) && at < TODAY_START_MS) continue;
    const result = await revokeUnpaidAccess(email);
    if (result.ok) kicked.push(email);
  }
  return { ok: true, kicked: kicked.length, emails: kicked };
}

/** Revoke every sync-* / sync-access spoof that still looks "admin approved". */
export async function kickSyncSpoofVerifies() {
  let rows = [];
  try {
    const { listPrivateClients } = await import('./supabaseRoster.mjs');
    const list = await listPrivateClients();
    rows = Array.isArray(list) ? list : [];
  } catch {
    rows = [];
  }
  if (!rows.length) {
    try {
      rows = await listSubscriptions();
    } catch {
      rows = [];
    }
  }
  try {
    const { listOfflineRoster } = await import('./offlineRoster.mjs');
    const offline = listOfflineRoster();
    if (offline.length) rows = [...rows, ...offline];
  } catch {
    /* ignore */
  }

  const seen = new Set();
  const kicked = [];
  for (const row of rows) {
    const email = normalizeRegistrationEmail(row?.email);
    if (!email || seen.has(email) || SUPER_KEEP.has(email)) continue;
    seen.add(email);
    if (!isSpoofedVerify(row)) continue;
    const result = await revokeUnpaidAccess(email);
    if (result.ok) kicked.push(email);
  }
  return { ok: true, kicked: kicked.length, emails: kicked };
}
