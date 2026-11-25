/**
 * Single authoritative subscription / payment status for Lumo Edge.
 * Frontend copy and claim/approve MUST use these helpers — never invent parallel flags.
 */

export const SUBSCRIPTION_STATUS = Object.freeze({
  PENDING_PAYMENT: 'pending_payment',
  APPROVED: 'approved',
  DECLINED: 'declined',
  EXPIRED: 'expired',
  CANCELLED: 'cancelled',
});

/** Normalize any legacy client row into one of SUBSCRIPTION_STATUS. */
export function resolveSubscriptionStatus(client) {
  if (!client || typeof client !== 'object') return SUBSCRIPTION_STATUS.PENDING_PAYMENT;

  const raw = String(client.status || '')
    .trim()
    .toLowerCase();
  const verified = client.paymentVerified === true;
  const source = String(client.paymentVerifiedSource || '');
  const realPaid = verified && source !== 'assigned_license' && source !== 'paypal_sync_access';

  if (raw === 'rejected' || raw === 'declined') return SUBSCRIPTION_STATUS.DECLINED;
  if (raw === 'cancelled' || raw === 'canceled') return SUBSCRIPTION_STATUS.CANCELLED;
  if (raw === 'expired') return SUBSCRIPTION_STATUS.EXPIRED;

  // Approved for activation only when Super Admin (or payment webhook) verified payment.
  if (realPaid) return SUBSCRIPTION_STATUS.APPROVED;

  // Legacy rows marked approved without paymentVerified stay pending_payment.
  if (raw === 'approved' && !realPaid) return SUBSCRIPTION_STATUS.PENDING_PAYMENT;

  return SUBSCRIPTION_STATUS.PENDING_PAYMENT;
}

export function canActivateLicense(client) {
  return resolveSubscriptionStatus(client) === SUBSCRIPTION_STATUS.APPROVED;
}

export function statusLabel(status) {
  switch (status) {
    case SUBSCRIPTION_STATUS.APPROVED:
      return 'Approved';
    case SUBSCRIPTION_STATUS.DECLINED:
      return 'Declined';
    case SUBSCRIPTION_STATUS.EXPIRED:
      return 'Expired';
    case SUBSCRIPTION_STATUS.CANCELLED:
      return 'Cancelled';
    default:
      return 'Pending Payment';
  }
}

/** Patch applied when Super Admin approves payment (atomic intent). */
export function approvalPatch(actorId, now = new Date().toISOString()) {
  return {
    status: 'approved',
    paymentClaimed: true,
    paymentVerified: true,
    paymentClaimedAt: now,
    paymentVerifiedAt: now,
    paymentVerifiedSource: 'admin',
    approvedBy: String(actorId || 'super_admin').trim() || 'super_admin',
    approvedAt: now,
    subscriptionStatus: SUBSCRIPTION_STATUS.APPROVED,
    __allowAdminPrivilege: true,
  };
}

/** Patch applied when Super Admin declines. */
export function declinePatch(actorId, now = new Date().toISOString()) {
  return {
    status: 'rejected',
    paymentVerified: false,
    revokePaymentVerified: true,
    declinedBy: String(actorId || 'super_admin').trim() || 'super_admin',
    declinedAt: now,
    subscriptionStatus: SUBSCRIPTION_STATUS.DECLINED,
    __allowAdminPrivilege: true,
  };
}

/** Public-safe client view — never leak internal privilege flags. */
export function publicSubscriptionView(client) {
  if (!client) return null;
  const status = resolveSubscriptionStatus(client);
  return {
    id: client.id,
    email: client.email,
    firstName: client.firstName,
    lastName: client.lastName,
    status: status === SUBSCRIPTION_STATUS.APPROVED ? 'approved' : client.status || 'pending',
    subscriptionStatus: status,
    subscriptionStatusLabel: statusLabel(status),
    paymentVerified: status === SUBSCRIPTION_STATUS.APPROVED,
    paymentClaimed: Boolean(client.paymentClaimed),
    canActivate: status === SUBSCRIPTION_STATUS.APPROVED,
    approvedAt: client.approvedAt || client.paymentVerifiedAt || null,
    approvedBy: client.approvedBy || null,
  };
}
