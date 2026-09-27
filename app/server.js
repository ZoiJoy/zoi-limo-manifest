// Black car reservation & invoicing server. Zero required dependencies (nodemailer is optional, for email).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Store } from './lib/store.js';
import { emailEnabled, smsEnabled, sendEmail, sendSMS } from './lib/messaging.js';
import { renderInvoiceHTML, renderInvoiceText, fillTemplate, esc } from './public/invoice.js';
import { computeTotals } from './public/pricing.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
try { process.loadEnvFile(path.join(__dirname, '.env')); } catch { /* .env is optional */ }

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const APP_PASSWORD = process.env.APP_PASSWORD || '';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.createHash('sha256').update(`zoi:${APP_PASSWORD}`).digest('hex');
const store = new Store(process.env.DATA_DIR || path.join(__dirname, 'data'));

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};

// ---------- auth ----------
const sessionToken = () => crypto.createHmac('sha256', SESSION_SECRET).update('session-v1').digest('base64url');

function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
}

function safeEqual(a, b) {
  const ab = Buffer.from(String(a)), bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

const isAuthed = (req) => !APP_PASSWORD || safeEqual(parseCookies(req).zsess || '', sessionToken());

const loginAttempts = new Map();
function tooManyAttempts(ip) {
  const now = Date.now();
  const rec = loginAttempts.get(ip) || { count: 0, start: now };
  if (now - rec.start > 15 * 60_000) { rec.count = 0; rec.start = now; }
  rec.count++;
  loginAttempts.set(ip, rec);
  return rec.count > 10;
}

// ---------- helpers ----------
function send(res, status, body, headers = {}) {
  const isObj = typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(status, { 'Content-Type': isObj ? 'application/json' : 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff', ...headers });
  res.end(isObj ? JSON.stringify(body) : body);
}

async function readJSON(req) {
  let size = 0; const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > 1_000_000) throw Object.assign(new Error('Request too large'), { status: 413 });
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
}

function baseUrl(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  const proto = (req.headers['x-forwarded-proto'] || '').split(',')[0] || (req.socket.encrypted ? 'https' : 'http');
  return `${proto}://${req.headers['x-forwarded-host'] || req.headers.host}`;
}

const invoiceLink = (req, b) => `${baseUrl(req)}/i/${b.token}`;
const withTotals = (b) => ({ ...b, totals: computeTotals(b.pricing) });

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Forbidden');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Not found');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

function publicInvoicePage(req, res, token) {
  const b = store.byToken(token);
  if (!b) return send(res, 404, 'Invoice not found');
  const s = store.settings;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Invoice #${esc(b.number)} · ${esc(s.businessName)}</title>
<style>body{margin:0;background:#f3f1ec;padding:16px}.bar{max-width:720px;margin:0 auto 12px;text-align:right}
.bar button{background:#111;color:#d4b25a;border:0;padding:10px 18px;border-radius:8px;font:600 14px system-ui;cursor:pointer}
.wrap{box-shadow:0 2px 16px rgba(0,0,0,.08);max-width:720px;margin:0 auto}
@media print{body{background:#fff;padding:0}.bar{display:none}.wrap{box-shadow:none}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style>
</head><body><div class="bar"><button onclick="print()">Print / Save PDF</button></div>
<div class="wrap">${renderInvoiceHTML(b, s)}</div></body></html>`;
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer' });
  res.end(html);
}

// ---------- API ----------
async function api(req, res, pathname) {
  const method = req.method;

  if (pathname === '/api/config' && method === 'GET') {
    return send(res, 200, { authRequired: Boolean(APP_PASSWORD), authed: isAuthed(req), emailEnabled: emailEnabled(), smsEnabled: smsEnabled() });
  }

  if (pathname === '/api/login' && method === 'POST') {
    const ip = req.socket.remoteAddress;
    if (tooManyAttempts(ip)) return send(res, 429, { error: 'Too many attempts. Try again in 15 minutes.' });
    const { password } = await readJSON(req);
    if (!APP_PASSWORD || safeEqual(password || '', APP_PASSWORD)) {
      loginAttempts.delete(ip);
      const secure = baseUrl(req).startsWith('https') ? '; Secure' : '';
      return send(res, 200, { ok: true }, { 'Set-Cookie': `zsess=${sessionToken()}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 90}${secure}` });
    }
    return send(res, 401, { error: 'Wrong password' });
  }

  if (pathname === '/api/logout' && method === 'POST') {
    return send(res, 200, { ok: true }, { 'Set-Cookie': 'zsess=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
  }

  if (!isAuthed(req)) return send(res, 401, { error: 'Login required' });

  if (pathname === '/api/settings') {
    if (method === 'GET') return send(res, 200, store.settings);
    if (method === 'PUT') return send(res, 200, store.updateSettings(await readJSON(req)));
  }

  if (pathname === '/api/bookings') {
    if (method === 'GET') return send(res, 200, store.list().map(withTotals));
    if (method === 'POST') {
      const b = store.create(await readJSON(req));
      return send(res, 201, { ...withTotals(b), link: invoiceLink(req, b) });
    }
  }

  const m = pathname.match(/^\/api\/bookings\/([\w-]+)(\/send)?$/);
  if (m) {
    const [, id, isSend] = m;
    const b = store.get(id);
    if (!b) return send(res, 404, { error: 'Booking not found' });

    if (!isSend) {
      if (method === 'GET') return send(res, 200, { ...withTotals(b), link: invoiceLink(req, b) });
      if (method === 'PUT') {
        const u = store.update(id, await readJSON(req));
        return send(res, 200, { ...withTotals(u), link: invoiceLink(req, u) });
      }
      if (method === 'DELETE') return send(res, 200, { ok: store.remove(id) });
    }

    if (isSend && method === 'POST') {
      const { channel, to, message, subject } = await readJSON(req);
      const s = store.settings;
      const link = invoiceLink(req, b);
      if (!to) return send(res, 400, { error: 'Recipient is required' });

      if (channel === 'email') {
        if (!emailEnabled()) return send(res, 409, { error: 'Email is not configured on the server', fallback: true });
        const intro = message ?? fillTemplate(s.emailMessage, b, s, link);
        const html = `<div style="background:#f3f1ec;padding:16px">`
          + (intro ? `<div style="max-width:720px;margin:0 auto 16px;font:15px/1.5 system-ui,sans-serif;white-space:pre-line;color:#222">${esc(intro)}</div>` : '')
          + renderInvoiceHTML(b, s, { link }) + '</div>';
        const r = await sendEmail({
          to, subject: subject || fillTemplate(s.emailSubject, b, s, link),
          text: `${intro ? intro + '\n\n' : ''}${renderInvoiceText(b, s, { link })}`, html,
          fromName: s.businessName, replyTo: s.email,
        });
        store.logSend(id, { channel, to, via: 'smtp' });
        return send(res, 200, { ok: true, id: r.id });
      }

      if (channel === 'sms') {
        if (!smsEnabled()) return send(res, 409, { error: 'Text messaging is not configured on the server', fallback: true });
        const body = message || fillTemplate(s.smsTemplate, b, s, link);
        const r = await sendSMS({ to, body });
        store.logSend(id, { channel, to, via: 'twilio' });
        return send(res, 200, { ok: true, id: r.id });
      }

      // Client-side send (device Mail/Messages app): just record it.
      if (channel === 'device-email' || channel === 'device-sms') {
        store.logSend(id, { channel: channel.slice(7), to, via: 'device' });
        return send(res, 200, { ok: true });
      }
      return send(res, 400, { error: 'Unknown channel' });
    }
  }

  return send(res, 404, { error: 'Not found' });
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://x');
  try {
    if (pathname.startsWith('/api/')) return await api(req, res, pathname);
    const inv = pathname.match(/^\/i\/([\w-]+)$/);
    if (inv) return publicInvoicePage(req, res, inv[1]);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    return serveStatic(req, res, pathname);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) send(res, err.status || 500, { error: err.message || 'Server error' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\n  ${store.settings.businessName} reservations running at http://localhost:${PORT}`);
  console.log(`  Email (SMTP):  ${emailEnabled() ? 'enabled' : 'not configured - will use the device mail app'}`);
  console.log(`  Text (Twilio): ${smsEnabled() ? 'enabled' : 'not configured - will use the device messages app'}`);
  if (!APP_PASSWORD) console.log('  WARNING: APP_PASSWORD is not set - anyone who can reach this server can see bookings.');
  console.log('');
});
