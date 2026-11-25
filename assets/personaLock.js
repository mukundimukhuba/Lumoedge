/** Keep a customer's robot on the persona stored on their own license. */

export function normPersona(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

export function placeholderName(value) {
  const n = normPersona(value);
  return !n || n === 'lumoedge' || n === 'lumo';
}

/** Exact key match. Visually similar characters must not load another license. */
export function exactPersonaKey(a, b) {
  const norm = (s) => String(s || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const left = norm(a);
  const right = norm(b);
  return Boolean(left && right && left === right);
}

function mediaList(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.values(value);
  return [];
}

/**
 * Name on this license wins. The linked EA record may fill a blank/placeholder
 * name only. Mentor profile names are intentionally ignored here so one admin's
 * branding sync cannot rename another mentor's student robots.
 */
export function keepPersonaName(licenseName, eaName, _profileName) {
  const license = String(licenseName || '').trim();
  if (!placeholderName(license)) return license;
  const ea = String(eaName || '').trim();
  if (!placeholderName(ea)) return ea;
  return license || ea || '';
}

/** True only when this license is explicitly owned by the mentor. */
export function ownsPersonaLicense(license, adminId) {
  const owner = String(license?.ownerAdminId || license?.adminId || '').trim();
  const id = String(adminId || '').trim();
  return Boolean(owner && id && owner === id);
}

/** Tagline already on the license wins. Profile text only fills an empty one. */
export function keepPersonaText(licenseText, profileText) {
  const license = String(licenseText || '').trim();
  if (license) return license;
  return String(profileText || '').trim();
}

/**
 * Pictures already on the license stay there. Another profile's photos are used
 * only when this license has none of its own.
 */
export function keepPersonaMedia(licenseMedia, profileMedia) {
  const own = new Map();
  for (const item of mediaList(licenseMedia)) {
    if (!item?.slot || !String(item.url || '').trim()) continue;
    own.set(item.slot, item);
  }
  if (own.size) return [...own.values()];
  const fill = new Map();
  for (const item of mediaList(profileMedia)) {
    if (!item?.slot || !String(item.url || '').trim()) continue;
    fill.set(item.slot, item);
  }
  return [...fill.values()];
}

function usableImage(value) {
  const v = String(value || '').trim();
  if (!v || v.startsWith('blob:')) return '';
  return v;
}

/** This license's picture wins over the mentor profile picture. */
export function keepPersonaImage(licenseImage, profileImage) {
  return usableImage(licenseImage) || usableImage(profileImage) || '';
}
