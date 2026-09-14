/**
 * Email delivery log + idempotency helpers (Firebase RTDB).
 * Never store API keys or passwords here.
 */

export async function findEmailLogByKey(firebaseRead, idempotencyKey) {
  const key = String(idempotencyKey || '').trim();
  if (!key) return null;
  const all = (await firebaseRead('lumo/emailLogs')) || {};
  if (!all || typeof all !== 'object') return null;
  for (const [id, row] of Object.entries(all)) {
    if (!row || typeof row !== 'object') continue;
    if (String(row.idempotencyKey || '') === key && row.status === 'sent') {
      return { id, ...row };
    }
  }
  return null;
}

export async function writeEmailLog(firebaseWrite, _firebasePush, entry) {
  const payload = {
    to: String(entry.to || '').trim().toLowerCase(),
    type: String(entry.type || 'unknown'),
    subject: String(entry.subject || ''),
    status: String(entry.status || 'failed'),
    idempotencyKey: String(entry.idempotencyKey || ''),
    relatedId: String(entry.relatedId || ''),
    error: entry.error ? String(entry.error).slice(0, 500) : '',
    resendId: String(entry.resendId || ''),
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
  idempotencyKey,
  type,
  relatedId,
  to,
  subject,
  html,
  text = null,
}) {
  try {
    const existing = await findEmailLogByKey(firebaseRead, idempotencyKey);
    if (existing) {
      return { ok: true, skipped: true, reason: 'already_sent', log: existing };
    }
    const result = await sendResendEmail({
      to,
      subject,
      html,
      text,
      tags: [type],
      firebaseRead,
    });
    await writeEmailLog(firebaseWrite, firebasePush, {
      to,
      type,
      subject,
      status: result.ok ? 'sent' : result.skipped ? 'skipped' : 'failed',
      idempotencyKey,
      relatedId,
      error: result.error || '',
      resendId: result.id || '',
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
