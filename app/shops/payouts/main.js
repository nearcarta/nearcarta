import { formatNear, parseCsv, payoutIssues } from '../../design/D8_shops/js/payouts.js';
import { payoutReady } from '../../design/D8_shops/js/payout-ready.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const app = document.getElementById('app');
let rows = [{ to: '', amt: '0.001' }, { to: '', amt: '0.001' }];
let csv = '';
const exists = {};

function paint() {
  const issues = payoutIssues(rows, exists);
  const ready = payoutReady(rows, exists);
  app.innerHTML = `<p data-testid="payout-issues" class="${issues.length ? 'bad' : ''}">${issues.length ? esc(issues.map(x => x.code === 'bad_account' ? `${x.to || 'That name'} is not a NEAR account` : x.code === 'missing_account' ? `${x.to} was not found on chain` : `${x.amt} NEAR is over the 0.005 cap`).join('. ')) : 'Each NEAR row needs a real account and at most 0.005 NEAR.'}</p>
    <ol data-testid="payout-list">${rows.map((r, i) => `<li><input data-i="${i}" data-k="to" value="${esc(r.to)}" aria-label="Payee ${i + 1}" placeholder="name.near"><input data-i="${i}" data-k="amt" inputmode="decimal" value="${esc(formatNear(r.amt))}" aria-label="Amount ${i + 1}"></li>`).join('')}</ol>
    <label>CSV <textarea id="csv" data-testid="payout-csv" rows="3" placeholder="account,amount,asset">${esc(csv)}</textarea></label>
    <p><button type="button" id="prep" data-testid="payout-prepare" ${ready.enabled ? '' : 'disabled'}>${ready.enabled ? `Prepare ${ready.count} as one batch` : 'Pay'}</button></p>
    <p data-testid="payout-result"></p>`;
  app.querySelectorAll('input').forEach(el => { el.oninput = () => { rows[+el.dataset.i][el.dataset.k] = el.value; if (el.dataset.k === 'amt') return; paint(); }; });
  const box = app.querySelector('#csv');
  box.oninput = () => { csv = box.value; };
  box.onchange = () => {
    const parsed = parseCsv(csv);
    if (parsed.length) rows = parsed;
    paint();
  };
  app.querySelector('#prep').onclick = () => {
    const el = app.querySelector('[data-testid=payout-result]');
    if (!payoutReady(rows, exists).enabled) { el.textContent = 'Nothing was sent.'; return; }
    el.textContent = 'Prepared. Nothing was sent.';
  };
  const api = (globalThis.NEARCARTA_API || '').replace(/\/$/, '');
  for (const r of rows) {
    if (!r.to || Object.prototype.hasOwnProperty.call(exists, r.to)) continue;
    exists[r.to] = 'pending';
    fetch(api + '/api/account/' + encodeURIComponent(r.to)).then(x => x.json()).then(body => { exists[r.to] = body.exists !== false; if (body.exists === false) paint(); }).catch(() => { delete exists[r.to]; });
  }
  document.querySelector('[data-testid=payout-skel]')?.remove();
}

paint();
