import { isValidEmail, sendResendEmail, resolveResendApiKey } from './send.mjs';
import { sendTrackedEmail } from './log.mjs';
import {
  adminManualEmail,
  licenseKeyEmail,
  mentorApprovedEmail,
  mentorReceivedEmail,
} from './messages.mjs';

export { isValidEmail, sendResendEmail, resolveResendApiKey };

export async function notifyMentorReceived(ctx, mentor) {
  const to = isValidEmail(mentor?.email);
  if (!to) return { ok: false, skipped: true, error: 'no email' };
  const msg = mentorReceivedEmail(mentor);
  return sendTrackedEmail({
    ...ctx,
    sendResendEmail,
    idempotencyKey: `mentor-received:${mentor.id || to}`,
    type: 'mentor_received',
    relatedId: String(mentor.id || ''),
    to,
    subject: msg.subject,
    html: msg.html,
    text: msg.text,
  });
}

export async function notifyMentorApproved(ctx, mentor) {
  const to = isValidEmail(mentor?.email);
  if (!to) return { ok: false, skipped: true, error: 'no email' };
  const msg = mentorApprovedEmail(mentor);
  return sendTrackedEmail({
    ...ctx,
    sendResendEmail,
    idempotencyKey: `mentor-approved:${mentor.id || to}`,
    type: 'mentor_approved',
    relatedId: String(mentor.id || ''),
    to,
    subject: msg.subject,
    html: msg.html,
    text: msg.text,
  });
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
    licenseKey: key,
    eaName: license?.eaName,
  });
  const norm = key.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return sendTrackedEmail({
    ...ctx,
    sendResendEmail,
    idempotencyKey: `license-key:${norm}`,
    type: 'license_key',
    relatedId: norm,
    to,
    subject: msg.subject,
    html: msg.html,
    text: msg.text,
  });
}

export async function notifyAdminManual(ctx, input) {
  const to = isValidEmail(input?.to);
  if (!to) return { ok: false, skipped: true, error: 'invalid recipient' };
  const msg = adminManualEmail({
    subject: input.subject,
    messageHtml: input.html,
    messageText: input.text || input.message,
  });
  return sendTrackedEmail({
    ...ctx,
    sendResendEmail,
    idempotencyKey: `admin-manual:${to}:${Date.now()}`,
    type: 'admin_manual',
    relatedId: String(input.relatedId || ''),
    to,
    subject: msg.subject,
    html: msg.html,
    text: msg.text,
  });
}

/**
 * Collect platform emails for broadcast audiences.
 * @param {'all_mentors'|'all_clients'|'everyone'} audience
 * @param {(path: string) => Promise<any>} firebaseRead
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
  if (audience === 'everyone') {
    const all = new Set([...mentors, ...clients]);
    return [...all];
  }
  return [];
}
