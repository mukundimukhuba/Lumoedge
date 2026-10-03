import assert from 'node:assert/strict';
import { test } from 'node:test';
import { supabaseConfig, supabaseStatus } from './api/_lib/supabase.mjs';

test('supabase stays unconfigured until the url and publishable key are set', async () => {
  const previous = {
    url: process.env.SUPABASE_URL,
    publicUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    key: process.env.SUPABASE_PUBLISHABLE_KEY,
    publicKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    secret: process.env.SUPABASE_SECRET_KEY,
    service: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  delete process.env.SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_PUBLISHABLE_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  delete process.env.SUPABASE_SECRET_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    assert.equal(supabaseConfig().configured, false);
    const status = await supabaseStatus();
    assert.equal(status.ok, false);
    assert.equal(status.configured, false);
    assert.equal(status.database, false);
  } finally {
    for (const [name, value] of [
      ['SUPABASE_URL', previous.url],
      ['NEXT_PUBLIC_SUPABASE_URL', previous.publicUrl],
      ['SUPABASE_PUBLISHABLE_KEY', previous.key],
      ['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', previous.publicKey],
      ['SUPABASE_SECRET_KEY', previous.secret],
      ['SUPABASE_SERVICE_ROLE_KEY', previous.service],
    ]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test('the publishable key marks the project configured and the secret key is separate', () => {
  process.env.SUPABASE_URL = 'https://example.supabase.co/';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
  delete process.env.SUPABASE_SECRET_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  const config = supabaseConfig();
  assert.equal(config.configured, true);
  assert.equal(config.url, 'https://example.supabase.co');
  assert.equal(config.secretKey, '');
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_PUBLISHABLE_KEY;
});
