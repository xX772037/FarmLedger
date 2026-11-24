// Money: one ledger shared by the herd and crop sides, so calf sales and grain sales roll into one
// picture. Amounts are stored as whole cents (no rounding errors). Only owners see money (permissions.js).

export const INCOME = 'income';
export const EXPENSE = 'expense';

/** Shared categories. Modules add an entry's links (animal, group, field) rather than new categories. */
export const CATEGORIES = {
  income: ['Cattle sales', 'Other livestock sales', 'Grain and crop sales', 'Hay sales', 'Custom work', 'Government payments', 'Insurance payments', 'Rent received', 'Other income'],
  expense: ['Feed and hay', 'Vet and medicine', 'Breeding', 'Livestock purchased', 'Seed', 'Fertilizer', 'Chemicals', 'Fuel', 'Repairs', 'Equipment', 'Land rent', 'Labor', 'Insurance', 'Trucking and marketing', 'Utilities', 'Taxes', 'Interest', 'Other expense'],
};

/** "1,234.56" or "$1,234" or 1234.5 → 123456 cents; null if it isn't an amount. */
export function toCents(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * 100) : null;
  const s = String(value ?? '').replace(/[$,\s]/g, '');
  if (!/^-?\d+(\.\d{1,2})?$/.test(s) && !/^-?\.\d{1,2}$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

/** 123456 → "$1,234.56" (negative: "-$1,234.56"). */
export function formatCents(cents) {
  const c = Number.isFinite(cents) ? Math.round(cents) : 0;
  const abs = (Math.abs(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${c < 0 ? '-' : ''}$${abs}`;
}

/**
 * Totals for a year: { income, expense, net, byCategory: { [category]: cents } }.
 * `entries` are money records' data; dates are 'YYYY-MM-DD'.
 */
export function yearSummary(entries, year) {
  const out = { income: 0, expense: 0, net: 0, byCategory: {} };
  for (const e of entries) {
    if (!String(e.date).startsWith(`${year}-`)) continue;
    const c = Number(e.cents) || 0;
    if (e.direction === INCOME) out.income += c; else out.expense += c;
    out.byCategory[e.category] = (out.byCategory[e.category] || 0) + c;
  }
  out.net = out.income - out.expense;
  return out;
}
