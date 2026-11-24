// Crop management (Farm-working branch). Add the crop screens here and give this module a render().
// Until then it shows on the home screen as "coming soon". See src/core/modules.js for what a module can do.
// Plantings and sprays should point at the shared Land records (fields), take seed and chemicals from the shared
// Supplies (REI and pre-harvest interval are already there), and add reminders for re-entry and harvest dates.
import { registerModule } from '../../core/modules.js';

export default registerModule({
  id: 'crops',
  title: 'Crops',
  enterprise: 'crops',
  summary: 'Fields on a map, what was planted, sprayed and harvested, yields and costs, year by year.',
  route: 'crops',
});
