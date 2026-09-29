import {
  isValidEmail,
  sendLumoEmail,
  sendLumoEmailMany,
  sendResendEmail,
  resolveEmailProvider,
  describeEmailConfig,
} from './send.mjs';
import { listEmailLogs, sendTrackedEmail } from './log.mjs';
import {
  adminManualEmail,
  licenseKeyEmail,
  mentorApprovedEmail,
  passwordResetEmail,
  registrationConfirmationEmail,
} from './messages.mjs';
import { APP_LOGIN_URL } from './template.mjs';

export {
  isValidEmail,
  sendLumoEmail,
  sendResendEmail,
  resolveEmailProvider,
  describeEmailConfig,
  listEmailLogs,
};

function tracked(ctx, extra) {
  return {
    ...ctx,
    sendLumoEmail,
    sendResendEmail,
    ...extra,
  };
}

export async function notifyMentorReceived(ctx, mentor) {
  const to = isValidEmail(mentor?.email);
  if (!to) return { ok: false, skipped: true, error: 'no email' };
  const msg = registrationConfirmationEmail(mentor);
  return sendTrackedEmail(
    tracked(ctx, {
      idempotencyKey: `registration:${mentor.id || to}`,
      type: 'registration_confirmation',
      relatedId: String(mentor.id || ''),
      relatedUserId: String(mentor.id || ''),
      to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    }),
  );
}

export async function notifyMentorApproved(ctx, mentor) {
  const to = isValidEmail(mentor?.email);
  if (!to) return { ok: false, skipped: true, error: 'no email' };
  const msg = mentorApprovedEmail({
    ...mentor,
    portalUrl: mentor?.portalUrl || APP_LOGIN_URL,
  });
  return sendTrackedEmail(
    tracked(ctx, {
      idempotencyKey: `mentor-approved:${mentor.id || to}:${mentor.approvalDate || ''}`,
      type: 'mentor_approval',
      relatedId: String(mentor.id || ''),
      relatedUserId: String(mentor.id || ''),
      to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    }),
  );
}

export async function notifyLicenseKey(ctx, license) {
  const to = isValidEmail(license?.email || license?.clientEmail);
  const key = String(license?.key || '').trim();
  if (!to || !key) {
    return { ok: false, skipped: true, error: 'email or license key missing' };
  }
  const msg = licenseKeyEmail({
    name: license?.clientName || license?.name,
    fullName: license?.fullName,
    clientName: license?.clientName,
    firstName: license?.firstName,
    licenseKey: key,
    eaName: license?.eaName,
    licenseDuration: license?.licenseDuration || license?.duration,
    portalUrl: license?.portalUrl || APP_LOGIN_URL,
  });
  const norm = key.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return sendTrackedEmail(
    tracked(ctx, {
      idempotencyKey: `license-key:${norm}`,
      type: 'license_key',
      relatedId: norm,
      relatedUserId: String(license?.ownerAdminId || license?.clientEmail || ''),
      relatedLicenseId: String(license?.id || norm),
      to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    }),
  );
}

export async function notifyPasswordReset(ctx, input) {
  const to = isValidEmail(input?.email);
  const code = String(input?.resetCode || '').trim();
  if (!to || !code) return { ok: false, skipped: true, error: 'email or code missing' };
  const msg = passwordResetEmail({
    firstName: input.firstName,
    name: input.name,
    fullName: input.fullName,
    resetCode: code,
  });
  return sendTrackedEmail(
    tracked(ctx, {
      idempotencyKey: `password-reset:${to}:${input.requestId || Date.now()}`,
      type: 'password_reset',
      relatedId: String(input.userId || ''),
      relatedUserId: String(input.userId || ''),
      to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    }),
  );
}

export async function notifyAdminManual(ctx, input) {
  const to = isValidEmail(input?.to);
  if (!to) return { ok: false, skipped: true, error: 'invalid recipient' };
  const msg = adminManualEmail({
    subject: input.subject,
    messageHtml: input.html,
    messageText: input.text || input.message,
  });
  return sendTrackedEmail(
    tracked(ctx, {
      idempotencyKey: `admin-manual:${to}:${Date.now()}`,
      type: 'admin_manual',
      relatedId: String(input.relatedId || ''),
      to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    }),
  );
}

/**
 * Collect platform emails for broadcast audiences.
 * @param {'all_mentors'|'all_clients'|'everyone'} audience
 */
function collectEmails(raw, readEmail) {
  const rows = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? Object.values(raw) : [];
  const emails = new Set();
  for (const row of rows) {
    const email = isValidEmail(readEmail(row));
    if (email) emails.add(email);
  }
  return emails;
}

export async function resolveAudienceEmails(audience, firebaseRead) {
  const wantMentors = audience === 'all_mentors' || audience === 'everyone';
  const wantClients = audience === 'all_clients' || audience === 'everyone';
  const mentors = new Set();
  const clients = new Set();

  if (wantMentors) {
    const curAuth = (await firebaseRead('lumo/auth')) || {};
    const admins = Array.isArray(curAuth.admins)
      ? curAuth.admins
      : curAuth.admins && typeof curAuth.admins === 'object'
        ? Object.values(curAuth.admins)
        : [];
    for (const email of collectEmails(admins, (row) => row?.email)) mentors.add(email);
  }

  if (wantClients) {
    const topClients = (await firebaseRead('lumo/clients')) || [];
    for (const email of collectEmails(topClients, (row) => row?.email)) clients.add(email);
  }

  if (audience === 'all_mentors') return [...mentors];
  if (audience === 'all_clients') return [...clients];
  if (audience === 'everyone') return [...new Set([...mentors, ...clients])];
  return [];
}

export async function notifyAudience(ctx, input) {
  const emails = Array.isArray(input?.recipients) ? input.recipients : [];
  const msg = adminManualEmail({
    subject: input.subject,
    messageHtml: input.html,
    messageText: input.text || input.message,
  });
  const batch = await sendLumoEmailMany({
    recipients: emails,
    subject: msg.subject,
    html: msg.html,
    text: msg.text,
    firebaseRead: ctx?.firebaseRead,
  });
  if (typeof ctx?.firebaseWrite === 'function') {
    await writeSummaryEmailLog(ctx.firebaseWrite, {
      subject: msg.subject,
      sent: batch.sent || 0,
      failed: batch.failed || 0,
      total: batch.total || emails.length,
      error: batch.error || '',
      provider: batch.provider || '',
    }).catch(() => {});
  }
  return batch;
}

async function writeSummaryEmailLog(firebaseWrite, entry) {
  const id = `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await firebaseWrite(`lumo/emailLogs/${id}`, {
    to: `${entry.sent || 0} of ${entry.total || 0} recipients`,
    type: 'admin_manual',
    subject: String(entry.subject || ''),
    status: entry.sent > 0 ? 'sent' : 'failed',
    idempotencyKey: '',
    relatedId: '',
    relatedUserId: '',
    relatedLicenseId: '',
    error: entry.failed ? `${entry.failed} failed. ${entry.error || ''}`.trim().slice(0, 500) : '',
    messageId: '',
    resendId: '',
    provider: String(entry.provider || ''),
    createdAt: new Date().toISOString(),
  });
}
