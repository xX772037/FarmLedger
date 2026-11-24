// Shared screen pieces, for the core screens and the herd and crop modules alike:
// forms drawn from a field list (schema.js), record lists, a two-tap confirm, a notes-and-photos panel
// for any record, and a print button. Everything a person typed goes through esc().

import { optionPairs } from './schema.js';
import { NOTE, save, prepare } from './entities.js';
import { linkedRecords } from './links.js';
import { isoDay, showDate } from './dates.js';
import { formatCents } from './money.js';

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** A button that asks "tap again" before doing something that can't be undone. */
export function confirmClick(btn, label, fn) {
  if (btn.dataset.armed) { delete btn.dataset.armed; fn(); return; }
  const original = btn.textContent;
  btn.dataset.armed = '1'; btn.textContent = label;
  setTimeout(() => { if (btn.isConnected && btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = original; } }, 5000);
}

export const errorSlot = name => `<p class="error" data-error="${esc(name)}" role="alert" hidden></p>`;

/** Show { field: message } next to each field and focus the first; {} clears them. */
export function showErrors(form, fields = {}) {
  form.querySelectorAll('[data-error]').forEach(el => { el.textContent = ''; el.hidden = true; });
  form.querySelectorAll('[aria-invalid]').forEach(el => el.removeAttribute('aria-invalid'));
  let firstBad = null;
  for (const [name, msg] of Object.entries(fields)) {
    const out = form.querySelector(`[data-error="${CSS.escape(name)}"]`);
    if (out) { out.textContent = msg; out.hidden = false; }
    const input = form.querySelector(`[name="${CSS.escape(name)}"]`);
    if (input) { input.setAttribute('aria-invalid', 'true'); firstBad ??= input; }
  }
  firstBad?.focus();
}

const moneyText = c => (typeof c === 'number' ? (c / 100).toFixed(2) : c ?? '');

/**
 * The inputs for a field list. `refs` = { [refType]: [{ id, label }] } for "ref" fields.
 * Hidden fields (show() false) are drawn with the hidden attribute so they can appear when the data changes.
 */
export function fieldsHTML(fields, data = {}, { refs = {} } = {}) {
  return fields.map(f => {
    const v = data[f.key];
    const hidden = f.show && !f.show(data) ? ' hidden' : '';
    // the hint sits outside the <label> (so the field's name stays short) and is tied to it with aria-describedby
    const hint = f.hint ? `<small class="hint" id="h-${f.key}">${esc(f.hint)}</small>` : '';
    const described = f.hint ? ` aria-describedby="h-${f.key}"` : '';
    const label = `${esc(f.label)}${f.required ? '' : ' <small>(optional)</small>'}`;
    const id = `f-${f.key}`;
    switch (f.type) {
      case 'textarea':
        return `<div class="field" data-field="${f.key}"${hidden}><label for="${id}">${label}</label>${hint}<textarea id="${id}" name="${f.key}" rows="3"${described}>${esc(v)}</textarea>${errorSlot(f.key)}</div>`;
      case 'select': case 'ref': {
        const opts = f.type === 'ref' ? (refs[f.refType] || []).map(r => [r.id, r.label]) : optionPairs(typeof f.options === 'function' ? f.options(data) : f.options);
        const none = f.required ? '<option value="">Choose…</option>' : '<option value="">None</option>';
        return `<div class="field" data-field="${f.key}"${hidden}><label for="${id}">${label}</label>${hint}<select id="${id}" name="${f.key}"${described}>${none}${opts.map(([val, txt]) => `<option value="${esc(val)}"${val === v ? ' selected' : ''}>${esc(txt)}</option>`).join('')}</select>${errorSlot(f.key)}</div>`;
      }
      case 'multi':
        return `<fieldset data-field="${f.key}"${hidden}${described}><legend>${label}</legend>${hint}${optionPairs(f.options).map(([val, txt]) => `<label class="check"><input type="checkbox" name="${f.key}" value="${esc(val)}"${(v || []).includes(val) ? ' checked' : ''}> ${esc(txt)}</label>`).join('')}${errorSlot(f.key)}</fieldset>`;
      case 'check':
        return `<div data-field="${f.key}"${hidden}><label class="check"><input type="checkbox" name="${f.key}"${v ? ' checked' : ''}> ${esc(f.label)}</label>${errorSlot(f.key)}</div>`;
      default: {
        const type = f.type === 'date' ? 'date' : f.type === 'number' ? 'number' : 'text';
        const extra = f.type === 'number' ? ' step="any" inputmode="decimal"' : f.type === 'money' ? ' inputmode="decimal" placeholder="0.00"' : '';
        const value = f.type === 'money' ? moneyText(v) : v;
        const pre = f.type === 'money' ? '<span class="money-in"><span aria-hidden="true">$</span>' : '';
        const post = f.type === 'money' ? '</span>' : '';
        return `<div class="field" data-field="${f.key}"${hidden}><label for="${id}">${label}</label>${hint}${pre}<input id="${id}" type="${type}" name="${f.key}" value="${esc(value)}"${extra}${described}>${post}${errorSlot(f.key)}</div>`;
      }
    }
  }).join('');
}

/** Read a form drawn by fieldsHTML back into raw values (strings, booleans, arrays). */
export function readFields(form, fields) {
  const d = new FormData(form), out = {};
  for (const f of fields) {
    if (f.type === 'multi') out[f.key] = d.getAll(f.key);
    else if (f.type === 'check') out[f.key] = d.has(f.key);
    else out[f.key] = d.get(f.key) ?? '';
  }
  return out;
}

/** Re-show/hide fields with show() and refresh option lists (options(data)) as the form changes. */
export function liveFields(form, fields) {
  const update = () => {
    const raw = readFields(form, fields);
    for (const f of fields) {
      const box = form.querySelector(`[data-field="${f.key}"]`);
      if (f.show && box) box.hidden = !f.show(raw);
      if (typeof f.options === 'function') {
        const sel = form.querySelector(`select[name="${f.key}"]`);
        const keep = sel.value;
        const opts = optionPairs(f.options(raw));
        sel.innerHTML = `<option value="">Choose…</option>${opts.map(([val, txt]) => `<option value="${esc(val)}">${esc(txt)}</option>`).join('')}`;
        if (opts.some(([val]) => val === keep)) sel.value = keep;
      }
    }
  };
  form.addEventListener('change', update);
  update();
}

/** A list of records as big tappable rows. items: [{ href, title, detail }]. */
export const listHTML = (items, empty) => (items.length
  ? `<ul class="rows">${items.map(i => `<li><a href="${esc(i.href)}"><b>${esc(i.title)}</b>${i.detail ? `<span class="sub">${esc(i.detail)}</span>` : ''}</a></li>`).join('')}</ul>`
  : `<p class="sub">${esc(empty)}</p>`);

/** A Print button: prints the current screen with the operation's name and today's date on top. */
export function printButtonHTML(label = 'Print') { return `<button type="button" class="btn no-print" data-print>${esc(label)}</button>`; }
export function wirePrint(root, heading) {
  root.querySelectorAll('[data-print]').forEach(b => b.addEventListener('click', () => {
    let head = document.getElementById('printHead');
    if (!head) { head = Object.assign(document.createElement('p'), { id: 'printHead', className: 'print-only' }); document.querySelector('main').prepend(head); }
    head.textContent = `${heading} · printed ${showDate(isoDay())}`;
    window.print();
  }));
}

export { formatCents, showDate };

// ---------------------------------------------------------------- notes and photos on any record

/** Shrink a photo to at most 1600 px on its long side, as a JPEG data URL (keeps storage and backups small). */
export function readPhoto(file, maxSide = 1600) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.naturalWidth * scale)); c.height = Math.max(1, Math.round(img.naturalHeight * scale));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve({ dataUrl: c.toDataURL('image/jpeg', 0.82), width: c.width, height: c.height });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not a picture this phone can open. Try a JPG or PNG.')); };
    img.src = url;
  });
}

/**
 * Draw the notes-and-photos panel for one record into `el`.
 * ops = scope(store, opId); target = { type, id } of the record the notes belong to.
 */
export async function notesPanel(el, ops, target) {
  const notes = (await linkedRecords(ops, NOTE, target)).sort((a, b) => (a.data.date < b.data.date ? 1 : -1));
  el.innerHTML = `<section class="card" aria-labelledby="notesTitle"><h2 id="notesTitle">Notes and photos</h2>
    ${notes.length ? `<ul class="notes">${notes.map(n => `<li><span class="sub">${esc(showDate(n.data.date))}</span>
      ${n.data.text ? `<p>${esc(n.data.text).replace(/\n/g, '<br>')}</p>` : ''}
      ${n.data.photo ? `<img src="${esc(n.data.photo.dataUrl)}" alt="Photo from ${esc(showDate(n.data.date))}" width="${n.data.photo.width}" height="${n.data.photo.height}">` : ''}
      <button type="button" class="btn btn-danger" data-del-note="${esc(n.id)}">Delete note</button></li>`).join('')}</ul>` : '<p class="sub">No notes yet.</p>'}
    <form class="note-form" novalidate>
      <label class="field"><span>Add a note</span><textarea name="text" rows="3"></textarea>${errorSlot('text')}</label>
      <label class="btn">Add a photo<input type="file" name="photo" accept="image/*" capture="environment" hidden></label>
      <p class="sub" data-photo-state></p>
      <div class="row"><button type="submit" class="btn btn-primary">Save note</button></div>
    </form></section>`;
  const form = el.querySelector('form');
  let photo = null;
  form.photo.addEventListener('change', async e => {
    const f = e.target.files?.[0]; e.target.value = '';
    const state = form.querySelector('[data-photo-state]');
    if (!f) return;
    try { photo = await readPhoto(f); state.textContent = 'Photo added.'; }
    catch (x) { photo = null; state.textContent = x.message; }
  });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await save(ops, NOTE, { date: isoDay(), text: form.text.value, links: [target], ...(photo ? { photo } : {}) });
      await notesPanel(el, ops, target);
    } catch (x) { showErrors(form, x.fields || { text: x.message }); }
  });
  el.querySelectorAll('[data-del-note]').forEach(b => b.addEventListener('click', () => confirmClick(b, 'Tap again to delete', async () => {
    await ops.remove(NOTE, b.dataset.delNote);
    await notesPanel(el, ops, target);
  })));
}

export { prepare };
