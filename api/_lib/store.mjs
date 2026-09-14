import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeDatabases } from './mergeDb.mjs';

const OWNER = process.env.LUMO_DATA_OWNER || 'mukundimukhuba8-jpg';
const REPO = process.env.LUMO_DATA_REPO || 'lumoedge';
const PATH = process.env.LUMO_DATA_PATH || 'cloud-data/db.json';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_DB = process.env.LUMO_LOCAL_DB || path.join(__dirname, '..', '..', 'data', 'db.json');

export function emptyDb() {
  return {
    auth: { admins: [], admin: null },
    store: { workspaces: {} },
    vault: [],
    images: {},
    clients: [],
    sessions: {},
    revokedKeys: [],
    updatedAt: new Date().toISOString(),
  };
}

function token() {
  return (
    process.env.LUMO_DATA_TOKEN ||
    process.env.GITHUB_TOKEN ||
    process.env.GH_TOKEN ||
    ''
  );
}

function useGitHub() {
  return Boolean(process.env.VERCEL) || process.env.LUMO_USE_GITHUB === '1';
}

function ghHeaders() {
  const t = token();
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'lumo-edge-api',
  };
  if (t) headers.Authorization = `Bearer ${t}`;
  return headers;
}

function normalizeDb(db) {
  const base = emptyDb();
  return {
    ...base,
    ...db,
    auth: { ...base.auth, ...(db?.auth || {}) },
    store: { workspaces: { ...(db?.store?.workspaces || {}) } },
    clients: Array.isArray(db?.clients) ? db.clients : [],
    sessions: db?.sessions && typeof db.sessions === 'object' ? db.sessions : {},
    vault: Array.isArray(db?.vault) ? db.vault : [],
    images: db?.images && typeof db.images === 'object' ? db.images : {},
    revokedKeys: Array.isArray(db?.revokedKeys) ? db.revokedKeys : [],
  };
}

function ensureLocalFile() {
  const dir = path.dirname(LOCAL_DB);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(LOCAL_DB)) {
    fs.writeFileSync(LOCAL_DB, JSON.stringify(emptyDb(), null, 2));
  }
}

function loadLocal() {
  ensureLocalFile();
  try {
    return normalizeDb(JSON.parse(fs.readFileSync(LOCAL_DB, 'utf8')));
  } catch {
    return emptyDb();
  }
}

function saveLocal(db) {
  ensureLocalFile();
  const next = { ...normalizeDb(db), updatedAt: new Date().toISOString() };
  fs.writeFileSync(LOCAL_DB, JSON.stringify(next, null, 2));
  return next;
}

/** In-memory fallback when Vercel has no token */
let memoryDb = emptyDb();

export async function loadDb() {
  if (!useGitHub()) {
    return { db: loadLocal(), sha: null, backend: 'local-file' };
  }
  const t = token();
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${PATH}`;
  const res = await fetch(url, { headers: ghHeaders() });
  if (res.status === 404) {
    // Public raw fallback (no token) for read-only bootstrap
    if (!t) {
      const rawRes = await fetch(
        `https://raw.githubusercontent.com/${OWNER}/${REPO}/main/${PATH}?t=${Date.now()}`,
      );
      if (rawRes.ok) {
        const raw = await rawRes.text();
        memoryDb = normalizeDb(JSON.parse(raw || '{}'));
        return { db: structuredClone(memoryDb), sha: null, backend: 'github-raw' };
      }
      return { db: structuredClone(memoryDb), sha: null, backend: 'memory' };
    }
    return { db: emptyDb(), sha: null, backend: 'github' };
  }
  if (!res.ok) {
    if (!t) {
      return { db: structuredClone(memoryDb), sha: null, backend: 'memory' };
    }
    const text = await res.text();
    throw new Error(`GitHub read failed ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  const raw = Buffer.from(String(data.content || '').replace(/\n/g, ''), 'base64').toString(
    'utf8',
  );
  return {
    db: normalizeDb(JSON.parse(raw || '{}')),
    sha: data.sha,
    backend: 'github',
  };
}

export async function saveDb(db, sha) {
  let latest = emptyDb();
  try {
    const loaded = await loadDb();
    latest = loaded.db;
    if (loaded.sha) sha = loaded.sha;
  } catch {
    latest = structuredClone(memoryDb);
  }
  const next = {
    ...mergeDatabases(latest, db),
    updatedAt: new Date().toISOString(),
  };
  if (!useGitHub()) {
    return { db: saveLocal(next), sha: null, backend: 'local-file' };
  }
  const t = token();
  if (!t) {
    memoryDb = structuredClone(next);
    return { db: memoryDb, sha: 'memory', backend: 'memory' };
  }

  const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${PATH}`;
  const payload = {
    message: `chore(db): sync ${next.updatedAt}`,
    content: Buffer.from(JSON.stringify(next, null, 2)).toString('base64'),
    ...(sha ? { sha } : {}),
  };
  const res = await fetch(url, {
    method: 'PUT',
    headers: { ...ghHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (res.status === 409) {
    const fresh = await loadDb();
    const merged = {
      ...mergeDatabases(fresh.db, next),
      updatedAt: new Date().toISOString(),
    };
    const retry = await fetch(url, {
      method: 'PUT',
      headers: { ...ghHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `chore(db): sync retry ${merged.updatedAt}`,
        content: Buffer.from(JSON.stringify(merged, null, 2)).toString('base64'),
        sha: fresh.sha,
      }),
    });
    if (!retry.ok) {
      const text = await retry.text();
      throw new Error(`GitHub write retry failed ${retry.status}: ${text.slice(0, 200)}`);
    }
    const out = await retry.json();
    return { db: merged, sha: out.content?.sha || fresh.sha, backend: 'github' };
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub write failed ${res.status}: ${text.slice(0, 200)}`);
  }
  const out = await res.json();
  return { db: next, sha: out.content?.sha || sha, backend: 'github' };
}

export function hasDurableBackend() {
  if (!useGitHub()) return true; // local file is durable for that host
  return Boolean(token());
}
