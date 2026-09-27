// Tiny JSON-file database. Fine for a single operator / small fleet; writes are atomic (temp file + rename).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const DEFAULT_SETTINGS = {
  businessName: 'ZOI LIMO',
  ownerName: 'Sadok Tsega',
  phone: '832-844-8660',
  email: 'contact@zoilimo.com',
  website: 'www.zoilimo.com',
  address: '',
  numberPrefix: 'ZL-',
  defaultGratuityPct: 20,
  defaultTaxPct: 0,
  vehicles: 'Cadillac Escalade, Chevrolet Suburban, Lincoln Navigator, Mercedes S-Class, Sprinter Van',
  drivers: 'Sadok Tsega',
  paymentInstructions: '',
  invoiceTerms: 'Payment is due upon completion of service. Cancellations within 24 hours of pickup may be charged in full.',
  emailSubject: '{business} Invoice #{number}',
  emailMessage: 'Hi {firstName},\n\nThank you for booking with {business}. Your invoice is below.',
  smsTemplate: 'Hi {firstName}, thanks for booking with {business}! Invoice #{number} for your {pickupDate} {pickupTime} pickup. Total {total}, balance due {balance}.\n{link}',
};

export class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'db.json');
    fs.mkdirSync(dir, { recursive: true });
    this.db = { nextNumber: 1001, bookings: [], settings: {} };
    if (fs.existsSync(this.file)) {
      this.db = { ...this.db, ...JSON.parse(fs.readFileSync(this.file, 'utf8')) };
    }
  }

  save() {
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.db, null, 2));
    fs.renameSync(tmp, this.file);
  }

  get settings() {
    return { ...DEFAULT_SETTINGS, ...this.db.settings };
  }

  updateSettings(patch) {
    const allowed = Object.keys(DEFAULT_SETTINGS);
    for (const k of allowed) if (k in patch) this.db.settings[k] = String(patch[k] ?? '').slice(0, 5000);
    this.save();
    return this.settings;
  }

  list() {
    return this.db.bookings;
  }

  get(id) {
    return this.db.bookings.find((b) => b.id === id);
  }

  byToken(token) {
    return this.db.bookings.find((b) => b.token === token);
  }

  create(data) {
    const now = new Date().toISOString();
    const booking = {
      ...sanitize(data),
      id: crypto.randomUUID(),
      token: crypto.randomBytes(18).toString('base64url'),
      number: `${this.settings.numberPrefix}${this.db.nextNumber++}`,
      createdAt: now,
      updatedAt: now,
      sent: [],
    };
    this.db.bookings.push(booking);
    this.save();
    return booking;
  }

  update(id, data) {
    const b = this.get(id);
    if (!b) return null;
    Object.assign(b, sanitize(data), { updatedAt: new Date().toISOString() });
    this.save();
    return b;
  }

  logSend(id, entry) {
    const b = this.get(id);
    if (!b) return;
    b.sent = [...(b.sent || []), { ...entry, at: new Date().toISOString() }];
    this.save();
  }

  remove(id) {
    const before = this.db.bookings.length;
    this.db.bookings = this.db.bookings.filter((b) => b.id !== id);
    this.save();
    return this.db.bookings.length !== before;
  }
}

// Keep only the editable parts of a booking; server-owned fields (id, token, number, sent...) are never taken from input.
function sanitize(d = {}) {
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  const strings = (o) => Object.fromEntries(Object.entries(obj(o)).map(([k, v]) => [k, v == null ? '' : String(v).slice(0, 2000)]));
  const out = {};
  if ('customer' in d) out.customer = strings(d.customer);
  if ('trip' in d) out.trip = strings(d.trip);
  if ('pricing' in d) out.pricing = strings(d.pricing);
  if ('status' in d) out.status = ['booked', 'completed', 'cancelled'].includes(d.status) ? d.status : 'booked';
  return out;
}
