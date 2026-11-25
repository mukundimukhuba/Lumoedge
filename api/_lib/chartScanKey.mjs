/** Chart scan key. Firebase used to hold it. The Vercel value is named `openai`. */
let keyCheck = { at: 0, ok: false, status: 0 };

export async function chartScanKeyWorks(key) {
  if (!key) return { ok: false, status: 0 };
  if (Date.now() - keyCheck.at < 10 * 60 * 1000) {
    return { ok: keyCheck.ok, status: keyCheck.status };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
      signal: controller.signal,
    });
    keyCheck = { at: Date.now(), ok: response.ok, status: response.status };
  } catch {
    keyCheck = { at: Date.now(), ok: false, status: 0 };
  } finally {
    clearTimeout(timer);
  }
  return { ok: keyCheck.ok, status: keyCheck.status };
}

export function chartScanApiKey(secret) {
  const fromSecret =
    secret && typeof secret === 'object' ? String(secret.apiKey || '').trim() : '';
  return (
    fromSecret ||
    String(process.env.CHART_SCAN_API_KEY || '').trim() ||
    String(process.env.OPENAI_API_KEY || '').trim() ||
    String(process.env.openai || '').trim()
  );
}
