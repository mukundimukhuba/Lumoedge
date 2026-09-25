const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(raw) {
  const email = String(raw || '')
    .trim()
    .toLowerCase();
  return EMAIL_RE.test(email) ? email : '';
}

function cleanKey(raw) {
  return String(raw || '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .trim();
}

function env(name) {
  const direct = cleanKey(process.env[name]);
  if (direct) return direct;
  const wanted = String(name || '').toLowerCase();
  for (const [key, value] of Object.entries(process.env || {})) {
    if (String(key || '').toLowerCase() === wanted) {
      const hit = cleanKey(value);
      if (hit) return hit;
    }
  }
  return '';
}

function scanBrevoApiKeyFromEnv() {
  for (const [key, value] of Object.entries(process.env || {})) {
    const val = cleanKey(value);
    if (!val) continue;
    if (val.startsWith('xkeysib-')) return val;
    if (
      /brevo|sendinblue|sendin_blue/i.test(String(key || '')) &&
      val.length > 24 &&
      !val.startsWith('xsmtpsib-') &&
      !val.startsWith('re_')
    ) {
      return val;
    }
  }
  return '';
}

function parseFrom(raw, fallbackName = 'Lumo Edge') {
  const text = String(raw || '').trim();
  const match = text.match(/^(.*)<([^>]+)>$/);
  if (match) {
    return {
      name: match[1].trim().replace(/^["']|["']$/g, '') || fallbackName,
      email: match[2].trim(),
    };
  }
  if (EMAIL_RE.test(text.toLowerCase())) {
    return { name: fallbackName, email: text };
  }
  return null;
}

export function resolveSender() {
  const name = env('BREVO_SENDER_NAME') || env('EMAIL_FROM_NAME') || 'Lumo Edge';
  const fromEnv =
    parseFrom(env('BREVO_SENDER_EMAIL')) ||
    parseFrom(env('EMAIL_FROM'), name) ||
    parseFrom(env('BREVO_SMTP_LOGIN'));
  if (fromEnv) return { name: fromEnv.name || name, email: fromEnv.email };
  return { name, email: 'noreply@lumoedge.com' };
}

/** Env first, then optional Firebase secret (server-side only). Never log the key. */
export async function resolveBrevoApiKey(firebaseRead) {
  const fromEnv =
    env('BREVO_API_KEY') ||
    env('SENDINBLUE_API_KEY') ||
    env('BREVO_KEY') ||
    env('BREVO_API') ||
    env('brevo') ||
    env('brevo_api_key') ||
    scanBrevoApiKeyFromEnv();
  if (fromEnv) return { apiKey: fromEnv, source: 'env' };
  if (typeof firebaseRead === 'function') {
    try {
      const secret = (await firebaseRead('lumo/secrets/brevo')) || {};
      const key = cleanKey(secret.apiKey || secret.BREVO_API_KEY || secret.key);
      if (key) return { apiKey: key, source: 'firebase' };
    } catch {
      /* ignore */
    }
  }
  return { apiKey: '', source: '' };
}

export async function resolveResendApiKey(firebaseRead) {
  const fromEnv = env('RESEND_API_KEY') || env('RESEND_KEY') || env('RESEND_TOKEN') || env('resend');
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

export async function resolveEmailProvider(firebaseRead) {
  const brevo = await resolveBrevoApiKey(firebaseRead);
  if (brevo.apiKey) return { provider: 'brevo', ...brevo };
  const resend = await resolveResendApiKey(firebaseRead);
  if (resend.apiKey) return { provider: 'resend', ...resend };
  return { provider: '', apiKey: '', source: '' };
}

function resolveResendSender() {
  return (
    parseFrom(env('RESEND_FROM')) ||
    parseFrom(env('EMAIL_FROM'), env('EMAIL_FROM_NAME') || 'Lumo Edge') ||
    { name: 'Lumo Edge', email: 'onboarding@resend.dev' }
  );
}

async function sendViaBrevo({ apiKey, to, subject, html, text, tags }) {
  const sender = resolveSender();
  const payload = {
    sender: { name: sender.name, email: sender.email },
    to: [{ email: to }],
    subject,
    htmlContent: html,
    textContent: text,
    replyTo: {
      email: env('EMAIL_REPLY_TO') || 'lumoedge08@gmail.com',
      name: sender.name,
    },
  };
  if (Array.isArray(tags) && tags.length) {
    payload.tags = tags.map((tag) => (typeof tag === 'string' ? tag : tag?.value)).filter(Boolean);
  }
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'api-key': apiKey,
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      error: data?.message || data?.error || `Brevo failed (${res.status})`,
    };
  }
  return { ok: true, id: String(data?.messageId || data?.messageIds?.[0] || '') };
}

async function sendViaResend({ apiKey, to, subject, html, text, tags }) {
  const sender = resolveResendSender();
  const payload = {
    from: `${sender.name} <${sender.email}>`,
    to: [to],
    subject,
    html,
    text,
    reply_to: env('EMAIL_REPLY_TO') || 'lumoedge08@gmail.com',
  };
  if (Array.isArray(tags) && tags.length) {
    payload.tags = tags.map((tag) => (typeof tag === 'string' ? { name: 'type', value: tag } : tag));
  }
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
}

/**
 * Send a branded Lumo Edge transactional email.
 * Credentials come from environment / server secrets only — never the frontend.
 */
async function renderFromTemplate(template, variables, subject, html, text) {
  if ((!html || !subject) && template) {
    try {
      const { registrationConfirmationEmail, mentorApprovedEmail, licenseKeyEmail, passwordResetEmail, adminManualEmail } =
        await import('./messages.mjs');
      const builders = {
        registration_confirmation: registrationConfirmationEmail,
        mentor_approval: mentorApprovedEmail,
        license_key: licenseKeyEmail,
        password_reset: passwordResetEmail,
        admin_manual: adminManualEmail,
      };
      const build = builders[String(template || '')];
      if (typeof build === 'function') {
        const msg = build(variables || {});
        return {
          subject: subject || msg.subject,
          html: html || msg.html,
          text: text || msg.text,
        };
      }
    } catch {
      /* keep caller-provided content */
    }
  }
  return { subject, html, text };
}

export async function sendLumoEmail({
  to,
  subject,
  html,
  text,
  tags,
  firebaseRead,
  template,
  variables,
}) {
  const recipient = isValidEmail(to);
  if (!recipient) {
    return { ok: false, skipped: true, error: 'invalid or missing recipient email' };
  }
  const rendered = await renderFromTemplate(template, variables, subject, html, text);
  subject = rendered.subject;
  html = rendered.html;
  text = rendered.text;
  const resolved = await resolveEmailProvider(firebaseRead);
  if (!resolved.apiKey) {
    return {
      ok: false,
      error: 'Email provider is not configured. Set BREVO_API_KEY on the server.',
    };
  }
  const plain =
    String(text || '').trim() ||
    String(html || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  try {
    const result =
      resolved.provider === 'brevo'
        ? await sendViaBrevo({
            apiKey: resolved.apiKey,
            to: recipient,
            subject: String(subject || '').trim() || 'Lumo Edge',
            html: String(html || ''),
            text: plain,
            tags: tags || (template ? [template] : undefined),
          })
        : await sendViaResend({
            apiKey: resolved.apiKey,
            to: recipient,
            subject: String(subject || '').trim() || 'Lumo Edge',
            html: String(html || ''),
            text: plain,
            tags: tags || (template ? [template] : undefined),
          });
    return { ...result, provider: resolved.provider };
  } catch (error) {
    return {
      ok: false,
      provider: resolved.provider,
      error: error instanceof Error ? error.message : 'Email request failed',
    };
  }
}

/** Backward-compatible alias used by older callers. */
export async function sendResendEmail(input) {
  return sendLumoEmail(input);
}

export { sendLumoEmail as sendBrevoEmail };
