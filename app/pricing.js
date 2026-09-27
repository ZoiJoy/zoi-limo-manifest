// Shared pricing logic, used by the browser (live preview) and the server (authoritative totals).

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

export function computeTotals(p = {}) {
  const hourly = p.rateType === 'hourly';
  const base = hourly ? num(p.hourlyRate) * num(p.hours) : num(p.baseFare);

  const lines = [];
  if (hourly) {
    lines.push({ label: `Hourly charter (${num(p.hours)} hr × $${num(p.hourlyRate).toFixed(2)})`, amount: round2(base) });
  } else {
    lines.push({ label: 'Base fare', amount: round2(base) });
  }

  const extras = [
    ['extraStops', 'Extra stop(s)'],
    ['waiting', 'Waiting time'],
    ['tolls', 'Tolls'],
    ['parking', 'Airport parking'],
    ['meetGreet', 'Meet & greet'],
    ['childSeat', 'Child seat'],
    ['additional', p.additionalLabel || 'Additional'],
  ];
  for (const [key, label] of extras) {
    const amount = round2(num(p[key]));
    if (amount) lines.push({ label, amount });
  }

  const serviceTotal = round2(lines.reduce((s, l) => s + l.amount, 0));
  const discount = round2(Math.min(num(p.discount), serviceTotal));
  const afterDiscount = round2(serviceTotal - discount);

  // Gratuity is charged on the base fare only, which is the norm in the industry.
  const gratuityPct = num(p.gratuityPct);
  const gratuity = round2(base * gratuityPct / 100);

  const taxPct = num(p.taxPct);
  const tax = round2(afterDiscount * taxPct / 100);

  const total = round2(afterDiscount + gratuity + tax);
  const paid = round2(num(p.amountPaid));
  const balance = round2(total - paid);

  return { lines, serviceTotal, discount, gratuityPct, gratuity, taxPct, tax, total, paid, balance };
}

export const money = (n) =>
  (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
