// Feature modules plug into the core here, so the herd and crop parts never edit the same files:
//   src/modules/herd/  (Ranch-working branch)  and  src/modules/crops/  (Farm-working branch).
//
// A module is { id, title, enterprise: 'livestock' | 'crops', summary, route, render?(el, ctx), today?(ctx) }:
//   render   draws the module's screens into `el`. The address #/<route>/a/b arrives as ctx.path = ['a', 'b'].
//   today    returns [{ text, href? }] for the home screen's "Today" list (optional)
// A module with no render yet shows as "coming soon".
//
// ctx = {
//   store     the current operation's records only: scope(store, opId) from store.js.
//             put(type, data, { id }) / get / list / remove. Pick your own record types ('animal', 'crop-plan', ...).
//   farm      the operation's profile; opId its id
//   role, can(action)   permissions.js: check can('money') before showing money, can('edit') before forms
//   navigate(path)      go to another screen, e.g. navigate('/herd/123')
//   ui        ui.js: fieldsHTML / readFields / liveFields / showErrors for forms drawn from a field list (schema.js),
//             listHTML, confirmClick, printButtonHTML + wirePrint, notesPanel(el, store, { type, id }) for notes and photos
// }
// Shared things to reuse rather than rebuild (entities.js): land (fields and pastures), contacts (buyers, vets),
// supplies with stock on hand (vaccines, chemicals, seed), money entries, reminders (show on Today), notes.
// Link a record to them with data.links = [{ type: 'land', id }] or a ref field; linkedRecords() finds them back.
// A money entry made by a module (a calf sale, a grain ticket) should carry source: { type, id } of the record behind it.

const registry = new Map();

export function registerModule(mod) {
  for (const k of ['id', 'title', 'enterprise', 'summary', 'route']) if (!mod?.[k]) throw new Error(`A module needs a ${k}.`);
  if (!['livestock', 'crops'].includes(mod.enterprise)) throw new Error(`Module ${mod.id}: enterprise must be "livestock" or "crops".`);
  if (!/^[a-z][a-z0-9-]*$/.test(mod.route)) throw new Error(`Module ${mod.id}: route must be lower-case letters, digits and dashes.`);
  if (registry.has(mod.id)) throw new Error(`Module ${mod.id} is registered twice.`);
  registry.set(mod.id, mod);
  return mod;
}

/** The modules for this farm: livestock ones if it runs livestock, crop ones if it grows crops. */
export function modulesFor(farm) {
  return [...registry.values()].filter(m => (m.enterprise === 'livestock' && farm?.livestock) || (m.enterprise === 'crops' && farm?.crops));
}

export const moduleByRoute = route => [...registry.values()].find(m => m.route === route) || null;
export const ready = mod => typeof mod?.render === 'function';

/** For tests. */
export function _resetModules() { registry.clear(); }
