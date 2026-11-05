// Shop route boot. One mount for every /shops/<name>/ page.
import { installBoundary } from './boundary.js';
import { mountShop } from './deep.js';

const root = document.getElementById('room');
installBoundary(root || document.body);
const id = document.body.dataset.shop || '';
mountShop(id, root, { auto: true });
document.querySelector('[data-testid=shop-skel]')?.remove();
