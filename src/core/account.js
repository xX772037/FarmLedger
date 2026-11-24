// Accounts. Today FarmLedger keeps one farm on this device, with no sign-in. Cloud accounts (sign in on
// any phone or computer, with the farm backed up online) plug in here once a provider is chosen.
//
// A cloud provider will supply:
//   signIn(email)    send a one-time sign-in code by email (no passwords to forget)
//   verify(code)     finish signing in; returns { userId, email }
//   signOut()
//   sync(store)      send the store's outbox (every change since the last sync) and fetch other devices' changes
// The data layer already keeps that outbox and gives every record an id and a version for this.

export const cloud = null; // set to a provider object when cloud accounts are added

/** What the app shows about where the farm's records live. */
export function accountStatus({ persistent, pending }) {
  if (cloud) return { mode: 'cloud', text: 'Signed in. Records are backed up online.' };
  return {
    mode: 'device',
    text: persistent
      ? 'Your records are saved on this device. Cloud sign-in is coming; until then, download a backup now and then.'
      : 'This browser is not keeping data, so records last only until you close it. Download a backup to keep them.',
    pending,
  };
}
