// The shared core: the record store, the farm profile and people, backup files and module slots.
// Runs on the in-memory backend, which has the same five methods as the browser's IndexedDB one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryBackend, idbBackend } from '../src/core/db.js';
import { createStore } from '../src/core/store.js';
import { FARM, PERSON, getFarm, saveFarm, farmErrors, normalizeFarm, savePerson, removePerson, personErrors } from '../src/core/farm.js';
import { makeBackup, parseBackup, restoreBackup, backupFileName, BACKUP_FORMAT } from '../src/core/backup.js';
import { registerModule, modulesFor, moduleByRoute, ready, _resetModules } from '../src/core/modules.js';
import { accountStatus } from '../src/core/account.js';

let clock = 1_000;
const fresh = () => createStore(memoryBackend(), { now: () => ++clock });
const goodFarm = { name: 'Prairie View Farm', ownerName: 'Pat Example', state: 'SD', county: 'Hutchinson', crops: true, livestock: true, acres: '640' };

// ---- store

test('put adds a record with an id, version 1 and times; get and list return it', async () => {
  const s = fresh();
  const r = await s.put('cow', { tag: '101' });
  assert.match(r.id, /\S{8,}/);
  assert.equal(r.version, 1); assert.equal(r.deleted, false); assert.ok(r.createdAt > 0 && r.updatedAt === r.createdAt);
  assert.deepEqual((await s.get('cow', r.id)).data, { tag: '101' });
  assert.deepEqual((await s.list('cow')).map(x => x.data.tag), ['101']);
  assert.equal(await s.get('field', r.id), null, 'get checks the type');
});

test('updating keeps the id and created time, bumps the version, and stores a copy', async () => {
  const s = fresh();
  const data = { tag: '101' };
  const a = await s.put('cow', data);
  data.tag = 'changed after save';
  const b = await s.put('cow', { tag: '102' }, { id: a.id });
  assert.equal(b.id, a.id); assert.equal(b.createdAt, a.createdAt); assert.equal(b.version, 2); assert.ok(b.updatedAt > a.updatedAt);
  assert.equal((await s.get('cow', a.id)).data.tag, '102');
  await assert.rejects(s.put('field', {}, { id: a.id }), /is a cow, not a field/);
  await assert.rejects(s.put('', {}), /needs a type/);
});

test('remove marks a record deleted: it disappears from get and list but is kept for backup', async () => {
  const s = fresh();
  const a = await s.put('cow', { tag: '1' }), b = await s.put('cow', { tag: '2' });
  assert.equal(await s.remove('cow', a.id), true);
  assert.equal(await s.remove('cow', a.id), false, 'already removed');
  assert.equal(await s.remove('field', b.id), false, 'wrong type');
  assert.equal(await s.get('cow', a.id), null);
  assert.deepEqual((await s.list('cow')).map(x => x.data.tag), ['2']);
  const kept = (await s.allRecords()).find(r => r.id === a.id);
  assert.equal(kept.deleted, true); assert.equal(kept.version, 2);
});

test('every change is logged for cloud backup, and subscribers hear about it', async () => {
  const s = fresh();
  const heard = [];
  const stop = s.subscribe(t => heard.push(t));
  const a = await s.put('cow', { tag: '1' });
  await s.put('cow', { tag: '1b' }, { id: a.id });
  await s.remove('cow', a.id);
  stop();
  await s.put('cow', { tag: '2' });
  assert.equal(await s.pendingChanges(), 4);
  assert.deepEqual(heard, ['cow', 'cow', 'cow']);
});

test('list is oldest first; settings are kept separately', async () => {
  const s = fresh();
  for (const t of ['a', 'b', 'c']) await s.put('cow', { tag: t });
  assert.deepEqual((await s.list('cow')).map(r => r.data.tag), ['a', 'b', 'c']);
  assert.equal(await s.getMeta('nothing', 'fallback'), 'fallback');
  await s.setMeta('farmId', 'x');
  assert.equal(await s.getMeta('farmId'), 'x');
});

test('with no IndexedDB (as in Node) the store uses memory and says it is not persistent', async () => {
  const b = await idbBackend(undefined);
  assert.equal(b.persistent, false);
  assert.equal(accountStatus({ persistent: false, pending: 0 }).text.includes('not keeping data'), true);
  assert.equal(accountStatus({ persistent: true, pending: 3 }).mode, 'device');
});

// ---- farm profile and people

test('a farm profile needs a name, your name, a state and at least one of crops or livestock', () => {
  assert.deepEqual(farmErrors(goodFarm), {});
  const e = farmErrors({ name: ' ', ownerName: '', state: 'XX', crops: false, livestock: false, acres: '-5' });
  assert.deepEqual(Object.keys(e).sort(), ['acres', 'enterprises', 'name', 'ownerName', 'state']);
  assert.deepEqual(farmErrors({ ...goodFarm, acres: '' }), {}, 'acres are optional');
  assert.ok(farmErrors({ ...goodFarm, name: 'x'.repeat(81) }).name);
  const n = normalizeFarm({ ...goodFarm, name: '  Prairie   View ', state: 'sd', acres: '640.5' });
  assert.equal(n.name, 'Prairie View'); assert.equal(n.state, 'SD'); assert.equal(n.acres, 640.5);
});

test('the first save creates the farm and adds you to People as the owner; later saves update it', async () => {
  const s = fresh();
  assert.equal(await getFarm(s), null);
  const first = await saveFarm(s, goodFarm);
  assert.equal((await getFarm(s)).id, first.id);
  assert.deepEqual((await s.list(PERSON)).map(p => [p.data.name, p.data.role]), [['Pat Example', 'owner']]);
  await saveFarm(s, { ...goodFarm, name: 'Prairie View Ranch', livestock: false });
  const f = await getFarm(s);
  assert.equal(f.id, first.id); assert.equal(f.data.name, 'Prairie View Ranch'); assert.equal(f.data.livestock, false);
  assert.equal((await s.list(PERSON)).length, 1, 'the owner is added once, not on every save');
  assert.equal((await s.list(FARM)).length, 1);
  await assert.rejects(saveFarm(s, { ...goodFarm, name: '' }), e => e.fields?.name === 'Give your farm or ranch a name.');
});

test('people: add, change role, remove; the last owner stays', async () => {
  const s = fresh();
  await saveFarm(s, goodFarm);
  const owner = (await s.list(PERSON))[0];
  const hand = await savePerson(s, { name: 'Sam Hand', role: 'worker', phone: '(605) 555-0100' });
  const vet = await savePerson(s, { name: 'Dr. Vet', role: 'viewer' });
  assert.equal((await s.list(PERSON)).length, 3);
  await assert.rejects(savePerson(s, { name: 'Pat Example', role: 'worker' }, owner.id), /at least one owner/);
  await assert.rejects(removePerson(s, owner.id), /at least one owner/);
  await savePerson(s, { name: 'Sam Hand', role: 'owner' }, hand.id);
  await savePerson(s, { name: 'Pat Example', role: 'viewer' }, owner.id); // fine now: Sam is an owner
  assert.equal(await removePerson(s, vet.id), true);
  assert.deepEqual((await s.list(PERSON)).map(p => `${p.data.name}:${p.data.role}`), ['Pat Example:viewer', 'Sam Hand:owner']);
  assert.ok(personErrors({ name: '' }).name);
  assert.ok(personErrors({ name: 'X', phone: 'call me' }).phone);
  assert.equal((await savePerson(s, { name: 'Odd Role', role: 'boss' })).data.role, 'worker', 'unknown roles become worker');
});

// ---- backup

test('a backup restores the same records and farm on another device', async () => {
  const a = fresh();
  await saveFarm(a, goodFarm);
  await savePerson(a, { name: 'Sam Hand', role: 'worker' });
  const gone = await savePerson(a, { name: 'Left Last Year', role: 'worker' });
  await removePerson(a, gone.id);
  const backup = await makeBackup(a, { now: new Date('2026-11-24T15:00:00Z') });
  assert.equal(backup.app, 'FarmLedger'); assert.equal(backup.format, BACKUP_FORMAT); assert.equal(backup.exportedAt, '2026-11-24T15:00:00.000Z');

  const b = fresh();
  await saveFarm(b, { ...goodFarm, name: 'Something Else' }); // replaced by the restore
  await restoreBackup(b, parseBackup(JSON.stringify(backup)));
  assert.equal((await getFarm(b)).data.name, 'Prairie View Farm');
  assert.deepEqual((await b.list(PERSON)).map(p => p.data.name), ['Pat Example', 'Sam Hand']);
  assert.equal((await b.allRecords()).length, (await a.allRecords()).length, 'the deleted person comes along, marked deleted');
});

test('a damaged or foreign file is refused with a plain reason', () => {
  assert.throws(() => parseBackup('not json'), /not a FarmLedger backup \(it is not readable\)/);
  assert.throws(() => parseBackup('{"app":"Other","records":[]}'), /not a FarmLedger backup/);
  assert.throws(() => parseBackup(JSON.stringify({ app: 'FarmLedger', format: 99, records: [] })), /newer FarmLedger/);
  assert.throws(() => parseBackup(JSON.stringify({ app: 'FarmLedger', format: 1, records: [{ id: 'x' }] })), /damaged/);
  assert.throws(() => parseBackup(JSON.stringify({ app: 'FarmLedger', format: 1, farmId: 'f', records: [] })), /farm profile is missing/);
  assert.equal(backupFileName('Prairie View / Farm', new Date('2026-11-24T00:00:00Z')), 'FarmLedger-backup-Prairie-View-Farm-2026-11-24.json');
  assert.equal(backupFileName('', new Date('2026-11-24T00:00:00Z')), 'FarmLedger-backup-farm-2026-11-24.json');
});

// ---- module slots

test('modules show only for the enterprises the farm runs, and bad modules are refused', () => {
  _resetModules();
  const herd = registerModule({ id: 'herd', title: 'Herd', enterprise: 'livestock', summary: 's', route: 'herd' });
  const crops = registerModule({ id: 'crops', title: 'Crops', enterprise: 'crops', summary: 's', route: 'crops', render() {} });
  assert.deepEqual(modulesFor({ crops: true, livestock: true }), [herd, crops]);
  assert.deepEqual(modulesFor({ crops: false, livestock: true }), [herd]);
  assert.deepEqual(modulesFor(null), []);
  assert.equal(moduleByRoute('crops'), crops); assert.equal(moduleByRoute('nope'), null);
  assert.equal(ready(herd), false); assert.equal(ready(crops), true);
  assert.throws(() => registerModule({ id: 'herd', title: 'Again', enterprise: 'livestock', summary: 's', route: 'again' }), /registered twice/);
  assert.throws(() => registerModule({ id: 'x', title: 'X', enterprise: 'poultry', summary: 's', route: 'x' }), /enterprise must be/);
  assert.throws(() => registerModule({ id: 'y', title: 'Y', enterprise: 'crops', summary: 's', route: 'Bad Route' }), /route must be/);
  assert.throws(() => registerModule({ id: 'z' }), /needs a title/);
  _resetModules();
});

test('the herd and crop slots are registered by their own files', async () => {
  _resetModules();
  const herd = (await import('../src/modules/herd/index.js')).default;
  const crops = (await import('../src/modules/crops/index.js')).default;
  assert.equal(herd.enterprise, 'livestock'); assert.equal(crops.enterprise, 'crops');
});
