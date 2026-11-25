/** Shared helpers so temporary storage outages are never treated as “not found” / unpaid. */

export function durableUnavailablePayload(extra = {}) {
  return {
    ok: false,
    error: 'unavailable',
    reason: 'storage_unavailable',
    message:
      extra.message ||
      'Private storage is temporarily unavailable. Your access was not revoked — try again shortly.',
    ...extra,
  };
}

export function isOfflineStore(store) {
  return store == null || store.__offline === true;
}

export function offlineStore(reason = 'storage_unreachable') {
  return { __offline: true, reason, clients: {}, version: -1 };
}
