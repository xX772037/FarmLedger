// Dates as 'YYYY-MM-DD' in the device's own time zone (a calving at 11 p.m. stays on that day).

const pad = n => String(n).padStart(2, '0');
export const isoDay = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** '2026-11-24' + 7 → '2026-12-01'. */
export function addDays(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  return isoDay(new Date(y, m - 1, d + days));
}

/** Whole days from a to b ('2026-11-24' → '2026-11-27' = 3). */
export function daysBetween(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number), [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 864e5);
}

/** '2026-11-24' → 'Nov 24, 2026'. */
export function showDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
