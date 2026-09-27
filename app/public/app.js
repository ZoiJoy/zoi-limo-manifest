import { computeTotals, money } from './pricing.js';
import {
  esc, renderInvoiceHTML, renderInvoiceText, fillTemplate, customerName, formatDate, formatTime,
  paymentStatus, STATUS_LABELS, SERVICE_LABELS, TRIP_LABELS,
} from './invoice.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const view = $('#view');
const dialog = $('#dialog');

const state = { config: null, settings: null, bookings: [], listTab: 'upcoming', search: '' };

// ---------- utilities ----------
async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/api/login') { renderLogin(); throw new Error('Login required'); }
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { data, status: res.status });
  return data;
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
async function route() {
  const hash = (location.hash.slice(1) || '/').split('?')[0];
  const [, page, id] = hash.split('/');
  window.scrollTo(0, 0);
  try {
    if (!state.config) state.config = await api('/api/config');
    if (state.config.authRequired && !state.config.authed) return renderLogin();
    if (!state.settings) state.settings = await api('/api/settings');
    $('#brand').textContent = state.settings.businessName || 'RESERVATIONS';
    document.title = `${state.settings.businessName || 'Black Car'} · Reservations`;

    if (!page) return await renderList();
    if (page === 'new') {
      state.bookings = await api('/api/bookings');
      return renderForm(null, id);
    }
    if (page === 'edit') return renderForm(await api(`/api/bookings/${id}`));
    if (page === 'b') return renderDetail(await api(`/api/bookings/${id}`));
    if (page === 'settings') return renderSettings();
    location.hash = '#/';
  } catch (err) {
    if (err.message !== 'Login required') {
      view.innerHTML = `<div class="card empty"><p>${esc(err.message)}</p><a class="btn" href="#/">Back to bookings</a></div>`;
    }
  }
}
window.addEventListener('hashchange', route);

// ---------- login ----------
function renderLogin() {
  setActiveNav('');
  view.innerHTML = `
  <form class="card login" id="loginForm">
    <h1>Sign in</h1>
    <label>Password <input type="password" name="password" autocomplete="current-password" required autofocus></label>
    <p></p>
    <button class="btn primary block">Sign in</button>
  </form>`;
  $('#loginForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('/api/login', { method: 'POST', body: { password: e.target.password.value } });
      state.config = null;
      route();
    } catch (err) { toast(err.message, true); }
  };
}

// ---------- bookings list ----------
async function renderList() {
  setActiveNav('list');
  state.bookings = await api('/api/bookings');
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
          ${['', 'Cash', 'Credit card', 'Zelle', 'Cash App', 'Venmo', 'Corporate account', 'Check'].map((m) => `<option ${p.paymentMethod === m ? 'selected' : ''} value="${m}">${m || '—'}</option>`).join('')}
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
  if (cancel) cancel.onclick = () => (location.hash = `#/b/${booking.id}`);

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
        ? await api('/api/bookings', { method: 'POST', body: { ...d, status: 'booked' } })
        : await api(`/api/bookings/${booking.id}`, { method: 'PUT', body: d });
      toast(isNew ? `Booking #${saved.number} saved` : 'Changes saved');
      location.hash = `#/b/${saved.id}${isNew ? '?send=1' : ''}`;
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
  const t = computeTotals(b.pricing);
  const cfg = state.config;
  const sent = b.sent || [];
  view.innerHTML = `
  <div class="no-print">
    <div class="btn-row" style="justify-content:space-between;align-items:center;margin-bottom:10px">
      <a href="#/" class="btn">← Bookings</a>
      <span class="badge ${paymentStatus(b)}">${b.status === 'completed' ? 'Completed · ' : ''}${STATUS_LABELS[paymentStatus(b)]}</span>
    </div>
    <section class="card">
      <h2>Send invoice to ${esc(customerName(b))}</h2>
      <div class="btn-grid">
        <button class="btn primary" id="sendSms" ${b.customer?.phone ? '' : 'disabled'}>💬 Text invoice</button>
        <button class="btn primary" id="sendEmail" ${b.customer?.email ? '' : 'disabled'}>✉️ Email invoice</button>
      </div>
      ${!b.customer?.phone && !b.customer?.email ? `<p class="hint warn">Add a phone or email to this booking to send the invoice.</p>` : ''}
      ${sent.length ? `<p class="hint">Sent:</p><ul class="sent-log">${sent.slice().reverse().map((x) =>
        `<li>${x.channel === 'sms' ? 'Text' : 'Email'} to ${esc(x.to)} · ${new Date(x.at).toLocaleString()}${x.via === 'device' ? ' (from this device)' : ''}</li>`).join('')}</ul>` : ''}
    </section>
    <div class="btn-grid" style="margin-bottom:14px">
      ${t.balance > 0 && b.status !== 'cancelled' ? `<button class="btn" id="recordPay">💵 Record payment</button>` : ''}
      <a class="btn" href="#/edit/${b.id}">✏️ Edit</a>
      <button class="btn" id="print">🖨️ Print / PDF</button>
      <button class="btn" id="copyLink">🔗 Copy invoice link</button>
      ${b.status === 'booked' ? `<button class="btn" id="complete">✅ Mark completed</button>` : ''}
      <a class="btn" href="#/new/${b.id}">⧉ Book again</a>
      ${b.status !== 'cancelled' ? `<button class="btn danger" id="cancelBooking">Cancel ride</button>` : `<button class="btn" id="reinstate">Reinstate</button>`}
      <button class="btn danger" id="delete">Delete</button>
    </div>
  </div>
  <div class="invoice-frame">${renderInvoiceHTML(b, s)}</div>`;

  $('#print').onclick = () => window.print();
  $('#copyLink').onclick = async () => {
    try { await navigator.clipboard.writeText(b.link); toast('Invoice link copied'); }
    catch { prompt('Copy this link', b.link); }
  };
  const setStatus = (status, msg) => async () => {
    await api(`/api/bookings/${b.id}`, { method: 'PUT', body: { status } });
    toast(msg);
    route();
  };
  if ($('#complete')) $('#complete').onclick = setStatus('completed', 'Marked completed');
  if ($('#reinstate')) $('#reinstate').onclick = setStatus('booked', 'Booking reinstated');
  if ($('#cancelBooking')) $('#cancelBooking').onclick = async () => { if (confirm('Cancel this ride?')) await setStatus('cancelled', 'Ride cancelled')(); };
  $('#delete').onclick = async () => {
    if (!confirm(`Permanently delete booking #${b.number}?`)) return;
    await api(`/api/bookings/${b.id}`, { method: 'DELETE' });
    toast('Booking deleted');
    location.hash = '#/';
  };
  if ($('#recordPay')) $('#recordPay').onclick = () => openPaymentDialog(b, t);
  $('#sendSms').onclick = () => openSendDialog(b, 'sms', cfg.smsEnabled);
  $('#sendEmail').onclick = () => openSendDialog(b, 'email', cfg.emailEnabled);

  // Right after a new booking is saved, jump straight to sending it.
  if (location.hash.includes('?send=1')) {
    history.replaceState(null, '', `#/b/${b.id}`);
    if (b.customer?.phone) openSendDialog(b, 'sms', cfg.smsEnabled);
    else if (b.customer?.email) openSendDialog(b, 'email', cfg.emailEnabled);
  }
}

function openPaymentDialog(b, t) {
  dialog.innerHTML = `
  <form method="dialog" id="payForm">
    <h3>Record payment</h3>
    <label class="money">Amount<input name="amount" type="number" inputmode="decimal" step="0.01" min="0.01" value="${Math.max(t.balance, 0).toFixed(2)}" required></label>
    <label>Method<select name="method">${['Cash', 'Credit card', 'Zelle', 'Cash App', 'Venmo', 'Corporate account', 'Check']
      .map((m) => `<option ${b.pricing?.paymentMethod === m ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
    <div class="btn-row"><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn primary" value="ok" style="flex:1">Save payment</button></div>
  </form>`;
  dialog.showModal();
  $('#payForm').onsubmit = async (e) => {
    if (e.submitter?.value !== 'ok') return;
    e.preventDefault();
    const amount = parseFloat(e.target.amount.value) || 0;
    const pricing = { ...b.pricing, amountPaid: String(Math.round(((parseFloat(b.pricing?.amountPaid) || 0) + amount) * 100) / 100), paymentMethod: e.target.method.value };
    await api(`/api/bookings/${b.id}`, { method: 'PUT', body: { pricing } });
    dialog.close();
    toast(`${money(amount)} payment recorded`);
    route();
  };
}

function openSendDialog(b, channel, serverEnabled) {
  const s = state.settings;
  const isSms = channel === 'sms';
  const to = isSms ? b.customer?.phone : b.customer?.email;
  const message = isSms ? fillTemplate(s.smsTemplate, b, s, b.link) : fillTemplate(s.emailMessage, b, s, b.link);
  const subject = fillTemplate(s.emailSubject, b, s, b.link);
  const isLocal = /^https?:\/\/(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(b.link);

  dialog.innerHTML = `
  <form method="dialog" id="sendForm">
    <h3>${isSms ? 'Text' : 'Email'} invoice #${esc(b.number)}</h3>
    <label>${isSms ? 'Mobile number' : 'Email address'}
      <input name="to" type="${isSms ? 'tel' : 'email'}" value="${esc(to)}" required></label>
    ${isSms ? '' : `<label>Subject<input name="subject" value="${esc(subject)}"></label>`}
    <label>Message<textarea name="message" rows="${isSms ? 6 : 4}">${esc(message)}</textarea></label>
    <p class="hint">${serverEnabled
      ? (isSms ? 'Sent directly from your business number.' : 'The full invoice is attached below your message.')
      : `Opens ${isSms ? 'Messages' : 'your mail app'} on this device with the invoice filled in. Just tap send.`}</p>
    ${isLocal ? `<p class="hint warn">The invoice link points to a private address (${esc(new URL(b.link).host)}), so the customer can't open it. Set PUBLIC_URL when you host the app online.</p>` : ''}
    <div class="btn-row"><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn primary" value="ok" style="flex:1">${serverEnabled ? 'Send now' : `Open ${isSms ? 'Messages' : 'Mail'}`}</button></div>
  </form>`;
  dialog.showModal();

  $('#sendForm').onsubmit = async (e) => {
    if (e.submitter?.value !== 'ok') return;
    e.preventDefault();
    const f = e.target;
    const payload = { channel, to: f.to.value.trim(), message: f.message.value, subject: f.subject?.value };
    if (!payload.to) return toast('Recipient is required', true);
    const btn = e.submitter;
    btn.disabled = true;

    if (serverEnabled) {
      try {
        await api(`/api/bookings/${b.id}/send`, { method: 'POST', body: payload });
        dialog.close();
        toast(isSms ? 'Invoice texted ✓' : 'Invoice emailed ✓');
        return route();
      } catch (err) {
        btn.disabled = false;
        if (!err.data?.fallback) return toast(err.message, true);
      }
    }

    // Device fallback: hand off to the phone's Messages / Mail app.
    if (isSms) {
      const num = payload.to.replace(/[^\d+]/g, '');
      location.href = `sms:${num}${isIOS ? '&' : '?'}body=${encodeURIComponent(payload.message)}`;
    } else {
      const body = `${payload.message}\n\n${renderInvoiceText(b, s, { link: b.link })}`;
      location.href = `mailto:${encodeURIComponent(payload.to)}?subject=${encodeURIComponent(payload.subject || '')}&body=${encodeURIComponent(body)}`;
    }
    api(`/api/bookings/${b.id}/send`, { method: 'POST', body: { channel: `device-${channel}`, to: payload.to } }).catch(() => {});
    dialog.close();
    setTimeout(route, 800);
  };
}

// ---------- settings ----------
function renderSettings() {
  setActiveNav('settings');
  const s = state.settings;
  const cfg = state.config;
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
      <h2>Defaults</h2>
      <div class="grid">
        <label class="pct">Default gratuity<input name="defaultGratuityPct" type="number" step="0.5" min="0" value="${v('defaultGratuityPct')}"></label>
        <label class="pct">Default tax<input name="defaultTaxPct" type="number" step="0.01" min="0" value="${v('defaultTaxPct')}"></label>
        <label>Invoice number prefix<input name="numberPrefix" value="${v('numberPrefix')}"></label>
        <label class="span-all">Vehicles (comma separated)<input name="vehicles" value="${v('vehicles')}"></label>
        <label class="span-all">Chauffeurs (comma separated)<input name="drivers" value="${v('drivers')}"></label>
      </div>
    </section>
    <section class="card">
      <h2>Invoice text</h2>
      <div class="grid">
        <label class="span-all">How to pay (Zelle, Cash App, card link…)<textarea name="paymentInstructions" placeholder="Zelle: 832-844-8660">${v('paymentInstructions')}</textarea></label>
        <label class="span-all">Terms<textarea name="invoiceTerms">${v('invoiceTerms')}</textarea></label>
      </div>
    </section>
    <section class="card">
      <h2>Message templates</h2>
      <p class="hint" style="margin:0 0 10px">Placeholders: {firstName} {name} {number} {business} {phone} {total} {balance} {pickupDate} {pickupTime} {pickup} {dropoff} {link}</p>
      <div class="grid">
        <label class="span-all">Text message<textarea name="smsTemplate" rows="4">${v('smsTemplate')}</textarea></label>
        <label class="span-all">Email subject<input name="emailSubject" value="${v('emailSubject')}"></label>
        <label class="span-all">Email message<textarea name="emailMessage" rows="4">${v('emailMessage')}</textarea></label>
      </div>
    </section>
    <section class="card">
      <h2>Delivery</h2>
      <p style="margin:0">Text: <b>${cfg.smsEnabled ? 'Sent automatically (Twilio)' : "Uses this device's Messages app"}</b><br>
      Email: <b>${cfg.emailEnabled ? 'Sent automatically (SMTP)' : "Uses this device's mail app"}</b></p>
      <p class="hint">To send automatically, add Twilio / SMTP details to the server's <code>.env</code> file (see README).</p>
    </section>
    <button class="btn primary block">Save settings</button>
    ${cfg.authRequired ? `<button type="button" class="btn block" id="logout" style="margin-top:10px">Sign out</button>` : ''}
  </form>`;

  $('#settingsForm').onsubmit = async (e) => {
    e.preventDefault();
    state.settings = await api('/api/settings', { method: 'PUT', body: readForm(e.target) });
    $('#brand').textContent = state.settings.businessName || 'RESERVATIONS';
    toast('Settings saved');
  };
  if ($('#logout')) $('#logout').onclick = async () => {
    await api('/api/logout', { method: 'POST' });
    state.config = null; state.settings = null;
    route();
  };
}

// Close dialogs by tapping the backdrop.
dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
route();
