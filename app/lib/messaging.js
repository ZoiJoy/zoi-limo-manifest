// Outbound email (SMTP via nodemailer) and SMS (Twilio REST API). Both are optional:
// when not configured, the app falls back to opening the device's own Mail / Messages app.

const env = process.env;

export const emailEnabled = () => Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);
export const smsEnabled = () =>
  Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && (env.TWILIO_FROM || env.TWILIO_MESSAGING_SERVICE_SID));

let transporter;
async function getTransporter() {
  if (transporter) return transporter;
  let nodemailer;
  try {
    nodemailer = (await import('nodemailer')).default;
  } catch {
    throw new Error('Email sending needs the "nodemailer" package. Run "npm install" in the app folder.');
  }
  const port = Number(env.SMTP_PORT || 465);
  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port,
    secure: env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : port === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  });
  return transporter;
}

export async function sendEmail({ to, subject, text, html, fromName, replyTo }) {
  const t = await getTransporter();
  const fromAddr = env.SMTP_FROM || env.SMTP_USER;
  const info = await t.sendMail({
    from: fromName ? `"${fromName.replace(/"/g, '')}" <${fromAddr}>` : fromAddr,
    to,
    replyTo: replyTo || undefined,
    subject,
    text,
    html,
  });
  return { id: info.messageId };
}

// Accepts "(832) 844-8660", "832.844.8660", "+44 20 ..." etc. Ten-digit numbers are assumed to be US/Canada.
export function normalizePhone(raw) {
  const s = String(raw || '').trim();
  const digits = s.replace(/\D/g, '');
  if (s.startsWith('+')) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return digits ? `+${digits}` : '';
}

export async function sendSMS({ to, body }) {
  const params = new URLSearchParams({ To: normalizePhone(to), Body: body });
  if (env.TWILIO_MESSAGING_SERVICE_SID) params.set('MessagingServiceSid', env.TWILIO_MESSAGING_SERVICE_SID);
  else params.set('From', env.TWILIO_FROM);

  const auth = Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64');
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `Twilio error ${res.status}`);
  return { id: data.sid };
}
