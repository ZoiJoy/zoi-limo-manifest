// Draws the invoice as a PDF (US Letter) with jsPDF, matching the on-screen invoice design.
// jsPDF is loaded as a plain script (window.jspdf) before the app.
import { computeTotals, money } from './pricing.js';
import {
  customerName, formatDate, formatTime, paymentStatus, paymentOptions, STATUS_LABELS, SERVICE_LABELS, TRIP_LABELS,
} from './invoice.js';

const C = {
  black: [17, 17, 17], gold: [212, 178, 90], goldDark: [138, 109, 31], line: [232, 225, 207], rule: [238, 238, 238],
  ink: [26, 26, 26], muted: [85, 85, 85], light: [187, 187, 187], white: [255, 255, 255],
  paid: [30, 123, 69], partial: [154, 103, 0], unpaid: [180, 35, 24], cancelled: [102, 102, 102],
};

// The built-in PDF fonts only cover Western European characters; swap the few common others.
const clean = (s) => String(s ?? '')
  .replace(/[–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
  .replace(/•/g, '-').replace(/…/g, '...')
  .replace(/[^\x00-\xFF]/g, '?');

export function invoiceFileName(b) {
  return `Invoice-${String(b.number).replace(/[^\w-]/g, '')}.pdf`;
}

export function buildInvoicePDF(b, s = {}) {
  const { jsPDF } = globalThis.jspdf || {};
  if (!jsPDF) throw new Error('PDF maker did not load. Check your connection and reopen the app.');

  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 48; // side margin
  const t = computeTotals(b.pricing);
  const c = b.customer || {};
  const trip = b.trip || {};
  const status = paymentStatus(b);
  const statusColor = C[status];

  const font = (size, style = 'normal', color = C.ink) => {
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
    doc.setTextColor(...color);
  };
  const text = (str, x, y, opts) => doc.text(clean(str), x, y, opts);

  // ---- header band ----
  const contact = [s.ownerName, s.phone, s.email, s.website, s.address].filter(Boolean);
  const headerH = Math.max(142, 78 + contact.length * 14 + 16);
  doc.setFillColor(...C.black);
  doc.rect(0, 0, W, headerH, 'F');

  font(24, 'bold', C.gold);
  text(s.businessName || 'Black Car Service', M, 62, { charSpace: 3 });
  font(10, 'normal', C.light);
  contact.forEach((line, i) => text(line, M, 86 + i * 14));

  // Right-align by hand: jsPDF's align ignores character spacing.
  font(30, 'normal', C.white);
  const title = 'INVOICE';
  text(title, W - M - doc.getTextWidth(title) - 4 * (title.length - 1), 62, { charSpace: 4 });
  font(11, 'normal', [221, 221, 221]);
  text(`#${b.number}`, W - M, 84, { align: 'right' });
  font(10, 'normal', [170, 170, 170]);
  text(`Issued ${formatDate((b.createdAt || '').slice(0, 10))}`, W - M, 99, { align: 'right' });

  const pill = STATUS_LABELS[status];
  font(10, 'bold', statusColor);
  const pw = doc.getTextWidth(pill) + 22;
  doc.setFillColor(...C.white);
  doc.roundedRect(W - M - pw, 110, pw, 20, 10, 10, 'F');
  text(pill, W - M - pw / 2, 124, { align: 'center' });

  // ---- body helpers ----
  let y = headerH + 32;
  const ensure = (need) => {
    if (y + need > H - 48) {
      doc.addPage();
      y = 56;
    }
  };
  const section = (title) => {
    ensure(40);
    font(9, 'bold', C.goldDark);
    text(title.toUpperCase(), M, y, { charSpace: 1.5 });
    doc.setDrawColor(...C.line);
    doc.setLineWidth(1);
    doc.line(M, y + 7, W - M, y + 7);
    y += 24;
  };
  const labelW = 150;
  const kv = (label, value) => {
    if (!value) return;
    font(11, 'normal', C.ink);
    const lines = doc.splitTextToSize(clean(value), W - M * 2 - labelW);
    ensure(lines.length * 15 + 6);
    font(10, 'bold', C.muted);
    text(label, M, y);
    font(11, 'normal', C.ink);
    doc.text(lines, M + labelW, y);
    y += lines.length * 15 + 6;
  };

  // ---- billed to ----
  section('Billed to');
  kv('Name', customerName(b));
  kv('Company', c.company);
  kv('Phone', c.phone);
  kv('Email', c.email);
  y += 8;

  // ---- trip ----
  section('Trip details');
  kv('Service', [SERVICE_LABELS[trip.serviceType], TRIP_LABELS[trip.tripType]].filter(Boolean).join(' · '));
  kv('Pickup', [formatDate(trip.pickupDate), formatTime(trip.pickupTime)].filter(Boolean).join(' at '));
  kv('From', trip.pickup);
  kv('Stops', trip.stops);
  kv('To', trip.dropoff);
  kv('Return', [formatDate(trip.returnDate), formatTime(trip.returnTime)].filter(Boolean).join(' at '));
  kv('Flight', [trip.airline, trip.flightNumber, trip.terminal && `Terminal ${trip.terminal}`, trip.flightTime && formatTime(trip.flightTime)].filter(Boolean).join(' · '));
  kv('Passengers', trip.passengers);
  kv('Luggage', trip.luggage);
  kv('Vehicle', [trip.vehicle, trip.plate].filter(Boolean).join(' · '));
  kv('Chauffeur', trip.driver);
  kv('Notes', trip.notes);
  y += 8;

  // ---- charges ----
  section('Charges');
  const rows = [
    ...t.lines.map((l) => [l.label, money(l.amount)]),
    ...(t.discount ? [['Discount', `-${money(t.discount)}`]] : []),
    ...(t.gratuity ? [[`Gratuity (${t.gratuityPct}%)`, money(t.gratuity)]] : []),
    ...(t.tax ? [[`Tax (${t.taxPct}%)`, money(t.tax)]] : []),
  ];
  for (const [label, amount] of rows) {
    ensure(26);
    font(11, 'normal', C.ink);
    text(label, M, y);
    text(amount, W - M, y, { align: 'right' });
    doc.setDrawColor(...C.rule);
    doc.setLineWidth(0.75);
    doc.line(M, y + 9, W - M, y + 9);
    y += 24;
  }
  ensure(70);
  font(13, 'bold', C.ink);
  text('Total', M, y + 2);
  text(money(t.total), W - M, y + 2, { align: 'right' });
  doc.setDrawColor(...C.black);
  doc.setLineWidth(1.5);
  doc.line(M, y + 12, W - M, y + 12);
  y += 32;
  if (t.paid) {
    font(11, 'normal', C.ink);
    text(`Paid${b.pricing?.paymentMethod ? ` (${b.pricing.paymentMethod})` : ''}`, M, y);
    text(`-${money(t.paid)}`, W - M, y, { align: 'right' });
    y += 24;
  }
  font(15, 'bold', statusColor);
  text('Balance due', M, y);
  text(money(Math.max(t.balance, 0)), W - M, y, { align: 'right' });
  y += 28;

  // ---- payment options / terms ----
  if (status !== 'paid' && status !== 'cancelled') {
    section('Payment options');
    font(11, 'normal', C.ink);
    for (const opt of paymentOptions(s)) {
      ensure(16);
      text(opt, M, y);
      y += 15;
    }
    y += 10;
  }
  if (s.invoiceTerms) {
    section('Terms');
    font(9, 'normal', C.muted);
    const lines = doc.splitTextToSize(clean(s.invoiceTerms), W - M * 2);
    ensure(lines.length * 12);
    doc.text(lines, M, y);
    y += lines.length * 12 + 20;
  }
  // The closing line may sit in the bottom margin rather than start a page of its own.
  if (y + 6 > H - 24) { doc.addPage(); y = 56; }
  font(11, 'normal', C.muted);
  text(`Thank you for riding with ${s.businessName || 'us'}.`, W / 2, y + 6, { align: 'center' });

  doc.setProperties({ title: `Invoice ${b.number}`, author: s.businessName || '' });
  return doc.output('blob');
}
