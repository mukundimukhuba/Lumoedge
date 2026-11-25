import { supabaseConfig } from './supabase.mjs';

const BUCKET = 'lumo-private';
const PROBE_PATH = 'recovery/mentors.json';

let cached = { at: 0, value: null };

function headers(secretKey) {
  return {
    apikey: secretKey,
    Authorization: `Bearer ${secretKey}`,
  };
}

function isQuotaMessage(message) {
  return /exceed_.*egress|egress_quota|spend cap|restricted due to/i.test(String(message || ''));
}

/**
 * Probe private Supabase storage used for mentor passwords and workspaces.
 * Cached briefly so login/register do not hammer a restricted project.
 */
export async function privateStorageHealth(force = false) {
  const now = Date.now();
  if (!force && cached.value && now - cached.at < 15_000) {
    return cached.value;
  }

  const config = supabaseConfig();
  if (!config.url || !config.secretKey) {
    const value = {
      ok: false,
      offline: true,
      configured: Boolean(config.url && config.publishableKey),
      error: 'not_configured',
      message: 'Private mentor storage is not configured on this server.',
    };
    cached = { at: now, value };
    return value;
  }

  try {
    const response = await fetch(
      `${config.url}/storage/v1/object/${BUCKET}/${PROBE_PATH}`,
      {
        headers: headers(config.secretKey),
        cache: 'no-store',
        signal: AbortSignal.timeout(8000),
      },
    );
    if (response.ok || response.status === 404) {
      const value = { ok: true, offline: false, configured: true, status: response.status };
      cached = { at: now, value };
      return value;
    }

    let message = '';
    try {
      const body = await response.json();
      message = String(body?.message || body?.error || '').slice(0, 220);
    } catch {
      try {
        message = (await response.text()).slice(0, 220);
      } catch {
        message = '';
      }
    }

    const value = {
      ok: false,
      offline: true,
      configured: true,
      status: response.status,
      error: isQuotaMessage(message) ? 'egress_quota' : 'storage_unavailable',
      message:
        message ||
        'Mentor password storage is temporarily unavailable. Try again after the cloud store is restored.',
    };
    cached = { at: now, value };
    return value;
  } catch (error) {
    const value = {
      ok: false,
      offline: true,
      configured: true,
      error: 'storage_unreachable',
      message:
        error instanceof Error
          ? error.message.slice(0, 180)
          : 'Mentor password storage is temporarily unreachable.',
    };
    cached = { at: now, value };
    return value;
  }
}

export function durableUnavailablePayload(health) {
  return {
    ok: false,
    error: 'unavailable',
    reason: health?.error || 'storage_unavailable',
    message:
      health?.message ||
      'Service is temporarily unavailable. Mentor accounts are stored in private cloud storage that is currently restricted.',
  };
}
