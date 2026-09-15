const OWNER = process.env.LUMO_DATA_OWNER || 'mukundimukhuba8-jpg';
const REPO = process.env.LUMO_DATA_REPO || 'lumoedge';
const PATH = process.env.LUMO_DATA_PATH || 'cloud-data/db.json';

/** Never let a Firebase fallback read hang a request — fail fast to null instead. */
function withTimeout(promise, ms = 4000) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(null), ms)),
  ]).catch(() => null);
}

function emptyDb() {
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
    ...(db || {}),
    auth: { ...base.auth, ...((db && db.auth) || {}) },
    store: { workspaces: { ...((db && db.store && db.store.workspaces) || {}) } },
    clients: Array.isArray(db && db.clients) ? db.clients : [],
    sessions: db && db.sessions && typeof db.sessions === 'object' ? db.sessions : {},
    vault: Array.isArray(db && db.vault) ? db.vault : [],
    images: db && db.images && typeof db.images === 'object' ? db.images : {},
    revokedKeys: Array.isArray(db && db.revokedKeys) ? db.revokedKeys : [],
  };
}

/** Never let a stale pending push wipe a saved license key. */
function mergeSessionPreferLicense(prev, incoming) {
  if (!incoming || typeof incoming !== 'object') return prev || incoming;
  if (!prev || typeof prev !== 'object') return incoming;
  const prevBot = prev.bot && typeof prev.bot === 'object' ? prev.bot : {};
  const nextBot = incoming.bot && typeof incoming.bot === 'object' ? incoming.bot : {};
  const incomingKey = String(nextBot.licenseKey || '').trim();
  const prevKey = String(prevBot.licenseKey || '').trim();
  // deleteBot sends paid + empty key — allow that clear. Block other demotions.
  const intentionalClear =
    nextBot.licenseKey !== undefined &&
    !incomingKey &&
    incoming.accessStatus === 'paid';
  const licenseKey = intentionalClear ? '' : incomingKey || prevKey;
  const accessStatus = licenseKey
    ? 'licensed'
    : incoming.accessStatus || prev.accessStatus || 'pending';
  return {
    ...prev,
    ...incoming,
    accessStatus,
    bot: {
      ...prevBot,
      ...nextBot,
      licenseKey,
    },
  };
}

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

/** Never drop existing clients / vault / licenses on sync — only add or upgrade */
function mergeClients(existing = [], incoming = []) {
  const byEmail = new Map();
  for (const c of existing || []) {
    if (c?.email) byEmail.set(String(c.email).toLowerCase(), c);
  }
  for (const c of incoming || []) {
    if (!c?.email) continue;
    const email = String(c.email).toLowerCase();
    const prev = byEmail.get(email);
    if (!prev) {
      byEmail.set(email, { ...c, email });
      continue;
    }
    const rank = (x) =>
      (x.status === 'approved' ? 2 : x.status === 'pending' ? 1 : 0) +
      (x.paymentClaimed ? 1 : 0);
    byEmail.set(email, rank(c) >= rank(prev) ? { ...prev, ...c, email } : { ...c, ...prev, email });
  }
  return [...byEmail.values()];
}

function mergeVault(existing = [], incoming = []) {
  const byId = new Map();
  const byKey = new Map();
  const put = (v) => {
    if (!v) return;
    const key = String(v.key || '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
    if (v.id) byId.set(v.id, v);
    if (key) byKey.set(key, v);
  };
  for (const v of existing || []) put(v);
  for (const v of incoming || []) put(v);
  const out = new Map();
  for (const v of byId.values()) out.set(v.id || v.key, v);
  for (const v of byKey.values()) out.set(v.id || v.key, v);
  return [...out.values()].filter((v) => v.status !== 'deleted');
}

function mergeWorkspaces(existing = {}, incoming = {}) {
  const ids = new Set([...Object.keys(existing || {}), ...Object.keys(incoming || {})]);
  const out = {};
  for (const id of ids) {
    const a = existing?.[id] || {};
    const b = incoming?.[id] || {};
    const licenseMap = new Map();
    for (const l of [...(a.licenses || []), ...(b.licenses || [])]) {
      if (!l) continue;
      const key = String(l.key || '')
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '');
      const k = l.id || key;
      if (!k) continue;
      const prev = licenseMap.get(k);
      if (!prev || (l.status === 'active' && prev.status !== 'active')) licenseMap.set(k, l);
      else licenseMap.set(k, { ...prev, ...l });
    }
    out[id] = {
      ...a,
      ...b,
      eas: [...(a.eas || []), ...(b.eas || [])].filter(
        (e, i, arr) => e?.id && arr.findIndex((x) => x.id === e.id) === i,
      ),
      licenses: [...licenseMap.values()],
      clientRequests: mergeClients(a.clientRequests || [], b.clientRequests || []),
      profile: { ...(a.profile || {}), ...(b.profile || {}) },
      mt5: { ...(a.mt5 || {}), ...(b.mt5 || {}) },
      orders: [...(b.orders || []), ...(a.orders || [])].filter(
        (o, i, arr) => o?.id && arr.findIndex((x) => x.id === o.id) === i,
      ),
      revokedKeys: [
        ...new Set([...(a.revokedKeys || []), ...(b.revokedKeys || [])]),
      ],
    };
  }
  return out;
}

function mergeDatabases(base, patch) {
  const a = normalizeDb(base);
  const b = normalizeDb(patch);
  return normalizeDb({
    ...a,
    ...b,
    auth: {
      ...a.auth,
      ...b.auth,
      // keep larger admin list
      admins:
        (b.auth?.admins?.length || 0) >= (a.auth?.admins?.length || 0)
          ? b.auth?.admins || a.auth.admins
          : a.auth.admins,
    },
    store: {
      workspaces: mergeWorkspaces(a.store?.workspaces, b.store?.workspaces),
    },
    clients: mergeClients(a.clients, b.clients),
    vault: mergeVault(a.vault, b.vault),
    sessions: { ...(a.sessions || {}), ...(b.sessions || {}) },
    images: { ...(a.images || {}), ...(b.images || {}) },
    revokedKeys: [...new Set([...(a.revokedKeys || []), ...(b.revokedKeys || [])])],
  });
}

let memoryDb = emptyDb();

async function loadFromGitHubRaw() {
  const rawRes = await fetch(
    `https://raw.githubusercontent.com/${OWNER}/${REPO}/main/${PATH}?t=${Date.now()}`,
    { cache: 'no-store' },
  );
  if (!rawRes.ok) return null;
  const raw = await rawRes.text();
  return normalizeDb(JSON.parse(raw || '{}'));
}

async function loadDb() {
  const t = token();
  // Prefer durable GitHub file — works on Vercel even without a write token
  try {
    const fromRaw = await loadFromGitHubRaw();
    if (fromRaw) {
      memoryDb = clone(fromRaw);
      if (!t) {
        return { db: clone(memoryDb), sha: null, backend: 'github-raw' };
      }
    }
  } catch {
    // continue to API / memory
  }

  if (!t) {
    return { db: clone(memoryDb), sha: null, backend: memoryDb.vault?.length ? 'github-raw' : 'memory' };
  }

  const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${PATH}`;
  try {
    const res = await fetch(url, { headers: ghHeaders() });
    if (res.status === 404) {
      return { db: memoryDb.clients?.length ? clone(memoryDb) : emptyDb(), sha: null, backend: 'github' };
    }
    if (!res.ok) {
      if (memoryDb.vault?.length || memoryDb.clients?.length) {
        return { db: clone(memoryDb), sha: null, backend: 'github-raw' };
      }
      throw new Error(`GitHub read failed ${res.status}`);
    }
    const data = await res.json();
    const raw = Buffer.from(String(data.content || '').replace(/\n/g, ''), 'base64').toString(
      'utf8',
    );
    const db = normalizeDb(JSON.parse(raw || '{}'));
    memoryDb = clone(db);
    return { db, sha: data.sha, backend: 'github' };
  } catch (err) {
    if (memoryDb.vault?.length || memoryDb.clients?.length) {
      return { db: clone(memoryDb), sha: null, backend: 'github-raw' };
    }
    throw err;
  }
}

async function saveDb(db, sha) {
  // Always merge on top of the latest durable copy so sync never wipes data
  let latest = emptyDb();
  try {
    const loaded = await loadDb();
    latest = loaded.db;
    if (loaded.sha) sha = loaded.sha;
  } catch {
    latest = clone(memoryDb);
  }
  const next = {
    ...mergeDatabases(latest, db),
    updatedAt: new Date().toISOString(),
  };
  const t = token();
  if (!t) {
    memoryDb = clone(next);
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
    if (!retry.ok) throw new Error(`GitHub write retry failed ${retry.status}`);
    const out = await retry.json();
    memoryDb = clone(merged);
    return { db: merged, sha: out.content?.sha || fresh.sha, backend: 'github' };
  }
  if (!res.ok) throw new Error(`GitHub write failed ${res.status}`);
  const out = await res.json();
  memoryDb = clone(next);
  return { db: next, sha: out.content?.sha || sha, backend: 'github' };
}

function send(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    return {};
  }
}

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function mirrorClientToSuper(db, entry) {
  const sid = 'LM-004821';
  db.store = db.store || { workspaces: {} };
  db.store.workspaces = db.store.workspaces || {};
  const ws = db.store.workspaces[sid] || {
    eas: [],
    licenses: [],
    clientRequests: [],
    mt5: {},
    profile: {},
    orders: [],
    revokedKeys: [],
  };
  const rest = (ws.clientRequests || []).filter(
    (c) => c.id !== entry.id && c.email !== entry.email,
  );
  ws.clientRequests = [entry, ...rest];
  db.store.workspaces[sid] = ws;
}

export default async function handler(req, res) {
  try {
    const host = req.headers.host || 'localhost';
    const url = new URL(req.url || '/', `https://${host}`);
    let pathname = url.pathname;
    // vercel.json rewrites /api/foo → /api?__path=foo
    const rewritePath = String(
      url.searchParams.get('__path') ||
        (req.query && (req.query.__path || req.query.path)) ||
        '',
    ).trim();
    if (rewritePath) {
      pathname = `/api/${rewritePath.replace(/^\/+/, '')}`;
    }
    if (!pathname.startsWith('/api')) {
      pathname = `/api${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
    }
    if (pathname === '/api/') pathname = '/api';

    const method = String(req.method || '').toUpperCase();
    const githubEvent = String(req.headers['x-github-event'] || '');
    if (pathname === '/api/github-deploy' && (method === 'POST' || githubEvent)) {
      const { handleGithubDeploy } = await import('./_lib/githubDeploy.mjs');
      return handleGithubDeploy(req, res);
    }

    // Prefer shared Firebase-aware router (auth, clients, vault, images, …)
    try {
      const { handleApi } = await import('./_lib/handlers.mjs');
      const handled = await handleApi(
        req,
        res,
        pathname === '/api' ? '/api/health' : pathname,
      );
      if (handled) return;
    } catch (routerErr) {
      console.error('handleApi failed', routerErr);
    }

    if (req.method === 'OPTIONS') {
      send(res, 204, {});
      return;
    }

    if (pathname === '/api/health' || pathname === '/api') {
      const { db, backend } = await loadDb();
      send(res, 200, {
        ok: true,
        durable: Boolean(token()),
        backend,
        updatedAt: db.updatedAt,
      });
      return;
    }

    if (pathname === '/api/db' && req.method === 'GET') {
      const { db } = await loadDb();
      send(res, 200, db);
      return;
    }

    if (pathname === '/api/db' && req.method === 'PUT') {
      const body = await readBody(req);
      const { db, sha } = await loadDb();
      // Merge only — never replace whole lists with empties from a partial client sync
      const saved = await saveDb(mergeDatabases(db, body), sha);
      send(res, 200, saved.db);
      return;
    }

    if (pathname === '/api/clients' && req.method === 'GET') {
      const { db } = await loadDb();
      send(res, 200, db.clients || []);
      return;
    }

    if (pathname === '/api/clients' && req.method === 'POST') {
      const body = await readBody(req);
      const { db, sha } = await loadDb();
      const email = String(body.email || '')
        .trim()
        .toLowerCase();
      if (!email || !body.firstName || !body.lastName) {
        send(res, 400, { error: 'email, firstName, lastName required' });
        return;
      }
      const existing = (db.clients || []).find((c) => c.email === email);
      if (existing) {
        send(res, 200, existing);
        return;
      }
      const entry = {
        id: `cli-${Date.now()}`,
        email,
        firstName: String(body.firstName).trim(),
        lastName: String(body.lastName).trim(),
        status: 'pending',
        createdAt: new Date().toISOString(),
        notifiedAt: new Date().toISOString(),
        paymentClaimed: false,
      };
      db.clients = [entry, ...(db.clients || [])];
      mirrorClientToSuper(db, entry);
      const saved = await saveDb(db, sha);
      const created = (saved.db.clients || []).find((c) => c.email === email) || entry;
      send(res, 201, created);
      return;
    }

    if (pathname.startsWith('/api/clients/') && req.method === 'PATCH') {
      const id = decodeURIComponent(pathname.replace('/api/clients/', ''));
      const body = await readBody(req);
      const { db, sha } = await loadDb();
      db.clients = (db.clients || []).map((c) => {
        if (c.id !== id && c.email !== id) return c;
        return {
          ...c,
          ...body,
          id: c.id,
          email: c.email,
          paymentClaimed:
            body.paymentClaimed === true || c.paymentClaimed === true
              ? true
              : Boolean(body.paymentClaimed ?? c.paymentClaimed),
          paymentClaimedAt:
            body.paymentClaimed === true
              ? body.paymentClaimedAt || new Date().toISOString()
              : c.paymentClaimedAt,
        };
      });
      const updated =
        db.clients.find((c) => c.id === id) || db.clients.find((c) => c.email === id);
      if (updated) mirrorClientToSuper(db, updated);
      await saveDb(db, sha);
      send(res, 200, updated || null);
      return;
    }

    if (pathname.startsWith('/api/clients/') && req.method === 'DELETE') {
      const id = decodeURIComponent(pathname.replace('/api/clients/', ''));
      const { db, sha } = await loadDb();
      const before = (db.clients || []).length;
      db.clients = (db.clients || []).filter((c) => c.id !== id && c.email !== id);
      const sid = 'LM-004821';
      const ws = db.store?.workspaces?.[sid];
      if (ws) {
        ws.clientRequests = (ws.clientRequests || []).filter(
          (c) => c.id !== id && c.email !== id,
        );
      }
      await saveDb(db, sha);
      send(res, 200, { ok: true, removed: before - (db.clients || []).length });
      return;
    }

    if (pathname.startsWith('/api/sessions/') && req.method === 'GET') {
      const email = decodeURIComponent(pathname.replace('/api/sessions/', '')).toLowerCase();
      const { db } = await loadDb();
      send(res, 200, db.sessions?.[email] ?? null);
      return;
    }

    if (pathname.startsWith('/api/sessions/') && req.method === 'PUT') {
      const email = decodeURIComponent(pathname.replace('/api/sessions/', '')).toLowerCase();
      const body = await readBody(req);
      const { db, sha } = await loadDb();
      const prev = db.sessions?.[email];
      db.sessions = {
        ...(db.sessions || {}),
        [email]: mergeSessionPreferLicense(prev, body),
      };
      await saveDb(db, sha);
      send(res, 200, { ok: true });
      return;
    }

    if (pathname === '/api/vault' && req.method === 'GET') {
      const { db } = await loadDb();
      send(res, 200, db.vault || []);
      return;
    }

    if (pathname === '/api/vault' && req.method === 'PUT') {
      const body = await readBody(req);
      const { db, sha } = await loadDb();
      db.vault = Array.isArray(body) ? body : body.vault || db.vault;
      await saveDb(db, sha);
      send(res, 200, db.vault);
      return;
    }

    if (pathname.startsWith('/api/images/') && req.method === 'PUT') {
      const key = decodeURIComponent(pathname.replace('/api/images/', '')).trim();
      if (!key) {
        send(res, 400, { error: 'image key required' });
        return;
      }
      const body = await readBody(req);
      const dataUrl = String(body.dataUrl || '');
      if (!dataUrl.startsWith('data:')) {
        send(res, 400, { error: 'dataUrl required' });
        return;
      }
      const { db, sha } = await loadDb();
      db.images = { ...(db.images || {}), [key]: dataUrl };
      await saveDb(db, sha);
      // The in-process store above is memory-only and is wiped on every cold
      // start / redeploy. Mirror into Firebase RTDB (already durable — this
      // is the same store the client reads 72MB of EA branding from) so an
      // upload survives past this Lambda instance's lifetime.
      try {
        const { firebaseWrite } = await import('./_lib/clientMerge.mjs');
        await withTimeout(firebaseWrite(`lumo/images/${encodeURIComponent(key)}`, dataUrl));
      } catch {}
      send(res, 200, { ok: true, url: `/api/images/${encodeURIComponent(key)}` });
      return;
    }

    if (pathname.startsWith('/api/images/') && (req.method === 'GET' || req.method === 'HEAD')) {
      const key = decodeURIComponent(pathname.replace('/api/images/', '')).trim();
      const { db } = await loadDb();
      let dataUrl = db.images?.[key];
      if (!dataUrl || !String(dataUrl).startsWith('data:')) {
        // Cold-start miss — the memory store above never survives a redeploy.
        // Fall back to the durable Firebase copy before giving up.
        try {
          const { firebaseRead } = await import('./_lib/clientMerge.mjs');
          const remote = await withTimeout(firebaseRead(`lumo/images/${encodeURIComponent(key)}`));
          if (remote && String(remote).startsWith('data:')) dataUrl = remote;
        } catch {}
      }
      if (!dataUrl || !String(dataUrl).startsWith('data:')) {
        send(res, 404, { error: 'Image not found' });
        return;
      }
      const m = /^data:([^;]+);base64,(.+)$/s.exec(String(dataUrl));
      if (!m) {
        send(res, 404, { error: 'Invalid image' });
        return;
      }
      const buf = Buffer.from(m[2], 'base64');
      res.statusCode = 200;
      res.setHeader('Content-Type', m[1] || 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.setHeader('Access-Control-Allow-Origin', '*');
      if (req.method === 'HEAD') {
        res.setHeader('Content-Length', String(buf.length));
        res.end();
        return;
      }
      res.end(buf);
      return;
    }

    // Mentor media aliases → same durable images store (fixes Vercel "Not found")
    if (pathname === '/api/media' && req.method === 'POST') {
      const body = await readBody(req);
      const key = String(body.key || '')
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .slice(0, 120);
      const dataUrl = String(body.dataUrl || '');
      if (!key || !dataUrl.startsWith('data:')) {
        send(res, 400, { error: 'key and dataUrl required' });
        return;
      }
      if (dataUrl.length > 3_500_000) {
        send(res, 413, { error: 'File too large for cloud upload' });
        return;
      }
      const { db, sha } = await loadDb();
      db.images = { ...(db.images || {}), [key]: dataUrl };
      await saveDb(db, sha);
      try {
        const { firebaseWrite } = await import('./_lib/clientMerge.mjs');
        await withTimeout(firebaseWrite(`lumo/images/${encodeURIComponent(key)}`, dataUrl));
      } catch {}
      send(res, 200, { ok: true, url: `/api/images/${encodeURIComponent(key)}`, key });
      return;
    }

    if (pathname === '/api/media/binary' && req.method === 'POST') {
      send(res, 501, {
        error: 'Binary media upload is not available on this host. Use a compressed image under 2.5 MB.',
      });
      return;
    }

    if (pathname.startsWith('/api/media/') && (req.method === 'GET' || req.method === 'HEAD')) {
      const raw = decodeURIComponent(pathname.replace('/api/media/', '')).trim();
      const key = raw.replace(/\.[a-z0-9]+$/i, '');
      const { db } = await loadDb();
      let dataUrl = db.images?.[key] || db.images?.[raw];
      if (!dataUrl || !String(dataUrl).startsWith('data:')) {
        try {
          const { firebaseRead } = await import('./_lib/clientMerge.mjs');
          const remote =
            (await withTimeout(firebaseRead(`lumo/images/${encodeURIComponent(key)}`))) ||
            (await withTimeout(firebaseRead(`lumo/images/${encodeURIComponent(raw)}`)));
          if (remote && String(remote).startsWith('data:')) dataUrl = remote;
        } catch {}
      }
      if (!dataUrl || !String(dataUrl).startsWith('data:')) {
        send(res, 404, { error: 'Media not found' });
        return;
      }
      const m = /^data:([^;]+);base64,(.+)$/s.exec(String(dataUrl));
      if (!m) {
        send(res, 404, { error: 'Invalid media' });
        return;
      }
      const buf = Buffer.from(m[2], 'base64');
      res.statusCode = 200;
      res.setHeader('Content-Type', m[1] || 'application/octet-stream');
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.setHeader('Access-Control-Allow-Origin', '*');
      if (req.method === 'HEAD') {
        res.setHeader('Content-Length', String(buf.length));
        res.end();
        return;
      }
      res.end(buf);
      return;
    }

    if (pathname.startsWith('/api/media/') && req.method === 'DELETE') {
      const key = decodeURIComponent(pathname.replace('/api/media/', '')).trim();
      const { db, sha } = await loadDb();
      if (db.images?.[key]) {
        const next = { ...(db.images || {}) };
        delete next[key];
        db.images = next;
        await saveDb(db, sha);
      }
      send(res, 200, { ok: true });
      return;
    }

    // Chart Scanner — OpenAI vision (same behavior as local server.mjs)
    if (pathname === '/api/scan' && req.method === 'POST') {
      const body = await readBody(req);
      const image = String(body.image || '');
      if (!image.startsWith('data:image/')) {
        send(res, 400, { ok: false, accuracy: 0, error: 'image data URL required' });
        return;
      }

      // The live OpenAI key lives in Firebase (lumo/secrets/chartScan), not a
      // Vercel env var — this project only has env vars for resend/mt5, so
      // env vars are kept purely as a fallback if Firebase is unreachable.
      let chartScanSecret = null;
      try {
        const { firebaseRead } = await import('./_lib/clientMerge.mjs');
        chartScanSecret = await withTimeout(firebaseRead('lumo/secrets/chartScan'));
      } catch {}

      const CHART_SCAN_API_KEY =
        chartScanSecret?.apiKey ||
        process.env.CHART_SCAN_API_KEY ||
        process.env.OPENAI_API_KEY ||
        '';
      const CHART_SCAN_API_URL =
        chartScanSecret?.apiUrl ||
        process.env.CHART_SCAN_API_URL ||
        'https://api.openai.com/v1/chat/completions';
      const CHART_SCAN_MODEL =
        chartScanSecret?.model || process.env.CHART_SCAN_MODEL || 'gpt-4o';

      if (!CHART_SCAN_API_KEY) {
        const accuracy = 70 + Math.floor(Math.random() * 21);
        const demoSymbols = ['XAUUSD', 'EURUSD', 'GBPUSD', 'NAS100', 'BTCUSD'];
        const symbol = demoSymbols[Math.floor(Math.random() * demoSymbols.length)];
        const direction = Math.random() > 0.5 ? 'buy' : 'sell';
        send(res, 200, {
          ok: true,
          demo: true,
          accuracy,
          symbol,
          timeframe: 'M15',
          direction,
          summary: 'Demo mode — add CHART_SCAN_API_KEY on Vercel for live AI scans.',
        });
        return;
      }

      const prompt =
        'You analyze MT5 / trading chart screenshots.\n' +
        'CRITICAL RULES FOR SYMBOL:\n' +
        '- Read the EXACT trading symbol text shown on the chart UI (title bar, market watch, or chart header).\n' +
        '- Do NOT guess, invent, or substitute a different pair (never default to XAUUSD/EURUSD unless that text is clearly visible).\n' +
        '- If the symbol text is not clearly readable on the image, set symbol to null and symbol_visible to false.\n' +
        '- Copy the symbol characters as shown (e.g. XAUUSD, EURUSD.r, NAS100, BTCUSD).\n' +
        'Also read timeframe only if visible (M1,M5,M15,H1,H4,D1, etc), else null.\n' +
        'Decide direction buy or sell from the chart structure only.\n' +
        'accuracy_percent must be an integer from 70 to 90.\n' +
        'Reply ONLY compact JSON:\n' +
        '{"symbol":"EXACT_OR_null","symbol_visible":true,"timeframe":"M15_or_null","direction":"buy|sell","accuracy_percent":78,"summary":"one short sentence"}';

      const upstream = await fetch(CHART_SCAN_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${CHART_SCAN_API_KEY}`,
        },
        body: JSON.stringify({
          model: CHART_SCAN_MODEL,
          temperature: 0,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                { type: 'image_url', image_url: { url: image, detail: 'high' } },
              ],
            },
          ],
        }),
      });

      const raw = await upstream.text();
      if (!upstream.ok) {
        send(res, 502, {
          ok: false,
          accuracy: 0,
          error: `Scan API ${upstream.status}: ${raw.slice(0, 240)}`,
        });
        return;
      }

      let parsed = {};
      try {
        const outer = JSON.parse(raw);
        const content =
          outer?.choices?.[0]?.message?.content ||
          outer?.output_text ||
          outer?.content ||
          '';
        const match =
          String(content).match(/\{[\s\S]*\}/) ||
          String(raw).match(/\{[\s\S]*\}/);
        parsed = match ? JSON.parse(match[0]) : {};
      } catch {
        parsed = {};
      }

      const symbolVisible = parsed.symbol_visible !== false;
      let symbol = parsed.symbol == null ? '' : String(parsed.symbol).trim();
      if (
        !symbolVisible ||
        !symbol ||
        /null|unknown|n\/a|none|guess/i.test(symbol)
      ) {
        send(res, 422, {
          ok: false,
          accuracy: 0,
          error:
            'Could not read the symbol from this chart. Upload a clearer MT5 screenshot showing the pair name.',
        });
        return;
      }
      symbol = symbol.replace(/\s+/g, '').toUpperCase();

      let accuracy = Number(parsed.accuracy_percent ?? parsed.accuracy ?? 0);
      if (!Number.isFinite(accuracy) || accuracy < 70 || accuracy > 90) {
        accuracy = 70 + Math.floor(Math.random() * 21);
      }
      const rawDir = String(parsed.direction || parsed.side || '').toLowerCase();
      if (!rawDir.includes('sell') && !rawDir.includes('buy')) {
        send(res, 422, {
          ok: false,
          accuracy: 0,
          error: 'Could not determine BUY/SELL from this chart. Try another screenshot.',
        });
        return;
      }
      const direction = rawDir.includes('sell') ? 'sell' : 'buy';
      const timeframeRaw = parsed.timeframe == null ? '' : String(parsed.timeframe).trim();
      const timeframe =
        !timeframeRaw || /null|unknown|n\/a|none/i.test(timeframeRaw)
          ? undefined
          : timeframeRaw;

      send(res, 200, {
        ok: true,
        demo: false,
        accuracy: Math.round(accuracy),
        symbol,
        timeframe,
        direction,
        summary: parsed.summary || `Scan for ${symbol}`,
      });
      return;
    }

    if (pathname === '/api/scan/status' && req.method === 'GET') {
      let chartScanSecret = null;
      try {
        const { firebaseRead } = await import('./_lib/clientMerge.mjs');
        chartScanSecret = await withTimeout(firebaseRead('lumo/secrets/chartScan'));
      } catch {}
      const configured = Boolean(
        chartScanSecret?.apiKey ||
          process.env.CHART_SCAN_API_KEY ||
          process.env.OPENAI_API_KEY,
      );
      send(res, 200, {
        configured,
        model: chartScanSecret?.model || process.env.CHART_SCAN_MODEL || 'gpt-4o',
        url:
          chartScanSecret?.apiUrl ||
          process.env.CHART_SCAN_API_URL ||
          'https://api.openai.com/v1/chat/completions',
        source: chartScanSecret?.apiKey ? 'firebase' : 'env',
        mt5Base: Boolean(process.env.MT5_API_BASE || process.env.mt5_api_base),
        hint: configured ? 'Live AI scans enabled' : 'Demo mode — no chart scan key configured',
      });
      return;
    }

    // Direct broker connect (resolves terminal host from server name).
    // Must run before the generic /api/mt5 proxy — that proxy forwards POST /connect
    // upstream, and the MT5 swagger API only accepts GET Connect/ConnectEx (405).
    if (pathname === '/api/mt5/connect') {
      if (req.method === 'OPTIONS') {
        send(res, 204, {});
        return;
      }
      if (req.method !== 'POST') {
        send(res, 405, { error: 'Method not allowed' });
        return;
      }
      const { connectMt5Broker } = await import('./_lib/mt5Bridge.mjs');
      const body = await readBody(req);
      const result = await connectMt5Broker({
        user: body.user,
        password: body.password,
        server: body.server,
      });
      if (result.ok && result.token) {
        send(res, 200, { token: result.token });
      } else {
        send(res, 502, { error: result.error || 'Connect failed' });
      }
      return;
    }

    // Proxy → MT5API RESTFul (broker search, ConnectEx, account, trading)
    if (pathname.startsWith('/api/mt5')) {
      const MT5_API_BASE = (
        process.env.MT5_API_BASE || 'http://66.23.225.158'
      ).replace(/\/$/, '');
      const targetPath = pathname === '/api/mt5' ? '/' : pathname.slice('/api/mt5'.length);
      const targetUrl = `${MT5_API_BASE}${targetPath}${url.search}`;
      const method = req.method || 'GET';
      const body =
        method === 'GET' || method === 'HEAD' ? undefined : await readRawBody(req);
      const headers = {
        Accept: req.headers.accept || 'application/json, text/plain, */*',
      };
      if (req.headers['content-type']) {
        headers['Content-Type'] = req.headers['content-type'];
      }
      try {
        const upstream = await fetch(targetUrl, {
          method,
          headers,
          body,
        });
        const buf = Buffer.from(await upstream.arrayBuffer());
        const ct = upstream.headers.get('content-type') || 'application/json';
        res.statusCode = upstream.status;
        res.setHeader('Content-Type', ct);
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,POST,OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.end(buf);
      } catch (err) {
        send(res, 502, {
          error:
            err instanceof Error
              ? `MT5 bridge unreachable: ${err.message}`
              : 'MT5 bridge unreachable',
        });
      }
      return;
    }

    if (pathname === '/api/brokers' && req.method === 'GET') {
      const {
        ensureBrokerCatalog,
        filterCatalog,
        brokersFromFirebase,
      } = await import('./_lib/brokers.mjs');
      const { firebaseRead, firebaseWrite } = await import('./_lib/clientMerge.mjs');
      const q = String(url.searchParams.get('q') || '').trim();
      const live = String(url.searchParams.get('live') || '') === '1';
      const catalog = await ensureBrokerCatalog(firebaseRead, firebaseWrite);
      let brokers = filterCatalog(catalog, q);
      if (live && q) {
        // Keep catalog hits; live search enrichment happens client-side when needed
        const fb = brokersFromFirebase(await firebaseRead('lumo/brokers'));
        const extra = filterCatalog(fb, q);
        const seen = new Set(brokers.map((b) => String(b.id || b.company || '').toLowerCase()));
        for (const b of extra) {
          const id = String(b.id || b.company || '').toLowerCase();
          if (!seen.has(id)) {
            brokers.push(b);
            seen.add(id);
          }
        }
      }
      send(res, 200, { ok: true, brokers });
      return;
    }

    if (pathname === '/api/brokers/catalog' && req.method === 'GET') {
      const { ensureBrokerCatalog } = await import('./_lib/brokers.mjs');
      const { firebaseRead, firebaseWrite } = await import('./_lib/clientMerge.mjs');
      const catalog = await ensureBrokerCatalog(firebaseRead, firebaseWrite);
      send(res, 200, { ok: true, brokers: catalog });
      return;
    }

    send(res, 404, { error: 'Not found', path: pathname });
  } catch (err) {
    send(res, 500, {
      error: err instanceof Error ? err.message : 'API error',
      durable: Boolean(token()),
    });
  }
}
