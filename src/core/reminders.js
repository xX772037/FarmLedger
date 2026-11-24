// The home screen's Today list, from reminders. Modules add their own reminders (a withdrawal date, a
// preg check, a spray window) with save(ops, REMINDER, { title, due, source: 'herd', links }), so
// everything due shows in one place.

import { addDays } from './dates.js';

/** Group open reminders: overdue, due today, and the next `days` days. Done ones are left out. */
export function todayList(reminders, today, days = 7) {
  const until = addDays(today, days);
  const open = reminders.filter(r => !r.data.done).sort((a, b) => (a.data.due < b.data.due ? -1 : a.data.due > b.data.due ? 1 : 0));
  return {
    overdue: open.filter(r => r.data.due < today),
    today: open.filter(r => r.data.due === today),
    soon: open.filter(r => r.data.due > today && r.data.due <= until),
  };
}
