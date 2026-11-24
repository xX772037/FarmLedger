// The record store every part of FarmLedger uses: the farm profile, people, and (later) animals, fields
// and everything else. Each record is { id, type, data, createdAt, updatedAt, version, deleted }.
//
// Every change is also written to the outbox, so cloud backup can send exactly what changed since the
// last sync. Deleting marks a record deleted instead of erasing it, so the deletion can be synced too.

import { newId } from './ids.js';

export function createStore(backend, { now = () => Date.now() } = {}) {
  const listeners = new Set();
  const changed = type => { for (const fn of listeners) fn(type); };

  async function log(record, op) {
    await backend.put('outbox', { id: newId(), recordId: record.id, type: record.type, op, version: record.version, at: record.updatedAt });
  }

  const store = {
    persistent: backend.persistent,

    /** Add a record, or update it when `id` is given and exists. Returns the saved record. */
    async put(type, data, { id } = {}) {
      if (!type || typeof type !== 'string') throw new Error('A record needs a type.');
      const prev = id ? await backend.get('records', id) : undefined;
      if (prev && prev.type !== type) throw new Error(`Record ${id} is a ${prev.type}, not a ${type}.`);
      const t = now();
      const record = {
        id: prev?.id || id || newId(),
        type,
        data: structuredClone(data),
        createdAt: prev?.createdAt ?? t,
        updatedAt: t,
        version: (prev?.version || 0) + 1,
        deleted: false,
      };
      await backend.put('records', record);
      await log(record, 'put');
      changed(type);
      return record;
    },

    /** One record, or null. Deleted records are not returned. */
    async get(type, id) {
      const r = await backend.get('records', id);
      return r && r.type === type && !r.deleted ? r : null;
    },

    /** Every live record of a type, oldest first. */
    async list(type) {
      return (await backend.getAll('records')).filter(r => r.type === type && !r.deleted).sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
    },

    /** Mark a record deleted (kept so the deletion can be backed up). Returns false if it wasn't there. */
    async remove(type, id) {
      const prev = await backend.get('records', id);
      if (!prev || prev.type !== type || prev.deleted) return false;
      const record = { ...prev, deleted: true, updatedAt: now(), version: prev.version + 1 };
      await backend.put('records', record);
      await log(record, 'delete');
      changed(type);
      return true;
    },

    /** How many changes are waiting for cloud backup. */
    async pendingChanges() { return (await backend.getAll('outbox')).length; },

    async getMeta(key, fallback = null) { const m = await backend.get('meta', key); return m ? m.value : fallback; },
    async setMeta(key, value) { await backend.put('meta', { key, value }); },

    /** Everything, including deleted records, for a backup file. */
    async allRecords() { return backend.getAll('records'); },

    /** Replace everything with the given records (a restored backup). */
    async replaceAll(records, meta = {}) {
      await backend.clear('records');
      await backend.clear('outbox');
      for (const r of records) { await backend.put('records', r); await log(r, r.deleted ? 'delete' : 'put'); }
      for (const [key, value] of Object.entries(meta)) await backend.put('meta', { key, value });
      changed('*');
    },

    /** Call fn(type) after every change; returns a function that stops it. */
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
  return store;
}
