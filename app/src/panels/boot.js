// Shop route boot. One mount for every /shops/<name>/ page.
import { visitor } from '../../design/D8_shops/js/session.js';
import { paintTrack } from '../../design/D8_shops/js/names.js';
import { installBoundary } from './boundary.js';
import { mountShop } from './deep.js';
import { mountSessionRestore, pageSigns, resolveAccount } from './restore.js';

const root = document.getElementById('room');
installBoundary(root || document.body);
const id = document.body.dataset.shop || '';
paintTrack(id);
const saved = visitor();
// A check or a quote does not wait on the wallet peek. That peek also downloads the house bundle,
// and on the bank it was sitting in front of the TEE request.
const accountP = pageSigns(id) ? resolveAccount() : Promise.resolve(null);
if (!saved.signedIn && pageSigns(id)) await accountP;
mountShop(id, root, { auto: true, accountP });
document.querySelector('[data-testid=shop-skel]')?.remove();
accountP.then(plan => {
  if (!pageSigns(id)) return;
  mountSessionRestore(document.querySelector('header') || document.body, plan);
}).catch(() => {});
