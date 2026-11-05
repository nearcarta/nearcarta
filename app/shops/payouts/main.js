// Payouts page. The list is the same component the city tray and the console use.
import { mountShop } from '../../src/panels/deep.js';
import { installBoundary } from '../../src/panels/boundary.js';

const app = document.getElementById('app');
installBoundary(app);
document.querySelector('[data-testid=payout-skel]')?.remove();
mountShop('payouts', app, { auto: true });
