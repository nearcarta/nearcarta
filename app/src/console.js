// Live console: every value below is fetched from the Nearcarta API, which reads NEAR RPC,
// 1Click (dry) and NEAR AI Cloud. Nothing here signs or spends; only the Your House tab asks your own wallet to sign.
const API = (window.NEARCARTA_API || '').replace(/\/$/, '');
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const NB = window.NEARCARTA_PUBLIC_MAINNET ? 'https://nearblocks.io' : 'https://nearblocks.io';
const tx = h => `<a href="${NB}/txns/${esc(h)}" target="_blank" rel="noopener">${esc(String(h).slice(0, 10))}…</a>`;
// Readable names for our mainnet accounts; the full id stays in the link and the tooltip.
const ROLE = [[/^attacker\./, 'test merchant (red-team)'], [/mallory/, 'red-team account'], [/^bakery\./, 'Bakery (payee)'], [/^dao\.|sputnik/, 'Town Hall DAO'],
  [/house/, 'Your House charter'], [/hown/, 'House owner'], [/oath/, 'charter contract'], [/arena/, 'Arena contract'], [/agent/, 'agent'], [/own-/, 'owner'], [/signer/, 'NEAR MPC signer']];
const nameOf = a => { const s = String(a ?? ''); for (const [re, n] of ROLE) if (re.test(s)) return n; return s.length > 26 ? s.slice(0, 10) + '…' + s.slice(-8) : s; };
const acct = a => `<a href="${NB}/address/${esc(a)}" target="_blank" rel="noopener" title="${esc(a)}">${esc(nameOf(a))}</a>`;
const near = y => (y == null ? '–' : (Number(BigInt(y) / 10n ** 18n) / 1e6).toString() + ' NEAR');
const mark = ok => `<b class="${ok ? 'pass' : 'fail'}" data-check="${ok ? 'pass' : 'fail'}">${ok ? 'PASS' : 'FAIL'}</b>`;
function plainErr(e) {
  const m = String(e?.message || e || '');
  if (/failed to fetch|networkerror|load failed|aborted/i.test(m)) return 'The town API is not reachable just now.';
  if (/^http 5\d\d/.test(m)) return 'The town API is busy. Try again in a moment.';
  return m;
}

async function get(path, opts) {
  const r = await fetch(API + path, opts);
  const j = await r.json().catch(() => ({ error: `http ${r.status}` }));
  if (!r.ok) throw new Error(j.error || `http ${r.status}`);
  return j;
}

const loaded = {};
const loaders = { guardhouse, townhall, arena, toll, chronicle, house: () => import('/house.bundle.js').then(m => m.mountHouse()) };
for (const b of document.querySelectorAll('#tabs button')) b.onclick = () => show(b.dataset.tab);
function show(t) {
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  document.querySelectorAll('.tab').forEach(s => s.classList.toggle('on', s.id === t));
  history.replaceState(null, '', '#' + t);
  if (loaders[t] && !loaded[t]) { loaded[t] = 1; loaders[t]().catch(e => { const host = $(`#${t} .out`); host.innerHTML = `<p class="fail" data-testid="load-error">${esc(plainErr(e))}</p><button type="button" data-testid="retry">Try again</button>`; loaded[t] = 0; host.querySelector('button').onclick = () => show(t); }); }
}

get('/api/health').then(h => {
  const onMain = h.network?.contracts === 'mainnet';
  $('#health').innerHTML = onMain ? `Town contracts on mainnet ${mark(true)}` : `API up ${mark(!!h.ok)}`;
})
  .catch(e => { const el = $('#health'); el.innerHTML = `<span class="fail" data-testid="load-error">${esc(plainErr(e))}</span> <button type="button" data-testid="retry">Try again</button>`; el.querySelector('button').onclick = () => location.reload(); });

get('/api/mainnet').then(m => {
  if (!window.NEARCARTA_PUBLIC_MAINNET) return;
  const el = document.createElement('p');
  el.className = 'note';
  el.dataset.testid = 'board-note';
  el.textContent = m?.board?.status === 'deployed'
    ? 'Your charter is a row on the mainnet board, under the account you sign in with.'
    : 'A personal charter is a row on the mainnet board. That contract is not deployed yet, so this page does not create one.';
  const host = $('#tabs'); if (host) host.after(el);
}).catch(() => {});

get('/api/receipts').then(body => {
  const rows = (body.receipts || []).filter(r => r.network === 'mainnet' && r.tx);
  $('#proofs').innerHTML = `<p class="note">${esc(body.gate || 'The charter contract decides. The agent only asks.')}</p><table>${rows.map(r => `<tr><td>${esc(r.what)}</td><td>${esc(r.decision)}</td><td>${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener" class="tx">${esc(String(r.tx).slice(0, 8))}…</a>` : ''}</td></tr>`).join('') || '<tr><td>No mainnet receipts in this response.</td></tr>'}</table>`;
}).catch(() => { const el = $('#proofs'); if (el) el.innerHTML = '<p class="note">Mainnet proofs could not be loaded from the API.</p>'; });

// Ferry
const form = $('#ferry-form');
const SAMPLE = { zec: 'u1naczqa5m5nefpyqnhs8h3dw8un8z8us45xwgfh4ees95mayyru9snc33dkfk2dc27r5syu4uveyyd5dt8wwad89kpc3f8cah055lm0ex',
  near: '561e8ef0fecb621469da30250dc6cdcd1e47a66e561e8ef0fecb621469da3025', refund: '0x561E8eF0FEcB621469dA30250dC6CdCD1E47A66e' };
const refundFor = () => (form.from.value.split('|')[1] === 'near' ? SAMPLE.near : SAMPLE.refund);
$('#ferry-sample').onclick = () => { form.recipient.value = form.to.value.startsWith('ZEC') ? SAMPLE.zec : SAMPLE.near; form.refundTo.value = refundFor(); zcheck(); };
form.from.addEventListener('change', () => { if ([SAMPLE.near, SAMPLE.refund].includes(form.refundTo.value)) form.refundTo.value = refundFor(); hidePairs(); });
// Only pairs that quoted OK in the server's last dry probe are offered; a failing pair is hidden.
let pairs = null;
const pairKey = (from, to) => from.replace('|', '@') + '>' + to.replace('|', '@');
function hidePairs() {
  if (!pairs) return;
  for (const o of form.to.options) { const r = pairs.find(p => p.from + '>' + p.to === pairKey(form.from.value, o.value)); o.hidden = o.disabled = !!r && !r.ok; }
  if (form.to.selectedOptions[0]?.disabled) { const ok = [...form.to.options].find(o => !o.disabled); if (ok) form.to.value = ok.value; }
}
get('/api/ferry/routes').then(r => { pairs = r.routes; for (const o of form.from.options) { const rs = pairs.filter(p => p.from === o.value.replace('|', '@')); o.hidden = o.disabled = rs.length > 0 && !rs.some(p => p.ok); } hidePairs(); }).catch(() => {});
form.recipient.addEventListener('change', zcheck);
let zseq = 0;
async function zcheck() {
  const to = form.to.value.split('|')[1], el = $('#ferry-zec'), addr = form.recipient.value.trim(), my = ++zseq;
  if (to !== 'zec' || !addr) { el.innerHTML = ''; return; }
  // The address check is local to the server; a 503 means the API was restarting, so it retries twice.
  try { const z = await get('/api/ferry/zcash/' + encodeURIComponent(addr)).catch(async e => { for (let i = 0; i < 2 && /503|502|504|fetch/i.test(e.message); i++) { await new Promise(r => setTimeout(r, 4000)); try { return await get('/api/ferry/zcash/' + encodeURIComponent(addr)); } catch (e2) { e = e2; } } throw e; });
    if (my !== zseq) return; // a newer address was typed while this one was being checked
    el.innerHTML = `<div class="card" data-testid="zec-check">Zcash recipient: <b>${esc(z.kind)}</b> · receivers ${esc(z.receivers.join(', '))} · ${z.shielded ? '<b class="pass">shielded</b>' : '<b class="fail">public on Zcash</b>'}<br><span class="note">${esc(z.note)}</span></div>`;
  } catch (e) { if (my !== zseq) return; const t = /^t[13]/.test(addr);
    el.innerHTML = `<div class="card fail" data-testid="zec-check">${t ? '<b class="fail">public on Zcash</b> (transparent t-address) · ' : ''}check unavailable: ${esc(plainErr(e))}</div>`; }
}
form.to.onchange = () => { if (Object.values(SAMPLE).includes(form.recipient.value)) form.recipient.value = form.to.value.startsWith('ZEC') ? SAMPLE.zec : SAMPLE.near; zcheck(); };
form.onsubmit = async ev => {
  ev.preventDefault();
  const f = Object.fromEntries(new FormData(form)); const [fs, fc] = f.from.split('|'), [ts, tc] = f.to.split('|');
  const out = $('#ferry-out'); out.innerHTML = '<p class="note">asking 1Click…</p>';
  try {
    const q = await get('/api/ferry/quote', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: { symbol: fs, chain: fc }, to: { symbol: ts, chain: tc }, amount: f.amount, privacy: f.privacy, recipient: f.recipient.trim(), refundTo: f.refundTo.trim() }) });
    if (q.error && !q.checks) throw new Error(q.error);
    const c = q.checks;
    out.innerHTML = `<div class="card" data-testid="quote">
      <p><b>${esc(q.from.amount)} ${esc(q.from.symbol)}</b> on ${esc(q.from.chain)} → <b>${esc(q.to.amount)} ${esc(q.to.symbol)}</b> (min ${esc(q.to.min)} base units) · ETA ${esc(q.eta_s)} s · privacy <b>${esc(q.privacy)}</b></p>
      <table>
      <tr><td>1Click signature (ed25519, manager key)</td><td>${mark(c.signature)}</td></tr>
      <tr><td>Echo guard: every field we asked for came back unchanged (privacy level and fees are not signed)</td><td>${mark(c.echo.ok)} ${c.echo.diffs.map(d => esc(d.field)).join(', ')}</td></tr>
      <tr><td>Dry: no deposit address, nothing can be sent</td><td>${mark(c.dry)}</td></tr>
      <tr><td>Protocol fee added by 1Click</td><td>${esc(c.echo.protocolFeeBps)} bps</td></tr>
      <tr><td>All-in cost from signed USD amounts</td><td>${esc(q.cost_bps_signed)} bps = ${(q.cost_bps_signed / 100).toFixed(2)}% (includes the destination withdrawal fee)${q.cost_bps_signed > 200 ? ' <b class="fail">fees eat ' + (q.cost_bps_signed / 100).toFixed(1) + '% of this amount; try about 30 USDC</b>' : ''}</td></tr>
      <tr><td>Verdict</td><td>${q.ok ? '<b class="pass" data-testid="verdict">ACCEPTED</b>' : '<b class="fail" data-testid="verdict">REJECTED</b>'}</td></tr>
      </table><p class="note">quote in ${esc(q.ms)} ms · signature <code>${esc(q.signature)}</code></p></div>`;
  } catch (e) { out.innerHTML = `<div class="card fail" data-testid="quote-error">${esc(plainErr(e))}</div>`; }
};

async function guardhouse() {
  const [d, gh] = await Promise.all([get('/api/mainnet'), get('/api/guardhouse').catch(() => null)]);
  const b = d.board, c = d.charter;
  // Prefer live access-key methods from Guardhouse; fall back to the on-chain truth for charter.nearcarta.near.
  const live = gh?.keys?.functionCall?.[0]?.methods;
  const methods = (Array.isArray(live) && live.length ? live : ['propose', 'propose_batch']).join(' and ');
  $('#guardhouse .out').innerHTML = `<div class="card" data-testid="oath-state">Board ${acct(b.contract)} · charter ${acct(c.contract)}<br>
    Full-access keys on the charter: <b data-testid="fak">${c.full_access_keys}</b> · agent key methods: <b data-testid="agent-methods">${esc(methods)}</b></div>
    <div class="card"><b>Proof on chain</b><table>
    <tr><td>Allowed 0.001 NEAR</td><td>${tx(b.txs['allowed_0.001'])}</td></tr>
    <tr><td>Refused over the per-payment cap</td><td>${tx(b.txs.refused_over_per_action_cap)}</td></tr>
    <tr><td>Refused, payee not on the list</td><td>${tx(b.txs.refused_receiver_not_allowlisted)}</td></tr>
    <tr><td>Charter agent key deleted its full-access key</td><td>${tx(c.txs.charter_delete_fak)}</td></tr></table></div>
    <div class="card"><b>Who signs the receipts: NEAR AI Cloud TEE</b><p class="note">Fresh nonce from this browser. The check does not move NEAR.</p>
    <button id="tee-btn" data-testid="tee-btn">Verify NEAR AI TEE now</button><div id="tee-out"></div></div>`;
  $('#tee-btn').onclick = e => teeCheck(e.currentTarget);
}

// NEAR AI TEE preflight: the browser makes the nonce, the API checks the quotes, the browser checks the nonce came back bound.
const TEE_LABELS = { quote: 'Intel TDX quote verified (dcap-qvl, TCB UpToDate)', debugOff: 'TDX debug mode off', signerBound: 'quote binds the signing address',
  nonceBound: 'quote binds our nonce', echoedNonce: 'echoed nonce matches', configBound: 'MRCONFIGID = sha256(app_compose)', rtmr3: 'RTMR3 replayed from event log',
  composeEvent: 'compose-hash event = app_compose hash' };
async function teeCheck(btn) {
  const out = $('#tee-out'); btn.disabled = true; out.innerHTML = '<p class="note">fetching fresh attestation…</p>';
  try {
    const nonce = [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, '0')).join('');
    const r = await get(`/api/ai/tee?nonce=${nonce}`);
    const mine = r.nonce === nonce;
    const block = (title, x) => `<tr><th colspan="2">${esc(title)} · signer <code>${esc(String(x.signing_address).slice(0, 12))}…</code> (${esc(x.signing_algo)})</th></tr>` +
      Object.entries(x.checks).map(([k, v]) => `<tr><td>${esc(TEE_LABELS[k] || k)}</td><td>${mark(v)}</td></tr>`).join('') +
      (x.gpu ? `<tr><td>NVIDIA NRAS GPU verdict${x.gpu.gpus ? ` (${esc(x.gpu.gpus)} GPUs)` : ''}</td><td>${mark(x.gpu.ok)}</td></tr>` : '') +
      `<tr><td class="note">mrTd / compose-hash</td><td class="note"><code>${esc(String(x.mrTd).slice(0, 16))}…</code> / <code>${esc(String(x.composeHash).slice(0, 16))}…</code></td></tr>`;
    out.innerHTML = `<table>${block('Gateway', r.gateway)}${r.models.map(m => block(`Model ${m.model_name}`, m)).join('')}
      <tr><td>response is for the nonce this browser made</td><td>${mark(mine)}</td></tr></table>
      <p data-testid="tee-verdict" data-ok="${r.ok && mine}">${r.ok && mine ? '<b class="pass">TEE verified</b>' : '<b class="fail">TEE NOT verified</b>'} · ${esc(r.checkedAt)} · no completion sent (non-billable)</p>`;
  } catch (e) { out.innerHTML = `<p class="fail" data-testid="tee-error">${esc(plainErr(e))}</p>`; }
  btn.disabled = false;
}

async function townhall() {
  const d = await get('/api/mainnet');
  const t = d.extras.townhall;
  $('#townhall .out').innerHTML = `<div class="card" data-testid="hall-state">Town Hall ${acct(t.contract)}. A shared DAO is not built. A rule change is set_rules on your own row.<br>
    Reward allowed ${tx(t.txs['townhall_reward_allowed_0.001'])} · reward refused ${tx(t.txs['townhall_reward_refused_0.002'])}</div>`;
}

async function arena() {
  const d = await get('/api/mainnet');
  const a = d.extras.arena;
  $('#arena .out').innerHTML = `<div class="card" data-testid="arena-state">Vault Arena ${acct(a.contract)}<br>
    Allowed ${tx(a.txs['arena_agent_pay_allowed_0.001'])} · refused ${tx(a.txs['arena_agent_pay_refused_0.002'])}</div>`;
}

async function toll() {
  const d = await get('/api/mainnet');
  const t = d.toll;
  $('#toll .out').innerHTML = `<div class="card" data-testid="toll-state">Toll ${acct(t.contract)} · Base chain ${esc(d.chain_id)} · address <code>${esc(t.foreign_address)}</code><br>
    Allowed ${tx(t.txs.owner_toll_pay_allowlisted)} · refused ${tx(t.txs.owner_toll_pay_not_allowlisted)}</div>`;
}

async function chronicle() {
  const d = await get('/api/mainnet');
  const rows = [
    ['Board allowed', d.board.txs['allowed_0.001']],
    ['Board refused, over cap', d.board.txs.refused_over_per_action_cap],
    ['Board refused, off list', d.board.txs.refused_receiver_not_allowlisted],
    ['Visitor allowed', d.board.visitor_run.txs['propose_allowed_0.001']],
    ['Visitor refused, over cap', d.board.visitor_run.txs['propose_refused_0.01_over_per_action_cap']],
  ];
  $('#chronicle .out').innerHTML = `<div class="card" data-testid="chronicle"><table><tr><th>what</th><th>tx</th><th>result</th></tr>${rows.map(([w, h]) => `<tr><td>${esc(w)}</td><td>${tx(h)}</td><td>${/refused/.test(w) ? 'denied' : 'allowed'}</td></tr>`).join('')}</table>
    <p class="note">Recorded mainnet propose results. Each link opens on nearblocks.io.</p></div>`;
}

show((location.hash || '#ferry').slice(1));
