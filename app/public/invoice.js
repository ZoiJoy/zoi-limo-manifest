// Invoice rendering shared by the browser preview and the server's public invoice page / email body.
import { computeTotals, money } from './pricing.js';

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const SERVICE_LABELS = {
  airport: 'Airport Transfer',
  p2p: 'Point to Point',
  hourly: 'Hourly Charter',
  wedding: 'Wedding / Event',
  corporate: 'Corporate',
};

export const TRIP_LABELS = { oneway: 'One Way', roundtrip: 'Round Trip' };

export function customerName(b) {
  const c = b.customer || {};
  return [c.firstName, c.lastName].filter(Boolean).join(' ') || 'Customer';
}

export function formatDate(d) {
  if (!d) return '';
  const [y, m, day] = d.split('-').map(Number);
  if (!y) return d;
  return new Date(y, m - 1, day).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  if (!Number.isFinite(h)) return t;
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${((h + 11) % 12) + 1}:${String(m || 0).padStart(2, '0')} ${ampm}`;
}

export function paymentStatus(b) {
  const t = computeTotals(b.pricing);
  if (b.status === 'cancelled') return 'cancelled';
  if (t.total > 0 && t.balance <= 0) return 'paid';
  if (t.paid > 0) return 'partial';
  return 'unpaid';
}

export const STATUS_LABELS = { paid: 'Paid', partial: 'Deposit paid', unpaid: 'Balance due', cancelled: 'Cancelled' };

function row(label, value) {
  return value ? `<tr><th>${esc(label)}</th><td>${esc(value)}</td></tr>` : '';
}

// Returns an HTML fragment (no <html>/<body>) with inline styles so it survives email clients.
export function renderInvoiceHTML(b, s = {}, { link } = {}) {
  const t = computeTotals(b.pricing);
  const c = b.customer || {};
  const trip = b.trip || {};
  const status = paymentStatus(b);
  const pickupWhen = [formatDate(trip.pickupDate), formatTime(trip.pickupTime)].filter(Boolean).join(' at ');
  const returnWhen = [formatDate(trip.returnDate), formatTime(trip.returnTime)].filter(Boolean).join(' at ');
  const flight = [trip.airline, trip.flightNumber, trip.terminal && `Terminal ${trip.terminal}`, trip.flightTime && formatTime(trip.flightTime)]
    .filter(Boolean).join(' · ');
  const statusColor = { paid: '#1e7b45', partial: '#9a6700', unpaid: '#b42318', cancelled: '#666' }[status];

  const priceRows = t.lines.map((l) => `<tr><td>${esc(l.label)}</td><td class="amt">${money(l.amount)}</td></tr>`).join('')
    + (t.discount ? `<tr><td>Discount</td><td class="amt">-${money(t.discount)}</td></tr>` : '')
    + (t.gratuity ? `<tr><td>Gratuity (${t.gratuityPct}%)</td><td class="amt">${money(t.gratuity)}</td></tr>` : '')
    + (t.tax ? `<tr><td>Tax (${t.taxPct}%)</td><td class="amt">${money(t.tax)}</td></tr>` : '');

  return `
<div class="zinv" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;max-width:720px;margin:0 auto;background:#fff;">
<style>
.zinv table{width:100%;border-collapse:collapse}
.zinv .kv th{text-align:left;font-weight:600;color:#555;padding:4px 12px 4px 0;width:38%;vertical-align:top;font-size:13px}
.zinv .kv td{padding:4px 0;font-size:14px;vertical-align:top}
.zinv .prices td{padding:8px 0;border-bottom:1px solid #eee;font-size:14px}
.zinv .amt{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.zinv .hdr td{word-break:break-word}
@media (max-width:520px){.zinv .hdr td{display:block;text-align:left!important;padding-bottom:4px!important}}
.zinv h3{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#8a6d1f;margin:22px 0 6px;border-bottom:1px solid #e8e1cf;padding-bottom:4px}
</style>
<table class="hdr" style="background:#111;color:#fff"><tr>
<td style="padding:22px 24px;vertical-align:top">
  <div style="font-size:22px;font-weight:700;letter-spacing:.12em;color:#d4b25a">${esc(s.businessName || 'Black Car Service')}</div>
  <div style="font-size:12px;color:#bbb;margin-top:6px;line-height:1.5">
    ${[s.ownerName, s.phone, s.email, s.website, s.address].filter(Boolean).map(esc).join('<br>')}
  </div>
</td>
<td style="padding:22px 24px;text-align:right;vertical-align:top">
  <div style="font-size:26px;font-weight:300;letter-spacing:.1em">INVOICE</div>
  <div style="font-size:13px;color:#ddd;margin-top:6px">#${esc(b.number)}</div>
  <div style="font-size:12px;color:#aaa">Issued ${esc(formatDate((b.createdAt || '').slice(0, 10)))}</div>
  <div style="display:inline-block;margin-top:8px;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:600;background:#fff;color:${statusColor}">${esc(STATUS_LABELS[status])}</div>
</td>
</tr></table>

<div style="padding:4px 24px 24px">
<h3>Billed to</h3>
<table class="kv">
${row('Name', customerName(b))}
${row('Company', c.company)}
${row('Phone', c.phone)}
${row('Email', c.email)}
</table>

<h3>Trip details</h3>
<table class="kv">
${row('Service', [SERVICE_LABELS[trip.serviceType], TRIP_LABELS[trip.tripType]].filter(Boolean).join(' · '))}
${row('Pickup', pickupWhen)}
${row('From', trip.pickup)}
${row('Stops', trip.stops)}
${row('To', trip.dropoff)}
${row('Return', returnWhen)}
${row('Flight', flight)}
${row('Passengers', trip.passengers)}
${row('Luggage', trip.luggage)}
${row('Vehicle', [trip.vehicle, trip.plate].filter(Boolean).join(' · '))}
${row('Chauffeur', trip.driver)}
${row('Notes', trip.notes)}
</table>

<h3>Charges</h3>
<table class="prices">
${priceRows}
<tr><td style="font-weight:700;font-size:16px;border-bottom:2px solid #111">Total</td><td class="amt" style="font-weight:700;font-size:16px;border-bottom:2px solid #111">${money(t.total)}</td></tr>
${t.paid ? `<tr><td>Paid${b.pricing?.paymentMethod ? ` (${esc(b.pricing.paymentMethod)})` : ''}</td><td class="amt">-${money(t.paid)}</td></tr>` : ''}
<tr><td style="font-weight:700;font-size:18px;color:${statusColor}">Balance due</td><td class="amt" style="font-weight:700;font-size:18px;color:${statusColor}">${money(Math.max(t.balance, 0))}</td></tr>
</table>

${s.paymentInstructions ? `<h3>How to pay</h3><div style="font-size:14px;white-space:pre-line">${esc(s.paymentInstructions)}</div>` : ''}
${s.invoiceTerms ? `<h3>Terms</h3><div style="font-size:12px;color:#555;white-space:pre-line">${esc(s.invoiceTerms)}</div>` : ''}
${link ? `<p style="margin-top:22px;font-size:13px"><a href="${esc(link)}" style="color:#8a6d1f">View this invoice online</a></p>` : ''}
<p style="margin-top:22px;font-size:13px;color:#555;text-align:center">Thank you for riding with ${esc(s.businessName || 'us')}.</p>
</div>
</div>`;
}

export function fillTemplate(tpl, b, s, link) {
  const t = computeTotals(b.pricing);
  const trip = b.trip || {};
  const vars = {
    name: customerName(b),
    firstName: b.customer?.firstName || customerName(b),
    number: b.number,
    business: s.businessName || '',
    phone: s.phone || '',
    total: money(t.total),
    balance: money(Math.max(t.balance, 0)),
    pickupDate: formatDate(trip.pickupDate),
    pickupTime: formatTime(trip.pickupTime),
    pickup: trip.pickup || '',
    dropoff: trip.dropoff || '',
    link: link || '',
  };
  return String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)).replace(/\n{3,}/g, '\n\n').trim();
}

// Plain-text invoice, used for SMS fallbacks and the text part of emails.
export function renderInvoiceText(b, s = {}, { link } = {}) {
  const t = computeTotals(b.pricing);
  const trip = b.trip || {};
  const L = [];
  L.push(`${s.businessName || 'Invoice'} — Invoice #${b.number}`);
  L.push(`Billed to: ${customerName(b)}${b.customer?.company ? ` (${b.customer.company})` : ''}`);
  L.push('');
  if (trip.pickupDate || trip.pickupTime) L.push(`Pickup: ${formatDate(trip.pickupDate)} ${formatTime(trip.pickupTime)}`.trim());
  if (trip.pickup) L.push(`From: ${trip.pickup}`);
  if (trip.stops) L.push(`Stops: ${trip.stops}`);
  if (trip.dropoff) L.push(`To: ${trip.dropoff}`);
  if (trip.returnDate || trip.returnTime) L.push(`Return: ${formatDate(trip.returnDate)} ${formatTime(trip.returnTime)}`.trim());
  if (trip.flightNumber) L.push(`Flight: ${[trip.airline, trip.flightNumber].filter(Boolean).join(' ')}`);
  if (trip.vehicle) L.push(`Vehicle: ${trip.vehicle}`);
  L.push('');
  for (const l of t.lines) L.push(`${l.label}: ${money(l.amount)}`);
  if (t.discount) L.push(`Discount: -${money(t.discount)}`);
  if (t.gratuity) L.push(`Gratuity (${t.gratuityPct}%): ${money(t.gratuity)}`);
  if (t.tax) L.push(`Tax (${t.taxPct}%): ${money(t.tax)}`);
  L.push(`TOTAL: ${money(t.total)}`);
  if (t.paid) L.push(`Paid: -${money(t.paid)}`);
  L.push(`BALANCE DUE: ${money(Math.max(t.balance, 0))}`);
  if (s.paymentInstructions) L.push('', 'How to pay:', s.paymentInstructions);
  if (link) L.push('', `View invoice: ${link}`);
  L.push('', [s.businessName, s.phone, s.email].filter(Boolean).join(' · '));
  return L.join('\n');
}
