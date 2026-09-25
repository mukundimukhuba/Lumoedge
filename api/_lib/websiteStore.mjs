import { randomBytes } from 'node:crypto';

export const WEBSITE_STATUSES = new Set(['draft', 'published', 'unpublished', 'disabled']);
const PRICE_RE = /^(?:R\s*)?(\d+(?:[.,]\d{1,2})?)$/i;

export function toList(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value && typeof value === 'object') return Object.values(value).filter(Boolean);
  return [];
}

export function slugifyRobotName(name) {
  const slug = String(name || '')
    .trim()
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || 'lumo-robot';
}

export function uniqueSlug(base, taken, websiteId) {
  const root = slugifyRobotName(base);
  const owned = taken instanceof Map ? taken : new Map(Object.entries(taken || {}));
  const current = owned.get(root);
  if (!current || current === websiteId) return root;
  for (let i = 2; i < 200; i += 1) {
    const next = `${root}-${i}`;
    const owner = owned.get(next);
    if (!owner || owner === websiteId) return next;
  }
  return `${root}-${Date.now().toString(36)}`;
}

export function parsePrice(raw) {
  const text = String(raw || '').trim();
  if (!text) return { ok: false, error: 'price_required', value: 0, display: '' };
  const match = text.replace(/\s+/g, ' ').match(PRICE_RE);
  if (!match) return { ok: false, error: 'invalid_price', value: 0, display: text };
  const value = Number(String(match[1]).replace(',', '.'));
  if (!Number.isFinite(value) || value <= 0) {
    return { ok: false, error: 'invalid_price', value: 0, display: text };
  }
  return { ok: true, value, display: `R${Number.isInteger(value) ? value : value.toFixed(2)}` };
}

export function sanitizeText(value, max = 4000) {
  return String(value || '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export function sanitizeMultiline(value, max = 8000) {
  return String(value || '')
    .replace(/[<>]/g, '')
    .replace(/\r\n/g, '\n')
    .trim()
    .slice(0, max);
}

export function sanitizeImageUrl(value, mentorId) {
  const url = String(value || '').trim();
  if (!url) return '';
  if (url.startsWith('data:image/')) return url;
  if (url.startsWith('/api/images/')) {
    const key = decodeURIComponent(url.slice(12));
    if (mentorId && key && !key.includes(String(mentorId))) return '';
    return `/api/images/${encodeURIComponent(key)}`;
  }
  if (url.startsWith('https://lumoedge.com/api/images/')) {
    return sanitizeImageUrl(url.replace('https://lumoedge.com', ''), mentorId);
  }
  return '';
}

export function publicWebsiteUrl(slug) {
  return `https://lumoedge.com/store/${slug}`;
}

export function emptyWebsite(mentorId, seed = {}) {
  const now = new Date().toISOString();
  const robotName = sanitizeText(seed.robotName || seed.eaName || '', 80);
  return {
    websiteId: seed.websiteId || `web-${mentorId}`,
    mentorId,
    eaId: String(seed.eaId || '').trim(),
    slug: '',
    status: 'draft',
    robotName,
    headline: sanitizeText(seed.headline || '', 120),
    shortDescription: sanitizeMultiline(seed.shortDescription || '', 400),
    robotDescription: sanitizeMultiline(seed.robotDescription || '', 8000),
    robotImage: sanitizeImageUrl(seed.robotImage || '', mentorId),
    iphonePrice: '',
    iphoneDuration: '',
    androidPrice: '',
    androidDuration: '',
    mentorName: sanitizeText(seed.mentorName || seed.fullName || '', 80),
    mentorBio: sanitizeMultiline(seed.mentorBio || '', 4000),
    mentorImage: sanitizeImageUrl(seed.mentorImage || '', mentorId),
    whatsapp: sanitizeText(seed.whatsapp || '', 40),
    whatsappLink: sanitizeText(seed.whatsappLink || '', 200),
    email: sanitizeText(seed.email || '', 120).toLowerCase(),
    telegram: sanitizeText(seed.telegram || '', 120),
    instagram: sanitizeText(seed.instagram || '', 120),
    tiktok: sanitizeText(seed.tiktok || '', 120),
    createdAt: seed.createdAt || now,
    updatedAt: now,
    publishedAt: seed.publishedAt || '',
    disabledAt: '',
    disabledReason: '',
  };
}

export function applyWebsitePatch(current, patch, mentorId) {
  const next = { ...current };
  const textFields = ['robotName', 'headline', 'mentorName', 'whatsapp', 'whatsappLink', 'email', 'telegram', 'instagram', 'tiktok', 'eaId'];
  const longFields = ['shortDescription', 'robotDescription', 'mentorBio', 'iphoneDuration', 'androidDuration'];
  for (const key of textFields) {
    if (patch[key] !== undefined) next[key] = sanitizeText(patch[key], key === 'headline' ? 120 : 120);
  }
  for (const key of longFields) {
    if (patch[key] !== undefined) next[key] = sanitizeMultiline(patch[key], key.includes('Duration') ? 40 : 8000);
  }
  if (patch.iphonePrice !== undefined) next.iphonePrice = String(patch.iphonePrice || '').trim().slice(0, 24);
  if (patch.androidPrice !== undefined) next.androidPrice = String(patch.androidPrice || '').trim().slice(0, 24);
  if (patch.robotImage !== undefined) next.robotImage = sanitizeImageUrl(patch.robotImage, mentorId);
  if (patch.mentorImage !== undefined) next.mentorImage = sanitizeImageUrl(patch.mentorImage, mentorId);
  if (patch.email !== undefined) next.email = sanitizeText(patch.email, 120).toLowerCase();
  next.updatedAt = new Date().toISOString();
  return next;
}

export function publishRequirements(website) {
  const missing = [];
  if (!sanitizeText(website?.robotName, 80)) missing.push('robotName');
  const iphone = parsePrice(website?.iphonePrice);
  const android = parsePrice(website?.androidPrice);
  if (!iphone.ok) missing.push('iphonePrice');
  if (!android.ok) missing.push('androidPrice');
  if (!sanitizeText(website?.iphoneDuration, 40)) missing.push('iphoneDuration');
  if (!sanitizeText(website?.androidDuration, 40)) missing.push('androidDuration');
  return { ok: missing.length === 0, missing, iphone, android };
}

export function publicWebsiteView(website) {
  if (!website || typeof website !== 'object') return null;
  if (String(website.status || '') !== 'published') return null;
  const iphone = parsePrice(website.iphonePrice);
  const android = parsePrice(website.androidPrice);
  const contacts = {};
  if (website.whatsapp) contacts.whatsapp = website.whatsapp;
  if (website.whatsappLink) contacts.whatsappLink = website.whatsappLink;
  if (website.email) contacts.email = website.email;
  if (website.telegram) contacts.telegram = website.telegram;
  if (website.instagram) contacts.instagram = website.instagram;
  if (website.tiktok) contacts.tiktok = website.tiktok;
  return {
    websiteId: website.websiteId,
    slug: website.slug,
    status: 'published',
    url: publicWebsiteUrl(website.slug),
    robotName: website.robotName || '',
    headline: website.headline || '',
    shortDescription: website.shortDescription || '',
    robotDescription: website.robotDescription || '',
    robotImage: website.robotImage || '',
    pricing: {
      iphone: {
        platform: 'iphone',
        label: 'iPhone',
        price: iphone.display || website.iphonePrice || '',
        duration: website.iphoneDuration || '',
      },
      android: {
        platform: 'android',
        label: 'Android',
        price: android.display || website.androidPrice || '',
        duration: website.androidDuration || '',
      },
    },
    mentorName: website.mentorName || '',
    mentorBio: website.mentorBio || '',
    mentorImage: website.mentorImage || '',
    contacts,
    poweredBy: 'Powered by Lumo Edge',
  };
}

export function ownerWebsiteView(website) {
  if (!website) return null;
  return {
    ...website,
    url: website.slug ? publicWebsiteUrl(website.slug) : '',
    publicPath: website.slug ? `/store/${website.slug}` : '',
  };
}

export function superWebsiteRow(website) {
  if (!website) return null;
  return {
    websiteId: website.websiteId,
    mentorId: website.mentorId,
    eaId: website.eaId || '',
    robotName: website.robotName || '',
    slug: website.slug || '',
    url: website.slug ? publicWebsiteUrl(website.slug) : '',
    status: website.status || 'draft',
    createdAt: website.createdAt || '',
    publishedAt: website.publishedAt || '',
    disabledReason: website.disabledReason || '',
  };
}

export function generateLicenseKey() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const chunk = () =>
    Array.from({ length: 4 }, () => alphabet[randomBytes(1)[0] % alphabet.length]).join('');
  return `LUMO-${chunk()}-${chunk()}-${chunk()}`;
}

export function whatsappHref(website, message) {
  const link = String(website?.whatsappLink || '').trim();
  if (/^https?:\/\//i.test(link)) {
    if (link.includes('wa.me') || link.includes('whatsapp')) return link;
  }
  const digits = String(website?.whatsapp || link || '').replace(/[^\d]/g, '');
  if (!digits) return '';
  const text = encodeURIComponent(message || '');
  return `https://wa.me/${digits}${text ? `?text=${text}` : ''}`;
}

export function checkoutMessage(website, platform, orderId) {
  const card = platform === 'android' ? 'Android' : 'iPhone';
  const price = platform === 'android' ? website.androidPrice : website.iphonePrice;
  const duration = platform === 'android' ? website.androidDuration : website.iphoneDuration;
  return `Hi ${website.mentorName || 'there'}, I want to buy ${website.robotName || 'the robot'} (${card}) for ${price} / ${duration}. Order ${orderId}`;
}

export function assertWebsiteOwner(website, session) {
  if (!website) return { ok: false, error: 'not_found' };
  if (!session?.ok) return { ok: false, error: 'unauthorized' };
  if (session.role === 'super') return { ok: true, super: true };
  if (String(website.mentorId || '') !== String(session.adminId || '')) {
    return { ok: false, error: 'forbidden' };
  }
  return { ok: true, super: false };
}
