// One rule for who may do what, used by every screen (core and modules). On a single device with no
// sign-in, the person using it is the owner; once cloud accounts exist, each signed-in person's role
// from People applies.

export const ACTIONS = ['view', 'edit', 'money', 'people', 'settings'];

const RULES = {
  owner: new Set(['view', 'edit', 'money', 'people', 'settings']),
  worker: new Set(['view', 'edit']),
  viewer: new Set(['view']),
};

/** can('worker', 'money') → false. Unknown roles can do nothing. */
export function can(role, action) {
  if (!ACTIONS.includes(action)) throw new Error(`Unknown action "${action}".`);
  return RULES[role]?.has(action) ?? false;
}

/** The role of whoever is using the app right now. */
export const currentRole = () => 'owner'; // no sign-in yet: this device's user owns its operations
