const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(raw) {
  const email = String(raw || '').trim().toLowerCase();
  return EMAIL_RE.test(email) ? email : '';
}

function cleanKey(raw) {
  return String(raw || '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .trim();
}

function resolveFrom() {
  const configured = String(process.env.EMAIL_FROM || '').trim();
  if (configured) return configured;
  // Until lumoedge.com is verified in Resend, onboarding sender works
  return 'Lumo Edge <onboarding@resend.dev>';
}

/** Env first, then optional Firebase secret reader (server-side only). */
export async function resolveResendApiKey(firebaseRead) {
  const fromEnv =
    cleanKey(process.env.RESEND_API_KEY) ||
    cleanKey(process.env.RESEND_KEY) ||
    cleanKey(process.env.RESEND_TOKEN);
  if (fromEnv) return { apiKey: fromEnv, source: 'env' };
  if (typeof firebaseRead === 'function') {
    try {
      const secret = (await firebaseRead('lumo/secrets/resend')) || {};
      const key = cleanKey(secret.apiKey || secret.RESEND_API_KEY || secret.key);
      if (key) return { apiKey: key, source: 'firebase' };
    } catch {
      /* ignore */
    }
  }
  return { apiKey: '', source: '' };
}

/**
 * Send via Resend. API key from Vercel env or Firebase secret (never frontend).
 * @returns {Promise<{ ok: boolean, id?: string, error?: string, skipped?: boolean }>}
 */
export async function sendResendEmail({
  to,
  subject,
  html,
  text,
  replyTo,
  tags,
  firebaseRead,
}) {
  const { apiKey } = await resolveResendApiKey(firebaseRead);
  if (!apiKey) {
    return {
      ok: false,
      error:
        'Resend API key not configured. Super Admin → Send Emails → paste API key and Save, or set RESEND_API_KEY on Vercel and Redeploy.',
    };
  }
  const recipient = isValidEmail(to);
  if (!recipient) {
    return { ok: false, skipped: true, error: 'invalid or missing recipient email' };
  }
  const from = resolveFrom();
  const plain =
    String(text || '').trim() ||
    String(html || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const payload = {
    from,
    to: [recipient],
    subject: String(subject || '').trim() || 'Lumo Edge',
    html: String(html || ''),
    text: plain,
    reply_to: String(
      replyTo || process.env.EMAIL_REPLY_TO || 'lumoedge08@gmail.com',
    ).trim(),
    headers: {
      'List-Unsubscribe': `<mailto:lumoedge08@gmail.com?subject=unsubscribe>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
  if (Array.isArray(tags) && tags.length) {
    payload.tags = tags.map((t) =>
      typeof t === 'string' ? { name: 'type', value: t } : t,
    );
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        error: data?.message || data?.error || `Resend failed (${res.status})`,
      };
    }
    return { ok: true, id: data?.id || '' };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Resend request failed',
    };
  }
}
