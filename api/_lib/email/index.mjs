import { isValidEmail, sendLumoEmail, sendResendEmail, resolveEmailProvider } from './send.mjs';
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
export async function resolveAudienceEmails(audience, firebaseRead) {
  const mentors = new Set();
  const clients = new Set();

  const curAuth = (await firebaseRead('lumo/auth')) || {};
  const admins = Array.isArray(curAuth.admins)
    ? curAuth.admins
    : curAuth.admins && typeof curAuth.admins === 'object'
      ? Object.values(curAuth.admins)
      : [];
  for (const a of admins) {
    const email = isValidEmail(a?.email);
    if (email) mentors.add(email);
  }

  const topClients = (await firebaseRead('lumo/clients')) || {};
  const clientList = Array.isArray(topClients)
    ? topClients
    : typeof topClients === 'object'
      ? Object.values(topClients)
      : [];
  for (const c of clientList) {
    const email = isValidEmail(c?.email);
    if (email) clients.add(email);
  }

  const workspaces = (await firebaseRead('lumo/store/workspaces')) || {};
  for (const ws of Object.values(workspaces || {})) {
    if (!ws || typeof ws !== 'object') continue;
    const reqs = Array.isArray(ws.clientRequests)
      ? ws.clientRequests
      : ws.clientRequests && typeof ws.clientRequests === 'object'
        ? Object.values(ws.clientRequests)
        : [];
    for (const c of reqs) {
      const email = isValidEmail(c?.email);
      if (email) clients.add(email);
    }
  }

  if (audience === 'all_mentors') return [...mentors];
  if (audience === 'all_clients') return [...clients];
  if (audience === 'everyone') return [...new Set([...mentors, ...clients])];
  return [];
}
