/** Supabase connection for the Vercel API. This app is not Next.js, so there is no cookie middleware. */

function firstEnv(names) {
  for (const name of names) {
    const value = String(process.env[name] || '').trim();
    if (value) return value;
  }
  return '';
}

export function supabaseConfig() {
  const url = firstEnv(['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL']).replace(/\/$/, '');
  const publishableKey = firstEnv([
    'SUPABASE_PUBLISHABLE_KEY',
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  ]);
  const secretKey = firstEnv(['SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY']);
  return {
    url,
    publishableKey,
    secretKey,
    configured: Boolean(url && publishableKey),
  };
}

async function ping(url, key, path) {
  const response = await fetch(`${url}${path}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
  });
  let message = '';
  if (!response.ok) {
    try {
      const body = await response.json();
      message = String(body?.message || body?.error || '').slice(0, 180);
    } catch {
      message = '';
    }
  }
  return { ok: response.ok, status: response.status, message };
}

export async function supabaseStatus() {
  const config = supabaseConfig();
  if (!config.configured) {
    return {
      ok: false,
      configured: false,
      auth: false,
      database: false,
    };
  }

  let auth = { ok: false, status: 0, message: '' };
  try {
    auth = await ping(config.url, config.publishableKey, '/auth/v1/health');
  } catch {
    auth = { ok: false, status: 0, message: 'Auth request failed' };
  }

  let database = { ok: false, status: 0, message: '' };
  if (!config.secretKey) {
    database = {
      ok: false,
      status: 0,
      message: 'Add the Supabase secret key to read and write the database.',
    };
  } else {
    try {
      database = await ping(config.url, config.secretKey, '/rest/v1/');
    } catch {
      database = { ok: false, status: 0, message: 'Database request failed' };
    }
  }

  return {
    ok: auth.ok,
    configured: true,
    auth: auth.ok,
    database: database.ok,
    databaseMessage: database.ok ? undefined : database.message || undefined,
  };
}
