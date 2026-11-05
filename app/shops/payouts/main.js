// Payouts page. The list is the same component the city tray and the console use.
import { mountShop } from '../../src/panels/deep.js';
import { installBoundary } from '../../src/panels/boundary.js';
import { visitor } from '../../design/D8_shops/js/session.js';

const app = document.getElementById('app');
installBoundary(app);
document.querySelector('[data-testid=payout-skel]')?.remove();
const who = visitor();
mountShop('payouts', app, {
  auto: true,
  rows: () => (who.signedIn ? [{ to: who.accountId, amt: '0.001' }] : []),
});
