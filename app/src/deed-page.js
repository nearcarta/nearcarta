// The deed page: /deed/<token>. Only the current holder opens it, and the check is the chain.
//
// The NFT track asks for "a gated page that only current holders can open". The gate is
// `nft_token(id).owner_id` read fresh on every load, compared with the account signed in on
// this browser. A sold deed stops opening for the seller on their next visit; the link keeps
// working for whoever holds it now, because nothing about the right is stored in the URL.
import { gateDeed, gatedHtml } from './deed-gate.js';
import { visitor } from '../design/D8_shops/js/session.js';
import { rpcClient, viewFn } from '../shared/vault/tx.js';
import MAIN from '../../shared/deployments/mainnet.json' with { type: 'json' };

const root = document.getElementById('deed');
const board = MAIN?.board?.contract || 'board.nearcarta.near';
const DEEDS = 'house.nearcarta.near';

function tokenFromPath() {
  // /deed/<token> (and ?token= for a link that cannot carry a path).
  const m = String(location.pathname || '').match(/\/deed\/([^/?#]+)/);
  if (m) return decodeURIComponent(m[1]);
  try { return new URLSearchParams(location.search).get('token') || ''; } catch { return ''; }
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function main() {
  const token = tokenFromPath();
  const who = visitor();
  const rpc = rpcClient([MAIN?.rpc || 'https://free.rpc.fastnear.com']);
  const view = (c, m, a) => viewFn(rpc, c, m, a);
  const gate = await gateDeed(token, who.accountId, { view, contract: DEEDS });

  if (!gate.open) {
    document.title = 'Nearcarta · this page is for the deed holder';
    root.innerHTML = gatedHtml(gate, esc);
    return;
  }

  // Open: the holder's panel. What the deed owns, in the contract's own numbers.
  document.title = 'Nearcarta · your deed';
  const [purse, line, row] = await Promise.all([
    view(DEEDS, 'house_purse', { token_id: token }).catch(() => null),
    view(DEEDS, 'house_line', { token_id: token }).catch(() => null),
    view(board, 'get_charter', { owner: gate.owner }).catch(() => null),
  ]);
  const y = (v) => (v == null ? '—' : (Number(v) / 1e24).toFixed(4));
  const heirs = (line?.heirs || []).join(', ') || 'none named yet';
  root.innerHTML = `
    <div class="deed-open" data-testid="deed-open">
      <h2>Only the holder sees this</h2>
      <p class="small muted">Held by <code>${esc(gate.owner)}</code>, read from <code>${esc(DEEDS)}</code> just now.</p>
      <dl class="deed-facts">
        <dt>Purse</dt><dd data-testid="deed-purse">${y(purse?.balance)} NEAR</dd>
        <dt>Cap per payment</dt><dd>${y(purse?.cap)} NEAR</dd>
        <dt>Paid out</dt><dd>${y(purse?.paid)} NEAR in ${esc(purse?.pays ?? 0)} payments</dd>
        <dt>Heirs</dt><dd>${esc(heirs)}</dd>
        <dt>Your row</dt><dd>${row ? `allowed to pay ${esc((row.receivers || []).join(', '))}` : 'no row open'}</dd>
      </dl>
      <p><a class="btn" href="/api/house/history/${encodeURIComponent(token)}" data-testid="deed-history-json">History (JSON)</a>
         <a class="btn" href="/?shop=house">Open the House</a></p>
      <p class="small muted">Sell or transfer the deed and this page moves with it: the next owner is read from the chain, not from this tab.</p>
    </div>`;
}

main().catch((e) => {
  if (root) root.innerHTML = `<p class="err" role="alert" data-testid="deed-error">${esc(String(e?.message || e).slice(0, 200))}</p>`;
});
