import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { computeTotals } from '../public/pricing.js';
import { renderInvoiceHTML, fillTemplate } from '../public/invoice.js';
import { normalizePhone } from '../lib/messaging.js';

test('flat-rate totals with gratuity on base fare, tax, discount and deposit', () => {
  const t = computeTotals({ rateType: 'flat', baseFare: '100', tolls: '10', parking: '5', discount: '15', gratuityPct: '20', taxPct: '8.25', amountPaid: '50' });
  assert.equal(t.serviceTotal, 115);
  assert.equal(t.discount, 15);
  assert.equal(t.gratuity, 20);
  assert.equal(t.tax, 8.25);
  assert.equal(t.total, 128.25);
  assert.equal(t.balance, 78.25);
});

test('hourly totals', () => {
  const t = computeTotals({ rateType: 'hourly', hourlyRate: '95', hours: '3', gratuityPct: '20' });
  assert.equal(t.lines[0].amount, 285);
  assert.equal(t.total, 342);
});

test('empty pricing is zero', () => {
  assert.equal(computeTotals({}).total, 0);
});

test('phone normalization', () => {
  assert.equal(normalizePhone('(832) 844-8660'), '+18328448660');
  assert.equal(normalizePhone('1-832-844-8660'), '+18328448660');
  assert.equal(normalizePhone('+44 20 7946 0958'), '+442079460958');
});

test('invoice escapes customer input', () => {
  const html = renderInvoiceHTML({ number: 'ZL-1', customer: { firstName: '<script>x</script>' }, trip: {}, pricing: {} }, {});
  assert.ok(!html.includes('<script>x'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('template placeholders', () => {
  const msg = fillTemplate('Hi {firstName}, total {total} {link} {unknown}', { number: 'ZL-1', customer: { firstName: 'Ann' }, pricing: { baseFare: '50' } }, {}, 'http://x/i/abc');
  assert.equal(msg, 'Hi Ann, total $50.00 http://x/i/abc {unknown}');
});

// ---- API ----
let proc, base, dir;
const PORT = 3900 + Math.floor(Math.random() * 90);

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bcr-'));
  proc = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, APP_PASSWORD: 'secret', SMTP_HOST: '', TWILIO_ACCOUNT_SID: '' },
    stdio: 'pipe',
  });
  base = `http://127.0.0.1:${PORT}`;
  for (let i = 0; i < 50; i++) {
    try { await fetch(`${base}/api/config`); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error('server did not start');
});
after(() => { proc?.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

test('API: auth, create, update, public invoice, send fallback', async () => {
  assert.equal((await fetch(`${base}/api/bookings`)).status, 401);
  assert.equal((await fetch(`${base}/api/login`, { method: 'POST', body: JSON.stringify({ password: 'nope' }) })).status, 401);

  const login = await fetch(`${base}/api/login`, { method: 'POST', body: JSON.stringify({ password: 'secret' }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const h = { cookie, 'Content-Type': 'application/json' };

  const res = await fetch(`${base}/api/bookings`, {
    method: 'POST', headers: h,
    body: JSON.stringify({ id: 'evil', number: 'X', customer: { firstName: 'Jane', phone: '8325550000', email: 'jane@example.com' }, trip: { pickupDate: '2026-10-01' }, pricing: { baseFare: '120', gratuityPct: '20' }, status: 'booked' }),
  });
  assert.equal(res.status, 201);
  const b = await res.json();
  assert.equal(b.number, 'ZL-1001');
  assert.notEqual(b.id, 'evil');
  assert.equal(b.totals.total, 144);
  assert.match(b.link, /\/i\/[\w-]+$/);

  const upd = await (await fetch(`${base}/api/bookings/${b.id}`, { method: 'PUT', headers: h, body: JSON.stringify({ pricing: { ...b.pricing, amountPaid: '144' } }) })).json();
  assert.equal(upd.totals.balance, 0);

  const pub = await fetch(new URL(b.link).pathname.replace(/^/, base));
  assert.equal(pub.status, 200);
  const html = await pub.text();
  assert.ok(html.includes('ZL-1001') && html.includes('Jane') && html.includes('Paid'));

  const sms = await fetch(`${base}/api/bookings/${b.id}/send`, { method: 'POST', headers: h, body: JSON.stringify({ channel: 'sms', to: '8325550000' }) });
  assert.equal(sms.status, 409);
  assert.equal((await sms.json()).fallback, true);

  const dev = await fetch(`${base}/api/bookings/${b.id}/send`, { method: 'POST', headers: h, body: JSON.stringify({ channel: 'device-sms', to: '8325550000' }) });
  assert.equal(dev.status, 200);
  const again = await (await fetch(`${base}/api/bookings/${b.id}`, { headers: h })).json();
  assert.equal(again.sent.length, 1);

  assert.equal((await fetch(`${base}/i/does-not-exist`)).status, 404);
  assert.equal((await fetch(`${base}/..%2fserver.js`)).status, 403);
});
