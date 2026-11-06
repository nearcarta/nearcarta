// Toll Bridge tray: Pass / Proof / Split, the same actions as the manual buttons.
// A pass is a 0.001 NEAR board propose to toll.nearcarta.near. A chain signature is not a Base payment.
// v1.signer sign: domain_id 0, payload_v2.Ecdsa, path. Deposit 1 yoctoNEAR.
// https://docs.near.org/chain-abstraction/chain-signatures/implementation
// https://github.com/near/mpc/blob/main/crates/contract/README.md
// Broadcast is a separate step. Paid on Base only after a success receipt.
// https://docs.near.org/chain-abstraction/chain-signatures
import { checkDerived, TOLL_ADDRESS, TOLL_KEY } from '../toll-derive.js';
import { tokenBadge, bindTokenFallbacks } from './token-badge.js';
import { armTollDock, installTollDock } from './toll-dock.js';

export const TOLL_ACCT = 'toll.nearcarta.near';
export const PASS_NEAR = '0.001';
export const PASS_YOCTO = 10n ** 21n;
export const TOLL_CHRONICLE_KEY = 'nearcarta.toll.chronicle';
export const TOLL_HINT = 'Try: Pay the toll, Check signature, or Show my foreign address.';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function yoctoNear(y) {
  try {
    const b = BigInt(y);
    const whole = b / (10n ** 24n);
    const frac = (b % (10n ** 24n)).toString().padStart(24, '0').slice(0, 6).replace(/0+$/, '');
    return frac ? `${whole}.${frac}` : String(whole);
  } catch { return ''; }
}

/** Survives a reload. A private window that blocks localStorage falls back to the tab. */
export function tollChronicleStore() {
  let local = null;
  try { local = globalThis.localStorage || null; } catch { local = null; }
  if (local) {
    try {
      const prior = globalThis.sessionStorage?.getItem?.(TOLL_CHRONICLE_KEY);
      if (prior && !local.getItem(TOLL_CHRONICLE_KEY)) local.setItem(TOLL_CHRONICLE_KEY, prior);
    } catch { /* the tab copy is optional */ }
    return local;
  }
  try { return globalThis.sessionStorage || null; } catch { return null; }
}

function memory() {
  return tollChronicleStore();
}

/** Rows Chronicle can list. Same shape as chronicle-feed RECORDED. */
export function tollChronicleRows(storage = memory()) {
  try {
    const v = JSON.parse(storage?.getItem?.(TOLL_CHRONICLE_KEY) || '[]');
    return Array.isArray(v) ? v.filter(r => r && r.shop === 'toll' && r.h) : [];
  } catch { return []; }
}

export function rememberTollPass(row, storage = memory()) {
  const kept = tollChronicleRows(storage);
  if (!row?.h || !storage?.setItem) return kept;
  const list = kept.filter(r => r.h !== row.h);
  list.unshift({
    shop: 'toll',
    decision: row.decision === 'allowed' ? 'allowed' : 'denied',
    reason: row.reason || '',
    h: row.h,
    label: row.label || (row.decision === 'allowed' ? '0.001 NEAR pass' : 'refused'),
  });
  storage.setItem(TOLL_CHRONICLE_KEY, JSON.stringify(list.slice(0, 12)));
  return list;
}

/** Extra toll rows first. One row per transaction hash. */
export function mergeTollChronicle(base, extra = []) {
  const seen = new Set();
  const out = [];
  for (const r of [...(extra || []), ...(base || [])]) {
    if (!r) continue;
    const h = r.h || '';
    if (h && seen.has(h)) continue;
    if (h) seen.add(h);
    out.push(r);
  }
  return out;
}

/**
 * Local refuse before any signature. Null means the 0.001 NEAR pass fits the row.
 * Caps: contracts/charter_board propose (per_action_cap, balance, daily, expiry).
 */
export function tollCapCheck({
  receivers, capYocto, balanceYocto, spentYocto, dailyYocto, minYocto,
  expiresAtNs, nowNs, frozen, amountYocto = PASS_YOCTO,
} = {}) {
  if (frozen) return 'The row is frozen. Nothing was signed.';
  if (expiresAtNs != null && expiresAtNs !== '' && nowNs != null && nowNs !== '') {
    try {
      const exp = BigInt(expiresAtNs);
      if (exp !== 0n && exp < BigInt(nowNs)) return 'The row has expired. Update it in /setup. Nothing was signed.';
    } catch { return 'The row expiry could not be read. Nothing was signed.'; }
  }
  if (!Array.isArray(receivers) || !receivers.includes(TOLL_ACCT)) {
    return 'Add toll.nearcarta.near to your allowlist first. Nothing was signed.';
  }
  let amt;
  try { amt = BigInt(amountYocto); } catch { return 'The pass amount could not be read. Nothing was signed.'; }
  if (capYocto == null || capYocto === '') return 'The row cap could not be read. Open /setup. Nothing was signed.';
  try {
    if (amt > BigInt(capYocto)) return 'Your cap is smaller than this 0.001 NEAR pass. Update the row in /setup. Nothing was signed.';
  } catch { return 'The row cap could not be read. Nothing was signed.'; }
  if (minYocto != null && minYocto !== '') {
    try {
      if (amt < BigInt(minYocto)) return 'The pass is below the smallest payment on the row. Nothing was signed.';
    } catch { /* a missing min does not block */ }
  }
  if (balanceYocto != null && balanceYocto !== '') {
    try {
      if (amt > BigInt(balanceYocto)) return 'The row does not hold 0.001 NEAR. Add NEAR in /setup. Nothing was signed.';
    } catch { return 'The row balance could not be read. Nothing was signed.'; }
  }
  if (dailyYocto != null && dailyYocto !== '' && spentYocto != null && spentYocto !== '') {
    try {
      if (BigInt(spentYocto) + amt > BigInt(dailyYocto)) return 'This pass would pass the daily budget. Nothing was signed.';
    } catch { /* skip a bad daily field */ }
  }
  return null;
}

export function capLine(row) {
  if (!row || row.per_action_cap == null || row.per_action_cap === '') {
    return 'Sign in at /setup so this pass can use your row. Nothing is signed from here until then.';
  }
  const cap = yoctoNear(row.per_action_cap);
  const bal = row.balance == null || row.balance === '' ? '' : yoctoNear(row.balance);
  const capTxt = cap ? `${cap} NEAR` : 'unread';
  const balTxt = bal ? `${bal} NEAR` : 'unread';
  return `Row cap ${capTxt}. Row balance ${balTxt}. This pass is 0.001 NEAR.`;
}

/**
 * What a toll record proves. "Paid on Base" only when a receipt status is 1.
 * https://docs.near.org/chain-abstraction/chain-signatures (signing is one way; NEAR does not watch the other chain)
 */
export function proofWords(rec, { baseReceipt } = {}) {
  if (!rec) {
    return { claim: 'none', text: 'No chain-signature record on this toll yet. A NEAR pass does not move funds on Base.' };
  }
  const status = String(rec.status || '');
  const paid = status === 'confirmed' && Number(baseReceipt?.status) === 1;
  if (paid) return { claim: 'paid', text: 'Paid on Base. The receipt status is success.' };
  if (status === 'confirmed') {
    return { claim: 'proof', text: 'A chain-signature proof is recorded on NEAR. This page has not read a Base success receipt.' };
  }
  if (status === 'signed') {
    return { claim: 'signed', text: 'Signature issued for a Base transaction. Not broadcast from this page. No Base payment.' };
  }
  if (status === 'signing') {
    return { claim: 'signing', text: 'v1.signer was asked to sign. Not broadcast. No Base payment.' };
  }
  if (status === 'failed') return { claim: 'failed', text: 'The signature did not finish. Nothing moved on Base.' };
  if (status === 'refused_proof') return { claim: 'refused', text: 'The foreign-chain proof was refused. Nothing moved on Base.' };
  return { claim: 'none', text: `Status ${status || 'unknown'}. This is not a Base payment.` };
}

export function addressWords({ recorded = '', live = '', path = '', chainId = null, ok = false } = {}) {
  const shown = live || recorded || '';
  const same = !live || !recorded || live.toLowerCase() === String(recorded).toLowerCase();
  const where = path ? `Path ${path}` : 'Path from the toll policy';
  const chain = chainId == null || chainId === '' ? '' : `, chain id ${chainId}`;
  const text = ok
    ? `${where}${chain}. The key hashes to the recorded address ${shown}. A v1.signer signature for this path is not a Base payment.`
    : 'The key does not hash to the recorded address.';
  return { address: shown, text, same: !!same };
}

export function splitWords(live) {
  const gate = live?.gate;
  if (!gate) {
    return 'This toll is one payment of 0.001 NEAR to toll.nearcarta.near. The live policy has no revenue split and no foreign payout.';
  }
  const fee = gate.fee_near || '0';
  return `The gate fee is ${fee} NEAR to ${gate.payee || 'the payee'}, memo ${gate.memo || ''}. The foreign recipient is fixed at ${gate.evm_to || 'the gate address'}. This room does not broadcast that transaction.`;
}

function asYocto(v) {
  if (v == null || typeof v === 'object') return null;
  return String(v);
}

/** Shape returned by GET /api/toll/live. Recent rows never claim a Base payment. */
export function assembleTollLive({ contract, policy, txs = [] } = {}) {
  const recent = (txs || []).filter(Boolean).map(tx => {
    const words = proofWords(tx);
    return {
      nonce: tx.nonce,
      status: tx.status,
      to: tx.to || '',
      tx_hash: tx.tx_hash || null,
      words: words.text,
      claim: words.claim,
    };
  });
  const g = policy?.gate || null;
  const feeRaw = g ? asYocto(g.fee) : null;
  const gate = g ? {
    payee: g.payee || '',
    fee_near: feeRaw ? yoctoNear(feeRaw) : '',
    memo: g.memo || '',
    evm_to: g.evm_to || '',
    evm_value: asYocto(g.evm_value) || '',
  } : null;
  return {
    ok: !!policy,
    network: 'mainnet',
    contract: contract || '',
    mpc: policy?.mpc || null,
    path: policy?.path || '',
    chain_id: policy?.chain_id ?? null,
    foreign_address: policy?.foreign_address || '',
    frozen: !!policy?.frozen,
    next_nonce: policy?.next_nonce ?? null,
    gate,
    recent,
    note: 'A NEAR pass is not a Base payment.',
  };
}

/** Natural-language commands for the dock. A different amount never becomes a payment. */
export function parseTollCommand(text) {
  const raw = String(text || '').trim();
  if (!raw) return { ok: false, action: 'miss', hint: TOLL_HINT };
  const lower = raw.toLowerCase();
  const nums = [...lower.matchAll(/(\d+(?:\.\d+)?)/g)].map(m => Number(m[1]));
  const pay = /\b(pay|pass|cross)\b/.test(lower) || /\bthe toll\b/.test(lower) || /\bpay toll\b/.test(lower) || /\bpass the bridge\b/.test(lower);
  const check = /\bsignature\b|\bsign\b/.test(lower) && !pay;
  const policy = /\bpolicy\b/.test(lower) && !pay;
  const address = /\b(address|foreign|explain)\b|\bbase\b/.test(lower) && !pay && !policy;
  if (pay) {
    if (nums.some(n => Number.isFinite(n) && Math.abs(n - 0.001) > 1e-9)) {
      return { ok: false, action: 'amount', hint: 'The pass is 0.001 NEAR. This gate will not pay a different amount. Nothing was signed.' };
    }
    return { ok: true, action: 'pay', amountNear: PASS_NEAR, hint: '' };
  }
  if (check) return { ok: true, action: 'check', hint: '' };
  if (policy) return { ok: true, action: 'policy', hint: '' };
  if (address) return { ok: true, action: 'address', hint: '' };
  return { ok: false, action: 'miss', hint: TOLL_HINT };
}

export const PENDING_PAY = 'Asking the charter under your cap…';

/** Balance after this 0.001 NEAR pass, from the row we just read. */
export function nextRowBalance(balanceYocto, amountYocto = PASS_YOCTO) {
  try {
    if (balanceYocto == null || balanceYocto === '') return '';
    const left = BigInt(balanceYocto) - BigInt(amountYocto);
    if (left < 0n) return '';
    return yoctoNear(left.toString());
  } catch { return ''; }
}

export function passPaidCopy({ balanceNear } = {}) {
  const bal = balanceNear ? ` Row balance ${balanceNear} NEAR.` : '';
  return `Pass paid. 0.001 NEAR went to toll.nearcarta.near.${bal} This receipt is not a Base payment.`;
}

export function policyWords(live) {
  if (!live || live.ok === false) return 'The live policy did not answer. Nothing was signed.';
  const fee = live.gate?.fee_near ? ` Gate fee ${live.gate.fee_near} NEAR.` : ' One pass is 0.001 NEAR.';
  const path = live.path || 'unread';
  const chain = live.chain_id == null || live.chain_id === '' ? 'unread' : String(live.chain_id);
  return `Policy on ${live.contract || TOLL_ACCT}. Path ${path}, chain id ${chain}.${fee} This is not a Base payment.`;
}

/** Newest allowed pass from this browser. The recorded owner allow is not the visitor's pass. */
export function latestVisitorPass({ passTx, rows } = {}) {
  if (passTx && /^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(String(passTx))) return { h: String(passTx), decision: 'allowed' };
  for (const r of rows || []) {
    if (r && r.decision === 'allowed' && /^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(String(r.h || ''))) {
      return { h: String(r.h), decision: 'allowed' };
    }
  }
  return null;
}

export function describeVisitorPass(judged, { hash } = {}) {
  const link = hash && /^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(String(hash)) ? ` https://nearblocks.io/txns/${hash}` : '';
  if (!judged || judged.ok === false || judged.receiver !== TOLL_ACCT || judged.decision !== 'allowed') {
    return { ok: false, text: 'This hash is not your pass to toll.nearcarta.near. Nothing moved on Base.' };
  }
  const near = yoctoNear(judged.amount) || PASS_NEAR;
  return { ok: true, text: `Your latest pass is on NEAR. ${near} NEAR went to toll.nearcarta.near. That receipt is not a Base payment.${link}` };
}

let policyPrefetch = null;
/** Start the policy read before the door opens. The room reuses the same promise. */
export function prefetchTollPolicy(apiBase) {
  if (policyPrefetch) return policyPrefetch;
  if (typeof fetch !== 'function') return null;
  const base = String(apiBase ?? (globalThis.NEARCARTA_API || '')).replace(/\/$/, '');
  policyPrefetch = Promise.all([
    fetch(base + '/api/toll/live').then(r => r.json()).catch(() => null),
    fetch(base + '/api/toll').then(r => r.json()).catch(() => null),
  ]).then(([live, recorded]) => ({ live, recorded }));
  return policyPrefetch;
}

function txLinks(txs) {
  if (!txs || typeof txs !== 'object') return '';
  const bits = [];
  for (const [k, h] of Object.entries(txs)) {
    if (!/^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(String(h || ''))) continue;
    const label = /not_allow|refus/i.test(k) ? 'Refused on NEAR' : /allow|pay/i.test(k) ? 'Allowed on NEAR' : k;
    bits.push(`<a class="rc tx" data-testid="toll-record" href="https://nearblocks.io/txns/${esc(h)}" target="_blank" rel="noopener">${esc(label)}</a>`);
  }
  return bits.join(' ');
}

export function tollMarkup(state = {}) {
  const tab = state.tab || 'pass';
  const on = name => tab === name ? ' on' : '';
  const sel = name => tab === name ? 'true' : 'false';
  const derive = state.derive || checkDerived({ publicKey: TOLL_KEY, recorded: TOLL_ADDRESS });
  const live = state.live || {};
  const recorded = state.recorded?.foreign_address || derive.recorded || '';
  const addr = addressWords({
    recorded,
    live: live.foreign_address || '',
    path: live.path || '',
    chainId: live.chain_id,
    ok: derive.ok,
  });
  const near = tokenBadge('NEAR', 'near', { size: 40, chainSize: 16 });
  const base = '<img class="ti" src="/tokens/chains/base.svg" alt="Base" width="36" height="36" decoding="async">';
  const seal = state.seal
    ? `<p class="toll-seal" data-testid="toll-refuse">${esc(state.seal)}</p>`
    : '<p class="toll-seal" data-testid="toll-refuse" hidden></p>';
  const capIcon = tokenBadge('NEAR', '', { size: 22, chainSize: 0 });
  const cap = `<p class="toll-cap tok-done" data-testid="toll-cap">${capIcon}<span>${esc(state.capText || capLine(state.row))}</span></p>`;
  const passTx = state.passTx
    ? `<p class="toll-pass-tx"><a class="rc tx" data-testid="toll-pass-tx" href="https://nearblocks.io/txns/${esc(state.passTx)}" target="_blank" rel="noopener">0.001 NEAR pass</a></p>`
    : '';
  const sig = state.sig ? `<p id="toll-sig-out" data-testid="check-signature-out">${esc(state.sig)}</p>` : '<p id="toll-sig-out" data-testid="check-signature-out"></p>';
  const recent = (live.recent || []).map(r => `<li data-testid="toll-live-row"><b>#${esc(r.nonce)}</b> ${esc(r.status || '')}. ${esc(r.words || '')}</li>`).join('');
  const liveNote = live.ok === false
    ? `<p class="toll-note" data-testid="toll-live-miss">${esc(live.error || 'The live policy did not answer.')}</p>`
    : '';
  const records = txLinks(state.recorded?.txs);
  return `<div class="toll-card" data-testid="toll-card">
    <div class="ferry-tabs toll-tabs" role="tablist" aria-label="Toll">
      <button type="button" class="ferry-tab toll-tab${on('pass')}" role="tab" id="toll-tab-pass" data-testid="toll-tab-pass" data-tab="pass" aria-selected="${sel('pass')}">Pass</button>
      <button type="button" class="ferry-tab toll-tab${on('proof')}" role="tab" id="toll-tab-proof" data-testid="toll-tab-proof" data-tab="proof" aria-selected="${sel('proof')}">Proof</button>
      <button type="button" class="ferry-tab toll-tab${on('split')}" role="tab" id="toll-tab-split" data-testid="toll-tab-split" data-tab="split" aria-selected="${sel('split')}">Split</button>
    </div>
    <div class="toll-pane" data-testid="toll-pane-pass"${tab === 'pass' ? '' : ' hidden'}>
      <div class="toll-flow">${near}<p class="toll-amt tok-done"><b>0.001</b> <span>NEAR</span></p></div>
      <p class="toll-lead">One pass to toll.nearcarta.near. A refusal pays nothing.</p>
      ${cap}
      ${seal}
      ${passTx}
      <div class="toll-actions tok-done${state.pending ? ' toll-busy' : ''}">
        <button type="button" class="primary" id="toll-pay" data-testid="toll-pay"${state.pending ? ' disabled' : ''}>${state.pending ? esc(state.pending) : 'Pay 0.001 NEAR'}</button>
      </div>
    </div>
    <div class="toll-pane" data-testid="toll-pane-proof"${tab === 'proof' ? '' : ' hidden'}>
      <div class="toll-flow">${base}<p class="toll-address" data-testid="toll-address">${esc(addr.address || 'No address yet')}</p></div>
      <p class="toll-lead" data-testid="toll-address-words">${esc(addr.text)}</p>
      ${live.mpc ? `<p class="toll-note">Signer ${esc(live.mpc)}. Domain 0, secp256k1.</p>` : ''}
      ${liveNote}
      ${recent ? `<ul class="toll-live">${recent}</ul>` : '<p class="toll-note">No recent chain-signature record on this contract.</p>'}
      ${records ? `<p class="toll-records">${records}</p>` : ''}
      ${sig}
      <div class="toll-actions tok-done">
        <button type="button" class="primary" id="toll-sig" data-testid="check-signature"${state.pending ? ' disabled' : ''}>Check signature</button>
      </div>
    </div>
    <div class="toll-pane" data-testid="toll-pane-split"${tab === 'split' ? '' : ' hidden'}>
      <p class="toll-lead" data-testid="toll-split">${esc(state.policyNote || splitWords(live))}</p>
    </div>
  </div>`;
}

export function mountTollRoom(root, hooks = {}, env = {}) {
  if (!root) return;
  const state = hooks.state || (hooks.state = {});
  if (!state.tab) state.tab = 'pass';
  if (!state.derive) state.derive = checkDerived({ publicKey: TOLL_KEY, recorded: TOLL_ADDRESS });
  const apiBase = env.api ?? ((globalThis.NEARCARTA_API || '').replace(/\/$/, ''));
  const doc = env.doc || (typeof document !== 'undefined' ? document : null);

  const paint = () => {
    if (typeof hooks.row === 'function') state.row = hooks.row() || null;
    state.capText = capLine(state.row);
    root.innerHTML = tollMarkup(state);
    bind();
    bindTokenFallbacks(root);
  };

  const clearSeal = () => {
    state.seal = '';
    hooks.hideRefuse?.();
  };

  async function checkSignature() {
    clearSeal();
    state.tab = 'proof';
    state.sig = 'Checking your latest pass…';
    paint();
    const mine = latestVisitorPass({
      passTx: state.passTx,
      rows: [...tollChronicleRows(), ...(typeof hooks.passes === 'function' ? hooks.passes() : [])],
    });
    const sender = typeof hooks.account === 'function' ? String(hooks.account() || '') : '';
    if (!mine?.h) {
      state.sig = 'No pass from this browser yet. A NEAR pass is not a Base payment.';
      paint();
      return state.sig;
    }
    if (!sender) {
      state.sig = 'Set up your agent in /setup so this check can name your account. Nothing was signed.';
      paint();
      return state.sig;
    }
    try {
      const st = await fetch(apiBase + '/api/toll/pass/' + encodeURIComponent(mine.h) + '?sender=' + encodeURIComponent(sender)).then(r => r.json());
      const words = describeVisitorPass(st, { hash: mine.h });
      state.sig = st?.text || words.text;
    } catch {
      state.sig = 'The chain check did not answer. Nothing moved on Base.';
    }
    paint();
    return state.sig;
  }

  let busy = false;
  async function runAgent(text) {
    if (busy) return { ok: false, hint: 'That line is already running.', action: 'busy' };
    busy = true;
    try {
    clearSeal();
    const plan = parseTollCommand(typeof text === 'string' ? text : '');
    if (!plan.ok) return plan;
    if (plan.action === 'check') {
      const sig = await checkSignature();
      return { ok: true, action: 'check', hint: sig };
    }
    if (plan.action === 'policy') {
      state.tab = 'split';
      state.policyNote = policyWords(state.live);
      paint();
      return { ok: true, action: 'policy', hint: state.policyNote };
    }
    if (plan.action === 'address') {
      state.tab = 'proof';
      paint();
      const words = addressWords({
        recorded: state.recorded?.foreign_address || state.derive?.recorded || '',
        live: state.live?.foreign_address || '',
        path: state.live?.path || '',
        chainId: state.live?.chain_id,
        ok: state.derive?.ok,
      });
      return { ok: true, action: 'address', hint: words.text };
    }
    if (!hooks.onPay) {
      const hint = 'Set up your agent in /setup. Nothing was signed.';
      return { ok: false, action: 'pay', hint };
    }
    state.tab = 'pass';
    state.pending = PENDING_PAY;
    paint();
    const res = await hooks.onPay();
    state.pending = '';
    if (!res?.ok) state.seal = res?.hint || '';
    else state.seal = '';
    if (res?.refused) hooks.showRefuse?.(state.seal);
    else hooks.hideRefuse?.();
    if (res?.success && (res.o?.tx || res.tx)) state.passTx = res.o?.tx || res.tx;
    state.tab = 'pass';
    paint();
    return res || { ok: false, hint: 'The pass did not run.' };
    } finally { busy = false; }
  }

  function bind() {
    root.querySelectorAll('[data-tab]').forEach(btn => {
      btn.onclick = () => {
        clearSeal();
        state.tab = btn.dataset.tab || 'pass';
        paint();
      };
    });
    const pay = root.querySelector('#toll-pay');
    if (pay) pay.onclick = () => runAgent('Pay the toll');
    const sig = root.querySelector('#toll-sig');
    if (sig) sig.onclick = () => runAgent('Check signature');
    if (doc) {
      armTollDock((text) => runAgent(text));
      installTollDock(doc);
    }
  }

  async function loadLive() {
    if (state.liveTried) return;
    state.liveTried = true;
    try {
      const warmed = await prefetchTollPolicy(apiBase);
      const liveRes = warmed?.live;
      const recRes = warmed?.recorded;
      state.live = liveRes && typeof liveRes === 'object' ? liveRes : { ok: false, error: 'The live policy did not answer.' };
      state.recorded = recRes && typeof recRes === 'object' ? recRes : null;
    } catch {
      state.live = { ok: false, error: 'The live policy did not answer.' };
    }
    if (root.isConnected !== false) paint();
  }

  hooks.runAgent = (text) => runAgent(text);
  hooks.localPaint = paint;
  paint();
  loadLive();
}

if (typeof window !== 'undefined') prefetchTollPolicy();
