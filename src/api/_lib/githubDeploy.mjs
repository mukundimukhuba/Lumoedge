import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const PROJECT_ID = process.env.VERCEL_PROJECT_ID || 'prj_fRIFCFi1sfhC5iELndsuekR3l3qm';
const TEAM_ID = process.env.VERCEL_TEAM_ID || 'team_AIHT521u3r2h9DXR2QJkNQ8I';
const REPO_TARBALL =
  process.env.LUMO_GIT_TARBALL ||
  'https://codeload.github.com/mukundimukhuba/Lumoedge/tar.gz/main';
const ROOT_FILES = [
  'index.html',
  'lumo-logo.png',
  'lumo-logo-192.png',
  'lumo-logo-email.png',
  'vercel.json',
  'package.json',
];

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

async function walkFiles(dir, prefix) {
  const out = [];
  let entries = [];
  try {
    entries = await readdir(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name.startsWith('.')) continue;
    const full = join(dir, name);
    const st = await stat(full);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (st.isDirectory()) out.push(...(await walkFiles(full, rel)));
    else out.push({ path: rel, full });
  }
  return out;
}

async function collectDeployFiles(extractedRoot) {
  const files = [];
  for (const name of ROOT_FILES) {
    const full = join(extractedRoot, name);
    try {
      if ((await stat(full)).isFile()) files.push({ path: name, full });
    } catch {
      /* optional */
    }
  }
  files.push(...(await walkFiles(join(extractedRoot, 'assets'), 'assets')));
  files.push(...(await walkFiles(join(extractedRoot, 'api'), 'api')));
  return files;
}

async function findExtractedRoot(tmp) {
  const names = await readdir(tmp);
  for (const name of names) {
    if (name.endsWith('.tar.gz') || name.endsWith('.tgz')) continue;
    const full = join(tmp, name);
    try {
      if ((await stat(full)).isDirectory()) return full;
    } catch {
      /* skip */
    }
  }
  return tmp;
}

async function deployFromGithub(token, sha) {
  const tmp = await mkdtemp(join(tmpdir(), 'lumo-git-'));
  try {
    const tarUrl = sha
      ? `https://codeload.github.com/mukundimukhuba/Lumoedge/tar.gz/${sha}`
      : REPO_TARBALL;
    const tarResp = await fetch(tarUrl, {
      headers: { 'User-Agent': 'lumoedge-github-deploy' },
    });
    if (!tarResp.ok) {
      throw new Error(`tarball ${tarResp.status}`);
    }
    const tarPath = join(tmp, 'repo.tar.gz');
    await writeFile(tarPath, Buffer.from(await tarResp.arrayBuffer()));
    await execFileAsync('tar', ['-xzf', tarPath, '-C', tmp]);
    const root = await findExtractedRoot(tmp);
    const specs = await collectDeployFiles(root);
    if (specs.length < 5) {
      throw new Error(`too few files: ${specs.length}`);
    }
    const uploaded = [];
    for (const spec of specs) {
      const content = await readFile(spec.full);
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
        throw new Error(`upload ${spec.path} ${status} ${JSON.stringify(data).slice(0, 200)}`);
      }
      uploaded.push({ file: spec.path, sha: sha1, size: content.length });
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
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
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
  // Ack immediately so GitHub does not retry while files upload to Vercel.
  json(res, 202, { ok: true, accepted: true, sha });
  try {
    const result = await deployFromGithub(token, sha);
    console.log('github deploy ok', result);
  } catch (err) {
    console.error('github deploy failed', err);
  }
  return true;
}
