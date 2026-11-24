// FarmLedger app shell. Screens are chosen by the address (#/land, #/money/new, ...):
//   setup, Home (Today), More, Land, Contacts, Supplies, Reminders, Money, People, Farm (and operations),
//   Backup, and the herd and crop modules.
// Everything a module sees goes through ctx.store = scope(store, opId): one operation at a time.

import { idbBackend } from './core/db.js';
import { createStore, scope } from './core/store.js';
import { migrate } from './core/migrate.js';
import { getFarm, saveFarm, createOperation, listOperations, switchOperation, removeOperation, emptyFarm, US_STATES, ROLES, PERSON, savePerson, removePerson } from './core/farm.js';
import { makeBackup, backupFileName, parseBackup, restoreBackup, backupOperations } from './core/backup.js';
import { modulesFor, moduleByRoute, ready } from './core/modules.js';
import { accountStatus } from './core/account.js';
import { can, currentRole } from './core/permissions.js';
import { ENTITIES, LAND, CONTACT, PRODUCT, STOCK, MONEY, REMINDER, save } from './core/entities.js';
import { todayList } from './core/reminders.js';
import { onHand, lotsOf } from './core/inventory.js';
import { yearSummary, formatCents, INCOME } from './core/money.js';
import { isoDay, showDate } from './core/dates.js';
import * as ui from './core/ui.js';
import './modules/herd/index.js';
import './modules/crops/index.js';

const { esc, confirmClick, showErrors, errorSlot } = ui;
const app = document.getElementById('app');
const nav = document.getElementById('nav');
let store;

// ---------------------------------------------------------------- routing

const navigate = path => { if (location.hash !== `#${path}`) location.hash = path; else render(); };
const currentPath = () => (location.hash.replace(/^#/, '') || '/');

/** The generic list/edit screens for the shared record kinds. */
const SHARED = {
  land: { type: LAND, lead: 'Fields, pastures and hay ground. The herd and crop records both use these.', add: 'Add land', empty: 'No land yet.', notes: true },
  contacts: { type: CONTACT, lead: 'Buyers, sale barns, vets, landlords and suppliers.', add: 'Add a contact', empty: 'No contacts yet.', notes: true },
  supplies: { type: PRODUCT, lead: 'Vaccines, medicine, chemicals, seed, fertilizer and feed, with what is on hand.', add: 'Add a supply', empty: 'No supplies yet.', notes: true },
  reminders: { type: REMINDER, lead: 'Things to do by a date. Open ones show on the home screen.', add: 'Add a reminder', empty: 'No reminders yet.' },
  money: { type: MONEY, lead: 'Money in and out for the whole operation. Only owners see this.', add: 'Add money in or out', empty: 'No money entries yet.', perm: 'money' },
};

async function render() {
  const farmRec = await getFarm(store);
  const farm = farmRec?.data || null;
  const path = currentPath();
  const [, first, second] = path.split('/');
  if (!farm && first !== 'setup') return navigate('/setup');
  if (farm && path === '/setup') return navigate('/');
  const ops = farm ? scope(store, farmRec.id) : null;
  const role = currentRole();
  const ctx = { store: ops, farm, opId: farmRec?.id, role, can: action => can(role, action), navigate, ui };
  renderNav(farm, path);
  if (first === 'setup') await setupView(second === 'new' && !!farm);
  else if (path === '/') await homeView(ctx);
  else if (first === 'more') moreView(ctx);
  else if (SHARED[first] && (!SHARED[first].perm || ctx.can(SHARED[first].perm))) {
    if (!second) await sharedListView(first, ctx);
    else await sharedEditView(first, second === 'new' ? null : decodeURIComponent(second), ctx);
  }
  else if (first === 'farm') await farmView(ctx, farmRec.id);
  else if (first === 'people') await peopleView(ctx);
  else if (first === 'backup') await backupView(ctx);
  else {
    const mod = moduleByRoute(first);
    if (mod && modulesFor(farm).includes(mod)) await moduleView(mod, ctx, path.split('/').slice(2));
    else return navigate('/');
  }
  const h1 = app.querySelector('h1');
  if (h1) { h1.tabIndex = -1; h1.focus({ preventScroll: true }); }
  scrollTo({ top: 0 });
}

function renderNav(farm, path) {
  nav.hidden = !farm;
  if (!farm) { nav.innerHTML = ''; return; }
  const links = [['/', 'Home'], ...modulesFor(farm).map(m => [`/${m.route}`, m.title]), ['/more', 'More']];
  const first = path.split('/')[1] || '';
  const here = first === '' ? '/' : (modulesFor(farm).some(m => m.route === first) ? `/${first}` : '/more');
  nav.innerHTML = links.map(([href, label]) => `<a href="#${href}"${href === here ? ' aria-current="page"' : ''}>${esc(label)}</a>`).join('');
}

// ---------------------------------------------------------------- farm profile form

function farmForm(f, submitLabel) {
  return `<form id="farmForm" novalidate>
    <label class="field"><span>Farm or ranch name</span><input type="text" name="name" value="${esc(f.name)}" autocomplete="organization" maxlength="80" required>${errorSlot('name')}</label>
    <label class="field"><span>Your name</span><input type="text" name="ownerName" value="${esc(f.ownerName)}" autocomplete="name" maxlength="80" required>${errorSlot('ownerName')}</label>
    <div class="grid2">
      <label class="field"><span>State</span><select name="state">${US_STATES.map(s => `<option${s === f.state ? ' selected' : ''}>${s}</option>`).join('')}</select>${errorSlot('state')}</label>
      <label class="field"><span>County</span><input type="text" name="county" value="${esc(f.county)}" maxlength="60">${errorSlot('county')}</label>
    </div>
    <fieldset><legend>What do you run?</legend>
      <label class="check"><input type="checkbox" name="crops"${f.crops ? ' checked' : ''}> Crops</label>
      <label class="check"><input type="checkbox" name="livestock"${f.livestock ? ' checked' : ''}> Livestock</label>
      ${errorSlot('enterprises')}
    </fieldset>
    <label class="field"><span>Total acres <small>(optional)</small></span><input type="number" name="acres" value="${esc(f.acres)}" min="0" step="any" inputmode="decimal">${errorSlot('acres')}</label>
    <div class="row"><button type="submit" class="btn btn-primary btn-big">${esc(submitLabel)}</button><span class="saved" id="farmSaved" role="status"></span></div>
  </form>`;
}

const readFarmForm = form => {
  const d = new FormData(form);
  return { name: d.get('name'), ownerName: d.get('ownerName'), state: d.get('state'), county: d.get('county'), crops: d.has('crops'), livestock: d.has('livestock'), acres: d.get('acres') };
};

const farmFieldErrors = (form, err) => {
  const fields = { ...(err.fields || { name: err.message }) };
  if (fields.enterprises) form.querySelector('input[name="crops"]').setAttribute('aria-invalid', 'true');
  showErrors(form, fields);
};

// ---------------------------------------------------------------- restore (setup and Backup)

const restoreSection = intro => `<section class="card" aria-labelledby="rsTitle"><h2 id="rsTitle">Restore from a backup</h2>
      <p>${esc(intro)}</p>
      <label class="btn btn-big" for="restoreFile">Choose a backup file</label>
      <input type="file" id="restoreFile" accept=".json,application/json" hidden>
      <p class="error" id="restoreError" role="alert" hidden></p>
      <div id="restoreConfirm" hidden><p id="restoreSummary"></p><div class="row"><button type="button" class="btn btn-danger btn-big" id="restoreGo">Replace this device's records</button></div></div>
    </section>`;

function wireRestore() {
  let pending = null;
  app.querySelector('#restoreFile').addEventListener('change', async e => {
    const file = e.target.files?.[0]; e.target.value = '';
    const err = app.querySelector('#restoreError'), box = app.querySelector('#restoreConfirm');
    err.hidden = true; box.hidden = true; pending = null;
    if (!file) return;
    try {
      pending = parseBackup(await file.text());
      const names = backupOperations(pending);
      const n = pending.records.filter(r => !r.deleted).length;
      app.querySelector('#restoreSummary').textContent = `Backup of ${names.join(', ') || 'a farm'} from ${new Date(pending.exportedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}, with ${n} record${n === 1 ? '' : 's'}.`;
      box.hidden = false;
    } catch (x) { err.textContent = x.message; err.hidden = false; }
  });
  app.querySelector('#restoreGo').addEventListener('click', e => confirmClick(e.currentTarget, 'Tap again to replace', async () => {
    if (!pending) return;
    await restoreBackup(store, pending);
    navigate('/');
  }));
}

// ---------------------------------------------------------------- screens

async function setupView(another) {
  app.innerHTML = another
    ? `<h1>Add another operation</h1>
       <p class="lead">A separate farm or ranch, like a family partnership, with its own records. You can switch between them.</p>
       <section class="card">${farmForm(emptyFarm(), 'Start this operation')}</section>
       <p><a href="#/farm">Cancel</a></p>`
    : `<h1>Set up your farm</h1>
       <p class="lead">A few details to start. You can change any of them later on the Farm screen.</p>
       <section class="card">${farmForm(emptyFarm(), 'Save and start')}</section>
       ${restoreSection('Moving to a new phone or computer? Restore your backup file here instead of setting up again.')}`;
  if (!another) wireRestore();
  const form = app.querySelector('#farmForm');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    try { await (another ? createOperation(store, readFarmForm(form)) : saveFarm(store, readFarmForm(form))); navigate('/'); }
    catch (err) { farmFieldErrors(form, err); }
  });
}

async function homeView(ctx) {
  const { farm, store: ops } = ctx;
  const mods = modulesFor(farm);
  const operations = await listOperations(store);
  const due = todayList(await ops.list(REMINDER), isoDay());
  const extra = (await Promise.all(mods.filter(m => typeof m.today === 'function').map(m => m.today(ctx)))).flat();
  const status = accountStatus({ persistent: store.persistent, pending: await store.pendingChanges() });
  const where = [farm.county && `${farm.county} County`, farm.state].filter(Boolean).join(', ');
  const item = (r, cls) => `<li class="${cls}"><span><b>${esc(r.data.title)}</b><span class="sub"> · ${cls === 'overdue' ? 'was due ' : ''}${esc(showDate(r.data.due))}</span></span>
      <button type="button" class="btn" data-done="${esc(r.id)}" aria-label="Mark done: ${esc(r.data.title)}">Done</button></li>`;
  const anything = due.overdue.length + due.today.length + due.soon.length + extra.length;
  app.innerHTML = `<div><h1>${esc(farm.name)}</h1><p class="lead">${esc(farm.ownerName)}${where ? ` · ${esc(where)}` : ''}</p>
      ${operations.length > 1 ? `<label class="field switcher"><span>Operation</span><select id="opSwitch">${operations.map(o => `<option value="${esc(o.id)}"${o.id === ctx.opId ? ' selected' : ''}>${esc(o.data.name)}</option>`).join('')}</select></label>` : ''}</div>
    <section class="card" aria-labelledby="todayTitle"><h2 id="todayTitle">Today</h2>
      ${anything ? `<ul class="today">
          ${due.overdue.map(r => item(r, 'overdue')).join('')}${due.today.map(r => item(r, 'due')).join('')}${due.soon.map(r => item(r, 'soon')).join('')}
          ${extra.map(t => `<li>${t.href ? `<a href="${esc(t.href)}">${esc(t.text)}</a>` : esc(t.text)}</li>`).join('')}</ul>`
        : '<p class="sub">Nothing due in the next week. Things like preg checks, withdrawal dates and spray windows will show here.</p>'}
      <div class="row"><a class="btn" href="#/reminders/new">Add a reminder</a></div>
    </section>
    <section class="cards" aria-label="Records">
      ${mods.map(m => `<article class="card"><h2>${esc(m.title)}</h2><p class="sub">${esc(m.summary)}</p>
        ${ready(m) ? `<a class="btn btn-primary" href="#/${esc(m.route)}">Open ${esc(m.title)}</a>` : '<p><span class="chip">Coming soon</span></p>'}</article>`).join('')}
    </section>
    <section class="note${!store.persistent ? ' warn' : ''}" aria-label="Where your records are kept">
      <p>${esc(status.text)}</p><p><a href="#/backup">Download a backup</a></p>
    </section>`;
  app.querySelector('#opSwitch')?.addEventListener('change', async e => { await switchOperation(store, e.target.value); render(); });
  app.querySelectorAll('[data-done]').forEach(b => b.addEventListener('click', async () => {
    const r = await ops.get(REMINDER, b.dataset.done);
    if (r) await ops.put(REMINDER, { ...r.data, done: true }, { id: r.id });
    render();
  }));
}

function moreView(ctx) {
  const tiles = [
    ['/land', 'Land', 'Fields, pastures, hay ground'],
    ['/supplies', 'Supplies', 'Medicine, chemicals, seed, feed on hand'],
    ['/contacts', 'Contacts', 'Buyers, vets, landlords, suppliers'],
    ['/reminders', 'Reminders', 'Things to do by a date'],
    ...(ctx.can('money') ? [['/money', 'Money', 'Money in and out, year totals']] : []),
    ['/people', 'People', 'Who works here, and who sees records'],
    ['/farm', 'Farm', 'Your farm profile and operations'],
    ['/backup', 'Backup', 'Download or restore your records'],
  ];
  app.innerHTML = `<h1>More</h1><nav aria-label="More"><ul class="tiles">${tiles.map(([href, title, sub]) => `<li><a href="#${href}"><b>${esc(title)}</b><span class="sub">${esc(sub)}</span></a></li>`).join('')}</ul></nav>`;
}

/** Options for "ref" fields: the operation's records of each referenced kind. */
async function refOptions(ops, fields) {
  const refs = {};
  for (const f of fields.filter(x => x.type === 'ref')) refs[f.refType] = (await ops.list(f.refType)).map(r => ({ id: r.id, label: ENTITIES[f.refType].label(r.data) }));
  return refs;
}

async function sharedListView(route, ctx) {
  const cfg = SHARED[route], def = ENTITIES[cfg.type], ops = ctx.store;
  const records = await ops.list(cfg.type);
  let body;
  if (cfg.type === MONEY) {
    const years = [...new Set([String(new Date().getFullYear()), ...records.map(r => r.data.date.slice(0, 4))])].sort().reverse();
    const year = sessionStorage.getItem('moneyYear') && years.includes(sessionStorage.getItem('moneyYear')) ? sessionStorage.getItem('moneyYear') : years[0];
    const inYear = records.filter(r => r.data.date.startsWith(`${year}-`)).sort((a, b) => (a.data.date < b.data.date ? 1 : -1));
    const sum = yearSummary(inYear.map(r => r.data), year);
    body = `<label class="field switcher"><span>Year</span><select id="year">${years.map(y => `<option${y === year ? ' selected' : ''}>${y}</option>`).join('')}</select></label>
      <section class="card"><h2>${esc(year)} totals</h2><dl class="totals">
        <div><dt>Money in</dt><dd>${formatCents(sum.income)}</dd></div><div><dt>Money out</dt><dd>${formatCents(sum.expense)}</dd></div>
        <div class="net"><dt>Net</dt><dd>${formatCents(sum.net)}</dd></div></dl></section>
      ${ui.listHTML(inYear.map(r => ({ href: `#/money/${encodeURIComponent(r.id)}`, title: `${r.data.direction === INCOME ? '+' : '−'}${formatCents(r.data.cents)} · ${r.data.category}`, detail: [showDate(r.data.date), r.data.note.split('\n')[0]].filter(Boolean).join(' · ') })), `No money entries in ${year}.`)}`;
  } else if (cfg.type === PRODUCT) {
    const have = onHand((await ops.list(STOCK)).map(s => s.data));
    const unit = u => ENTITIES[PRODUCT].fields[2].options.find(([v]) => v === u)?.[1] || u;
    body = ui.listHTML(records.map(r => ({ href: `#/supplies/${encodeURIComponent(r.id)}`, title: r.data.name, detail: `${def.detail(r.data)} · ${have[r.id] ?? 0} ${unit(r.data.unit)} on hand` })), cfg.empty);
  } else if (cfg.type === REMINDER) {
    const sorted = [...records].sort((a, b) => (a.data.due < b.data.due ? -1 : 1));
    const open = sorted.filter(r => !r.data.done), done = sorted.filter(r => r.data.done).reverse();
    body = `<h2>To do</h2>${ui.listHTML(open.map(r => ({ href: `#/reminders/${encodeURIComponent(r.id)}`, title: r.data.title, detail: showDate(r.data.due) })), 'Nothing to do.')}
      ${done.length ? `<h2>Done</h2>${ui.listHTML(done.map(r => ({ href: `#/reminders/${encodeURIComponent(r.id)}`, title: r.data.title, detail: showDate(r.data.due) })), '')}` : ''}`;
  } else {
    const sorted = [...records].sort((a, b) => def.label(a.data).localeCompare(def.label(b.data)));
    body = ui.listHTML(sorted.map(r => ({ href: `#/${route}/${encodeURIComponent(r.id)}`, title: def.label(r.data), detail: def.detail?.(r.data) })), cfg.empty);
  }
  app.innerHTML = `<div><h1>${esc(def.title)}</h1><p class="lead">${esc(cfg.lead)}</p></div>
    <div class="row no-print"><a class="btn btn-primary btn-big" href="#/${route}/new">${esc(cfg.add)}</a>${records.length ? ui.printButtonHTML() : ''}</div>
    ${body}`;
  app.querySelector('#year')?.addEventListener('change', e => { try { sessionStorage.setItem('moneyYear', e.target.value); } catch { /* private mode */ } render(); });
  ui.wirePrint(app, `${ctx.farm.name} · ${def.title}`);
}

async function sharedEditView(route, id, ctx) {
  const cfg = SHARED[route], def = ENTITIES[cfg.type], ops = ctx.store;
  const rec = id ? await ops.get(cfg.type, id) : null;
  if (id && !rec) return navigate(`/${route}`);
  const defaults = { date: isoDay(), due: isoDay() };
  const data = rec ? rec.data : Object.fromEntries(def.fields.filter(f => defaults[f.key]).map(f => [f.key, defaults[f.key]]));
  const title = rec ? def.label(rec.data) : cfg.add;
  app.innerHTML = `<div><p class="no-print"><a href="#/${route}">← ${esc(def.title)}</a></p><h1>${esc(title)}</h1></div>
    <section class="card"><form id="recForm" novalidate>${ui.fieldsHTML(def.fields, data, { refs: await refOptions(ops, def.fields) })}
      <div class="row"><button type="submit" class="btn btn-primary btn-big">${rec ? 'Save changes' : 'Save'}</button>
      ${rec ? '<button type="button" class="btn btn-danger" id="delRec">Delete</button>' : ''}</div></form></section>
    <div id="extra"></div><div id="notes"></div>`;
  const form = app.querySelector('#recForm');
  ui.liveFields(form, def.fields);
  form.addEventListener('submit', async e => {
    e.preventDefault();
    try { await save(ops, cfg.type, { ...ui.readFields(form, def.fields), ...(rec?.data.links ? { links: rec.data.links } : {}), ...(rec?.data.source ? { source: rec.data.source } : {}) }, rec?.id); navigate(`/${route}`); }
    catch (err) { showErrors(form, err.fields || {}); }
  });
  app.querySelector('#delRec')?.addEventListener('click', e => confirmClick(e.currentTarget, 'Tap again to delete', async () => { await ops.remove(cfg.type, rec.id); navigate(`/${route}`); }));
  if (rec && cfg.type === PRODUCT) await stockPanel(app.querySelector('#extra'), ops, rec);
  if (rec && cfg.notes) await ui.notesPanel(app.querySelector('#notes'), ops, { type: cfg.type, id: rec.id });
}

/** On a supply's page: what's on hand, lot numbers, and its stock changes, with a form to add one. */
async function stockPanel(el, ops, product) {
  const moves = (await ops.list(STOCK)).filter(s => s.data.productId === product.id).sort((a, b) => (a.data.date < b.data.date ? 1 : -1));
  const have = onHand(moves.map(m => m.data))[product.id] ?? 0;
  const unit = ENTITIES[PRODUCT].fields[2].options.find(([v]) => v === product.data.unit)?.[1] || product.data.unit;
  const lots = lotsOf(moves.map(m => m.data), product.id);
  const fields = ENTITIES[STOCK].fields.filter(f => f.key !== 'productId');
  el.innerHTML = `<section class="card" aria-labelledby="stockTitle"><h2 id="stockTitle">On hand: ${esc(have)} ${esc(unit)}</h2>
    ${lots.length ? `<p class="sub">Lot numbers: ${esc(lots.join(', '))}</p>` : ''}
    ${moves.length ? `<ul class="rows plain">${moves.map(m => `<li><span><b>${m.data.direction === 'in' ? '+' : '−'}${esc(m.data.qty)} ${esc(unit)}</b> <span class="sub">${esc(showDate(m.data.date))}${m.data.lot ? ` · lot ${esc(m.data.lot)}` : ''}${m.data.note ? ` · ${esc(m.data.note)}` : ''}</span></span>
      <button type="button" class="btn btn-danger" data-del-stock="${esc(m.id)}">Delete</button></li>`).join('')}</ul>` : '<p class="sub">No stock recorded yet.</p>'}
    <form id="stockForm" novalidate><h3>Record stock in or out</h3>${ui.fieldsHTML(fields, { date: isoDay() })}
      <div class="row"><button type="submit" class="btn btn-primary">Save</button></div></form></section>`;
  const form = el.querySelector('#stockForm');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    try { await save(ops, STOCK, { ...ui.readFields(form, fields), productId: product.id }); await stockPanel(el, ops, product); }
    catch (err) { showErrors(form, err.fields || {}); }
  });
  el.querySelectorAll('[data-del-stock]').forEach(b => b.addEventListener('click', () => confirmClick(b, 'Tap again to delete', async () => { await ops.remove(STOCK, b.dataset.delStock); await stockPanel(el, ops, product); })));
}

async function farmView(ctx, opId) {
  const operations = await listOperations(store);
  app.innerHTML = `<h1>Farm</h1><section class="card">${farmForm(ctx.farm, 'Save changes')}</section>
    <section class="card" aria-labelledby="opsTitle"><h2 id="opsTitle">Operations on this device</h2>
      <p class="sub">Keep separate records for another farm or ranch, like a family partnership, and switch between them.</p>
      <ul class="people">${operations.map(o => `<li><div class="who"><b>${esc(o.data.name)}</b>${o.id === opId ? '<span class="sub">In use now</span>' : ''}</div>
        <div class="row">${o.id === opId ? '' : `<button type="button" class="btn" data-switch="${esc(o.id)}">Switch to it</button>`}
        ${operations.length > 1 ? `<button type="button" class="btn btn-danger" data-remove-op="${esc(o.id)}">Remove</button>` : ''}</div></li>`).join('')}</ul>
      <p class="error" id="opError" role="alert" hidden></p>
      <div class="row"><a class="btn" href="#/setup/new">Add another operation</a></div>
    </section>`;
  const form = app.querySelector('#farmForm');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await saveFarm(store, readFarmForm(form));
      showErrors(form, {});
      renderNav((await getFarm(store)).data, currentPath());
      app.querySelector('#farmSaved').textContent = 'Saved.';
    } catch (err) { farmFieldErrors(form, err); }
  });
  app.querySelectorAll('[data-switch]').forEach(b => b.addEventListener('click', async () => { await switchOperation(store, b.dataset.switch); navigate('/'); }));
  app.querySelectorAll('[data-remove-op]').forEach(b => b.addEventListener('click', () => confirmClick(b, 'Tap again: removes all its records', async () => {
    try { await removeOperation(store, b.dataset.removeOp); render(); }
    catch (err) { const out = app.querySelector('#opError'); out.textContent = err.message; out.hidden = false; }
  })));
}

async function peopleView(ctx) {
  const ops = ctx.store;
  const people = await ops.list(PERSON);
  app.innerHTML = `<div><h1>People</h1><p class="lead">Who works on ${esc(ctx.farm.name)}, and who you share records with.</p></div>
    <section class="card" aria-labelledby="listTitle"><h2 id="listTitle">On this operation</h2>
      <ul class="people">${people.map(p => `<li><div class="who"><b>${esc(p.data.name)}</b><span class="sub">${esc(ROLES[p.data.role].label)}${p.data.phone ? ` · ${esc(p.data.phone)}` : ''}</span></div>
        <button type="button" class="btn btn-danger" data-remove="${esc(p.id)}">Remove</button></li>`).join('')}</ul>
      <p class="error" id="peopleError" role="alert" hidden></p>
    </section>
    <section class="card" aria-labelledby="addTitle"><h2 id="addTitle">Add a person</h2>
      <form id="personForm" novalidate>
        <label class="field"><span>Name</span><input type="text" name="name" maxlength="80" autocomplete="off">${errorSlot('name')}</label>
        <label class="field"><span>Role</span><select name="role">${Object.entries(ROLES).map(([k, r]) => `<option value="${k}"${k === 'worker' ? ' selected' : ''}>${esc(r.label)}</option>`).join('')}</select>${errorSlot('role')}</label>
        <p class="hint" id="roleHint">${esc(ROLES.worker.can)}</p>
        <label class="field"><span>Phone <small>(optional)</small></span><input type="tel" name="phone" maxlength="20" autocomplete="off">${errorSlot('phone')}</label>
        <div class="row"><button type="submit" class="btn btn-primary btn-big">Add person</button></div>
      </form>
      <p class="hint">Roles are saved now and take effect once cloud sign-in arrives. On this device, everyone is the owner.</p>
    </section>`;
  const form = app.querySelector('#personForm');
  form.role.addEventListener('change', () => { app.querySelector('#roleHint').textContent = ROLES[form.role.value].can; });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const d = new FormData(form);
    try { await savePerson(ops, { name: d.get('name'), role: d.get('role'), phone: d.get('phone') }); render(); }
    catch (err) { showErrors(form, err.fields || { name: err.message }); }
  });
  app.querySelectorAll('[data-remove]').forEach(b => b.addEventListener('click', () => confirmClick(b, 'Tap again to remove', async () => {
    const out = app.querySelector('#peopleError');
    try { await removePerson(ops, b.dataset.remove); render(); }
    catch (err) { out.textContent = err.message; out.hidden = false; }
  })));
}

async function backupView(ctx) {
  const status = accountStatus({ persistent: store.persistent, pending: await store.pendingChanges() });
  app.innerHTML = `<div><h1>Backup</h1><p class="lead">${esc(status.text)}</p></div>
    <section class="card" aria-labelledby="dlTitle"><h2 id="dlTitle">Download a backup</h2>
      <p>One file with everything on this device, every operation included. Keep it somewhere safe, like your email or a USB stick.</p>
      <div class="row"><button type="button" class="btn btn-primary btn-big" id="download">Download backup</button></div>
    </section>
    ${restoreSection('Replaces everything on this device with what is in the file. Use it on a new phone, or after losing one.')}`;
  app.querySelector('#download').addEventListener('click', async () => {
    const backup = await makeBackup(store);
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 1)], { type: 'application/json' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: backupFileName(ctx.farm.name) });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  });
  wireRestore();
}

async function moduleView(mod, ctx, rest) {
  if (ready(mod)) { app.innerHTML = ''; await mod.render(app, { ...ctx, path: rest }); return; }
  app.innerHTML = `<div><h1>${esc(mod.title)}</h1><p class="lead">${esc(mod.summary)}</p></div>
    <p class="note">Coming soon.</p>`;
}

// ---------------------------------------------------------------- start

if ('serviceWorker' in navigator && window.top === window && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* works without it, just not offline */ });
}

(async () => {
  store = createStore(await idbBackend());
  try { await migrate(store); }
  catch (err) { app.innerHTML = `<h1>FarmLedger</h1><p class="note warn">${esc(err.message)}</p>`; return; }
  try { await navigator.storage?.persist?.(); } catch { /* the browser decides */ }
  addEventListener('hashchange', render);
  await render();
})();
