import { computeTotals, money } from './pricing.js';
import {
  esc, renderInvoiceHTML, renderInvoiceText, fillTemplate, customerName, formatDate, formatTime,
  paymentStatus, STATUS_LABELS, SERVICE_LABELS, TRIP_LABELS,
} from './invoice.js';
import * as db from './store.js';
import { buildInvoicePDF, invoiceFileName } from './pdf.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const view = $('#view');
const dialog = $('#dialog');

const state = { path: '/', query: '', where: 'phone', settings: null, bookings: [], listTab: 'upcoming', search: '' };
const inClaude = typeof window.claude?.use === 'function';

// ---------- utilities ----------
const withTotals = (b) => b && { ...b, totals: computeTotals(b.pricing) };
const loadBookings = () => (state.bookings = db.listBookings().map(withTotals));
const findBooking = (id) => {
  const b = withTotals(db.getBooking(id));
  if (!b) throw new Error('Booking not found');
  return b;
};

// In-page yes/no dialog. Resolves true when the action button is tapped.
function ask(message, action) {
  return new Promise((resolve) => {
    dialog.innerHTML = `
    <form method="dialog" id="askForm">
      <h3>${esc(message)}</h3>
      <div class="btn-row"><button class="btn" value="no">Keep</button><button class="btn primary danger-fill" value="yes" style="flex:1">${esc(action)}</button></div>
    </form>`;
    dialog.onclose = () => { dialog.onclose = null; resolve(dialog.returnValue === 'yes'); };
    dialog.returnValue = '';
    dialog.showModal();
  });
}

let toastTimer;
function toast(msg, isError = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `show${isError ? ' error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = ''), 3200);
}

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const splitList = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);

// Turn form fields named "customer.firstName" into { customer: { firstName } }.
function readForm(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if ((el.type === 'radio' || el.type === 'checkbox') && !el.checked) continue;
    const [group, key] = el.name.split('.');
    if (key) (out[group] ||= {})[key] = el.value.trim();
    else out[group] = el.value.trim();
  }
  return out;
}

function setActiveNav(name) {
  $$('.topbar nav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === name));
}

const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// ---------- router ----------
function route() {
  const [hash, query] = state.path.split('?');
  state.query = query || '';
  const [, page, id] = hash.split('/');
  window.scrollTo(0, 0);
  try {
    state.settings = db.getSettings();
    $('#brand').textContent = state.settings.businessName || 'RESERVATIONS';
    document.title = `${state.settings.businessName || 'Black Car'} · Reservations`;

    if (!page) return renderList();
    if (page === 'new') {
      loadBookings();
      return renderForm(null, id);
    }
    if (page === 'edit') return renderForm(findBooking(id));
    if (page === 'b') return renderDetail(findBooking(id));
    if (page === 'settings') return renderSettings();
    go('/');
  } catch (err) {
    view.innerHTML = `<div class="card empty"><p>${esc(err.message)}</p><a class="btn" href="#/">Back to bookings</a></div>`;
  }
}
// Navigation stays inside the page (an artifact frame doesn't allow changing the address).
function go(path) {
  state.path = path;
  route();
}
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="#/"]');
  if (!a) return;
  e.preventDefault();
  go(a.getAttribute('href').slice(1));
});

// ---------- bookings list ----------
function renderList() {
  setActiveNav('list');
  loadBookings();
  view.innerHTML = `
  <div class="btn-row" style="margin-bottom:14px">
    <a href="#/new" class="btn primary block" style="font-size:17px;min-height:56px">+ New booking</a>
  </div>
  <div class="stats" id="stats"></div>
  <div class="toolbar">
    <input type="search" id="search" placeholder="Search name, phone, #, address…" value="${esc(state.search)}">
  </div>
  <div class="tabs" role="tablist">
    ${[['upcoming', 'Upcoming'], ['today', 'Today'], ['unpaid', 'Balance due'], ['all', 'All']]
      .map(([k, l]) => `<button role="tab" data-tab="${k}" class="${state.listTab === k ? 'active' : ''}">${l}</button>`).join('')}
  </div>
  <div id="items"></div>`;

  const b = state.bookings.filter((x) => x.status !== 'cancelled');
  const today = todayISO();
  const outstanding = b.reduce((s, x) => s + Math.max(x.totals.balance, 0), 0);
  const monthPrefix = today.slice(0, 7);
  const monthRevenue = b.filter((x) => (x.trip?.pickupDate || x.createdAt).startsWith(monthPrefix)).reduce((s, x) => s + x.totals.total, 0);
  $('#stats').innerHTML = `
    <div class="stat"><b>${b.filter((x) => x.trip?.pickupDate === today).length}</b><span>Rides today</span></div>
    <div class="stat"><b>${money(monthRevenue)}</b><span>Booked this month</span></div>
    <div class="stat"><b>${money(outstanding)}</b><span>Outstanding</span></div>`;

  $('#search').oninput = (e) => { state.search = e.target.value; drawItems(); };
  $$('.tabs button').forEach((btn) => (btn.onclick = () => {
    state.listTab = btn.dataset.tab;
    $$('.tabs button').forEach((x) => x.classList.toggle('active', x === btn));
    drawItems();
  }));
  drawItems();
}

function drawItems() {
  const today = todayISO();
  const q = state.search.toLowerCase().trim();
  let items = state.bookings.slice();
  const tab = state.listTab;
  if (tab === 'upcoming') items = items.filter((b) => b.status === 'booked' && (b.trip?.pickupDate || today) >= today);
  if (tab === 'today') items = items.filter((b) => b.trip?.pickupDate === today);
  if (tab === 'unpaid') items = items.filter((b) => b.status !== 'cancelled' && b.totals.balance > 0);
  if (q) {
    items = items.filter((b) => [b.number, customerName(b), b.customer?.phone, b.customer?.email, b.customer?.company, b.trip?.pickup, b.trip?.dropoff]
      .join(' ').toLowerCase().includes(q));
  }
  const key = (b) => `${b.trip?.pickupDate || ''}T${b.trip?.pickupTime || ''}`;
  items.sort((a, b) => (tab === 'all' || tab === 'unpaid' ? key(b).localeCompare(key(a)) : key(a).localeCompare(key(b))));

  $('#items').innerHTML = items.length
    ? items.map((b) => {
      const ps = paymentStatus(b);
      const badge = b.status === 'completed' && ps === 'paid' ? 'completed' : ps;
      return `
      <a class="booking-item" href="#/b/${b.id}">
        <div><div class="who">${esc(customerName(b))}</div>
          <div class="when">#${esc(b.number)} · ${esc(formatDate(b.trip?.pickupDate))} ${esc(formatTime(b.trip?.pickupTime))}</div></div>
        <div><div class="amt">${money(b.totals.total)}</div>
          <span class="badge ${badge}">${b.status === 'completed' && ps === 'paid' ? 'Completed' : STATUS_LABELS[ps]}</span></div>
        <div class="route">${esc(b.trip?.pickup || '—')} → ${esc(b.trip?.dropoff || '—')}</div>
      </a>`;
    }).join('')
    : `<div class="empty">No bookings here yet.<br><br><a href="#/new" class="btn primary">+ New booking</a></div>`;
}

// ---------- booking form ----------
function renderForm(booking, duplicateFromId) {
  setActiveNav('list');
  const s = state.settings;
  let b = booking;
  if (!b && duplicateFromId) {
    const src = state.bookings.find((x) => x.id === duplicateFromId);
    if (src) b = { customer: { ...src.customer }, trip: { ...src.trip, pickupDate: todayISO(), pickupTime: '', returnDate: '', returnTime: '' }, pricing: { ...src.pricing, amountPaid: '', paymentMethod: '' } };
  }
  const isNew = !booking;
  b = b || {
    customer: {},
    trip: { serviceType: 'p2p', tripType: 'oneway', pickupDate: todayISO(), passengers: '1' },
    pricing: { rateType: 'flat', gratuityPct: s.defaultGratuityPct, taxPct: s.defaultTaxPct },
  };
  const c = b.customer || {}, t = b.trip || {}, p = b.pricing || {};
  const v = (x) => esc(x ?? '');
  const chips = (name, options, current) => `<div class="chips">${Object.entries(options).map(([val, label]) =>
    `<label><input type="radio" name="${name}" value="${val}" ${current === val ? 'checked' : ''}><span>${label}</span></label>`).join('')}</div>`;
  const moneyField = (name, label, val, cls = '') => `<label class="money ${cls}">${label}<input name="pricing.${name}" type="number" inputmode="decimal" step="0.01" min="0" value="${v(val)}" placeholder="0.00"></label>`;

  // Unique past customers for quick fill.
  const seen = new Map();
  for (const x of state.bookings) {
    const k = (x.customer?.phone || x.customer?.email || customerName(x)).toLowerCase();
    if (k && !seen.has(k)) seen.set(k, x.customer);
  }
  const pastCustomers = [...seen.values()];

  view.innerHTML = `
  <h1>${isNew ? 'New booking' : `Edit #${esc(booking.number)}`}</h1>
  <form id="bookingForm" autocomplete="off" novalidate>
    <section class="card">
      <h2>Customer</h2>
      ${isNew && pastCustomers.length ? `
      <label style="margin-bottom:12px">Returning customer?
        <input list="pastCustomers" id="pastCustomer" placeholder="Start typing a name or phone">
        <datalist id="pastCustomers">${pastCustomers.map((pc, i) => `<option value="${esc([pc.firstName, pc.lastName].filter(Boolean).join(' '))} · ${esc(pc.phone || pc.email || '')}" data-i="${i}"></option>`).join('')}</datalist>
      </label>` : ''}
      <div class="grid">
        <label class="req">First name<input name="customer.firstName" value="${v(c.firstName)}" autocomplete="given-name" required></label>
        <label>Last name<input name="customer.lastName" value="${v(c.lastName)}" autocomplete="family-name"></label>
        <label class="span-m">Mobile phone<input name="customer.phone" type="tel" inputmode="tel" value="${v(c.phone)}" autocomplete="tel" placeholder="(555) 555-5555"></label>
        <label class="span-m">Email<input name="customer.email" type="email" inputmode="email" value="${v(c.email)}" autocomplete="email" placeholder="name@example.com"></label>
        <label class="span-all">Company / account<input name="customer.company" value="${v(c.company)}"></label>
      </div>
      <p class="hint">Phone or email is needed to send the invoice.</p>
    </section>

    <section class="card">
      <h2>Service</h2>
      <div style="display:grid;gap:12px">
        ${chips('trip.serviceType', SERVICE_LABELS, t.serviceType)}
        ${chips('trip.tripType', TRIP_LABELS, t.tripType)}
      </div>
    </section>

    <section class="card">
      <h2>Schedule &amp; route</h2>
      <div class="grid">
        <label class="req">Pickup date<input name="trip.pickupDate" type="date" value="${v(t.pickupDate)}" required></label>
        <label>Pickup time<input name="trip.pickupTime" type="time" value="${v(t.pickupTime)}"></label>
        <label class="span-all">Pickup address<input name="trip.pickup" value="${v(t.pickup)}" placeholder="Address, hotel or airport"></label>
        <label class="span-all">Extra stops<input name="trip.stops" value="${v(t.stops)}" placeholder="Optional"></label>
        <label class="span-all">Drop-off address<input name="trip.dropoff" value="${v(t.dropoff)}"></label>
        <label data-show="roundtrip">Return date<input name="trip.returnDate" type="date" value="${v(t.returnDate)}"></label>
        <label data-show="roundtrip">Return time<input name="trip.returnTime" type="time" value="${v(t.returnTime)}"></label>
        <label>Passengers<input name="trip.passengers" type="number" inputmode="numeric" min="1" value="${v(t.passengers)}"></label>
        <label>Luggage<input name="trip.luggage" type="number" inputmode="numeric" min="0" value="${v(t.luggage)}"></label>
      </div>
    </section>

    <section class="card" data-show="airport">
      <h2>Flight</h2>
      <div class="grid">
        <label>Airline<input name="trip.airline" value="${v(t.airline)}"></label>
        <label>Flight #<input name="trip.flightNumber" value="${v(t.flightNumber)}" style="text-transform:uppercase"></label>
        <label>Terminal<input name="trip.terminal" value="${v(t.terminal)}"></label>
        <label>Arrival / departure<input name="trip.flightTime" type="time" value="${v(t.flightTime)}"></label>
      </div>
    </section>

    <section class="card">
      <h2>Vehicle &amp; chauffeur</h2>
      <div class="grid">
        <label>Vehicle<input name="trip.vehicle" list="vehicles" value="${v(t.vehicle)}">
          <datalist id="vehicles">${splitList(s.vehicles).map((x) => `<option value="${esc(x)}">`).join('')}</datalist></label>
        <label>Plate<input name="trip.plate" value="${v(t.plate)}" style="text-transform:uppercase"></label>
        <label class="span-all">Chauffeur<input name="trip.driver" list="drivers" value="${v(t.driver)}">
          <datalist id="drivers">${splitList(s.drivers).map((x) => `<option value="${esc(x)}">`).join('')}</datalist></label>
        <label class="span-all">Notes / special requests<textarea name="trip.notes">${v(t.notes)}</textarea></label>
      </div>
    </section>

    <section class="card">
      <h2>Pricing</h2>
      ${chips('pricing.rateType', { flat: 'Flat rate', hourly: 'Hourly' }, p.rateType || 'flat')}
      <div class="grid" style="margin-top:12px">
        <div class="span-all" data-show="flat">${moneyField('baseFare', 'Base fare', p.baseFare)}</div>
        <div data-show="hourly">${moneyField('hourlyRate', 'Hourly rate', p.hourlyRate)}</div>
        <label data-show="hourly">Hours<input name="pricing.hours" type="number" inputmode="decimal" step="0.5" min="0" value="${v(p.hours)}"></label>
        ${moneyField('extraStops', 'Extra stops', p.extraStops)}
        ${moneyField('waiting', 'Waiting time', p.waiting)}
        ${moneyField('tolls', 'Tolls', p.tolls)}
        ${moneyField('parking', 'Parking', p.parking)}
        ${moneyField('meetGreet', 'Meet &amp; greet', p.meetGreet)}
        ${moneyField('childSeat', 'Child seat', p.childSeat)}
        <label>Other charge label<input name="pricing.additionalLabel" value="${v(p.additionalLabel)}" placeholder="e.g. Fuel surcharge"></label>
        ${moneyField('additional', 'Other charge', p.additional)}
        ${moneyField('discount', 'Discount', p.discount)}
        <label class="pct">Gratuity<input name="pricing.gratuityPct" type="number" inputmode="decimal" step="0.5" min="0" value="${v(p.gratuityPct)}"></label>
        <label class="pct">Tax<input name="pricing.taxPct" type="number" inputmode="decimal" step="0.01" min="0" value="${v(p.taxPct)}"></label>
      </div>
      <table class="breakdown" id="breakdown" style="margin-top:14px"></table>
    </section>

    <section class="card">
      <h2>Payment received</h2>
      <div class="grid">
        ${moneyField('amountPaid', 'Amount paid / deposit', p.amountPaid)}
        <label>Method<select name="pricing.paymentMethod">
          ${['', ...db.PAYMENT_METHODS].map((m) => `<option ${p.paymentMethod === m ? 'selected' : ''} value="${m}">${m || '—'}</option>`).join('')}
        </select></label>
      </div>
    </section>

    ${!isNew ? `<button type="button" class="btn block" id="cancelEdit">Discard changes</button>` : ''}
  </form>
  <div class="totalbar">
    <div><small>Total</small><span class="amt" id="barTotal">$0.00</span></div>
    <button class="btn primary" form="bookingForm" type="submit" style="min-width:170px">${isNew ? 'Save &amp; invoice' : 'Save changes'}</button>
  </div>`;

  const form = $('#bookingForm');

  const sync = () => {
    const d = readForm(form);
    const svc = d.trip?.serviceType, trip = d.trip?.tripType, rate = d.pricing?.rateType;
    $$('[data-show]', form).forEach((el) => {
      const k = el.dataset.show;
      const show = (k === 'airport' && svc === 'airport') || (k === 'roundtrip' && trip === 'roundtrip') || (k === rate);
      el.hidden = !show;
    });
    const tt = computeTotals(d.pricing);
    $('#barTotal').textContent = money(tt.total);
    $('#breakdown').innerHTML = tt.lines.map((l) => `<tr><td>${esc(l.label)}</td><td>${money(l.amount)}</td></tr>`).join('')
      + (tt.discount ? `<tr><td>Discount</td><td>-${money(tt.discount)}</td></tr>` : '')
      + (tt.gratuity ? `<tr><td>Gratuity (${tt.gratuityPct}%)</td><td>${money(tt.gratuity)}</td></tr>` : '')
      + (tt.tax ? `<tr><td>Tax (${tt.taxPct}%)</td><td>${money(tt.tax)}</td></tr>` : '')
      + `<tr class="total"><td>Total</td><td>${money(tt.total)}</td></tr>`
      + (tt.paid ? `<tr><td>Balance due</td><td>${money(Math.max(tt.balance, 0))}</td></tr>` : '');
  };

  form.addEventListener('input', sync);
  form.addEventListener('change', (e) => {
    // Hourly charters default to hourly pricing.
    if (e.target.name === 'trip.serviceType') {
      const rate = e.target.value === 'hourly' ? 'hourly' : 'flat';
      const r = form.querySelector(`input[name="pricing.rateType"][value="${rate}"]`);
      if (r) r.checked = true;
    }
    sync();
  });
  sync();

  const past = $('#pastCustomer');
  if (past) past.onchange = () => {
    const opt = $$('#pastCustomers option').find((o) => o.value === past.value);
    if (!opt) return;
    const pc = pastCustomers[Number(opt.dataset.i)];
    for (const k of ['firstName', 'lastName', 'phone', 'email', 'company']) form.elements[`customer.${k}`].value = pc[k] || '';
    toast(`Filled in ${[pc.firstName, pc.lastName].filter(Boolean).join(' ')}`);
  };

  const cancel = $('#cancelEdit');
  if (cancel) cancel.onclick = () => go(`/b/${booking.id}`);

  form.onsubmit = async (e) => {
    e.preventDefault();
    const d = readForm(form);
    if (!d.customer.firstName) { form.elements['customer.firstName'].focus(); return toast('Customer first name is required', true); }
    if (!d.trip.pickupDate) { form.elements['trip.pickupDate'].focus(); return toast('Pickup date is required', true); }
    if (d.customer.email && !/^\S+@\S+\.\S+$/.test(d.customer.email)) { form.elements['customer.email'].focus(); return toast('Email address looks incorrect', true); }
    d.trip.flightNumber = (d.trip.flightNumber || '').toUpperCase();
    d.trip.plate = (d.trip.plate || '').toUpperCase();
    const btn = $('.totalbar .btn');
    btn.disabled = true;
    try {
      const saved = isNew
        ? db.createBooking({ ...d, status: 'booked' })
        : db.updateBooking(booking.id, d);
      toast(isNew ? `Booking #${saved.number} saved` : 'Changes saved');
      go(`/b/${saved.id}${isNew ? '?send=1' : ''}`);
    } catch (err) {
      btn.disabled = false;
      toast(err.message, true);
    }
  };
}

// ---------- booking detail / invoice ----------
function renderDetail(b) {
  setActiveNav('list');
  const s = state.settings;
  const t = b.totals;
  const sent = b.sent || [];
  const ps = paymentStatus(b);
  view.innerHTML = `
  <div class="no-print">
    <div class="btn-row" style="justify-content:space-between;align-items:center;margin-bottom:10px">
      <a href="#/" class="btn">← Bookings</a>
      <span class="badge ${ps}">${b.status === 'completed' ? 'Completed · ' : ''}${STATUS_LABELS[ps]}</span>
    </div>
    <section class="card">
      <h2>Send invoice to ${esc(customerName(b))}</h2>
      <div class="btn-grid">
        <button class="btn primary" id="sendSms" ${b.customer?.phone ? '' : 'disabled'}>💬 Text invoice</button>
        <button class="btn primary" id="sendEmail" ${b.customer?.email ? '' : 'disabled'}>✉️ Email invoice</button>
      </div>
      ${!b.customer?.phone && !b.customer?.email ? `<p class="hint warn">Add a phone or email to this booking to send the invoice.</p>` : ''}
      ${sent.length ? `<p class="hint">Sent:</p><ul class="sent-log">${sent.slice().reverse().map((x) =>
        `<li>${x.channel === 'sms' ? 'Text' : 'Email'} to ${esc(x.to)} · ${new Date(x.at).toLocaleString()}</li>`).join('')}</ul>` : ''}
    </section>
    <div class="btn-grid" style="margin-bottom:14px">
      ${t.balance > 0 && b.status !== 'cancelled' ? `<button class="btn" id="recordPay">💵 Mark paid</button>` : ''}
      <a class="btn" href="#/edit/${b.id}">✏️ Edit</a>
      <button class="btn" id="pdfBtn">📄 PDF invoice</button>
      ${b.status === 'booked' ? `<button class="btn" id="complete">✅ Mark completed</button>` : ''}
      <a class="btn" href="#/new/${b.id}">⧉ Book again</a>
      ${b.status !== 'cancelled' ? `<button class="btn danger" id="cancelBooking">Cancel ride</button>` : `<button class="btn" id="reinstate">Reinstate</button>`}
      <button class="btn danger" id="delete">Delete</button>
    </div>
  </div>
  <div class="invoice-frame">${renderInvoiceHTML(b, s)}</div>`;

  $('#pdfBtn').onclick = () => savePDF(b);
  const setStatus = (status, msg) => () => {
    db.updateBooking(b.id, { status });
    toast(msg);
    route();
  };
  if ($('#complete')) $('#complete').onclick = setStatus('completed', 'Marked completed');
  if ($('#reinstate')) $('#reinstate').onclick = setStatus('booked', 'Booking reinstated');
  if ($('#cancelBooking')) $('#cancelBooking').onclick = async () => { if (await ask('Cancel this ride?', 'Cancel ride')) setStatus('cancelled', 'Ride cancelled')(); };
  $('#delete').onclick = async () => {
    if (!(await ask(`Delete booking #${b.number}? This can't be undone.`, 'Delete'))) return;
    db.deleteBooking(b.id);
    toast('Booking deleted');
    go('/');
  };
  if ($('#recordPay')) $('#recordPay').onclick = () => openPaymentDialog(b, t);
  $('#sendSms').onclick = () => openSendDialog(b, 'sms');
  $('#sendEmail').onclick = () => openSendDialog(b, 'email');

  // Right after a new booking is saved, jump straight to sending it.
  if (state.query === 'send=1') {
    state.path = `/b/${b.id}`;
    if (b.customer?.phone) openSendDialog(b, 'sms');
    else if (b.customer?.email) openSendDialog(b, 'email');
  }
}

function openPaymentDialog(b, t) {
  dialog.innerHTML = `
  <form method="dialog" id="payForm">
    <h3>Payment received</h3>
    <label class="money">Amount<input name="amount" type="number" inputmode="decimal" step="0.01" min="0.01" value="${Math.max(t.balance, 0).toFixed(2)}" required></label>
    <div class="chips">${db.PAYMENT_METHODS.map((m, i) =>
      `<label><input type="radio" name="method" value="${m}" ${(b.pricing?.paymentMethod ? b.pricing.paymentMethod === m : i === 0) ? 'checked' : ''}><span>${m}</span></label>`).join('')}</div>
    <div class="btn-row"><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn primary" value="ok" style="flex:1">Save</button></div>
  </form>`;
  dialog.showModal();
  $('#payForm').onsubmit = (e) => {
    if (e.submitter?.value !== 'ok') return;
    e.preventDefault();
    const amount = parseFloat(e.target.amount.value) || 0;
    const paid = Math.round(((parseFloat(b.pricing?.amountPaid) || 0) + amount) * 100) / 100;
    db.updateBooking(b.id, { pricing: { ...b.pricing, amountPaid: String(paid), paymentMethod: e.target.method.value } });
    dialog.close();
    toast(`${money(amount)} ${e.target.method.value} payment saved`);
    route();
  };
}

// Hands the PDF to the phone's share sheet (Messages, Mail, WhatsApp...). Inside Claude, where sharing
// is blocked, it saves the PDF to the phone instead so it can be attached. Returns true when handed off.
async function sharePDF(b, intro) {
  const s = state.settings;
  const name = invoiceFileName(b);
  const blob = buildInvoicePDF(b, s);
  const file = new File([blob], name, { type: 'application/pdf' });

  if (!inClaude && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: `Invoice #${b.number}`, text: intro });
      return true;
    } catch (err) {
      if (err.name === 'AbortError') return false;
    }
  }
  if (inClaude) {
    const downloads = await window.claude.use('downloads').catch(() => null);
    if (!downloads) { toast('Saving files is not available here. Use the text option.', true); return false; }
    try {
      await downloads.save({ filename: name, data: blob });
      toast('PDF saved. Attach it to your message from Files.');
      return true;
    } catch (err) {
      if (err?.code !== 'declined') toast('Could not save the PDF.', true);
      return false;
    }
  }
  // Computers without a share sheet: download the file.
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('PDF downloaded.');
  return true;
}

function openSendDialog(b, channel) {
  const s = state.settings;
  const isSms = channel === 'sms';
  const to = (isSms ? b.customer?.phone : b.customer?.email) || '';
  const intro = fillTemplate(isSms ? s.smsMessage : s.emailMessage, b, s);
  const message = `${intro ? `${intro}\n\n` : ''}${renderInvoiceText(b, s)}`;
  const subject = fillTemplate(s.emailSubject, b, s);
  const app = isSms ? 'Messages' : 'Mail';

  dialog.innerHTML = `
  <form method="dialog" id="sendForm">
    <h3>${isSms ? 'Text' : 'Email'} invoice #${esc(b.number)}</h3>
    <div class="send-to">
      <div><small>${isSms ? 'Send to' : 'Email to'}</small><b id="sendTo">${esc(to || '—')}</b></div>
      ${to ? `<button type="button" class="btn" id="copyTo">Copy</button>` : ''}
    </div>
    <button type="button" class="btn primary block" id="sendPdf" style="min-height:56px;font-size:17px">📄 Send PDF invoice</button>
    <p class="hint" style="margin:0">${inClaude
      ? `Saves the PDF to your phone. Then open ${app}, start a message to ${esc(to || 'the customer')} and attach the PDF from Files. Installed on your home screen, the app sends the PDF straight to ${app}.`
      : `Opens your share menu. Choose <b>${app}</b>, then pick ${esc(to || 'the customer')} as the recipient.`}</p>
    <details>
      <summary>Send as a plain text message instead</summary>
      ${isSms ? '' : `<label>Subject<input id="sendSubject" name="subject" value="${esc(subject)}"></label>`}
      <label>Message<textarea id="sendMessage" name="message" rows="8">${esc(message)}</textarea></label>
      <div class="btn-grid">
        <button type="button" class="btn" id="copyMsg">📋 Copy text</button>
        <a class="btn" id="openApp" href="#">Open ${app}</a>
      </div>
    </details>
    <button class="btn block" value="close">Done</button>
  </form>`;

  const f = $('#sendForm');
  const link = $('#openApp');
  const refreshLink = () => {
    const body = encodeURIComponent(f.message.value);
    link.href = isSms
      ? `sms:${to.replace(/[^\d+]/g, '')}${isIOS ? '&' : '?'}body=${body}`
      : `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(f.subject.value)}&body=${body}`;
  };
  f.addEventListener('input', refreshLink);
  refreshLink();

  let logged = false;
  const markSent = () => {
    if (logged) return;
    logged = true;
    db.logSend(b.id, channel, to || '(not entered)');
  };
  const copy = async (text, done) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(done);
      return true;
    } catch {
      toast('Could not copy. Press and hold to select the text instead.', true);
      return false;
    }
  };

  if ($('#copyTo')) $('#copyTo').onclick = () => copy(to, `${isSms ? 'Number' : 'Email address'} copied`);
  $('#sendPdf').onclick = async (e) => {
    e.currentTarget.disabled = true;
    try {
      if (await sharePDF(b, intro)) markSent();
    } catch (err) {
      toast(err.message, true);
    } finally {
      e.currentTarget.disabled = false;
    }
  };
  $('#copyMsg').onclick = async () => {
    const text = isSms ? f.message.value : `Subject: ${f.subject.value}\n\n${f.message.value}`;
    if (await copy(text, `Text copied. Paste it into ${app}.`)) markSent();
  };
  link.onclick = () => markSent();

  dialog.onclose = () => { dialog.onclose = null; if (logged) route(); };
  dialog.showModal();
}

// Download button on the booking screen.
async function savePDF(b) {
  try {
    await sharePDF(b, '');
  } catch (err) {
    toast(err.message, true);
  }
}

// ---------- settings ----------
function renderSettings() {
  setActiveNav('settings');
  const s = state.settings;
  const v = (k) => esc(s[k] ?? '');
  view.innerHTML = `
  <h1>Settings</h1>
  <form id="settingsForm">
    <section class="card">
      <h2>Business (shown on invoices)</h2>
      <div class="grid">
        <label class="span-all">Business name<input name="businessName" value="${v('businessName')}"></label>
        <label>Owner / contact<input name="ownerName" value="${v('ownerName')}"></label>
        <label>Phone<input name="phone" type="tel" value="${v('phone')}"></label>
        <label>Email<input name="email" type="email" value="${v('email')}"></label>
        <label>Website<input name="website" value="${v('website')}"></label>
        <label class="span-all">Address<input name="address" value="${v('address')}"></label>
      </div>
    </section>
    <section class="card">
      <h2>Payment options (shown on invoices)</h2>
      <p class="hint" style="margin:0 0 10px">Invoices list Venmo, Zelle, Cash App, Apple Pay and Cash. Add your details so customers know where to send payment.</p>
      <div class="grid">
        <label>Venmo username<input name="venmo" value="${v('venmo')}" placeholder="@your-venmo" autocapitalize="off"></label>
        <label>Zelle phone or email<input name="zelle" value="${v('zelle')}" placeholder="832-844-8660" autocapitalize="off"></label>
        <label>Cash App $cashtag<input name="cashApp" value="${v('cashApp')}" placeholder="$yourcashtag" autocapitalize="off"></label>
        <label>Apple Pay phone number<input name="applePay" value="${v('applePay')}" type="tel" placeholder="832-844-8660"></label>
      </div>
    </section>
    <section class="card">
      <h2>Defaults</h2>
      <div class="grid">
        <label class="pct">Default gratuity<input name="defaultGratuityPct" type="number" step="0.5" min="0" value="${v('defaultGratuityPct')}"></label>
        <label class="pct">Default tax<input name="defaultTaxPct" type="number" step="0.01" min="0" value="${v('defaultTaxPct')}"></label>
        <label>Invoice number prefix<input name="numberPrefix" value="${v('numberPrefix')}"></label>
        <label class="span-all">Vehicles (comma separated)<input name="vehicles" value="${v('vehicles')}"></label>
        <label class="span-all">Chauffeurs (comma separated)<input name="drivers" value="${v('drivers')}"></label>
        <label class="span-all">Invoice terms<textarea name="invoiceTerms">${v('invoiceTerms')}</textarea></label>
      </div>
    </section>
    <section class="card">
      <h2>Message greeting</h2>
      <p class="hint" style="margin:0 0 10px">Goes above the invoice. Placeholders: {firstName} {name} {number} {business} {phone} {total} {balance} {pickupDate} {pickupTime}</p>
      <div class="grid">
        <label class="span-all">Text message<textarea name="smsMessage" rows="3">${v('smsMessage')}</textarea></label>
        <label class="span-all">Email subject<input name="emailSubject" value="${v('emailSubject')}"></label>
        <label class="span-all">Email message<textarea name="emailMessage" rows="3">${v('emailMessage')}</textarea></label>
      </div>
    </section>
    <button class="btn primary block">Save settings</button>
  </form>
  ${state.where === 'account' ? `
  <section class="card" style="margin-top:14px">
    <h2>Where bookings are saved</h2>
    <p class="hint" style="margin:0">Privately in your Claude account. Only you can see them, and they are there on any phone where you open this page signed in.</p>
  </section>` : `
  <section class="card" style="margin-top:14px">
    <h2>Backup</h2>
    <p class="hint" style="margin:0 0 10px">Bookings are saved only on this phone. Export a backup now and then (save it to Files, iCloud or Google Drive) so you don't lose them if the phone is lost or the browser data is cleared.</p>
    <div class="btn-grid">
      <button class="btn" id="exportBtn">⬇️ Export backup</button>
      <button class="btn" id="importBtn">⬆️ Restore backup</button>
    </div>
    <input type="file" id="importFile" accept="application/json,.json" hidden>
  </section>`}`;

  $('#settingsForm').onsubmit = (e) => {
    e.preventDefault();
    state.settings = db.saveSettings(readForm(e.target));
    $('#brand').textContent = state.settings.businessName || 'RESERVATIONS';
    toast('Settings saved');
  };
  if ($('#exportBtn')) $('#exportBtn').onclick = async () => {
    const name = `reservations-backup-${todayISO()}.json`;
    const file = new File([db.exportBackup()], name, { type: 'application/json' });
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return; } catch (err) { if (err.name === 'AbortError') return; }
    }
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(file), download: name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  if ($('#importBtn')) $('#importBtn').onclick = () => $('#importFile').click();
  if ($('#importFile')) $('#importFile').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (!(await ask('Restoring replaces all bookings and settings with the ones in the backup file.', 'Restore'))) { e.target.value = ''; return; }
    try {
      const n = db.importBackup(await f.text());
      toast(`Restored ${n} booking${n === 1 ? '' : 's'}`);
      route();
    } catch (err) { toast(err.message, true); }
  };
}

// Close dialogs by tapping the backdrop.
dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });

if (!inClaude && 'serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./sw.js').catch(() => {});

view.innerHTML = '<div class="empty">Loading bookings…</div>';
db.init({ onSaveError: (msg) => toast(msg, true) }).then((where) => {
  state.where = where;
  route();
});
