import {
  APP_HOME_URL,
  APP_LOGIN_URL,
  SUPPORT_EMAIL,
  htmlToPlainText,
  licenseKeyBox,
  paragraph,
  renderLumoEmail,
} from './template.mjs';

function displayName(input = {}) {
  const full = String(input.fullName || input.name || '').trim();
  if (full) return full;
  const mentor = String(input.mentorName || '').trim();
  if (mentor) return mentor;
  const parts = [input.firstName, input.lastName]
    .map((s) => String(s || '').trim())
    .filter(Boolean);
  return parts.join(' ');
}

export function mentorReceivedEmail(mentor = {}) {
  const name = displayName(mentor);
  const who = name ? ` ${name}` : '';
  const bodyHtml = [
    paragraph(`Hi${who},`),
    name
      ? paragraph(`This confirmation is for your Lumo Edge mentor signup as “${name}”.`)
      : '',
    paragraph('Thank you for registering as a mentor with Lumo Edge.'),
    paragraph(
      'Your mentor account is currently awaiting approval from our team.',
    ),
    paragraph(
      'You will receive another email as soon as your account has been approved.',
    ),
    paragraph(
      'Please do not create another account while your application is being reviewed.',
    ),
  ]
    .filter(Boolean)
    .join('');
  const html = renderLumoEmail({
    title: 'Application received',
    preheader: 'Your Lumo Edge mentor application is under review.',
    bodyHtml,
    ctaLabel: 'OPEN LUMO EDGE',
    ctaUrl: APP_HOME_URL,
  });
  return {
    subject: 'Your Lumo Edge Mentor Application Has Been Received',
    html,
    text: htmlToPlainText(html),
  };
}

export function mentorApprovedEmail(mentor = {}) {
  const name = displayName(mentor);
  const who = name ? ` ${name}` : '';
  const bodyHtml = [
    paragraph(`Congratulations${who}!`),
    name
      ? paragraph(`Your mentor account registered as “${name}” is now approved.`)
      : paragraph('Your Lumo Edge mentor account has been approved.'),
    paragraph(
      'You can now log in to your mentor dashboard and start using your account.',
    ),
    paragraph('Welcome to Lumo Edge.'),
  ].join('');
  const html = renderLumoEmail({
    title: 'Mentor approved',
    preheader: 'Your Lumo Edge mentor account is approved — log in now.',
    bodyHtml,
    ctaLabel: 'LOGIN TO YOUR DASHBOARD',
    ctaUrl: APP_LOGIN_URL,
  });
  return {
    subject: 'Welcome to Lumo Edge — Your Mentor Account Has Been Approved',
    html,
    text: htmlToPlainText(html),
  };
}

export function licenseKeyEmail({ name, licenseKey, eaName, fullName, clientName } = {}) {
  const whoName = displayName({ name, fullName, clientName });
  const who = whoName ? ` ${whoName}` : '';
  const ea = eaName ? ` for ${eaName}` : '';
  const bodyHtml = [
    paragraph(`Hi${who},`),
    paragraph(`Your Lumo Edge license key${ea} is ready.`),
    licenseKeyBox(licenseKey),
    paragraph(
      'Open the Lumo Edge app, go to Activate / License, paste this key exactly, and confirm.',
    ),
    paragraph(
      'Keep this email safe. Do not share your license key with anyone else.',
    ),
    paragraph(`Need help? Email ${SUPPORT_EMAIL}.`),
  ].join('');
  const html = renderLumoEmail({
    title: 'License key',
    preheader: 'Your Lumo Edge license key is ready.',
    bodyHtml,
    ctaLabel: 'OPEN LUMO EDGE',
    ctaUrl: APP_HOME_URL,
  });
  return {
    subject: 'Your Lumo Edge License Key',
    html,
    text: htmlToPlainText(html),
  };
}

export function adminManualEmail({ subject, messageHtml, messageText }) {
  const body =
    messageHtml ||
    String(messageText || '')
      .split(/\n+/)
      .map((line) => paragraph(line))
      .join('');
  const html = renderLumoEmail({
    title: subject || 'Lumo Edge',
    preheader: String(messageText || subject || '').slice(0, 120),
    bodyHtml: body,
    ctaLabel: 'OPEN LUMO EDGE',
    ctaUrl: APP_HOME_URL,
  });
  return {
    subject: String(subject || 'Message from Lumo Edge').trim(),
    html,
    text: htmlToPlainText(html),
  };
}
