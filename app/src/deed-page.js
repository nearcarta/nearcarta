// The deed page: /deed/<token>. Only the current holder opens it, and the check is the chain.
//
// The NFT track asks for "a gated page that only current holders can open". The gate is the
// deed contract's own `owner_id`, read fresh on every load and compared with the account signed
// in on this browser. A sold deed stops opening for the seller on their next visit; the link
// keeps working for whoever holds it now, because nothing about the right lives in the URL.
//
// The ownership read goes through the API (`/api/house/deed/<token>`), not a raw RPC in the
// browser: this module is served as a plain file from the deploy root, so it can only import
// modules that are published there. Importing `/shared/...` 404s, which is how the first
// version of this page hung on "Reading the deed…".
import { gateDeed, gatedHtml } from './deed-gate.js';
import { visitor } from '../design/D8_shops/js/session.js';

const root = document.getElementById('deed');
const api = () => (globalThis.NEARCARTA_API || '').replace(/\/$/, '');

function tokenFromPath() {
  const m = String(location.pathname || '').match(/\/deed\/([^/?#]+)/);
  if (m) return decodeURIComponent(m[1]);
  try { return new URLSearchParams(location.search).get('token') || ''; } catch { return ''; }
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// The gate takes a `view` function. Here that view is the API: one request, one answer, and a
// failure is a failure rather than a silent empty.
const apiView = (contract, method, args) => {
  if (method !== 'nft_token') return Promise.resolve(null);
  return fetch(api() + '/api/house/deed/' + encodeURIComponent(args?.token_id || ''), { cache: 'no-store' })
    .then(r => (r.ok || r.status === 404 ? r.json() : Promise.reject(new Error('the API answered ' + r.status))))
    .then(body => body?.token || null);
};

async function main() {
  const token = tokenFromPath();
  const who = visitor();
  const gate = await gateDeed(token, who.accountId, { view: apiView, contract: 'house.nearcarta.near' });

  if (!gate.open) {
    document.title = 'Nearcarta · this page is for the deed holder';
    root.innerHTML = gatedHtml(gate, esc);
    return;
  }

  document.title = 'Nearcarta · your deed';
  const [deed, line, history] = await Promise.all([
    fetch(api() + '/api/house/deed/' + encodeURIComponent(token), { cache: 'no-store' }).then(r => r.json()).catch(() => null),
    fetch(api() + '/api/house/line/' + encodeURIComponent(token), { cache: 'no-store' }).then(r => r.json()).catch(() => null),
    fetch(api() + '/api/house/history/' + encodeURIComponent(token), { cache: 'no-store' }).then(r => r.json()).catch(() => null),
  ]);
  const purse = deed?.purses?.[token] || Object.values(deed?.purses || {})[0] || null;
  const y = (v) => (v == null ? '—' : (Number(v) / 1e24).toFixed(4));
  const heirs = (line?.line?.heirs || []).join(', ') || 'none named yet';
  const rows = history?.rows || [];
  root.innerHTML = `
    <div class="deed-open" data-testid="deed-open">
      <h2>Only the holder sees this</h2>
      <p class="small muted">Held by <code>${esc(gate.owner)}</code>, read from <code>house.nearcarta.near</code> just now.</p>
      <dl class="deed-facts">
        <dt>Purse</dt><dd data-testid="deed-purse">${y(purse?.balance)} NEAR</dd>
        <dt>Cap per payment</dt><dd>${y(purse?.cap)} NEAR</dd>
        <dt>Paid out</dt><dd>${y(purse?.paid)} NEAR in ${esc(purse?.pays ?? 0)} payments</dd>
        <dt>Heirs</dt><dd>${esc(heirs)}</dd>
        <dt>Transactions</dt><dd>${rows.length ? `<a href="#deed-h" data-testid="deed-history-link">${rows.length} on this deed</a>` : 'none yet'}</dd>
      </dl>
      <h3 id="deed-h">Every transaction on this deed</h3>
      ${rows.length
        ? `<ol class="deed-hist">${rows.map(r => `<li data-testid="deed-hist-row"><b>${esc(r.what)}</b> <a href="https://nearblocks.io/txns/${esc(r.hash)}" target="_blank" rel="noopener">${esc(String(r.hash).slice(0, 10))}… ↗</a></li>`).join('')}</ol>`
        : `<p class="small muted">${esc(history?.gap || history?.note || 'No transactions yet.')}</p>`}
      <p><a class="btn" href="/?shop=house">Open the House</a></p>
      <p class="small muted">Sell or transfer the deed and this page moves with it: the next owner is read from the chain, not from this tab.</p>
    </div>`;
}

main().catch((e) => {
  if (root) root.innerHTML = `<p class="err" role="alert" data-testid="deed-error">${esc(String(e?.message || e).slice(0, 200))}</p>`;
});
