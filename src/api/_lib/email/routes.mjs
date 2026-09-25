import { matchSuperPassword, requireSuper, verifyAdminSession } from '../adminSession.mjs';
import { firebaseRead, firebaseWrite } from '../clientMerge.mjs';
import {
  listEmailLogs,
  notifyAdminManual,
  resolveAudienceEmails,
  resolveEmailProvider,
} from './index.mjs';

function sessionOrSuperPassword(session, body) {
  if (session?.ok && requireSuper(session)) return true;
  return matchSuperPassword(body?.adminEmail, body?.adminPassword);
}

export async function handleEmailRoutes(req, res, ctx) {
  const { json, readBody, pathname } = ctx || {};
  const path = String(pathname || '').replace(/\/+$/, '') || '/';

  if (path === '/api/email/status' && req.method === 'GET') {
    const resolved = await resolveEmailProvider(firebaseRead);
    json(res, 200, {
      ok: true,
      configured: Boolean(resolved.apiKey),
      provider: resolved.provider || '',
      source: resolved.source || '',
    });
    return true;
  }

  if (path === '/api/email/logs' && req.method === 'GET') {
    const session = await verifyAdminSession(req);
    if (!requireSuper(session)) {
      json(res, 403, { ok: false, error: 'Access denied' });
      return true;
    }
    const logs = listEmailLogs(await firebaseRead('lumo/emailLogs'));
    json(res, 200, { ok: true, logs });
    return true;
  }

  if (path === '/api/email/config' && req.method === 'POST') {
    const body = await readBody(req);
    const session = await verifyAdminSession(req);
    if (!sessionOrSuperPassword(session, body)) {
      json(res, 403, { ok: false, error: 'Access denied' });
      return true;
    }
    const key = String(body.apiKey || '').trim();
    if (!key) {
      json(res, 400, { ok: false, error: 'apiKey required' });
      return true;
    }
    const pathName = key.startsWith('re_') ? 'lumo/secrets/resend' : 'lumo/secrets/brevo';
    const ok = await firebaseWrite(pathName, { apiKey: key, updatedAt: new Date().toISOString() });
    json(res, ok ? 200 : 502, { ok, provider: pathName.endsWith('brevo') ? 'brevo' : 'resend' });
    return true;
  }

  if (path === '/api/email/send' && req.method === 'POST') {
    const body = await readBody(req);
    const session = await verifyAdminSession(req);
    if (!sessionOrSuperPassword(session, body)) {
      json(res, 403, { ok: false, error: 'Access denied' });
      return true;
    }
    const ctxSend = { firebaseRead, firebaseWrite, firebasePush: null };
    const audience = String(body.audience || '').trim();
    if (audience === 'all_mentors' || audience === 'all_clients' || audience === 'everyone') {
      const emails = await resolveAudienceEmails(audience, firebaseRead);
      const results = [];
      for (const to of emails) {
        results.push(
          await notifyAdminManual(ctxSend, {
            to,
            subject: body.subject,
            message: body.message,
            html: body.html,
          }),
        );
      }
      const sent = results.filter((row) => row.ok).length;
      json(res, 200, {
        ok: sent > 0 || results.length === 0,
        sent,
        failed: results.length - sent,
        total: results.length,
        results: results.filter((row) => !row.ok),
      });
      return true;
    }
    const result = await notifyAdminManual(ctxSend, {
      to: body.to,
      subject: body.subject,
      message: body.message,
      html: body.html,
    });
    json(res, result.ok ? 200 : 502, result);
    return true;
  }

  return false;
}
