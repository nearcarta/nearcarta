// Live console: every value below is fetched from the Nearcarta API, which reads NEAR testnet RPC,
// 1Click (dry) and NEAR AI Cloud. Nothing here signs or spends; only the Your House tab asks your own wallet to sign.
const API = (window.NEARCARTA_API || '').replace(/\/$/, '');
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tx = h => `<a href="https://testnet.nearblocks.io/txns/${esc(h)}" target="_blank" rel="noopener">${esc(String(h).slice(0, 10))}…</a>`;
// Readable names for our testnet accounts; the full id stays in the link and the tooltip.
const ROLE = [[/^attacker\./, 'test merchant (red-team)'], [/mallory/, 'red-team account'], [/^bakery\./, 'Bakery (payee)'], [/^dao\.|sputnik/, 'Town Hall DAO'],
  [/house/, 'Your House charter'], [/hown/, 'House owner'], [/oath/, 'charter contract'], [/arena/, 'Arena contract'], [/agent/, 'agent'], [/own-/, 'owner'], [/signer/, 'NEAR MPC signer']];
const nameOf = a => { const s = String(a ?? ''); for (const [re, n] of ROLE) if (re.test(s)) return n; return s.length > 26 ? s.slice(0, 10) + '…' + s.slice(-8) : s; };
const acct = a => `<a href="https://testnet.nearblocks.io/address/${esc(a)}" target="_blank" rel="noopener" title="${esc(a)}">${esc(nameOf(a))}</a>`;
const near = y => (y == null ? '–' : (Number(BigInt(y) / 10n ** 18n) / 1e6).toString() + ' NEAR');
const mark = ok => `<b class="${ok ? 'pass' : 'fail'}" data-check="${ok ? 'pass' : 'fail'}">${ok ? 'PASS' : 'FAIL'}</b>`;

async function get(path, opts) {
  const r = await fetch(API + path, opts);
  const j = await r.json().catch(() => ({ error: `http ${r.status}` }));
  if (!r.ok) throw new Error(j.error || `http ${r.status}`);
  return j;
}

const loaded = {};
import('/house.bundle.js').then(m => m.mountConnect($('#wallet'))).catch(() => {});
const loaders = { guardhouse, townhall, arena, toll, chronicle, house: () => import('/house.bundle.js').then(m => m.mountHouse()) };
for (const b of document.querySelectorAll('#tabs button')) b.onclick = () => show(b.dataset.tab);
function show(t) {
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  document.querySelectorAll('.tab').forEach(s => s.classList.toggle('on', s.id === t));
  history.replaceState(null, '', '#' + t);
  if (loaders[t] && !loaded[t]) { loaded[t] = 1; loaders[t]().catch(e => { $(`#${t} .out`).innerHTML = `<p class="fail">${esc(e.message)}</p>`; loaded[t] = 0; }); }
}

get('/api/health').then(h => { $('#health').innerHTML = `testnet block ${h.near.height.toLocaleString()} ${mark(true)}`; })
  .catch(e => { $('#health').innerHTML = `<span class="fail">API unreachable: ${esc(e.message)}</span>`; });

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
    el.innerHTML = `<div class="card fail" data-testid="zec-check">${t ? '<b class="fail">public on Zcash</b> (transparent t-address) · ' : ''}check unavailable: ${esc(e.message)}</div>`; }
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
  } catch (e) { out.innerHTML = `<div class="card fail" data-testid="quote-error">${esc(e.message)}</div>`; }
};

async function guardhouse() {
  const [g, d] = await Promise.all([get('/api/guardhouse'), get('/api/deployments')]);
  const s = g.state;
  const rows = Object.entries(g.clauses).map(([id, c]) => `<tr><td>${esc(id)}</td><td>${c.receivers.map(acct).join('<br>')}</td><td>${near(c.per_action_cap)}</td><td>${near(c.daily_budget)}</td><td>${near(g.usage[id]?.spent)} (${esc(g.usage[id]?.count)})</td><td>${c.requires_receipt ? 'TEE receipt' : '–'}</td></tr>`).join('');
  const p = d.guardhouse.proof_txs;
  $('#guardhouse .out').innerHTML = `<div class="card" data-testid="oath-state">Oath ${acct(g.oath)} · policy v${esc(s.policy_version)} · next nonce ${esc(s.next_nonce)} · ${s.frozen ? '<b class="fail">frozen</b> <span class="note">(stopped on purpose: no agent spend goes through until it is unfrozen)</span>' : '<b class="pass">active</b>'} · timelock ${Number(s.policy_delay_ns) / 1e9} s<br>
    Full-access keys: <b data-testid="fak">${g.keys.fullAccess}</b> · agent key methods: <b>${esc(g.keys.functionCall.map(k => k.methods.join(',')).join(' | '))}</b></div>
    <div class="card"><table><tr><th>clause</th><th>may pay</th><th>cap</th><th>daily</th><th>spent today</th><th>needs</th></tr>${rows}</table></div>
    <div class="card"><b>Proof on chain</b><table>
    <tr><td>Paid with a valid NEAR AI TEE receipt</td><td>${tx(p.valid_receipt_paid)}</td></tr>
    <tr><td>Receipt saying BLOCK is refused</td><td>${tx(p.block_receipt_denied)}</td></tr>
    <tr><td>Full-access key deleted</td><td>${tx(p.full_access_key_deleted)}</td></tr>
    <tr><td>Spend refused while a policy widening waits in the timelock</td><td>${tx(p.queued_widening_denied)}</td></tr>
    <tr><td>DAO freezes the oath / owner cannot unfreeze</td><td>${tx(p.dao_freeze)} · ${tx(p.owner_unfreeze_refused)}</td></tr></table></div>
    <div class="card"><b>Who signs the receipts: NEAR AI Cloud TEE</b><p class="note">Fresh nonce from this browser → gateway and model TDX quotes checked as in docs.near.ai/cloud/verification.</p>
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
  } catch (e) { out.innerHTML = `<p class="fail" data-testid="tee-error">${esc(e.message)}</p>`; }
  btn.disabled = false;
}

async function townhall() {
  const t = await get('/api/townhall');
  $('#townhall .out').innerHTML = `<div class="card" data-testid="hall-state">DAO ${acct(t.dao)} · oath v${esc(t.oathState.version)} · per reward ${t.caps_near.per_reward} NEAR · total ${t.caps_near.total} NEAR · ${t.oathState.frozen ? '<b class="warn">frozen by a DAO vote</b> <span class="note">(on purpose: this shows the council can stop the agent, and the agent\'s owner alone cannot undo it)</span>' : '<b class="pass">active</b>'}<br>
    Council: ${t.council.flatMap(c => c.members).map(acct).join(', ')} · denied: ${t.oathState.policy.deny.map(acct).join(', ')}</div>
    <div class="card"><b>Bounties</b><table>${t.bounties.map(b => `<tr><td><code>${esc(b.hash.slice(0, 16))}…</code></td><td>${b.amount_near} NEAR</td><td>${b.claimed_by ? 'claimed by ' + acct(b.claimed_by) : 'open'}</td></tr>`).join('')}</table></div>
    <div class="card"><b>Recent proposals</b><table>${t.proposals.map(p => `<tr><td>#${esc(p.id)}</td><td>${esc(p.kind)}</td><td>${esc(p.status)}</td><td>${esc(p.description)}</td></tr>`).join('')}</table></div>`;
}

async function arena() {
  const a = await get('/api/arena');
  const gd = a.guardian;
  $('#arena .out').innerHTML = `<div class="card" data-testid="arena-state">Contract ${acct(a.contract)} · ${a.season?.commit_hex ? `season commit <code>${esc(a.season.commit_hex.slice(0, 16))}…</code>` : 'no season open yet'}<br>
    Guardian g1 agent ${acct(gd.agent)} · oath v${esc(gd.oath_version)} · cap ${near(gd.oath.per_action_cap)} · pot ${near(gd.pot)} · may pay ${gd.oath.allow.map(acct).join(', ')}</div>
    <div class="card"><b>Case tokens (NEP-245)</b><table>${a.tokens.map(t => `<tr><td>${esc(t.token_id)}</td><td>supply ${esc(t.supply ?? 0)}</td></tr>`).join('')}</table></div>
    <div class="card"><b>Attempts</b><table>${a.attempts.map(x => `<tr><td>#${x.id}</td><td>${acct(x.player)}</td><td>verdict ${esc(x.verdict)} · block ${esc(x.block)}</td></tr>`).join('') || '<tr><td>none</td></tr>'}</table></div>`;
}

async function toll() {
  const t = await get('/api/toll'), p = t.policy;
  $('#toll .out').innerHTML = `<div class="card" data-testid="toll-state">Oath ${acct(t.oath)} signs through ${acct(t.mpc)} for chain ${esc(p.chain_id)} (Base Sepolia)<br>
    Derived address <a href="${esc(t.foreign_explorer)}" target="_blank" rel="noopener">${esc(p.foreign_address)}</a> · may pay ${p.allow_to.map(a => `<code title="${esc(a)}">${esc(String(a).slice(0, 8))}…${esc(String(a).slice(-4))}</code>`).join(', ')} · max/tx ${Number(p.max_per_tx) / 1e18} ETH · spent ${Number(p.spent) / 1e18} / ${Number(p.budget) / 1e18} ETH</div>
    <div class="card"><b>Signed so far</b><table>${t.recent.map(r => `<tr><td><code title="${esc(r.to)}">${esc(String(r.to).slice(0, 8))}…${esc(String(r.to).slice(-4))}</code></td><td>${Number(r.value) / 1e18} ETH</td><td><code>${esc(JSON.stringify(r).slice(0, 120))}</code></td></tr>`).join('')}</table></div>`;
}

async function chronicle() {
  const d = await get('/api/deployments'), sel = $('#chron-acct');
  if (!sel.options.length) {
    for (const a of [d.guardhouse.oath, d.townhall.oath, d.townhall.dao, d.arena.contract, d.toll.oath]) sel.add(new Option(nameOf(a) + ' · ' + a, a));
    sel.onchange = () => chronicle();
  }
  $('#chronicle .out').innerHTML = '<p class="note">reading chain…</p>';
  const c = await get(`/api/chronicle/${sel.value}?limit=8`);
  $('#chronicle .out').innerHTML = `<div class="card" data-testid="chronicle"><table><tr><th>when (UTC)</th><th>tx</th><th>method</th><th>result</th><th>events</th></tr>${c.txs.map(t => `<tr><td>${esc((t.at || '').replace('T', ' ').slice(0, 19))}</td><td>${tx(t.hash)}</td><td>${esc(t.method)}</td><td>${t.result ? (t.result.ok ? esc(t.result.value?.decision || 'ok') : `<span class="fail">${esc(String(t.result.error).slice(0, 60))}</span>`) : esc(t.error)}</td><td>${(t.events || []).map(e => esc(e.event)).join(', ')}${t.phantomDropped ? ` <span class="fail">(${t.phantomDropped} phantom dropped)</span>` : ''}</td></tr>`).join('')}</table>
    <p class="note">${esc(c.source)}</p></div>`;
}

show((location.hash || '#ferry').slice(1));
