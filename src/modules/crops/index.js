// Crop management (Farm-working branch). Add the crop screens here and give this module a render().
// Until then it shows on the home screen as "coming soon". See src/core/modules.js for what a module can do.
import { registerModule } from '../../core/modules.js';

export default registerModule({
  id: 'crops',
  title: 'Crops',
  enterprise: 'crops',
  summary: 'Fields on a map, what was planted, sprayed and harvested, yields and costs, year by year.',
  route: 'crops',
});
