import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeTotals } from '../pricing.js';
import { renderInvoiceHTML, renderInvoiceText, fillTemplate, paymentOptions } from '../invoice.js';

test('flat-rate totals with gratuity on base fare, tax, discount and deposit', () => {
  const t = computeTotals({ rateType: 'flat', baseFare: '100', tolls: '10', parking: '5', discount: '15', gratuityPct: '20', taxPct: '8.25', amountPaid: '50' });
  assert.equal(t.serviceTotal, 115);
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

test('payment options are Venmo, Zelle, Cash App, Apple Pay and Cash', () => {
  assert.deepEqual(paymentOptions({}), ['Venmo', 'Zelle', 'Cash App', 'Apple Pay', 'Cash']);
  assert.deepEqual(
    paymentOptions({ venmo: '@zoi-limo', zelle: 'pay@zoilimo.com', cashApp: '$zoilimo', applePay: '832-844-8660' }),
    ['Venmo: @zoi-limo', 'Zelle: pay@zoilimo.com', 'Cash App: $zoilimo', 'Apple Pay: 832-844-8660', 'Cash'],
  );
});

test('text invoice shows payment options until paid', () => {
  const s = { businessName: 'ZOI LIMO', venmo: 'zoi', zelle: '832-844-8660', cashApp: 'zoi' };
  const b = { number: 'ZL-1001', customer: { firstName: 'Jane' }, trip: {}, pricing: { baseFare: '100' } };
  const unpaid = renderInvoiceText(b, s);
  assert.match(unpaid, /BALANCE DUE: \$100\.00/);
  assert.match(unpaid, /Venmo: @zoi/);
  assert.match(unpaid, /Cash App: \$zoi/);
  assert.match(unpaid, /Zelle: 832-844-8660/);
  assert.match(unpaid, /• Apple Pay\n• Cash/);
  const paid = renderInvoiceText({ ...b, pricing: { baseFare: '100', amountPaid: '100', paymentMethod: 'Venmo' } }, s);
  assert.match(paid, /Paid \(Venmo\): -\$100\.00/);
  assert.match(paid, /PAID IN FULL/);
  assert.doesNotMatch(paid, /Payment options/);
});

test('invoice escapes customer input', () => {
  const html = renderInvoiceHTML({ number: 'ZL-1', customer: { firstName: '<script>x</script>' }, trip: {}, pricing: {} }, {});
  assert.ok(!html.includes('<script>x'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('template placeholders', () => {
  const msg = fillTemplate('Hi {firstName}, total {total} {unknown}', { number: 'ZL-1', customer: { firstName: 'Ann' }, pricing: { baseFare: '50' } }, {});
  assert.equal(msg, 'Hi Ann, total $50.00 {unknown}');
});
