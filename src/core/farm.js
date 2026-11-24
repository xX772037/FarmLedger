// Operations (a farm or ranch: one person can keep several and switch between them) and the people on
// each one. An operation is a record of type "farm" whose opId is its own id; everything else belongs
// to an operation through its opId.

import { newId } from './ids.js';
import { scope } from './store.js';

export const FARM = 'farm';
export const PERSON = 'person';

export const US_STATES = ['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'];

/** Who can do what (the rules themselves are in permissions.js). */
export const ROLES = {
  owner: { label: 'Owner', can: 'Everything, including money, people and settings.' },
  worker: { label: 'Worker', can: 'Adds and edits herd and crop records. Does not see money or change settings.' },
  viewer: { label: 'Viewer', can: 'Reads records only. For a vet, agronomist, lender or landlord.' },
};

export const emptyFarm = () => ({ name: '', ownerName: '', state: 'SD', county: '', crops: false, livestock: false, acres: '' });

const clean = v => String(v ?? '').replace(/\s+/g, ' ').trim();
const fail = (message, fields) => Object.assign(new Error(message), { fields });

/** Tidy a farm profile from a form. */
export function normalizeFarm(input) {
  const f = { ...emptyFarm(), ...input };
  const acres = f.acres === '' || f.acres == null ? '' : Number(f.acres);
  return {
    name: clean(f.name), ownerName: clean(f.ownerName), state: clean(f.state).toUpperCase(), county: clean(f.county),
    crops: !!f.crops, livestock: !!f.livestock, acres: Number.isFinite(acres) ? acres : f.acres,
  };
}

/** Problems with a farm profile, as { field: message }. Empty when it can be saved. */
export function farmErrors(farm) {
  const f = normalizeFarm(farm), e = {};
  if (!f.name) e.name = 'Give your farm or ranch a name.';
  else if (f.name.length > 80) e.name = 'Keep the name to 80 characters or fewer.';
  if (!f.ownerName) e.ownerName = 'Type your name.';
  else if (f.ownerName.length > 80) e.ownerName = 'Keep your name to 80 characters or fewer.';
  if (!US_STATES.includes(f.state)) e.state = 'Pick a state.';
  if (f.county.length > 60) e.county = 'Keep the county to 60 characters or fewer.';
  if (!f.crops && !f.livestock) e.enterprises = 'Tick crops, livestock, or both.';
  if (f.acres !== '' && !(typeof f.acres === 'number' && f.acres >= 0 && f.acres <= 1e7)) e.acres = 'Acres must be a number, 0 or more.';
  return e;
}

/** People: name, role, optional phone. */
export function normalizePerson(input) {
  return { name: clean(input?.name), role: ROLES[input?.role] ? input.role : 'worker', phone: clean(input?.phone) };
}
export function personErrors(person) {
  const p = normalizePerson(person), e = {};
  if (!p.name) e.name = 'Type their name.';
  else if (p.name.length > 80) e.name = 'Keep the name to 80 characters or fewer.';
  if (p.phone && !/^[0-9+().\-\s]{7,20}$/.test(p.phone)) e.phone = 'That doesn\'t look like a phone number.';
  return e;
}

// ---------------------------------------------------------------- operations

/** Every operation on this device, oldest first. */
export const listOperations = store => store.list(FARM);

/** The operation in use (or null before setup). */
export async function getFarm(store) {
  const id = await store.getMeta('currentOpId');
  return id ? store.get(FARM, id) : null;
}

/** Switch to another operation on this device. */
export async function switchOperation(store, id) {
  if (!(await store.get(FARM, id))) throw new Error('That operation is not on this device.');
  await store.setMeta('currentOpId', id);
}

/** Start a new operation (you become its owner) and switch to it. */
export async function createOperation(store, input) {
  const errors = farmErrors(input);
  if (Object.keys(errors).length) throw fail('The farm profile has problems.', errors);
  const data = normalizeFarm(input);
  const id = newId();
  const rec = await store.put(FARM, data, { id, opId: id });
  await scope(store, id).put(PERSON, { name: data.ownerName, role: 'owner', phone: '' });
  await store.setMeta('currentOpId', id);
  return rec;
}

/** Save the current operation's profile; creates the first one on a new device. */
export async function saveFarm(store, input) {
  const existing = await getFarm(store);
  if (!existing) return createOperation(store, input);
  const errors = farmErrors(input);
  if (Object.keys(errors).length) throw fail('The farm profile has problems.', errors);
  return store.put(FARM, normalizeFarm(input), { id: existing.id });
}

/** Remove an operation and everything in it from this device. Not the last one. */
export async function removeOperation(store, id) {
  const ops = await listOperations(store);
  if (ops.length <= 1) throw new Error('This is the only operation on this device.');
  if (!ops.some(o => o.id === id)) return false;
  for (const r of await store.allRecords()) if (r.opId === id && !r.deleted) await store.remove(r.type, r.id);
  if ((await store.getMeta('currentOpId')) === id) await store.setMeta('currentOpId', (await listOperations(store))[0].id);
  return true;
}

// ---------------------------------------------------------------- people (in one operation: pass scope(store, opId))

/** Add or update a person. The last owner can't be made a worker or viewer. */
export async function savePerson(ops, input, id) {
  const errors = personErrors(input);
  if (Object.keys(errors).length) throw fail('That person has problems.', errors);
  const data = normalizePerson(input);
  if (id) {
    const prev = await ops.get(PERSON, id);
    if (prev?.data.role === 'owner' && data.role !== 'owner' && (await owners(ops)).length === 1) {
      throw fail('The farm needs at least one owner.', { role: 'The farm needs at least one owner.' });
    }
  }
  return ops.put(PERSON, data, { id });
}

/** Remove a person. The last owner can't be removed. */
export async function removePerson(ops, id) {
  const p = await ops.get(PERSON, id);
  if (p?.data.role === 'owner' && (await owners(ops)).length === 1) throw new Error('The farm needs at least one owner.');
  return ops.remove(PERSON, id);
}

const owners = async ops => (await ops.list(PERSON)).filter(p => p.data.role === 'owner');
