import nodemailer from 'nodemailer';

const configured = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
const transporter = configured ? nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: Number(process.env.SMTP_PORT || 587) === 465,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
}) : null;

export function smtpEnabled() {
  return Boolean(transporter);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

export async function sendAccountNotification({ to, subject, text }) {
  if (!transporter) return false;
  const safeText = escapeHtml(text);
  await transporter.sendMail({
    from: `"${process.env.SMTP_FROM_NAME || 'NEXA PRIME'}" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
    to,
    subject,
    text,
    html: `<main dir="rtl" style="font-family:Arial,sans-serif;max-width:560px;margin:32px auto;padding:24px;border:1px solid #ddd;border-radius:12px"><h1>${escapeHtml(subject)}</h1><p>${safeText}</p></main>`
  });
  return true;
}

export async function sendSecurityMail({ to, subject, title, text, link }) {
  if (!transporter) throw new Error('SMTP_NOT_CONFIGURED');
  const fromName = process.env.SMTP_FROM_NAME || 'NEXA PRIME';
  return transporter.sendMail({
    from: `"${fromName}" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
    to,
    subject,
    text: `${title}\n\n${text}\n\n${link}`,
    html: `<main dir="rtl" style="font-family:Arial,sans-serif;max-width:560px;margin:32px auto;padding:24px;border:1px solid #ddd;border-radius:12px"><h1>${title}</h1><p>${text}</p><p><a href="${link}">المتابعة بأمان</a></p><small>إذا لم تطلب هذه الرسالة فتجاهلها.</small></main>`
  });
}
