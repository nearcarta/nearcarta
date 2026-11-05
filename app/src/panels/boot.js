// Shop route boot. One mount for every /shops/<name>/ page.
import { visitor } from '../../design/D8_shops/js/session.js';
import { installBoundary } from './boundary.js';
import { mountShop } from './deep.js';
import { mountSessionRestore, pageSigns, resolveAccount } from './restore.js';

const root = document.getElementById('room');
installBoundary(root || document.body);
const id = document.body.dataset.shop || '';
const saved = visitor();
const accountP = resolveAccount();
if (!saved.signedIn) await accountP;
mountShop(id, root, { auto: true, accountP });
document.querySelector('[data-testid=shop-skel]')?.remove();
accountP.then(plan => {
  if (!pageSigns(id)) return;
  mountSessionRestore(document.querySelector('header') || document.body, plan);
}).catch(() => {});
