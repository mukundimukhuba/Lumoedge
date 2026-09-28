/** Super Admin Chart Scanner keys allowed to post Telegram trade alerts. */
export const TELEGRAM_ALERT_LICENSE_KEYS = [
  'LUMO-JSDZ-8MC4-P4R3',
  'LUMO-WB5J-4YBH-RK8P',
];

function keyFingerprint(key) {
  return String(key || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

export function normalizeLicenseKey(key) {
  const cleaned = keyFingerprint(key);
  if (!cleaned) return '';
  const body = cleaned.startsWith('LUMO') ? cleaned.slice(4) : cleaned;
  const parts = body.match(/.{1,4}/g) ?? [];
  return ['LUMO', ...parts.slice(0, 3)].join('-');
}

const ALLOWED = new Set(
  TELEGRAM_ALERT_LICENSE_KEYS.map((k) => normalizeLicenseKey(k)),
);

export function isTelegramAlertLicenseKey(licenseKey) {
  const key = normalizeLicenseKey(licenseKey);
  return Boolean(key && ALLOWED.has(key));
}

export const SUPER_ADMIN_EMAIL = 'mukundimukhuba8@gmail.com';
export const SUPER_ADMIN_ID = 'LM-004821';

/** Shared channel is super-admin only. License keys must never admit another mentor. */
export function canPostTelegramTradeAlert(input = {}) {
  const email = String(input.email || '').trim().toLowerCase();
  const mentorId = String(input.mentorId || '').trim();
  if (email === SUPER_ADMIN_EMAIL) return true;
  // Super-admin Telegram settings "Send test" posts mentorId without email.
  if (input.test && mentorId === SUPER_ADMIN_ID) return true;
  return false;
}

function fmt(v) {
  if (v == null || v === '') return '—';
  return String(v);
}

export function buildTelegramTradeMessage(input) {
  const side = String(input.side || '').toUpperCase() || '—';
  const symbol = String(input.symbol || '').toUpperCase() || '—';
  const ea = String(input.eaName || '').trim();
  const source = String(input.source || 'Auto Trade').trim();
  const lines = [
    `📡 ${source}`,
    ea ? `EA: ${ea}` : null,
    `${side} ${symbol}`,
    `Entry: ${fmt(input.entry)}`,
    `SL: ${fmt(input.stopLoss)}`,
    `TP: ${fmt(input.takeProfit)}`,
  ].filter(Boolean);
  if (input.volume != null && input.volume !== '') {
    lines.push(`Lot: ${fmt(input.volume)}`);
  }
  if (input.trades != null && Number(input.trades) > 1) {
    lines.push(`Trades: ${fmt(input.trades)}`);
  }
  if (input.accuracy != null && Number(input.accuracy) > 0) {
    lines.push(`Confidence: ${Math.round(Number(input.accuracy))}%`);
  }
  return lines.join('\n');
}

/** Send a text message to a Telegram chat via Bot API. */
export async function sendTelegramMessage(botToken, chatId, text) {
  const token = String(botToken || '').trim();
  const chat = String(chatId || '').trim();
  if (!token || !chat || !text) {
    return { ok: false, error: 'Telegram not configured' };
  }
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chat,
      text: String(text).slice(0, 3900),
      disable_web_page_preview: true,
    }),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok || !data?.ok) {
    return {
      ok: false,
      error:
        (data && (data.description || data.error)) ||
        `Telegram HTTP ${res.status}`,
    };
  }
  return { ok: true };
}

export function normalizeTelegramBotToken(value) {
  let token = String(value || '').trim();
  if (!token) return '';
  const fromUrl = token.match(
    /(?:https?:\/\/)?api\.telegram\.org\/bot([0-9]+:[A-Za-z0-9_-]+)/i,
  );
  if (fromUrl?.[1]) return fromUrl[1].trim();
  token = token.replace(/^bot/i, '').trim();
  return token.split('/')[0]?.trim() || token;
}

export function normalizeTelegramChatId(value) {
  return String(value || '').trim().replace(/\s+/g, '');
}

export async function resolveTelegramConfig(firebaseRead, input = {}) {
  let mentorId = String(input.mentorId || '').trim();
  const email = String(input.email || '').trim().toLowerCase();
  if (!mentorId && email) {
    try {
      const auth = (await firebaseRead('lumo/auth')) || null;
      const admins = Array.isArray(auth?.admins) ? auth.admins : [];
      const hit = admins.find(
        (row) => String(row?.email || '').trim().toLowerCase() === email,
      );
      mentorId = String(hit?.id || hit?.mentorId || '').trim();
    } catch {
      mentorId = '';
    }
    if (!mentorId && email === SUPER_ADMIN_EMAIL) mentorId = SUPER_ADMIN_ID;
  }
  const bodyToken = normalizeTelegramBotToken(input.botToken);
  const bodyChat = normalizeTelegramChatId(input.chatId);
  let stored = null;
  let profile = null;
  try {
    stored = (await firebaseRead('lumo/secrets/telegramAlerts')) || null;
  } catch {
    stored = null;
  }
  if (mentorId) {
    try {
      profile = (await firebaseRead(`lumo/store/workspaces/${mentorId}/profile`)) || null;
    } catch {
      profile = null;
    }
  }
  const allowOwnerChannel =
    email === SUPER_ADMIN_EMAIL || mentorId === SUPER_ADMIN_ID;
  const token =
    bodyToken ||
    normalizeTelegramBotToken(
      profile?.telegramBotToken ||
        (allowOwnerChannel
          ? stored?.botToken || process.env.TELEGRAM_BOT_TOKEN
          : ''),
    );
  const chat =
    bodyChat ||
    normalizeTelegramChatId(
      profile?.telegramChatId ||
        (allowOwnerChannel ? stored?.chatId || process.env.TELEGRAM_CHAT_ID : ''),
    );
  const enabled =
    input.enabled === false ||
    profile?.telegramAlertsEnabled === false ||
    stored?.enabled === false
      ? false
      : true;
  return {
    token,
    chat,
    enabled,
    mentorId: mentorId || String(stored?.mentorId || '').trim(),
  };
}
