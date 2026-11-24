// The farm profile and the people on it, shared by the crop and herd parts of FarmLedger.

export const FARM = 'farm';
export const PERSON = 'person';

export const US_STATES = ['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'];

/** Who can do what. Recorded now; enforced once cloud accounts exist (on one device, everyone is the owner). */
export const ROLES = {
  owner: { label: 'Owner', can: 'Everything, including money, people and settings.' },
  worker: { label: 'Worker', can: 'Adds and edits herd and crop records. Does not see money or change settings.' },
  viewer: { label: 'Viewer', can: 'Reads records only. For a vet, agronomist, lender or landlord.' },
};

export const emptyFarm = () => ({ name: '', ownerName: '', state: 'SD', county: '', crops: false, livestock: false, acres: '' });

const clean = v => String(v ?? '').replace(/\s+/g, ' ').trim();

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

/** The farm on this device (one per device for now), or null before setup. */
export async function getFarm(store) {
  const id = await store.getMeta('farmId');
  return id ? store.get(FARM, id) : null;
}

/** Save the farm profile. On first save the owner is added to People too. */
export async function saveFarm(store, input) {
  const errors = farmErrors(input);
  if (Object.keys(errors).length) { const err = new Error('The farm profile has problems.'); err.fields = errors; throw err; }
  const data = normalizeFarm(input);
  const existing = await getFarm(store);
  const rec = await store.put(FARM, data, { id: existing?.id });
  if (!existing) {
    await store.setMeta('farmId', rec.id);
    await store.put(PERSON, { name: data.ownerName, role: 'owner', phone: '' });
  }
  return rec;
}

/** Add or update a person. The last owner can't be made a worker or viewer. */
export async function savePerson(store, input, id) {
  const errors = personErrors(input);
  if (Object.keys(errors).length) { const err = new Error('That person has problems.'); err.fields = errors; throw err; }
  const data = normalizePerson(input);
  if (id) {
    const prev = await store.get(PERSON, id);
    if (prev?.data.role === 'owner' && data.role !== 'owner' && (await owners(store)).length === 1) {
      const err = new Error('The farm needs at least one owner.'); err.fields = { role: err.message }; throw err;
    }
  }
  return store.put(PERSON, data, { id });
}

/** Remove a person. The last owner can't be removed. */
export async function removePerson(store, id) {
  const p = await store.get(PERSON, id);
  if (p?.data.role === 'owner' && (await owners(store)).length === 1) throw new Error('The farm needs at least one owner.');
  return store.remove(PERSON, id);
}

const owners = async store => (await store.list(PERSON)).filter(p => p.data.role === 'owner');
