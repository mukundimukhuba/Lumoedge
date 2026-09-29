import { matchSuperPassword, requireSuper, verifyAdminSession } from '../adminSession.mjs';
import { firebaseRead, firebaseWrite } from '../clientMerge.mjs';
import { listEmailLogs, notifyAdminManual, notifyAudience, resolveAudienceEmails } from './index.mjs';
import { describeEmailConfig, isValidEmail } from './send.mjs';

const TEST_ALLOWLIST = new Set(['mukundimukhuba8@gmail.com', 'lumoedge08@gmail.com']);
const testSends = [];

function sessionOrSuperPassword(session, body) {
  if (session?.ok && requireSuper(session)) return true;
  return matchSuperPassword(body?.adminEmail, body?.adminPassword);
}

export async function handleEmailRoutes(req, res, ctx) {
  const { json, readBody, pathname } = ctx || {};
  const path = String(pathname || '').replace(/\/+$/, '') || '/';

  if (path === '/api/email/status' && req.method === 'GET') {
    const config = await describeEmailConfig(firebaseRead);
    json(res, 200, { ok: true, ...config });
    return true;
  }

  if (path === '/api/email/test' && req.method === 'POST') {
    const body = await readBody(req);
    const to = isValidEmail(body?.to || 'mukundimukhuba8@gmail.com');
    if (!TEST_ALLOWLIST.has(to)) {
      json(res, 400, { ok: false, error: 'test_recipient_not_allowed' });
      return true;
    }
    const now = Date.now();
    const recent = testSends.filter((at) => now - at < 60 * 60 * 1000);
    testSends.length = 0;
    testSends.push(...recent, now);
    if (recent.length >= 5) {
      json(res, 429, { ok: false, error: 'test_rate_limited' });
      return true;
    }
    const result = await notifyAdminManual(
      { firebaseRead, firebaseWrite, firebasePush: null },
      {
        to,
        subject: 'Lumo Edge email test',
        message: [
          'Hi Mukundi,',
          '',
          'This is a live Lumo Edge email test using the server Brevo/Resend configuration.',
          '',
          'If you can read this, the branded Lumo Edge template and the new API key are working.',
          '',
          'Lumo Edge Team',
        ].join('\n'),
      },
    );
    json(res, result.ok ? 200 : 502, {
      ok: Boolean(result.ok),
      provider: result.provider || '',
      transport: result.transport || '',
      error: result.error || '',
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
      if (!emails.length) {
        json(res, 400, { ok: false, error: 'No recipient emails found.', sent: 0, failed: 0, total: 0 });
        return true;
      }
      const result = await notifyAudience(ctxSend, {
        recipients: emails,
        subject: body.subject,
        message: body.message,
        html: body.html,
      });
      json(res, result.ok ? 200 : 502, {
        ok: Boolean(result.ok),
        sent: result.sent || 0,
        failed: result.failed || 0,
        total: result.total || emails.length,
        error: result.error || '',
        results: result.results || [],
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
