/**
 * Email delivery log + idempotency helpers (Firebase RTDB).
 * Never store API keys, passwords, or reset codes here.
 */

export async function findEmailLogByKey(firebaseRead, idempotencyKey) {
  const key = String(idempotencyKey || '').trim();
  if (!key) return null;
  const all = (await firebaseRead('lumo/emailLogs')) || {};
  if (!all || typeof all !== 'object') return null;
  for (const [id, row] of Object.entries(all)) {
    if (!row || typeof row !== 'object') continue;
    if (String(row.idempotencyKey || '') === key && String(row.status || '').toLowerCase() === 'sent') {
      return { id, ...row };
    }
  }
  return null;
}

export function listEmailLogs(raw, limit = 80) {
  const all = raw && typeof raw === 'object' ? raw : {};
  return Object.entries(all)
    .map(([id, row]) => (row && typeof row === 'object' ? { id, ...row } : null))
    .filter(Boolean)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .slice(0, Math.max(1, Number(limit) || 80))
    .map((row) => ({
      id: row.id,
      to: row.to || '',
      type: row.type || 'unknown',
      subject: row.subject || '',
      status: String(row.status || 'failed').toUpperCase(),
      createdAt: row.createdAt || '',
      relatedUserId: row.relatedUserId || row.relatedId || '',
      relatedLicenseId: row.relatedLicenseId || '',
      error: row.error ? String(row.error).slice(0, 200) : '',
    }));
}

export async function writeEmailLog(firebaseWrite, _firebasePush, entry) {
  const payload = {
    to: String(entry.to || '')
      .trim()
      .toLowerCase(),
    type: String(entry.type || 'unknown'),
    subject: String(entry.subject || ''),
    status: String(entry.status || 'failed'),
    idempotencyKey: String(entry.idempotencyKey || ''),
    relatedId: String(entry.relatedId || ''),
    relatedUserId: String(entry.relatedUserId || entry.relatedId || ''),
    relatedLicenseId: String(entry.relatedLicenseId || ''),
    error: entry.error ? String(entry.error).slice(0, 500) : '',
    messageId: String(entry.messageId || entry.resendId || ''),
    resendId: String(entry.messageId || entry.resendId || ''),
    provider: String(entry.provider || ''),
    createdAt: new Date().toISOString(),
  };
  const id = `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await firebaseWrite(`lumo/emailLogs/${id}`, payload);
  return { id, ...payload };
}

/**
 * Send once per idempotency key. Logs result. Never throws.
 */
export async function sendTrackedEmail({
  firebaseRead,
  firebaseWrite,
  firebasePush,
  sendResendEmail,
  sendLumoEmail,
  idempotencyKey,
  type,
  relatedId,
  relatedUserId,
  relatedLicenseId,
  to,
  subject,
  html,
  text = null,
}) {
  const send = sendLumoEmail || sendResendEmail;
  try {
    const existing = await findEmailLogByKey(firebaseRead, idempotencyKey);
    if (existing) {
      return { ok: true, skipped: true, reason: 'already_sent', log: existing };
    }
    const result = await send({
      to,
      subject,
      html,
      text,
      tags: [type],
      template: type,
      firebaseRead,
    });
    await writeEmailLog(firebaseWrite, firebasePush, {
      to,
      type,
      subject,
      status: result.ok ? 'sent' : result.skipped ? 'skipped' : 'failed',
      idempotencyKey,
      relatedId,
      relatedUserId: relatedUserId || relatedId,
      relatedLicenseId,
      error: result.error || '',
      messageId: result.id || '',
      provider: result.provider || '',
    });
    return result;
  } catch (e) {
    try {
      await writeEmailLog(firebaseWrite, firebasePush, {
        to,
        type,
        subject,
        status: 'failed',
        idempotencyKey,
        relatedId,
        relatedUserId: relatedUserId || relatedId,
        relatedLicenseId,
        error: e instanceof Error ? e.message : 'email failed',
      });
    } catch {
      /* ignore log failure */
    }
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'email failed',
    };
  }
}
