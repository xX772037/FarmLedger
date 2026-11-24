// FarmLedger app shell: first-time setup, the home ("Today") screen, the farm profile, people, backup,
// and the herd and crop modules. Screens are chosen by the address (#/farm, #/people, ...).

import { idbBackend } from './core/db.js';
import { createStore } from './core/store.js';
import { getFarm, saveFarm, emptyFarm, US_STATES, ROLES, PERSON, savePerson, removePerson } from './core/farm.js';
import { makeBackup, backupFileName, parseBackup, restoreBackup } from './core/backup.js';
import { modulesFor, moduleByRoute, ready } from './core/modules.js';
import { accountStatus } from './core/account.js';
import './modules/herd/index.js';
import './modules/crops/index.js';

const app = document.getElementById('app');
const nav = document.getElementById('nav');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let store;

// ---------------------------------------------------------------- routing

const navigate = path => { if (location.hash !== `#${path}`) location.hash = path; else render(); };
const currentPath = () => (location.hash.replace(/^#/, '') || '/');

async function render() {
  const farmRec = await getFarm(store);
  const farm = farmRec?.data || null;
  const path = currentPath();
  if (!farm && path !== '/setup') return navigate('/setup');
  if (farm && path === '/setup') return navigate('/');
  renderNav(farm, path);
  const ctx = { store, farm, navigate };
  const [, first] = path.split('/');
  if (path === '/setup') await setupView();
  else if (path === '/') await homeView(ctx);
  else if (first === 'farm') await farmView(ctx);
  else if (first === 'people') await peopleView(ctx);
  else if (first === 'backup') await backupView(ctx);
  else {
    const mod = moduleByRoute(first);
    if (mod && modulesFor(farm).includes(mod)) await moduleView(mod, ctx);
    else return navigate('/');
  }
  const h1 = app.querySelector('h1');
  if (h1) { h1.tabIndex = -1; h1.focus({ preventScroll: true }); }
  scrollTo({ top: 0 });
}

function renderNav(farm, path) {
  nav.hidden = !farm;
  if (!farm) { nav.innerHTML = ''; return; }
  const links = [['/', 'Home'], ...modulesFor(farm).map(m => [`/${m.route}`, m.title]), ['/farm', 'Farm'], ['/people', 'People'], ['/backup', 'Backup']];
  const here = '/' + (path.split('/')[1] || '');
  nav.innerHTML = links.map(([href, label]) => `<a href="#${href}"${href === here ? ' aria-current="page"' : ''}>${esc(label)}</a>`).join('');
}

// ---------------------------------------------------------------- shared bits

/** A button that asks "tap again" before doing something that can't be undone. */
function confirmClick(btn, label, fn) {
  if (btn.dataset.armed) { delete btn.dataset.armed; fn(); return; }
  const original = btn.textContent;
  btn.dataset.armed = '1'; btn.textContent = label;
  setTimeout(() => { if (btn.isConnected && btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = original; } }, 5000);
}

function showErrors(form, fields = {}) {
  form.querySelectorAll('[data-error]').forEach(el => { el.textContent = ''; el.hidden = true; });
  form.querySelectorAll('[aria-invalid]').forEach(el => el.removeAttribute('aria-invalid'));
  let firstBad = null;
  for (const [name, msg] of Object.entries(fields)) {
    const out = form.querySelector(`[data-error="${name}"]`);
    if (out) { out.textContent = msg; out.hidden = false; }
    const input = form.querySelector(`[name="${name}"]`) || form.querySelector(`[data-group="${name}"] input`);
    if (input) { input.setAttribute('aria-invalid', 'true'); firstBad ??= input; }
  }
  firstBad?.focus();
}

const errorSlot = name => `<p class="error" data-error="${name}" role="alert" hidden></p>`;

function farmForm(f, submitLabel) {
  return `<form id="farmForm" novalidate>
    <label class="field"><span>Farm or ranch name</span><input type="text" name="name" value="${esc(f.name)}" autocomplete="organization" maxlength="80" required>${errorSlot('name')}</label>
    <label class="field"><span>Your name</span><input type="text" name="ownerName" value="${esc(f.ownerName)}" autocomplete="name" maxlength="80" required>${errorSlot('ownerName')}</label>
    <div class="grid2">
      <label class="field"><span>State</span><select name="state">${US_STATES.map(s => `<option${s === f.state ? ' selected' : ''}>${s}</option>`).join('')}</select>${errorSlot('state')}</label>
      <label class="field"><span>County</span><input type="text" name="county" value="${esc(f.county)}" maxlength="60">${errorSlot('county')}</label>
    </div>
    <fieldset data-group="enterprises"><legend>What do you run?</legend>
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

/** The restore-from-file controls, used on the Backup screen and on setup (a new phone has no farm yet). */
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
      const f = pending.records.find(r => r.id === pending.farmId)?.data;
      const n = pending.records.filter(r => !r.deleted).length;
      app.querySelector('#restoreSummary').textContent = `Backup of ${f?.name || 'a farm'} from ${new Date(pending.exportedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}, with ${n} record${n === 1 ? '' : 's'}.`;
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

async function setupView() {
  app.innerHTML = `<h1>Set up your farm</h1>
    <p class="lead">A few details to start. You can change any of them later on the Farm screen.</p>
    <section class="card">${farmForm(emptyFarm(), 'Save and start')}</section>
    ${restoreSection('Moving to a new phone or computer? Restore your backup file here instead of setting up again.')}`;
  wireRestore();
  const form = app.querySelector('#farmForm');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    try { await saveFarm(store, readFarmForm(form)); navigate('/'); }
    catch (err) { showErrors(form, err.fields || { name: err.message }); }
  });
}

async function homeView({ farm }) {
  const mods = modulesFor(farm);
  const today = (await Promise.all(mods.filter(m => typeof m.today === 'function').map(m => m.today({ store, farm })))).flat();
  const status = accountStatus({ persistent: store.persistent, pending: await store.pendingChanges() });
  const where = [farm.county && `${farm.county} County`, farm.state].filter(Boolean).join(', ');
  app.innerHTML = `<div><h1>${esc(farm.name)}</h1><p class="lead">${esc(farm.ownerName)}${where ? ` · ${esc(where)}` : ''}</p></div>
    <section class="card" aria-labelledby="todayTitle"><h2 id="todayTitle">Today</h2>
      ${today.length ? `<ul class="today">${today.map(t => `<li>${t.href ? `<a href="${esc(t.href)}">${esc(t.text)}</a>` : esc(t.text)}</li>`).join('')}</ul>`
        : '<p class="sub">Nothing due today. Things like preg checks, withdrawal dates and spray windows will show here.</p>'}
    </section>
    <section class="cards" aria-label="Records">
      ${mods.map(m => `<article class="card"><h2>${esc(m.title)}</h2><p class="sub">${esc(m.summary)}</p>
        ${ready(m) ? `<a class="btn btn-primary" href="#/${esc(m.route)}">Open ${esc(m.title)}</a>` : '<p><span class="chip">Coming soon</span></p>'}</article>`).join('')}
    </section>
    <section class="note${status.mode === 'device' && !store.persistent ? ' warn' : ''}" aria-label="Where your records are kept">
      <p>${esc(status.text)}</p><p><a href="#/backup">Download a backup</a></p>
    </section>`;
}

async function farmView({ farm }) {
  app.innerHTML = `<h1>Farm</h1><section class="card">${farmForm(farm, 'Save changes')}</section>`;
  const form = app.querySelector('#farmForm');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await saveFarm(store, readFarmForm(form));
      showErrors(form, {});
      renderNav((await getFarm(store)).data, currentPath());
      app.querySelector('#farmSaved').textContent = 'Saved.';
    } catch (err) { showErrors(form, err.fields || { name: err.message }); }
  });
}

async function peopleView() {
  const people = await store.list(PERSON);
  app.innerHTML = `<div><h1>People</h1><p class="lead">Who works on the farm, and who you share records with.</p></div>
    <section class="card" aria-labelledby="listTitle"><h2 id="listTitle">On this farm</h2>
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
    try { await savePerson(store, { name: d.get('name'), role: d.get('role'), phone: d.get('phone') }); render(); }
    catch (err) { showErrors(form, err.fields || { name: err.message }); }
  });
  app.querySelectorAll('[data-remove]').forEach(b => b.addEventListener('click', () => confirmClick(b, 'Tap again to remove', async () => {
    const out = app.querySelector('#peopleError');
    try { await removePerson(store, b.dataset.remove); render(); }
    catch (err) { out.textContent = err.message; out.hidden = false; }
  })));
}

async function backupView({ farm }) {
  const status = accountStatus({ persistent: store.persistent, pending: await store.pendingChanges() });
  app.innerHTML = `<div><h1>Backup</h1><p class="lead">${esc(status.text)}</p></div>
    <section class="card" aria-labelledby="dlTitle"><h2 id="dlTitle">Download a backup</h2>
      <p>One file with everything on this device. Keep it somewhere safe, like your email or a USB stick.</p>
      <div class="row"><button type="button" class="btn btn-primary btn-big" id="download">Download backup</button></div>
    </section>
    ${restoreSection('Replaces everything on this device with what is in the file. Use it on a new phone, or after losing one.')}`;
  app.querySelector('#download').addEventListener('click', async () => {
    const backup = await makeBackup(store);
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 1)], { type: 'application/json' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: backupFileName(farm.name) });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  });
  wireRestore();
}

async function moduleView(mod, ctx) {
  if (ready(mod)) { app.innerHTML = ''; await mod.render(app, ctx); return; }
  app.innerHTML = `<div><h1>${esc(mod.title)}</h1><p class="lead">${esc(mod.summary)}</p></div>
    <p class="note">Coming soon.</p>`;
}

// ---------------------------------------------------------------- start

if ('serviceWorker' in navigator && window.top === window && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* works without it, just not offline */ });
}

(async () => {
  store = createStore(await idbBackend());
  try { await navigator.storage?.persist?.(); } catch { /* the browser decides */ }
  addEventListener('hashchange', render);
  await render();
})();
