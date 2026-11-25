import { firebaseRead, firebaseWrite } from './clientMerge.mjs';
import {
  buildTelegramTradeMessage,
  canPostTelegramTradeAlert,
  resolveTelegramConfig,
  sendTelegramMessage,
  normalizeTelegramBotToken,
  normalizeTelegramChatId,
} from './telegramNotify.mjs';

export async function saveTelegramAlerts(firebaseWriteFn, input, firebaseReadFn = firebaseRead) {
  const mentorId = String(input.mentorId || '').trim();
  const botToken = normalizeTelegramBotToken(input.botToken);
  const chatId = normalizeTelegramChatId(input.chatId);
  const enabled = input.enabled !== false;
  if (!mentorId) return { ok: false, error: 'mentorId required' };

  const now = new Date().toISOString();
  if (botToken && chatId) {
    const payload = { mentorId, botToken, chatId, enabled, updatedAt: now };
    const okSecret = await firebaseWriteFn('lumo/secrets/telegramAlerts', payload);
    const okToken = await firebaseWriteFn(
      `lumo/store/workspaces/${mentorId}/profile/telegramBotToken`,
      botToken,
    );
    const okChat = await firebaseWriteFn(
      `lumo/store/workspaces/${mentorId}/profile/telegramChatId`,
      chatId,
    );
    const okEnabled = await firebaseWriteFn(
      `lumo/store/workspaces/${mentorId}/profile/telegramAlertsEnabled`,
      enabled,
    );
    if (!okSecret || !okToken || !okChat || !okEnabled) {
      return { ok: false, error: 'Could not save Telegram settings' };
    }
    return { ok: true, mentorId, enabled };
  }

  const okEnabled = await firebaseWriteFn(
    `lumo/store/workspaces/${mentorId}/profile/telegramAlertsEnabled`,
    enabled,
  );
  const stored = (await firebaseReadFn('lumo/secrets/telegramAlerts')) || {};
  if (stored && typeof stored === 'object' && String(stored.mentorId || '') === mentorId) {
    await firebaseWriteFn('lumo/secrets/telegramAlerts', {
      ...stored,
      enabled,
      updatedAt: now,
    });
  }
  if (!okEnabled) return { ok: false, error: 'Could not update Telegram On/Off' };
  return { ok: true, mentorId, enabled };
}

export async function postTelegramTrade(firebaseReadFn, body, send = sendTelegramMessage) {
  if (body?.notify === false && !body?.test) {
    return { ok: true, skipped: true, reason: 'notify_off' };
  }
  if (!canPostTelegramTradeAlert(body || {})) {
    return { ok: true, skipped: true, reason: 'not_allowed' };
  }
  const cfg = await resolveTelegramConfig(firebaseReadFn, body || {});
  if (!body?.test && !cfg.enabled) {
    return { ok: true, skipped: true, reason: 'disabled' };
  }
  if (!cfg.token || !cfg.chat) {
    return { ok: false, skipped: true, error: 'Telegram not configured' };
  }
  const text = buildTelegramTradeMessage(body || {});
  const sent = await send(cfg.token, cfg.chat, text);
  if (!sent.ok) return { ok: false, error: sent.error || 'Send failed' };
  return { ok: true };
}

export async function handleTelegramRoutes(req, res, ctx) {
  const { json, readBody, pathname } = ctx || {};
  const path = String(pathname || '').replace(/\/+$/, '') || '/';

  if (path === '/api/telegram/config' && req.method === 'POST') {
    const body = await readBody(req);
    const result = await saveTelegramAlerts(firebaseWrite, body || {});
    json(res, result.ok ? 200 : 400, result);
    return true;
  }

  if (path === '/api/telegram/notify' && req.method === 'POST') {
    const body = await readBody(req);
    const result = await postTelegramTrade(firebaseRead, body || {});
    json(res, result.ok ? 200 : result.skipped ? 200 : 502, result);
    return true;
  }

  return false;
}
