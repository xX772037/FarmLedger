// Where FarmLedger keeps its data on the device. Two backends with the same five methods:
//   IndexedDB in the browser (survives closing the app, works with no signal), and
//   memory, for unit tests and for browsers that refuse storage (some private windows).
// Stores: "records" (every farm record), "outbox" (changes waiting for cloud backup), "meta" (settings).

export const STORES = ['records', 'outbox', 'meta'];
const DB_NAME = 'farmledger';
const DB_VERSION = 1;

/** In-memory backend. Data is lost when the page closes; `persistent` says so. */
export function memoryBackend() {
  const data = Object.fromEntries(STORES.map(s => [s, new Map()]));
  const key = (store, value) => (store === 'meta' ? value.key : value.id);
  return {
    persistent: false,
    async getAll(store) { return [...data[store].values()].map(v => structuredClone(v)); },
    async get(store, k) { const v = data[store].get(k); return v === undefined ? undefined : structuredClone(v); },
    async put(store, value) { data[store].set(key(store, value), structuredClone(value)); },
    async delete(store, k) { data[store].delete(k); },
    async clear(store) { data[store].clear(); },
  };
}

/** IndexedDB backend. Resolves to the memory backend if the browser won't open a database. */
export async function idbBackend(idb = globalThis.indexedDB) {
  if (!idb) return memoryBackend();
  let db;
  try {
    db = await new Promise((resolve, reject) => {
      const req = idb.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('records')) d.createObjectStore('records', { keyPath: 'id' }).createIndex('type', 'type');
        if (!d.objectStoreNames.contains('outbox')) d.createObjectStore('outbox', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('The database is open in another tab with an older version.'));
    });
  } catch {
    return memoryBackend();
  }
  const run = (store, mode, fn) => new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Storage was refused (the device may be full).'));
  });
  return {
    persistent: true,
    getAll: store => run(store, 'readonly', s => s.getAll()),
    get: (store, k) => run(store, 'readonly', s => s.get(k)),
    put: (store, value) => run(store, 'readwrite', s => s.put(value)).then(() => undefined),
    delete: (store, k) => run(store, 'readwrite', s => s.delete(k)).then(() => undefined),
    clear: store => run(store, 'readwrite', s => s.clear()).then(() => undefined),
  };
}
