/** Permissive email check for worldwide registration — no country or TLD rules. */

const MAX_EMAIL_LEN = 254;

export function normalizeRegistrationEmail(raw) {
  return String(raw || '').trim().toLowerCase();
}

export function isRegistrationEmail(raw) {
  const email = normalizeRegistrationEmail(raw);
  if (!email || email.length > MAX_EMAIL_LEN) return false;
  const at = email.indexOf('@');
  if (at <= 0 || at === email.length - 1) return false;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (!local || !domain || domain.startsWith('.') || domain.endsWith('.')) return false;
  if (/\s/.test(email)) return false;
  return true;
}

export function splitNameFromEmail(email) {
  const local = normalizeRegistrationEmail(email).split('@')[0] || 'Client';
  const parts = local.replace(/[._+-]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: 'Client', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}
