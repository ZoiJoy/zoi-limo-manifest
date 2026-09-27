// Bookings and settings. When the app runs as a Claude artifact, they are saved privately in the
// owner's Claude account (the artifact `db`). Anywhere else, they are saved in this phone's browser.

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

const LOCAL_KEY = 'bcr.db.v1';
let data = { nextNumber: 1001, bookings: [], settings: {} };
let remote = null; // artifact db namespace, when available
let onError = () => {};

// ---------- backends ----------
function saveLocal() {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(data));
  } catch {
    onError('Could not save on this phone (storage full or blocked).');
  }
}

// One write at a time per document, as the artifact db requires.
const queues = new Map();
function writeRemote(path, op) {
  const prev = queues.get(path) || Promise.resolve();
  const next = prev.then(op).catch((e) => onError(e?.code === 'quota_exceeded'
    ? 'Storage is full. Delete old bookings to make room.'
    : 'Could not save. Check your connection and try again.'));
  queues.set(path, next);
  return next;
}

function persistBooking(b) {
  if (!remote) return saveLocal();
  writeRemote(`bookings/${b.id}`, () => remote.doc(`bookings/${b.id}`).set(JSON.parse(JSON.stringify(b))));
}

function persistMeta() {
  if (!remote) return saveLocal();
  const body = { nextNumber: data.nextNumber, settings: { ...data.settings } };
  writeRemote('meta/main', () => remote.doc('meta/main').set(body));
}

function removeRemote(id) {
  if (!remote) return saveLocal();
  writeRemote(`bookings/${id}`, () => remote.doc(`bookings/${id}`).delete());
}

// Resolves once data is loaded. Returns 'account' or 'phone' (where data is kept).
export async function init({ onSaveError } = {}) {
  if (onSaveError) onError = onSaveError;
  const use = globalThis.window?.claude?.use;
  if (typeof use === 'function') {
    try {
      remote = await use.call(window.claude, 'db');
    } catch {
      remote = null;
    }
  }
  if (remote) {
    try {
      const [meta, list] = await Promise.all([remote.doc('meta/main').get(), remote.collection('bookings').limit(1000).get()]);
      const m = meta.exists ? meta.data() : {};
      data = {
        nextNumber: Number(m.nextNumber) || 1001,
        settings: { ...(m.settings || {}) },
        bookings: list.docs.map((d) => structuredClone(d.data())),
      };
      return 'account';
    } catch {
      remote = null;
    }
  }
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (raw) data = { ...data, ...JSON.parse(raw) };
  } catch { /* storage blocked: start empty */ }
  try { navigator.storage?.persist?.(); } catch { /* not supported */ }
  return 'phone';
}

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);

// ---------- API used by the app ----------
export const getSettings = () => ({ ...DEFAULT_SETTINGS, ...data.settings });

export function saveSettings(patch) {
  for (const k of Object.keys(DEFAULT_SETTINGS)) if (k in patch) data.settings[k] = String(patch[k] ?? '');
  persistMeta();
  return getSettings();
}

export const listBookings = () => data.bookings.slice();
export const getBooking = (id) => data.bookings.find((b) => b.id === id) || null;

export function createBooking(fields) {
  const now = new Date().toISOString();
  const b = {
    customer: {}, trip: {}, pricing: {}, status: 'booked', ...fields,
    id: uid(),
    number: `${getSettings().numberPrefix}${data.nextNumber++}`,
    createdAt: now, updatedAt: now, sent: [],
  };
  data.bookings.push(b);
  persistMeta();
  persistBooking(b);
  return b;
}

export function updateBooking(id, patch) {
  const b = getBooking(id);
  if (!b) return null;
  Object.assign(b, patch, { updatedAt: new Date().toISOString() });
  persistBooking(b);
  return b;
}

export function logSend(id, channel, to) {
  const b = getBooking(id);
  if (!b) return;
  b.sent = [...(b.sent || []), { channel, to, at: new Date().toISOString() }];
  persistBooking(b);
}

export function deleteBooking(id) {
  data.bookings = data.bookings.filter((b) => b.id !== id);
  removeRemote(id);
}

export const exportBackup = () => JSON.stringify({ app: 'black-car-reservations', exportedAt: new Date().toISOString(), ...data }, null, 2);

export function importBackup(text) {
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed.bookings)) throw new Error('This file is not a reservations backup.');
  const old = data.bookings.map((b) => b.id);
  data = { nextNumber: Number(parsed.nextNumber) || 1001, bookings: parsed.bookings, settings: parsed.settings || {} };
  if (remote) {
    old.filter((id) => !data.bookings.some((b) => b.id === id)).forEach(removeRemote);
    data.bookings.forEach(persistBooking);
  }
  persistMeta();
  return data.bookings.length;
}
