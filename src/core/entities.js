// The shared record kinds, used by the herd and crop sides alike:
//   land (fields and pastures), contacts, supplies and their stock movements, money, reminders and notes.
// Each is described once (schema.js); save() tidies, checks and stores one in an operation.
// Records point at each other with links: [{ type, id }] (links.js).

import { normalize, validate } from './schema.js';
import { CATEGORIES, INCOME, EXPENSE } from './money.js';
import { cleanLinks } from './links.js';

export const LAND = 'land';
export const CONTACT = 'contact';
export const PRODUCT = 'product';
export const STOCK = 'stock';
export const MONEY = 'money';
export const REMINDER = 'reminder';
export const NOTE = 'note';

const LIVESTOCK_PRODUCTS = ['vaccine', 'medicine', 'dewormer'];
const CROP_PRODUCTS = ['chemical'];

export const ENTITIES = {
  [LAND]: {
    title: 'Land', one: 'piece of land',
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true, max: 80, hint: 'What you call it, like "North 80" or "Creek pasture".' },
      { key: 'kind', label: 'Used as', type: 'select', required: true, options: [['field', 'Cropland'], ['pasture', 'Pasture'], ['hay', 'Hay ground'], ['other', 'Other']] },
      { key: 'acres', label: 'Acres', type: 'number', min: 0, max: 1e6 },
      { key: 'legal', label: 'Legal description', type: 'text', max: 120, hint: 'Optional, like "NE1/4 6-98-58".' },
      { key: 'owner', label: 'Owned or rented', type: 'select', options: [['owned', 'Owned'], ['rented', 'Rented']] },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
    label: d => d.name,
    detail: d => [({ field: 'Cropland', pasture: 'Pasture', hay: 'Hay ground', other: 'Other' })[d.kind], d.acres !== '' && d.acres != null ? `${d.acres} acres` : '', d.owner === 'rented' ? 'Rented' : ''].filter(Boolean).join(' · '),
  },

  [CONTACT]: {
    title: 'Contacts', one: 'contact',
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true, max: 80, hint: 'A person or a business, like a sale barn or co-op.' },
      { key: 'kinds', label: 'They are a', type: 'multi', options: ['Buyer', 'Seller', 'Sale barn', 'Vet', 'Landlord', 'Supplier', 'Trucker', 'Agronomist', 'Other'] },
      { key: 'phone', label: 'Phone', type: 'text', max: 20 },
      { key: 'email', label: 'Email', type: 'text', max: 120 },
      { key: 'address', label: 'Address', type: 'textarea' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
    check: d => ({
      ...(d.phone && !/^[0-9+().\-\s]{7,20}$/.test(d.phone) ? { phone: 'That doesn\'t look like a phone number.' } : {}),
      ...(d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email) ? { email: 'That doesn\'t look like an email address.' } : {}),
    }),
    label: d => d.name,
    detail: d => [d.kinds?.join(', '), d.phone].filter(Boolean).join(' · '),
  },

  [PRODUCT]: {
    title: 'Supplies', one: 'supply',
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true, max: 80, hint: 'The brand or product name on the label.' },
      { key: 'kind', label: 'Kind', type: 'select', required: true, options: [['vaccine', 'Vaccine'], ['medicine', 'Medicine (antibiotic, anti-inflammatory)'], ['dewormer', 'Dewormer or pour-on'], ['chemical', 'Crop chemical (herbicide, fungicide, insecticide)'], ['seed', 'Seed'], ['fertilizer', 'Fertilizer'], ['feed', 'Feed, mineral or hay'], ['other', 'Other']] },
      { key: 'unit', label: 'Counted in', type: 'select', required: true, options: [['dose', 'doses'], ['ml', 'mL / cc'], ['gal', 'gallons'], ['oz', 'ounces'], ['lb', 'pounds'], ['bag', 'bags'], ['unit', 'units (seed)'], ['bu', 'bushels'], ['ton', 'tons'], ['bale', 'bales'], ['each', 'each']] },
      { key: 'meatWithdrawalDays', label: 'Meat withdrawal, days', type: 'number', min: 0, max: 400, hint: 'From the label. Animals treated with it can\'t be sold for slaughter until this many days pass.', show: d => LIVESTOCK_PRODUCTS.includes(d.kind) },
      { key: 'milkWithdrawalDays', label: 'Milk withdrawal, days', type: 'number', min: 0, max: 400, show: d => LIVESTOCK_PRODUCTS.includes(d.kind) },
      { key: 'reiHours', label: 'Re-entry interval, hours', type: 'number', min: 0, max: 1000, hint: 'From the label.', show: d => CROP_PRODUCTS.includes(d.kind) },
      { key: 'phiDays', label: 'Pre-harvest interval, days', type: 'number', min: 0, max: 400, show: d => CROP_PRODUCTS.includes(d.kind) },
      { key: 'epa', label: 'EPA Reg. No.', type: 'text', max: 30, show: d => CROP_PRODUCTS.includes(d.kind) },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
    label: d => d.name,
    detail: d => ENTITIES[PRODUCT].fields[1].options.find(([v]) => v === d.kind)?.[1] || '',
  },

  // Stock coming in (bought) or going out (used, sold, lost). On-hand amounts are worked out from these.
  [STOCK]: {
    title: 'Stock', one: 'stock change',
    fields: [
      { key: 'productId', label: 'Supply', type: 'ref', refType: PRODUCT, required: true },
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'direction', label: 'In or out', type: 'select', required: true, options: [['in', 'In (bought or received)'], ['out', 'Out (used, sold or thrown away)']] },
      { key: 'qty', label: 'Amount', type: 'number', required: true, min: 0.0001, max: 1e7 },
      { key: 'lot', label: 'Lot number', type: 'text', max: 40, hint: 'From the bottle or bag. Needed for a recall or a residue question.' },
      { key: 'note', label: 'Note', type: 'textarea' },
    ],
    label: d => `${d.direction === 'in' ? '+' : '−'}${d.qty}`,
  },

  [MONEY]: {
    title: 'Money', one: 'money entry',
    fields: [
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'direction', label: 'Money in or out', type: 'select', required: true, options: [[INCOME, 'Money in (income)'], [EXPENSE, 'Money out (expense)']] },
      { key: 'category', label: 'Category', type: 'select', required: true, options: d => CATEGORIES[d?.direction] || [] },
      { key: 'cents', label: 'Amount', type: 'money', required: true },
      { key: 'contactId', label: 'Paid to or by', type: 'ref', refType: CONTACT },
      { key: 'note', label: 'Note', type: 'textarea' },
    ],
    label: d => d.category,
  },

  [REMINDER]: {
    title: 'Reminders', one: 'reminder',
    fields: [
      { key: 'title', label: 'What', type: 'text', required: true, max: 120, hint: 'Like "Preg check the heifers" or "Pay cash rent".' },
      { key: 'due', label: 'When', type: 'date', required: true },
      { key: 'done', label: 'Done', type: 'check' },
      { key: 'note', label: 'Note', type: 'textarea' },
    ],
    label: d => d.title,
  },

  // A note, a photo, or both, on any record (an animal, a field, a sale...).
  [NOTE]: {
    title: 'Notes', one: 'note',
    fields: [
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'text', label: 'Note', type: 'textarea' },
    ],
    check: (d, extra) => (!d.text && !extra?.photo ? { text: 'Type a note or add a photo.' } : {}),
    label: d => d.text.split('\n')[0].slice(0, 60) || 'Photo',
  },
};

/** Tidy and check one record of a shared kind. Returns { data, errors }. */
export function prepare(type, input, extra = {}) {
  const def = ENTITIES[type];
  if (!def) throw new Error(`Unknown record kind "${type}".`);
  const data = normalize(def.fields, input);
  if (type === MONEY && data.category && !(CATEGORIES[data.direction] || []).includes(data.category)) data.category = '';
  if (input.links !== undefined || extra.links) data.links = cleanLinks(input.links ?? extra.links);
  // where a record came from: a module name ('herd') or the record behind it ({ type: 'animal', id })
  if (input.source) data.source = typeof input.source === 'object' ? cleanLinks([input.source])[0] : String(input.source).slice(0, 40);
  if (data.source === undefined) delete data.source;
  if (type === NOTE && (input.photo || extra.photo)) data.photo = input.photo || extra.photo;
  const errors = { ...validate(def.fields, data), ...(def.check ? def.check(data, { photo: data.photo }) : {}) };
  return { data, errors };
}

/**
 * Save a shared record in an operation (ops = scope(store, opId)). Refs and links must point at
 * records of that same operation. Throws an error with .fields when something is wrong.
 */
export async function save(ops, type, input, id) {
  const { data, errors } = prepare(type, input);
  for (const f of ENTITIES[type].fields) {
    if (f.type === 'ref' && data[f.key] && !(await ops.get(f.refType, data[f.key]))) errors[f.key] = `That ${f.label.toLowerCase()} isn't in this operation.`;
  }
  for (const l of data.links || []) {
    if (!(await ops.get(l.type, l.id))) { errors.links = 'A linked record isn\'t in this operation.'; break; }
  }
  if (Object.keys(errors).length) throw Object.assign(new Error(`That ${ENTITIES[type].one} has problems.`), { fields: errors });
  return ops.put(type, data, { id });
}
