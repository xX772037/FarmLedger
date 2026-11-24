// Backup files: everything on this device in one JSON file, and restoring from one. Until cloud backup
// exists this is how records move to a new phone or survive a lost one.

export const BACKUP_FORMAT = 1;

export async function makeBackup(store, { now = new Date() } = {}) {
  return {
    app: 'FarmLedger',
    format: BACKUP_FORMAT,
    exportedAt: now.toISOString(),
    farmId: await store.getMeta('farmId'),
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
  if (b.format > BACKUP_FORMAT) throw new Error('This backup was made by a newer FarmLedger. Update the app, then try again.');
  for (const r of b.records) {
    if (!r || typeof r.id !== 'string' || typeof r.type !== 'string' || typeof r.version !== 'number' || typeof r.data !== 'object') {
      throw new Error('This backup is damaged: a record is missing its id, type or data.');
    }
  }
  if (b.farmId && !b.records.some(r => r.id === b.farmId)) throw new Error('This backup is damaged: its farm profile is missing.');
  return b;
}

/** Replace what is on this device with the backup. */
export async function restoreBackup(store, backup) {
  await store.replaceAll(backup.records, { farmId: backup.farmId ?? null });
}
