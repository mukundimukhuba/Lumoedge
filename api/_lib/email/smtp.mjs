import net from 'node:net';
import tls from 'node:tls';

const CRLF = '\r\n';

export function headerSafe(value) {
  return String(value || '')
    .replace(/[\r\n\0]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function encodeSubject(subject) {
  const safe = headerSafe(subject) || 'Lumo Edge';
  if (/^[\x20-\x7E]*$/.test(safe)) return safe;
  return `=?UTF-8?B?${Buffer.from(safe, 'utf8').toString('base64')}?=`;
}

export function buildMime({ fromName, fromEmail, to, subject, html, text, replyTo }) {
  const boundary = `lumo${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const from = `${headerSafe(fromName) || 'Lumo Edge'} <${fromEmail}>`;
  const bodyText = String(text || '').replace(/\r?\n/g, CRLF);
  const bodyHtml = String(html || '').replace(/\r?\n/g, CRLF);
  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeSubject(subject)}`,
    `Reply-To: ${headerSafe(replyTo) || fromEmail}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    bodyText,
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    bodyHtml,
    `--${boundary}--`,
    '',
  ].join(CRLF);
}

function dotStuff(raw) {
  return String(raw || '')
    .replace(/\r?\n/g, CRLF)
    .split(CRLF)
    .map((line) => (line.startsWith('.') ? `.${line}` : line))
    .join(CRLF);
}

function responseComplete(buffer) {
  if (!buffer.includes('\n')) return false;
  const lines = buffer.split(/\r?\n/).filter((line, idx, all) => line || idx < all.length - 1);
  return lines.some((line) => /^\d{3} /.test(line));
}

function parseCode(text) {
  const match = String(text || '').match(/^(\d{3})/m);
  return match ? Number(match[1]) : 0;
}

class SmtpClient {
  constructor(socket, timeoutMs) {
    this.socket = socket;
    this.timeoutMs = timeoutMs;
    this.buffer = '';
    this.waiters = [];
    this.closedError = null;
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      this.buffer += chunk;
      this.flush();
    });
    socket.on('error', (error) => this.fail(error));
    socket.on('end', () => this.fail(new Error('SMTP connection closed')));
  }

  flush() {
    if (!this.waiters.length || !responseComplete(this.buffer)) return;
    const text = this.buffer;
    this.buffer = '';
    const waiter = this.waiters.shift();
    waiter.resolve(text);
  }

  fail(error) {
    this.closedError = error;
    while (this.waiters.length) {
      this.waiters.shift().reject(error);
    }
  }

  read() {
    if (this.closedError) return Promise.reject(this.closedError);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('SMTP timed out waiting for a reply'));
      }, this.timeoutMs);
      this.waiters.push({
        resolve: (text) => {
          clearTimeout(timer);
          resolve(text);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.flush();
    });
  }

  async expect(wanted) {
    const text = await this.read();
    const code = parseCode(text);
    const allowed = Array.isArray(wanted) ? wanted : [wanted];
    if (!allowed.includes(code)) {
      throw new Error(headerSafe(text).slice(0, 180) || `SMTP ${code || 'error'}`);
    }
    return { code, text };
  }

  write(line) {
    return new Promise((resolve, reject) => {
      this.socket.write(`${line}${CRLF}`, (error) => (error ? reject(error) : resolve()));
    });
  }

  async command(line, wanted) {
    await this.write(line);
    return this.expect(wanted);
  }

  destroy() {
    this.socket.destroy();
  }
}

function connectTls(host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port, servername: host });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Could not reach ${host}:${port}`));
    }, timeoutMs);
    socket.once('secureConnect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function connectPlain(host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Could not reach ${host}:${port}`));
    }, timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function upgradeTls(socket, host, timeoutMs) {
  return new Promise((resolve, reject) => {
    const secure = tls.connect({ socket, servername: host });
    const timer = setTimeout(() => {
      secure.destroy();
      reject(new Error('SMTP STARTTLS timed out'));
    }, timeoutMs);
    secure.once('secureConnect', () => {
      clearTimeout(timer);
      resolve(secure);
    });
    secure.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function authenticateAndSend(client, { username, password, fromEmail, to, mime }) {
  await client.command('AUTH LOGIN', 334);
  await client.command(Buffer.from(username, 'utf8').toString('base64'), 334);
  await client.command(Buffer.from(password, 'utf8').toString('base64'), 235);
  await client.command(`MAIL FROM:<${fromEmail}>`, 250);
  await client.command(`RCPT TO:<${to}>`, [250, 251]);
  await client.command('DATA', 354);
  const done = await client.command(`${dotStuff(mime)}${CRLF}.`, 250);
  await client.write('QUIT').catch(() => {});
  const idMatch = String(done.text || '').match(/<[^>]+>/);
  return { ok: true, id: idMatch ? idMatch[0] : 'smtp' };
}

async function smtpStartTlsSession({ host, port, username, password, fromEmail, to, mime, timeoutMs }) {
  const plain = await connectPlain(host, port, timeoutMs);
  let client = new SmtpClient(plain, timeoutMs);
  try {
    await client.expect(220);
    await client.command('EHLO lumoedge.com', 250);
    await client.command('STARTTLS', 220);
    plain.removeAllListeners('data');
    plain.removeAllListeners('error');
    plain.removeAllListeners('end');
    const secure = await upgradeTls(plain, host, timeoutMs);
    client = new SmtpClient(secure, timeoutMs);
    await client.command('EHLO lumoedge.com', 250);
    return await authenticateAndSend(client, { username, password, fromEmail, to, mime });
  } finally {
    client.destroy();
  }
}

async function smtpImplicitTlsSession({ host, port, username, password, fromEmail, to, mime, timeoutMs }) {
  const secure = await connectTls(host, port, timeoutMs);
  const client = new SmtpClient(secure, timeoutMs);
  try {
    await client.expect(220);
    await client.command('EHLO lumoedge.com', 250);
    return await authenticateAndSend(client, { username, password, fromEmail, to, mime });
  } finally {
    client.destroy();
  }
}

/**
 * Send one transactional message through Brevo SMTP relay.
 * Password is the SMTP key. Never log credentials.
 */
export async function sendViaBrevoSmtp({
  smtpKey,
  login,
  sender,
  to,
  subject,
  html,
  text,
  replyTo,
}) {
  const username = headerSafe(login);
  const fromEmail = headerSafe(sender?.email);
  if (!username || !fromEmail || !to || !smtpKey) {
    return { ok: false, error: 'Brevo SMTP login or sender is missing.' };
  }
  const mime = buildMime({
    fromName: sender?.name || 'Lumo Edge',
    fromEmail,
    to,
    subject,
    html,
    text,
    replyTo,
  });
  const sessionArgs = {
    host: 'smtp-relay.brevo.com',
    username,
    password: smtpKey,
    fromEmail,
    to,
    mime,
    timeoutMs: 18000,
  };
  try {
    return await smtpStartTlsSession({ ...sessionArgs, port: 587 });
  } catch (startTlsError) {
    try {
      return await smtpImplicitTlsSession({ ...sessionArgs, port: 465 });
    } catch (implicitError) {
      const first = startTlsError instanceof Error ? startTlsError.message : 'STARTTLS failed';
      const second = implicitError instanceof Error ? implicitError.message : 'SMTPS failed';
      return { ok: false, error: `${first}; ${second}` };
    }
  }
}
