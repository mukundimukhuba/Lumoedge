import { supabaseConfig } from './supabase.mjs';

const BUCKET = 'lumo-private';

export function imageObjectPath(key) {
  const safe = String(key || '')
    .trim()
    .replace(/\.\./g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/^_+/, '')
    .slice(0, 160);
  return safe ? `images/${safe}` : '';
}

export function parseDataUrl(dataUrl) {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/s.exec(String(dataUrl || ''));
  if (!match) return null;
  const contentType = match[1].slice(0, 80) || 'application/octet-stream';
  if (!contentType.startsWith('image/') && contentType !== 'application/octet-stream') return null;
  const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
  if (!buffer.length) return null;
  return { contentType, buffer };
}

function storageHeaders(secretKey, extra = {}) {
  return {
    apikey: secretKey,
    Authorization: `Bearer ${secretKey}`,
    ...extra,
  };
}

export async function savePrivateImage(key, dataUrl) {
  const config = supabaseConfig();
  const path = imageObjectPath(key);
  const parsed = parseDataUrl(dataUrl);
  if (!config.url || !config.secretKey || !path || !parsed) return false;
  const response = await fetch(`${config.url}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: storageHeaders(config.secretKey, {
      'Content-Type': parsed.contentType,
      'x-upsert': 'true',
    }),
    body: parsed.buffer,
  });
  return response.ok;
}

export async function loadPrivateImage(key) {
  const config = supabaseConfig();
  const path = imageObjectPath(key);
  if (!config.url || !config.secretKey || !path) return null;
  const response = await fetch(`${config.url}/storage/v1/object/${BUCKET}/${path}`, {
    headers: storageHeaders(config.secretKey),
    cache: 'no-store',
  });
  if (!response.ok) return null;
  const contentType = String(response.headers.get('content-type') || 'image/jpeg').split(';')[0];
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) return null;
  return { contentType, buffer };
}
