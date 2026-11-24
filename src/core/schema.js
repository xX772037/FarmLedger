// Describe a kind of record once, as a list of fields, and get tidying, checking and (in ui.js) the
// on-screen form from it. The shared record kinds (entities.js) use this, and so can the herd and crop
// modules.
//
// A field: { key, label, type, required?, max?, min?, options?, hint?, show?(data) }
//   type: text | textarea | number | select | multi | date | money | check | ref
//   options: ['A', 'B'] or [['value', 'Label'], ...]   (select and multi)
//   ref: { refType: 'contact' } picks one record of that type from the same operation
//   show(data): false hides the field (and skips its checks) for this record, e.g. by kind

import { toCents } from './money.js';

export const optionPairs = options => (options || []).map(o => (Array.isArray(o) ? o : [o, o]));
const clean = v => String(v ?? '').replace(/[ \t]+/g, ' ').trim();
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const isIsoDate = s => ISO_DATE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);

/** Tidy raw input (strings from a form, or values from code) into stored values. */
export function normalize(fields, input = {}) {
  const out = {};
  for (const f of fields) {
    const v = input[f.key];
    switch (f.type) {
      case 'number': { const n = v === '' || v == null ? '' : Number(v); out[f.key] = Number.isFinite(n) ? n : clean(v); break; }
      // money: text from a form is dollars ("1,250.00"); a number from code is already cents
      case 'money': { const c = typeof v === 'number' ? Math.round(v) : toCents(v); out[f.key] = v === '' || v == null ? '' : (c ?? clean(v)); break; }
      case 'check': out[f.key] = !!v && v !== 'false'; break;
      case 'multi': out[f.key] = [...new Set((Array.isArray(v) ? v : v ? [v] : []).map(clean).filter(Boolean))]; break;
      case 'textarea': out[f.key] = String(v ?? '').replace(/\r\n/g, '\n').trim(); break;
      default: out[f.key] = clean(v);
    }
  }
  return out;
}

/** Problems as { key: message }. Hidden fields (show() false) are not checked. */
export function validate(fields, data) {
  const e = {};
  for (const f of fields) {
    if (f.show && !f.show(data)) continue;
    const v = data[f.key];
    const empty = v === '' || v == null || (Array.isArray(v) && !v.length);
    if (empty) { if (f.required) e[f.key] = f.requiredMessage || `${f.label} is needed.`; continue; }
    switch (f.type) {
      case 'number':
        if (typeof v !== 'number') e[f.key] = `${f.label} must be a number.`;
        else if (f.min != null && v < f.min) e[f.key] = `${f.label} must be ${f.min} or more.`;
        else if (f.max != null && v > f.max) e[f.key] = `${f.label} must be ${f.max} or less.`;
        break;
      case 'money':
        if (typeof v !== 'number') e[f.key] = `${f.label} must be an amount like 1250.00.`;
        else if (v <= 0) e[f.key] = `${f.label} must be more than $0.`;
        break;
      case 'date': if (!isIsoDate(v)) e[f.key] = `${f.label} must be a date.`; break;
      case 'select': if (!optionPairs(typeof f.options === 'function' ? f.options(data) : f.options).some(([val]) => val === v)) e[f.key] = `Pick a ${f.label.toLowerCase()}.`; break;
      case 'multi': { const ok = new Set(optionPairs(f.options).map(([val]) => val)); if (v.some(x => !ok.has(x))) e[f.key] = `Pick from the list for ${f.label.toLowerCase()}.`; break; }
      default:
        if (typeof v === 'string' && v.length > (f.max || (f.type === 'textarea' ? 4000 : 120))) e[f.key] = `Keep ${f.label.toLowerCase()} to ${f.max || (f.type === 'textarea' ? 4000 : 120)} characters or fewer.`;
    }
  }
  return e;
}
