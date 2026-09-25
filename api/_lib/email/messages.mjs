import {
  APP_HOME_URL,
  APP_LOGIN_URL,
  htmlToPlainText,
  licenseKeyBox,
  paragraph,
  renderLumoEmail,
} from './template.mjs';

export function firstNameFrom(input = {}) {
  const direct = String(input.firstName || '').trim();
  if (direct) return direct;
  const full = String(input.fullName || input.name || input.clientName || input.mentorName || '').trim();
  if (full) return full.split(/\s+/)[0];
  const email = String(input.email || '').trim();
  if (email.includes('@')) return email.split('@')[0];
  return 'there';
}

export function registrationConfirmationEmail(mentor = {}) {
  const firstName = firstNameFrom(mentor);
  const bodyHtml = [
    paragraph(`Hi ${firstName},`),
    paragraph('Welcome to Lumo Edge.'),
    paragraph('Your registration has been successfully received.'),
    paragraph(
      'Our team will review your registration and notify you once your account has been approved.',
    ),
    paragraph('You can then access your Lumo Edge portal and start using the platform.'),
    paragraph('Thank you for choosing Lumo Edge.'),
    paragraph('Lumo Edge Team'),
  ].join('');
  const html = renderLumoEmail({
    title: 'Registration received',
    preheader: 'Your Lumo Edge registration has been received.',
    bodyHtml,
    ctaLabel: 'OPEN LUMO EDGE',
    ctaUrl: APP_HOME_URL,
  });
  return {
    subject: 'Welcome to Lumo Edge — Registration Received',
    html,
    text: htmlToPlainText(html),
  };
}

export function mentorReceivedEmail(mentor = {}) {
  return registrationConfirmationEmail(mentor);
}

export function mentorApprovedEmail(mentor = {}) {
  const firstName = firstNameFrom(mentor);
  const approvalDate = String(mentor.approvalDate || '').trim() || 'today';
  const deadlineDate = String(mentor.deadlineDate || '').trim() || '40 days from approval';
  const portalUrl = String(mentor.portalUrl || APP_LOGIN_URL).trim() || APP_LOGIN_URL;
  const bodyHtml = [
    paragraph(`Hi ${firstName},`),
    paragraph('Your Lumo Edge mentor account has been approved.'),
    paragraph('You can now log in to your Lumo Edge portal and begin using your mentor dashboard.'),
    paragraph('IMPORTANT: You have 40 days from the date of approval to become active.'),
    paragraph('Within these 40 days, you must either:'),
    paragraph('1. Generate at least one license key'),
    paragraph('OR'),
    paragraph('2. Bring at least one client under your mentor account.'),
    paragraph(
      'If neither requirement is completed within 40 days, your mentor account will automatically be deactivated and removed according to the Lumo Edge inactivity policy.',
    ),
    paragraph(`Your 40-day activity period starts from: ${approvalDate}`),
    paragraph(`Your deadline is: ${deadlineDate}`),
    paragraph(`Login to your portal: ${portalUrl}`),
    paragraph('Welcome to Lumo Edge.'),
    paragraph('Lumo Edge Team'),
  ].join('');
  const html = renderLumoEmail({
    title: "You're approved",
    preheader: 'Your Lumo Edge mentor account is approved — log in now.',
    bodyHtml,
    ctaLabel: 'LOGIN TO YOUR PORTAL',
    ctaUrl: portalUrl,
  });
  return {
    subject: "You're Approved — Welcome to Lumo Edge",
    html,
    text: htmlToPlainText(html),
  };
}

export function licenseKeyEmail({
  name,
  licenseKey,
  eaName,
  fullName,
  clientName,
  firstName,
  licenseDuration,
  duration,
  portalUrl,
} = {}) {
  const who = firstNameFrom({ firstName, name, fullName, clientName });
  const ea = String(eaName || 'Lumo Edge').trim() || 'Lumo Edge';
  const length = String(licenseDuration || duration || 'As issued').trim();
  const login = String(portalUrl || APP_HOME_URL).trim() || APP_HOME_URL;
  const bodyHtml = [
    paragraph(`Hi ${who},`),
    paragraph('Your Lumo Edge license has been successfully generated.'),
    paragraph('Your license details:'),
    paragraph(`EA / Bot: ${ea}`),
    licenseKeyBox(licenseKey),
    paragraph(`Duration: ${length}`),
    paragraph('You can now use this license inside Lumo Edge.'),
    paragraph(`Login: ${login}`),
    paragraph('Thank you for using Lumo Edge.'),
    paragraph('Lumo Edge Team'),
  ].join('');
  const html = renderLumoEmail({
    title: 'License key',
    preheader: 'Your Lumo Edge license key is ready.',
    bodyHtml,
    ctaLabel: 'OPEN LUMO EDGE',
    ctaUrl: login,
  });
  return {
    subject: 'Your Lumo Edge License Key',
    html,
    text: htmlToPlainText(html),
  };
}

export function passwordResetEmail({ firstName, resetCode, name, fullName } = {}) {
  const who = firstNameFrom({ firstName, name, fullName });
  const code = String(resetCode || '').trim();
  const bodyHtml = [
    paragraph(`Hi ${who},`),
    paragraph('We received a request to reset your Lumo Edge password.'),
    paragraph('Your password reset code is:'),
    licenseKeyBox(code, 'Password reset code'),
    paragraph('This code expires in 15 minutes.'),
    paragraph('If you did not request this password reset, you can safely ignore this email.'),
    paragraph('Lumo Edge Team'),
  ].join('');
  const html = renderLumoEmail({
    title: 'Reset password',
    preheader: 'Your Lumo Edge password reset code expires in 15 minutes.',
    bodyHtml,
    ctaLabel: 'OPEN LUMO EDGE',
    ctaUrl: APP_LOGIN_URL,
  });
  return {
    subject: 'Reset Your Lumo Edge Password',
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
