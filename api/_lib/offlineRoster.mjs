/**
 * Static fallback when Supabase recovery / subscription vault is offline.
 * Keeps already-paid users unlockable without wiping them to Payment Required.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { normalizeRegistrationEmail, isRegistrationEmail } from './registrationEmail.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
let ROWS = null;

function loadRows() {
  if (ROWS) return ROWS;
  try {
    const raw = JSON.parse(readFileSync(join(HERE, 'offlineRoster.json'), 'utf8'));
    ROWS = Array.isArray(raw) ? raw : [];
  } catch {
    ROWS = [];
  }
  return ROWS;
}

export function listOfflineRoster() {
  return loadRows().map((row) => ({ ...row }));
}

export function getOfflineRosterClient(email) {
  const key = normalizeRegistrationEmail(email);
  if (!isRegistrationEmail(key)) return null;
  const hit = loadRows().find((row) => normalizeRegistrationEmail(row?.email) === key);
  return hit ? { ...hit } : null;
}

/** True when live private stores returned nothing useful. */
export function shouldUseOfflineRoster(liveRows) {
  const list = Array.isArray(liveRows) ? liveRows : [];
  if (list.length < 1500) return true;
  const verified = list.filter((row) => row?.paymentVerified === true).length;
  return verified < 200;
}
