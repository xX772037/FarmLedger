// The shared pieces both the herd and crop sides build on: operations, the per-operation store,
// format versions, permissions, money, field lists, shared records, links, reminders and supplies.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryBackend } from '../src/core/db.js';
import { createStore, scope } from '../src/core/store.js';
import { FARM, PERSON, getFarm, saveFarm, createOperation, listOperations, switchOperation, removeOperation, savePerson, removePerson } from '../src/core/farm.js';
import { migrate, DATA_VERSION } from '../src/core/migrate.js';
import { makeBackup, parseBackup, restoreBackup, backupOperations } from '../src/core/backup.js';
import { can, ACTIONS, currentRole } from '../src/core/permissions.js';
import { toCents, formatCents, yearSummary, CATEGORIES } from '../src/core/money.js';
import { normalize, validate, isIsoDate } from '../src/core/schema.js';
import { LAND, CONTACT, PRODUCT, STOCK, MONEY, REMINDER, NOTE, save, prepare } from '../src/core/entities.js';
import { cleanLinks, linksTo, linkedRecords } from '../src/core/links.js';
import { isoDay, addDays, daysBetween, showDate } from '../src/core/dates.js';
import { todayList } from '../src/core/reminders.js';
import { onHand, lotsOf } from '../src/core/inventory.js';

let clock = 1_000;
const fresh = () => createStore(memoryBackend(), { now: () => ++clock });
const farmA = { name: 'Prairie View Farm', ownerName: 'Pat Example', state: 'SD', county: 'Hutchinson', crops: true, livestock: true, acres: '640' };
const farmB = { ...farmA, name: 'Creek Partnership', crops: false };

async function twoOps() {
  const s = fresh();
  const a = await saveFarm(s, farmA);
  const b = await createOperation(s, farmB);
  return { s, a, b, opsA: scope(s, a.id), opsB: scope(s, b.id) };
}

// ---- operations and the per-operation store

test('several operations: each new one becomes current, with its own owner, and you can switch back', async () => {
  const { s, a, b, opsA, opsB } = await twoOps();
  assert.equal((await getFarm(s)).id, b.id, 'the new operation is in use');
  assert.deepEqual((await listOperations(s)).map(o => o.data.name), ['Prairie View Farm', 'Creek Partnership']);
  assert.equal((await opsA.list(PERSON)).length, 1); assert.equal((await opsB.list(PERSON)).length, 1);
  await switchOperation(s, a.id);
  assert.equal((await getFarm(s)).data.name, 'Prairie View Farm');
  await saveFarm(s, { ...farmA, county: 'Turner' });
  assert.equal((await s.get(FARM, a.id)).data.county, 'Turner'); assert.equal((await s.get(FARM, b.id)).data.county, 'Hutchinson');
  await assert.rejects(switchOperation(s, 'nope'), /not on this device/);
  await assert.rejects(createOperation(s, { ...farmB, name: '' }), e => !!e.fields?.name);
});

test('a scoped store only sees and changes its own operation', async () => {
  const { opsA, opsB } = await twoOps();
  const field = await opsA.put(LAND, { name: 'North 80' });
  assert.equal(field.opId, opsA.opId);
  assert.equal((await opsB.list(LAND)).length, 0);
  assert.equal(await opsB.get(LAND, field.id), null);
  assert.equal(await opsB.remove(LAND, field.id), false);
  await assert.rejects(opsB.put(LAND, { name: 'stolen' }, { id: field.id }), /another operation/);
  assert.equal((await opsA.get(LAND, field.id)).data.name, 'North 80');
  assert.throws(() => scope(fresh(), ''), /needs an operation id/);
});

test('people belong to one operation, and each keeps its last owner', async () => {
  const { opsA, opsB } = await twoOps();
  await savePerson(opsA, { name: 'Sam Hand', role: 'worker' });
  assert.equal((await opsA.list(PERSON)).length, 2); assert.equal((await opsB.list(PERSON)).length, 1);
  const ownerB = (await opsB.list(PERSON))[0];
  await assert.rejects(removePerson(opsB, ownerB.id), /at least one owner/);
  assert.equal(await removePerson(opsA, ownerB.id), false, 'not in this operation');
});

test('removing an operation removes its records; the last one cannot be removed', async () => {
  const { s, a, b, opsA, opsB } = await twoOps();
  await opsB.put(LAND, { name: 'Creek pasture' });
  await opsA.put(LAND, { name: 'North 80' });
  assert.equal(await removeOperation(s, b.id), true);
  assert.equal((await getFarm(s)).id, a.id, 'switched to the one that is left');
  assert.deepEqual((await s.list(LAND)).map(r => r.data.name), ['North 80']);
  assert.equal((await opsB.list(PERSON)).length, 0);
  await assert.rejects(removeOperation(s, a.id), /only operation/);
});

// ---- format versions

/** A device as the first version of FarmLedger left it: one farm named by "farmId", no operation on records. */
async function versionOneDevice() {
  const s = fresh();
  const farm = await s.put(FARM, farmA, { id: 'farm-1' });
  await s.put(PERSON, { name: 'Pat Example', role: 'owner', phone: '' });
  await s.setMeta('farmId', farm.id);
  return s;
}

test('old records are upgraded on start-up: every record gets its operation', async () => {
  const s = await versionOneDevice();
  assert.equal(await migrate(s), 1);
  assert.equal(await s.getMeta('dataVersion'), DATA_VERSION);
  assert.equal((await getFarm(s)).id, 'farm-1');
  assert.ok((await s.allRecords()).every(r => r.opId === 'farm-1'));
  assert.equal((await scope(s, 'farm-1').list(PERSON)).length, 1);
  const versions = (await s.allRecords()).map(r => r.version);
  assert.equal(await migrate(s), DATA_VERSION, 'running again does nothing');
  assert.deepEqual((await s.allRecords()).map(r => r.version), versions);
  assert.equal(await s.pendingChanges(), 2, 'upgrading is not a change to back up');
});

test('a new device starts at the current version; a newer one is refused', async () => {
  const s = fresh();
  assert.equal(await migrate(s), DATA_VERSION);
  await s.setMeta('dataVersion', DATA_VERSION + 1);
  await assert.rejects(migrate(s), /newer FarmLedger/);
});

test('a first-version backup file restores and is upgraded', async () => {
  const old = await versionOneDevice();
  const file = { app: 'FarmLedger', format: 1, exportedAt: '2026-01-01T00:00:00.000Z', farmId: 'farm-1', records: await old.allRecords() };
  const parsed = parseBackup(JSON.stringify(file));
  assert.deepEqual(backupOperations(parsed), ['Prairie View Farm']);
  const s = fresh();
  await restoreBackup(s, parsed);
  assert.equal((await getFarm(s)).data.name, 'Prairie View Farm');
  assert.ok((await s.allRecords()).every(r => r.opId === 'farm-1'));
  assert.equal(await s.getMeta('dataVersion'), DATA_VERSION);
});

test('a backup carries every operation and which one was in use', async () => {
  const { s, opsA } = await twoOps();
  await opsA.put(LAND, { name: 'North 80' });
  const b = parseBackup(JSON.stringify(await makeBackup(s)));
  assert.deepEqual(backupOperations(b).sort(), ['Creek Partnership', 'Prairie View Farm']);
  const t = fresh();
  await t.setMeta('farmId', 'left over from before'); // cleared by the restore
  await restoreBackup(t, b);
  assert.equal((await getFarm(t)).data.name, 'Creek Partnership');
  assert.equal(await t.getMeta('farmId'), null);
  assert.equal((await scope(t, opsA.opId).list(LAND)).length, 1);
});

// ---- permissions

test('owners can do everything, workers can record, viewers can only look; money is owners only', () => {
  for (const a of ACTIONS) assert.equal(can('owner', a), true);
  assert.equal(can('worker', 'edit'), true); assert.equal(can('worker', 'money'), false); assert.equal(can('worker', 'people'), false);
  assert.equal(can('viewer', 'view'), true); assert.equal(can('viewer', 'edit'), false); assert.equal(can('viewer', 'money'), false);
  assert.equal(can('stranger', 'view'), false);
  assert.throws(() => can('owner', 'fly'), /Unknown action/);
  assert.equal(currentRole(), 'owner', 'until sign-in exists, this device is the owner');
});

// ---- money

test('amounts are kept as whole cents', () => {
  assert.equal(toCents('1,250.00'), 125000); assert.equal(toCents('$3.5'), 350); assert.equal(toCents('.99'), 99);
  assert.equal(toCents(12.345), 1235); assert.equal(toCents('12.345'), null); assert.equal(toCents('ten'), null); assert.equal(toCents(''), null);
  assert.equal(formatCents(125000), '$1,250.00'); assert.equal(formatCents(-5), '-$0.05'); assert.equal(formatCents(undefined), '$0.00');
});

test('a year summary adds up money in and out by category, for that year only', () => {
  const e = [
    { date: '2026-03-01', direction: 'income', category: 'Cattle sales', cents: 1_500_000 },
    { date: '2026-04-01', direction: 'expense', category: 'Vet and medicine', cents: 45_000 },
    { date: '2026-05-01', direction: 'expense', category: 'Vet and medicine', cents: 5_000 },
    { date: '2025-12-31', direction: 'income', category: 'Cattle sales', cents: 999 },
  ];
  assert.deepEqual(yearSummary(e, '2026'), { income: 1_500_000, expense: 50_000, net: 1_450_000, byCategory: { 'Cattle sales': 1_500_000, 'Vet and medicine': 50_000 } });
  assert.equal(yearSummary(e, 2025).net, 999);
});

// ---- field lists

test('field lists tidy input and say what is wrong, skipping fields that do not apply', () => {
  const fields = [
    { key: 'name', label: 'Name', type: 'text', required: true, max: 10 },
    { key: 'n', label: 'Head', type: 'number', min: 1 },
    { key: 'pay', label: 'Amount', type: 'money' },
    { key: 'day', label: 'Date', type: 'date' },
    { key: 'kind', label: 'Kind', type: 'select', options: [['a', 'A'], 'b'] },
    { key: 'tags', label: 'Tags', type: 'multi', options: ['x', 'y'] },
    { key: 'ok', label: 'OK', type: 'check' },
    { key: 'only', label: 'Only for b', type: 'text', required: true, show: d => d.kind === 'b' },
  ];
  const d = normalize(fields, { name: '  Big   Red ', n: '3', pay: '12.50', day: '2026-02-30', kind: 'a', tags: ['x', 'x', ' '], ok: 'on' });
  assert.deepEqual(d, { name: 'Big Red', n: 3, pay: 1250, day: '2026-02-30', kind: 'a', tags: ['x'], ok: true, only: '' });
  assert.equal(normalize(fields, { pay: 1250 }).pay, 1250, 'a number from code is already cents');
  assert.deepEqual(Object.keys(validate(fields, d)), ['day'], 'February 30th is not a date; "only" is hidden');
  const bad = validate(fields, normalize(fields, { name: 'x'.repeat(11), n: '0', pay: 'lots', kind: 'b', tags: ['z'] }));
  assert.deepEqual(Object.keys(bad).sort(), ['n', 'name', 'only', 'pay', 'tags']);
  assert.ok(validate(fields, { ...d, name: '' }).name.includes('is needed'));
  assert.ok(isIsoDate('2028-02-29')); assert.ok(!isIsoDate('2026-2-3'));
});

// ---- shared records

test('shared records are checked: land, supplies by kind, money categories by direction', () => {
  assert.deepEqual(prepare(LAND, { name: 'North 80', kind: 'field', acres: '80' }).errors, {});
  assert.ok(prepare(LAND, { name: '', kind: 'field' }).errors.name);
  const vaccine = prepare(PRODUCT, { name: 'Bovi-Shield', kind: 'vaccine', unit: 'dose', meatWithdrawalDays: '21', reiHours: 'oops' });
  assert.deepEqual(vaccine.errors, {}, 'REI is not asked about for a vaccine');
  assert.ok(prepare(PRODUCT, { name: 'Roundup', kind: 'chemical', unit: 'gal', reiHours: 'oops' }).errors.reiHours);
  const m = prepare(MONEY, { date: '2026-05-01', direction: 'expense', category: 'Cattle sales', cents: '100' });
  assert.equal(m.data.category, '', 'an income category on money out is cleared');
  assert.ok(m.errors.category);
  assert.deepEqual(prepare(MONEY, { date: '2026-05-01', direction: 'income', category: CATEGORIES.income[0], cents: '1,500.00' }).errors, {});
  assert.ok(prepare(CONTACT, { name: 'Vet', email: 'not an email' }).errors.email);
  assert.ok(prepare(NOTE, { date: '2026-05-01', text: '' }).errors.text, 'a note needs words or a photo');
  assert.deepEqual(prepare(NOTE, { date: '2026-05-01', text: '', photo: { dataUrl: 'data:image/jpeg;base64,', width: 1, height: 1 } }).errors, {});
  assert.throws(() => prepare('cow', {}), /Unknown record kind/);
});

test('saving checks that picked records and links are in the same operation', async () => {
  const { opsA, opsB } = await twoOps();
  const barn = await save(opsA, CONTACT, { name: 'Sale Barn', kinds: ['Sale barn'] });
  const sale = { date: '2026-10-15', direction: 'income', category: 'Cattle sales', cents: '24,500.00', contactId: barn.id };
  const entry = await save(opsA, MONEY, sale);
  assert.equal(entry.data.cents, 2_450_000);
  await assert.rejects(save(opsB, MONEY, sale), e => /isn't in this operation/.test(e.fields?.contactId));
  await assert.rejects(save(opsA, MONEY, { ...sale, cents: '' }), e => !!e.fields?.cents);
  const field = await save(opsA, LAND, { name: 'North 80', kind: 'field' });
  await assert.rejects(save(opsB, NOTE, { date: '2026-05-01', text: 'rocks', links: [{ type: LAND, id: field.id }] }), e => !!e.fields?.links);
  const note = await save(opsA, NOTE, { date: '2026-05-01', text: 'rocks in the SW corner', links: [{ type: LAND, id: field.id }, { type: LAND, id: field.id }, { bad: 1 }] });
  assert.deepEqual(note.data.links, [{ type: LAND, id: field.id }], 'links are cleaned');
  const fromHerd = await save(opsA, REMINDER, { title: 'Withdrawal ends', due: '2026-06-01', source: { type: 'animal', id: 'a1', extra: 'x' } });
  assert.deepEqual(fromHerd.data.source, { type: 'animal', id: 'a1' });
  assert.equal((await save(opsA, REMINDER, { title: 'Preg check', due: '2026-06-01', source: 'herd' })).data.source, 'herd');
});

test('links: clean, test and find records that point at another', async () => {
  assert.deepEqual(cleanLinks([{ type: 'land', id: '1' }, { type: 'land', id: '1' }, { type: '', id: '2' }, null, 'x']), [{ type: 'land', id: '1' }]);
  assert.deepEqual(cleanLinks('nope'), []);
  assert.equal(linksTo({ data: { links: [{ type: 'land', id: '1' }] } }, 'land', '1'), true);
  assert.equal(linksTo({ data: {} }, 'land', '1'), false);
  const { opsA } = await twoOps();
  const f = await opsA.put(LAND, { name: 'North 80' });
  await opsA.put(NOTE, { text: 'a', links: [{ type: LAND, id: f.id }] });
  await opsA.put(NOTE, { text: 'b', links: [] });
  assert.deepEqual((await linkedRecords(opsA, NOTE, { type: LAND, id: f.id })).map(n => n.data.text), ['a']);
});

// ---- dates, reminders, supplies

test('dates are plain local days', () => {
  assert.equal(isoDay(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
  assert.equal(addDays('2026-12-30', 3), '2027-01-02'); assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(daysBetween('2026-03-01', '2026-03-31'), 30);
  assert.equal(showDate('2026-11-24'), 'Nov 24, 2026'); assert.equal(showDate(''), '');
});

test('Today groups open reminders: overdue, today, and the next week', () => {
  const r = (title, due, done = false) => ({ data: { title, due, done } });
  const list = todayList([r('late', '2026-11-20'), r('far', '2026-12-20'), r('now', '2026-11-24'), r('soon', '2026-12-01'), r('finished', '2026-11-24', true), r('week', '2026-11-28')], '2026-11-24');
  assert.deepEqual(Object.fromEntries(Object.entries(list).map(([k, v]) => [k, v.map(x => x.data.title)])), { overdue: ['late'], today: ['now'], soon: ['week', 'soon'] });
});

test('on hand is worked out from stock in and out, with lot numbers newest first', () => {
  const moves = [
    { productId: 'p1', date: '2026-01-01', direction: 'in', qty: 50, lot: 'A1' },
    { productId: 'p1', date: '2026-02-01', direction: 'out', qty: 12.5 },
    { productId: 'p1', date: '2026-03-01', direction: 'in', qty: 0.1, lot: 'B2' },
    { productId: 'p1', date: '2026-03-02', direction: 'in', qty: 0.2, lot: 'B2' },
    { productId: 'p2', date: '2026-01-01', direction: 'out', qty: 3 },
  ];
  assert.deepEqual(onHand(moves), { p1: 37.8, p2: -3 });
  assert.deepEqual(lotsOf(moves, 'p1'), ['B2', 'A1']);
  assert.deepEqual(lotsOf(moves, 'p3'), []);
});

test('stock must name a supply in the same operation', async () => {
  const { opsA, opsB } = await twoOps();
  const p = await save(opsA, PRODUCT, { name: 'Bovi-Shield', kind: 'vaccine', unit: 'dose' });
  await save(opsA, STOCK, { productId: p.id, date: '2026-01-01', direction: 'in', qty: '50', lot: 'A1' });
  await assert.rejects(save(opsB, STOCK, { productId: p.id, date: '2026-01-01', direction: 'in', qty: '5' }), e => !!e.fields?.productId);
  await assert.rejects(save(opsA, STOCK, { productId: p.id, date: '2026-01-01', direction: 'in', qty: '0' }), e => !!e.fields?.qty);
  assert.deepEqual(onHand((await opsA.list(STOCK)).map(s => s.data)), { [p.id]: 50 });
});
