import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const PROJECT_ID = process.env.VERCEL_PROJECT_ID || 'prj_fRIFCFi1sfhC5iELndsuekR3l3qm';
const TEAM_ID = process.env.VERCEL_TEAM_ID || 'team_AIHT521u3r2h9DXR2QJkNQ8I';
const REPO = 'mukundimukhuba/Lumoedge';
const ROOT_FILES = new Set([
  'index.html',
  'lumo-logo.png',
  'lumo-logo-192.png',
  'lumo-logo-email.png',
  'vercel.json',
  'package.json',
]);

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(JSON.stringify(data));
}

async function readRaw(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function validSignature(raw, header, secret) {
  if (!secret || !header) return false;
  const expected = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
  const a = Buffer.from(String(header));
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

async function vercelApi(token, method, path, body, headers = {}, raw = false) {
  const url = path.includes('?')
    ? `https://api.vercel.com${path}&teamId=${TEAM_ID}`
    : `https://api.vercel.com${path}?teamId=${TEAM_ID}`;
  const h = { Authorization: `Bearer ${token}`, ...headers };
  let payload = body;
  if (body != null && !raw) {
    payload = JSON.stringify(body);
    h['Content-Type'] = 'application/json';
  }
  const resp = await fetch(url, { method, headers: h, body: payload });
  const text = await resp.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text.slice(0, 2000) };
  }
  return { status: resp.status, data };
}

function shouldDeployPath(path) {
  if (ROOT_FILES.has(path)) return true;
  return path.startsWith('assets/') || path.startsWith('api/');
}

async function listDeployPaths(sha) {
  const ref = sha || 'main';
  const resp = await fetch(
    `https://api.github.com/repos/${REPO}/git/trees/${ref}?recursive=1`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'lumoedge-github-deploy',
      },
    },
  );
  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(`github tree ${resp.status} ${JSON.stringify(data).slice(0, 200)}`);
  }
  const paths = (data.tree || [])
    .filter((item) => item && item.type === 'blob' && shouldDeployPath(item.path))
    .map((item) => item.path);
  if (paths.length < 5) {
    throw new Error(`too few files: ${paths.length}`);
  }
  return paths;
}

async function fetchRepoFile(sha, path) {
  const ref = sha || 'main';
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  const url = `https://raw.githubusercontent.com/${REPO}/${ref}/${encoded}`;
  const resp = await fetch(url, { headers: { 'User-Agent': 'lumoedge-github-deploy' } });
  if (!resp.ok) {
    throw new Error(`github file ${path} ${resp.status}`);
  }
  return Buffer.from(await resp.arrayBuffer());
}

async function deployFromGithub(token, sha) {
  const paths = await listDeployPaths(sha);
  async function uploadOne(path) {
    const content = await fetchRepoFile(sha, path);
    const sha1 = createHash('sha1').update(content).digest('hex');
    const { status, data } = await vercelApi(
      token,
      'POST',
      '/v2/files',
      content,
      {
        'Content-Length': String(content.length),
        'x-vercel-digest': sha1,
      },
      true,
    );
    if (status !== 200 && status !== 201) {
      throw new Error(`upload ${path} ${status} ${JSON.stringify(data).slice(0, 200)}`);
    }
    return { file: path, sha: sha1, size: content.length };
  }
  const uploaded = [];
  const concurrency = 8;
  for (let i = 0; i < paths.length; i += concurrency) {
    uploaded.push(...(await Promise.all(paths.slice(i, i + concurrency).map(uploadOne))));
  }
  const { status, data } = await vercelApi(token, 'POST', '/v13/deployments', {
    name: 'lumoedge',
    project: PROJECT_ID,
    target: 'production',
    files: uploaded,
    meta: sha ? { githubCommitSha: sha, githubCommitRepo: 'Lumoedge' } : {},
    projectSettings: {
      framework: null,
      buildCommand: 'true',
      installCommand: 'true',
      outputDirectory: '.',
    },
  });
  if (status !== 200 && status !== 201) {
    throw new Error(`deploy ${status} ${JSON.stringify(data).slice(0, 400)}`);
  }
  return { id: data.id, url: data.url, files: uploaded.length };
}

export async function handleGithubDeploy(req, res) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET || '';
  const token = process.env.VERCEL_DEPLOY_TOKEN || process.env.VERCEL_TOKEN || '';
  const raw = await readRaw(req);
  const event = String(req.headers['x-github-event'] || '');
  const sig = String(req.headers['x-hub-signature-256'] || '');

  if (!secret || !validSignature(raw, sig, secret)) {
    json(res, 401, { error: 'unauthorized' });
    return true;
  }
  if (!token) {
    json(res, 500, { error: 'deploy token missing' });
    return true;
  }
  if (event === 'ping') {
    json(res, 200, { ok: true, ping: true });
    return true;
  }
  if (event !== 'push') {
    json(res, 202, { ok: true, ignored: event || 'unknown' });
    return true;
  }

  let payload = {};
  try {
    payload = JSON.parse(raw.toString('utf8') || '{}');
  } catch {
    json(res, 400, { error: 'invalid json' });
    return true;
  }
  const ref = String(payload.ref || '');
  if (ref !== 'refs/heads/main') {
    json(res, 202, { ok: true, ignored: ref });
    return true;
  }
  const sha = String(payload.after || payload.head_commit?.id || '').trim();
  try {
    const result = await deployFromGithub(token, sha);
    json(res, 200, { ok: true, ...result, sha });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('github deploy failed', message);
    json(res, 500, { error: 'deploy failed', sha, message });
  }
  return true;
}
