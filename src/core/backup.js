// Backup files: everything on this device (every operation) in one JSON file, and restoring from one.
// Until cloud backup exists this is how records move to a new phone or survive a lost one.
// Files from older versions are upgraded when restored (migrate.js).

import { DATA_VERSION, migrate } from './migrate.js';

export const BACKUP_FORMAT = 2;

export async function makeBackup(store, { now = new Date() } = {}) {
  return {
    app: 'FarmLedger',
    format: BACKUP_FORMAT,
    dataVersion: DATA_VERSION,
    exportedAt: now.toISOString(),
    currentOpId: await store.getMeta('currentOpId'),
    records: await store.allRecords(),
  };
}

export const backupFileName = (farmName, now = new Date()) => {
  const safe = String(farmName || 'farm').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'farm';
  return `FarmLedger-backup-${safe}-${now.toISOString().slice(0, 10)}.json`;
};

/** Check a backup file's text. Returns the parsed backup or throws an error that says what is wrong in plain words. */
export function parseBackup(text) {
  let b;
  try { b = JSON.parse(text); } catch { throw new Error('This file is not a FarmLedger backup (it is not readable).'); }
  if (!b || b.app !== 'FarmLedger' || !Array.isArray(b.records)) throw new Error('This file is not a FarmLedger backup.');
  if (!(b.format >= 1) || b.format > BACKUP_FORMAT || (b.dataVersion || 1) > DATA_VERSION) throw new Error('This backup was made by a newer FarmLedger. Update the app, then try again.');
  for (const r of b.records) {
    if (!r || typeof r.id !== 'string' || typeof r.type !== 'string' || typeof r.version !== 'number' || !r.data || typeof r.data !== 'object') {
      throw new Error('This backup is damaged: a record is missing its id, type or data.');
    }
  }
  const opId = b.format === 1 ? b.farmId : b.currentOpId;
  if (opId && !b.records.some(r => r.id === opId && r.type === 'farm')) throw new Error('This backup is damaged: its farm profile is missing.');
  return b;
}

/** The operations (farm names) in a parsed backup, for the "restore this?" question. */
export const backupOperations = b => b.records.filter(r => r.type === 'farm' && !r.deleted).map(r => r.data.name);

/** Replace what is on this device with the backup, then bring it up to date. */
export async function restoreBackup(store, b) {
  const meta = b.format === 1
    ? { farmId: b.farmId ?? null, dataVersion: 1 }
    : { currentOpId: b.currentOpId ?? null, dataVersion: b.dataVersion || DATA_VERSION };
  await store.replaceAll(b.records, meta);
  await migrate(store);
}
