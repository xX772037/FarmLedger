// How much of each supply is on hand, worked out from its stock changes (in and out), never typed in.

/** { [productId]: amount on hand } from stock records' data. */
export function onHand(stockEntries) {
  const out = {};
  for (const s of stockEntries) {
    const q = Number(s.qty) || 0;
    out[s.productId] = (out[s.productId] || 0) + (s.direction === 'in' ? q : -q);
  }
  for (const k of Object.keys(out)) out[k] = Math.round(out[k] * 10000) / 10000;
  return out;
}

/** The lot numbers used for a supply, newest first (for a recall or a residue question). */
export function lotsOf(stockEntries, productId) {
  return [...new Set(stockEntries.filter(s => s.productId === productId && s.lot).sort((a, b) => (a.date < b.date ? 1 : -1)).map(s => s.lot))];
}
