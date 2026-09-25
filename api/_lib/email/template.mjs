/** Shared Lumo Edge HTML email layout — safe for common email clients. */

/** Small hosted PNG — large logos get stripped by Gmail/Outlook */
export const LOGO_URL = 'https://lumoedge.com/lumo-logo-email.png';
export const APP_ORIGIN = 'https://lumoedge.com';
/** Always absolute with trailing slash so mail clients open the site correctly */
export const APP_HOME_URL = 'https://lumoedge.com/';
export const APP_LOGIN_URL = 'https://lumoedge.com/admin/login';
export const SUPPORT_EMAIL = 'lumoedge08@gmail.com';

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * @param {{ title?: string, preheader?: string, bodyHtml: string, ctaLabel?: string, ctaUrl?: string }} input
 */
export function renderLumoEmail(input) {
  const title = esc(input.title || 'Lumo Edge');
  const preheader = esc(input.preheader || '');
  const ctaLabel = input.ctaLabel ? esc(input.ctaLabel) : '';
  // Force https absolute URL — never relative paths in email
  let ctaUrl = String(input.ctaUrl || APP_HOME_URL).trim();
  if (ctaUrl.startsWith('/')) ctaUrl = `${APP_ORIGIN}${ctaUrl}`;
  if (!/^https?:\/\//i.test(ctaUrl)) ctaUrl = APP_HOME_URL;
  ctaUrl = esc(ctaUrl);

  const ctaBlock =
    ctaLabel && ctaUrl
      ? `
      <tr>
        <td align="center" style="padding:12px 28px 28px;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0">
            <tr>
              <td align="center" bgcolor="#22d3ee" style="border-radius:999px;background-color:#22d3ee;">
                <a href="${ctaUrl}" target="_blank" rel="noopener noreferrer"
                   style="display:inline-block;padding:14px 28px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;color:#061018;text-decoration:none;border-radius:999px;">
                  ${ctaLabel}
                </a>
              </td>
            </tr>
          </table>
          <p style="margin:12px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#93a4c7;">
            Or open: <a href="${ctaUrl}" target="_blank" style="color:#60a5fa;word-break:break-all;">${ctaUrl}</a>
          </p>
        </td>
      </tr>`
      : '';

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light dark" />
  <meta name="supported-color-schemes" content="light dark" />
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#070b14;color:#e8eefc;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${preheader}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#070b14;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background:linear-gradient(180deg,#10182b 0%,#0b1020 100%);border:1px solid #1d4ed8;border-radius:18px;box-shadow:0 0 28px rgba(56,189,248,0.18);">
          <tr>
            <td align="center" style="padding:28px 24px 12px;">
              <a href="${APP_HOME_URL}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;">
                <img src="${LOGO_URL}" width="72" height="72" alt="Lumo Edge logo"
                     style="display:block;width:72px;height:72px;border:0;border-radius:16px;outline:none;text-decoration:none;" />
              </a>
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:800;letter-spacing:0.06em;color:#ffffff;margin-top:14px;">
                LUMO EDGE
              </div>
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#67e8f9;margin-top:4px;letter-spacing:0.08em;text-transform:uppercase;">
                Premium trading platform
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 28px 8px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.65;color:#d7e0f5;">
              ${input.bodyHtml}
            </td>
          </tr>
          ${ctaBlock}
          <tr>
            <td style="padding:18px 28px 28px;border-top:1px solid #334155;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#8b9bb8;text-align:center;">
              <strong style="color:#e2e8f0;">© Lumo Edge. All rights reserved.</strong><br/>
              Questions? Contact
              <a href="mailto:${SUPPORT_EMAIL}" style="color:#67e8f9;text-decoration:none;">${SUPPORT_EMAIL}</a><br/>
              <a href="${APP_HOME_URL}" target="_blank" style="color:#93a4c7;text-decoration:none;">${APP_HOME_URL}</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function paragraph(text) {
  return `<p style="margin:0 0 14px;">${esc(text)}</p>`;
}

export function licenseKeyBox(key, label = 'Your License Key') {
  return `
  <div style="margin:18px 0;padding:16px 18px;border-radius:12px;background:#08101f;border:1px dashed #38bdf8;text-align:center;">
    <div style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#7dd3fc;margin-bottom:8px;">${esc(label)}</div>
    <div style="font-family:Consolas,Monaco,monospace;font-size:18px;font-weight:700;color:#ffffff;letter-spacing:0.04em;word-break:break-all;">
      ${esc(key)}
    </div>
  </div>`;
}

/** Plain-text fallback improves inbox placement */
export function htmlToPlainText(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
