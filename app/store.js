// All data lives on this phone, in the browser's local storage. Nothing is sent to a server.

const KEY = 'bcr.db.v1';

export const PAYMENT_METHODS = ['Venmo', 'Zelle', 'Cash App', 'Apple Pay', 'Cash'];

export const DEFAULT_SETTINGS = {
  businessName: 'ZOI LIMO',
  ownerName: 'Sadok Tsega',
  phone: '832-844-8660',
  email: 'contact@zoilimo.com',
  website: 'www.zoilimo.com',
  address: '',
  numberPrefix: 'ZL-',
  defaultGratuityPct: '20',
  defaultTaxPct: '0',
  vehicles: 'Cadillac Escalade, Chevrolet Suburban, Lincoln Navigator, Mercedes S-Class, Sprinter Van',
  drivers: 'Sadok Tsega',
  venmo: '',
  zelle: '',
  cashApp: '',
  applePay: '',
  invoiceTerms: 'Payment is due upon completion of service. Cancellations within 24 hours of pickup may be charged in full.',
  emailSubject: '{business} Invoice #{number}',
  emailMessage: 'Hi {firstName},\n\nThank you for booking with {business}. Your invoice is below.',
  smsMessage: 'Hi {firstName}, thank you for booking with {business}! Here is your invoice:',
};

const empty = () => ({ nextNumber: 1001, bookings: [], settings: {} });

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...empty(), ...JSON.parse(raw) } : empty();
  } catch {
    return empty();
  }
}

let db = load();

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch (err) {
    throw new Error('Could not save on this phone (storage full or blocked). Export a backup from Settings.');
  }
}

// Ask the browser not to clear our data when the phone is low on space.
try { navigator.storage?.persist?.(); } catch { /* not supported */ }

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);

export const getSettings = () => ({ ...DEFAULT_SETTINGS, ...db.settings });

export function saveSettings(patch) {
  for (const k of Object.keys(DEFAULT_SETTINGS)) if (k in patch) db.settings[k] = String(patch[k] ?? '');
  save();
  return getSettings();
}

export const listBookings = () => db.bookings.slice();
export const getBooking = (id) => db.bookings.find((b) => b.id === id) || null;

export function createBooking(data) {
  const now = new Date().toISOString();
  const b = {
    customer: {}, trip: {}, pricing: {}, status: 'booked', ...data,
    id: uid(),
    number: `${getSettings().numberPrefix}${db.nextNumber++}`,
    createdAt: now, updatedAt: now, sent: [],
  };
  db.bookings.push(b);
  save();
  return b;
}

export function updateBooking(id, patch) {
  const b = getBooking(id);
  if (!b) return null;
  Object.assign(b, patch, { updatedAt: new Date().toISOString() });
  save();
  return b;
}

export function logSend(id, channel, to) {
  const b = getBooking(id);
  if (!b) return;
  b.sent = [...(b.sent || []), { channel, to, at: new Date().toISOString() }];
  save();
}

export function deleteBooking(id) {
  db.bookings = db.bookings.filter((b) => b.id !== id);
  save();
}

export const exportBackup = () => JSON.stringify({ app: 'black-car-reservations', exportedAt: new Date().toISOString(), ...db }, null, 2);

export function importBackup(text) {
  const data = JSON.parse(text);
  if (!Array.isArray(data.bookings)) throw new Error('This file is not a reservations backup.');
  db = { ...empty(), nextNumber: Number(data.nextNumber) || 1001, bookings: data.bookings, settings: data.settings || {} };
  save();
  return db.bookings.length;
}
