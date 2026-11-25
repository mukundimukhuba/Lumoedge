/** Hard bans that cannot be undone by portal approve or local cache. */

import { keyFingerprint, keysMatch } from './licenseClaim.mjs';

const BANNED_EMAILS = new Set([
  'kinggeefx@gmail.com',
  'adolphquelin41@gmail.com',
  // Assigned Alpha x Bot / foreign keys onto Super Admin email.
  'sbusisomngunigift@gmail.com',
  'iturboyfifi@gmail.com',
]);

const BANNED_LICENSE_KEYS = [
  'LUMO-WBN9-QMNY-ZZGJ',
  'LUMO-U4SF-MHLC-ARP2',
  // LM-354954 Alpha x Bot (Sbusiso Mnguni Gift)
  'LUMO-MVSA-N7ZX-5DYB',
  'LUMO-EW43-57PW-DU4D',
  'LUMO-R92A-KXC6-7LW7',
  // LM-277812 (also bound keys to Super Admin email)
  'LUMO-9R3W-PBHG-26TZ',
  'LUMO-HBWP-UKH3-VBH4',
  'LUMO-BH6Q-HDLW-Z57L',
  'LUMO-EZ8G-WH69-7QMH',
  'LUMO-WUXM-PFRG-DQR5',
];

const BANNED_ADMIN_IDS = new Set([
  'LM-564951',
  'LM-354954', // Alpha x Bot — assigned keys to mukundimukhuba8@gmail.com
  'LM-277812', // Alpha X Bot — assigned keys to mukundimukhuba8@gmail.com
]);

const BANNED_ROBOT_NAMES = [
  'king of money heist',
  'king 👑 of money 💰 heist',
  'money heist',
];

/** Profile/media markers for deleted Alpha x Bot mentors only (not other Alpha X brands). */
const BANNED_PROFILE_MARKERS = [
  'profile-LM-354954',
  'LM-354954-bg',
  'profile-LM-277812',
  'LM-277812-bg',
];

export function normalizeBanEmail(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

export function isBannedEmail(email) {
  return BANNED_EMAILS.has(normalizeBanEmail(email));
}

export function isBannedAdminId(id) {
  return BANNED_ADMIN_IDS.has(String(id || '').trim());
}

export function isBannedLicenseKey(key) {
  const raw = String(key || '').trim();
  if (!raw) return false;
  return BANNED_LICENSE_KEYS.some((banned) => keysMatch(banned, raw));
}

export function isBannedRobotName(value) {
  const text = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  if (!text) return false;
  const folded = text.replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  return BANNED_ROBOT_NAMES.some((name) => {
    const n = name.replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
    return folded === n || folded.includes(n);
  });
}

export function isBannedBotImage(value) {
  const text = String(value || '');
  if (!text) return false;
  return BANNED_PROFILE_MARKERS.some((marker) => text.includes(marker));
}

export function banReason() {
  return 'This account has been permanently revoked by Super Admin.';
}

export function emptyBannedSession() {
  return {
    user: null,
    accessStatus: 'none',
    requiresRepayment: true,
    bot: {
      name: '',
      displayName: '',
      mainText: '',
      licenseKey: '',
      status: 'paused',
      symbols: ['XAUUSD'],
      imageUrl: '',
      customMedia: [],
    },
    device: null,
  };
}

export function stripBannedSession(session) {
  if (!session || typeof session !== 'object') return emptyBannedSession();
  const bot = session.bot && typeof session.bot === 'object' ? session.bot : {};
  const email = normalizeBanEmail(session.user?.email || session.email);
  const banned =
    isBannedEmail(email) ||
    isBannedLicenseKey(bot.licenseKey) ||
    isBannedRobotName(bot.name) ||
    isBannedRobotName(bot.displayName) ||
    isBannedRobotName(bot.eaName) ||
    isBannedBotImage(bot.imageUrl) ||
    isBannedBotImage(bot.eaImage);
  if (!banned) return session;
  return emptyBannedSession();
}

export function bannedLicenseFingerprints() {
  return BANNED_LICENSE_KEYS.map((key) => keyFingerprint(key)).filter(Boolean);
}

export function listBannedEmails() {
  return [...BANNED_EMAILS];
}

export function listBannedAdminIds() {
  return [...BANNED_ADMIN_IDS];
}
