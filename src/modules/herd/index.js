// Herd management (Ranch-working branch). Add the herd screens here and give this module a render().
// Until then it shows on the home screen as "coming soon". See src/core/modules.js for what a module can do.
import { registerModule } from '../../core/modules.js';

export default registerModule({
  id: 'herd',
  title: 'Herd',
  enterprise: 'livestock',
  summary: 'Animals, calving, treatments and withdrawal dates, weights, breeding and sales.',
  route: 'herd',
});
