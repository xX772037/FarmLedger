// Stored-format versions. When the shape of stored records changes, add a step here; every device (and
// every restored backup) is upgraded step by step on start-up, so old phones and old backup files keep
// working. Steps must be safe to run on data that is already partly upgraded.

export const DATA_VERSION = 2;

const STEPS = {
  // 1 → 2: one person can keep several operations. Every record gets the operation it belongs to
  // (until now there was one farm per device, named by the "farmId" setting).
  async 2(store) {
    const farmId = await store.getMeta('farmId');
    if (farmId) {
      for (const r of await store.allRecords()) {
        if (r.opId == null) await store.rewrite({ ...r, opId: farmId });
      }
      if (!(await store.getMeta('currentOpId'))) await store.setMeta('currentOpId', farmId);
    }
  },
};

/** Bring stored data up to DATA_VERSION. Returns the version it started from. */
export async function migrate(store) {
  const from = await store.getMeta('dataVersion', (await store.allRecords()).length || (await store.getMeta('farmId')) ? 1 : DATA_VERSION);
  if (from > DATA_VERSION) throw new Error('These records were saved by a newer FarmLedger. Update the app to open them.');
  for (let v = from + 1; v <= DATA_VERSION; v++) await STEPS[v](store);
  await store.setMeta('dataVersion', DATA_VERSION);
  return from;
}
