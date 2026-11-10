// Toll Bridge tray: Pass / Proof / Split, the same actions as the manual buttons.
// A pass pays the live policy fee to toll.nearcarta.near. A chain signature is not a Base payment.
// v1.signer sign: domain_id 0, payload_v2.Ecdsa, path. Deposit 1 yoctoNEAR.
// https://docs.near.org/chain-abstraction/chain-signatures/implementation
// https://github.com/near/mpc/blob/main/crates/contract/README.md
// Broadcast is a separate step. Paid on Base only after a success receipt.
// https://docs.near.org/chain-abstraction/chain-signatures
import { checkDerived, TOLL_ADDRESS, TOLL_KEY } from '../toll-derive.js';
import { tokenStack, bindTokenFallbacks } from './token-badge.js';
import { armTollDock, installTollDock } from './toll-dock.js';
import { rowPath } from '../foreign-path.js';

export const TOLL_ACCT = 'toll.nearcarta.near';
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
    label: row.label || (row.decision === 'allowed' ? 'NEAR pass' : 'refused'),
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
  expiresAtNs, nowNs, frozen, amountYocto = PASS_YOCTO, effectsKnown = null,
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
  const near = yoctoNear(amt) || 'the policy fee';
  if (capYocto == null || capYocto === '') return 'The row cap could not be read. Open /setup. Nothing was signed.';
  try {
    if (amt > BigInt(capYocto)) return `Your cap is smaller than this ${near} NEAR pass. Update the row in /setup. Nothing was signed.`;
  } catch { return 'The row cap could not be read. Nothing was signed.'; }
  if (minYocto != null && minYocto !== '') {
    try {
      if (amt < BigInt(minYocto)) return 'The pass is below the smallest payment on the row. Nothing was signed.';
    } catch { /* a missing min does not block */ }
  }
  if (balanceYocto != null && balanceYocto !== '') {
    try {
      if (amt > BigInt(balanceYocto)) return `The row does not hold ${near} NEAR. Add NEAR in /setup. Nothing was signed.`;
    } catch { return 'The row balance could not be read. Nothing was signed.'; }
  }
  if (dailyYocto != null && dailyYocto !== '' && spentYocto != null && spentYocto !== '') {
    try {
      if (BigInt(spentYocto) + amt > BigInt(dailyYocto)) return 'This pass would pass the daily budget. Nothing was signed.';
    } catch { /* skip a bad daily field */ }
  }
  // A crossing reserves an effect budget on the row before the board calls the toll, and a
  // row without one is refused `ERR_EFFECT` after the wallet has already approved. Saying so
  // here is the difference between a refusal the visitor can act on and gas spent on a trap.
  // Measured 2026-11-07: the first effect budget costs 351 bytes and no shop-bearing row has
  // that much room (four shops is exactly full at five pairs), so this check refuses honestly
  // rather than pretending a pass is possible.
  if (effectsKnown === false) {
    return 'This row has no Base effect budget and no room to write one, so the toll cannot open a crossing. Nothing was signed.';
  }
  return null;
}

export const EFFECT_BUDGET_BYTES = 351;
// The contract source raises the row to 3000 bytes and prepays 1400; that build is staged,
// not live. The number here stays 2000 until the upgrade lands, because a page that promises
// room the chain does not have is the bug this file exists to prevent.
export const ROW_ALLOWANCE_BYTES = 2000;
/**
 * Whether a row can still hold a FIRST effect budget, from the chain's own `storage_locked`.
 * The contract exposes no view that lists effect caps, so storage is the number to use.
 * Returns null when the row does not report storage: "unknown" must never become a refusal.
 */
// A first effect budget costs EFFECT_BUDGET_BYTES and the row allowance is ROW_ALLOWANCE_BYTES; both are on
// mainnet and pinned in shared/board/session.js. Repeated here because this module is served
// to the browser raw and cannot import a shared path.
/**
 * The sentence a shop shows when its account is not on the visitor's row.
 *
 * Measured 2026-11-08 in the city: pressing Town Hall's gold CTA answered only "Add
 * townhall.nearcarta.near in /setup", which is true but not enough to act on — the row was
 * already at 1946 of its 2000 bytes, so /setup would have refused the change too. This says
 * which shop is missing, what room is left, and that a swap is what is needed when there is
 * no room. It never claims the edit will succeed.
 */
export function missingShopLine(shop, row) {
  // The chain's own storage_locked, 1e19 yocto per byte, against ROW_ALLOWANCE_BYTES —
  // the same numbers effectBudgetFits uses, repeated here so this module stays importless.
  const locked = row?.storage_locked;
  const room = locked == null || locked === '' ? null
    : Math.max(0, ROW_ALLOWANCE_BYTES - Math.floor(Number(locked) / 1e19));
  const head = `This shop (${shop}) is not on your row, so the charter would refuse the call.`;
  const tail = 'Nothing was signed.';
  if (room == null) return `${head} Add it in /setup. ${tail}`;
  // One more receiver costs about 24 bytes, plus its pairs.
  if (room < 60) return `${head} Your row has ${room} bytes free of its ${ROW_ALLOWANCE_BYTES} and another shop needs about 60, so swap a shop out rather than add one: /setup lets you edit the list. ${tail}`;
  return `${head} Your row has ${room} bytes free, so you can add it in /setup. ${tail}`;
}

/**
 * Whether the row can hold a FIRST effect budget. `true` means it already has one.
 *
 * Room alone is the wrong question, and asking only that refused a crossing the chain would
 * have allowed. Measured on mainnet 2026-11-08: the row carried base/usdc/0x…01 (value cap
 * 10000) written by `set_effects`, which cost 351 bytes and left 42 free. Reading only the
 * remaining room said "no budget" and the gold CTA refused with "This row has no Base effect
 * budget" while the budget was right there on chain — the visitor could not pass the toll at
 * all. `hasEffect` is the contract's own answer, read before this check.
 */
export function effectBudgetFits(row, need = EFFECT_BUDGET_BYTES, maxRowBytes = ROW_ALLOWANCE_BYTES, hasEffect = null) {
  // The chain's own answer beats arithmetic. A budget that is already written costs its 351
  // bytes, so the row has little room left and room alone would say "no budget" while the
  // budget is on chain. That is what refused a real crossing on mainnet 2026-11-08.
  if (hasEffect === true) return true;
  const locked = row?.storage_locked;
  if (locked == null || locked === '') return null;
  const lockedBytes = Number(locked) / 1e19; // storage costs 1e19 yocto per byte on mainnet
  if (!Number.isFinite(lockedBytes)) return null;
  const room = Math.max(0, maxRowBytes - Math.floor(lockedBytes));
  if (room >= need) return true;
  // Not enough room for a FIRST budget. That is not proof there is none: the record may
  // already be there. Only a chain answer of "no cap" may refuse, so this is unknown.
  return null;
}

export function capLine(row, quote) {
  if (!row || row.per_action_cap == null || row.per_action_cap === '') {
    return 'Sign in at /setup so this pass can use your row. Nothing is signed from here until then.';
  }
  const cap = yoctoNear(row.per_action_cap);
  const bal = row.balance == null || row.balance === '' ? '' : yoctoNear(row.balance);
  const capTxt = cap ? `${cap} NEAR` : 'unread';
  const balTxt = bal ? `${bal} NEAR` : 'unread';
  const fee = quote?.feeNear ? ` The visitor fee is ${quote.feeNear} NEAR.` : ' The live policy has no visitor fee.';
  return `Row cap ${capTxt}. Row balance ${balTxt}.${fee}`;
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

export function walletWords({ owner = '', address = null } = {}) {
  const path = rowPath(owner, 'base');
  if (!path) return { path: '', address: '', text: 'Sign in at /setup to see this row. Nothing was signed.' };
  if (!address) return { path, address: '', text: `Path ${path}. No address yet. The signer has not returned one. The old shared path is not this wallet.` };
  return { path, address, text: `Path ${path}. Address ${address}.` };
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

export function formatWei(wei) {
  try {
    const b = BigInt(wei);
    const whole = b / (10n ** 18n);
    const frac = (b % (10n ** 18n)).toString().padStart(18, '0').slice(0, 8).replace(/0+$/, '');
    return frac ? `${whole}.${frac}` : String(whole);
  } catch { return ''; }
}

export function foreignExplorer(chain, hash) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(String(hash || ''))) return '';
  const host = /arbitrum/i.test(String(chain || '')) ? 'https://arbiscan.io/tx/' : 'https://basescan.org/tx/';
  return host + hash;
}

/** Fee, chain and caps from a live policy. No fee in the policy means the pass cannot be priced. */
export function policyQuote(live) {
  if (!live || live.ok === false) return { ok: false, payable: false, hint: 'The live policy did not answer. Nothing was signed.' };
  const cross = live.cross || null;
  const gate = live.gate || null;
  const price = live.price || null;
  const feeRaw = asYocto(price?.fee) || asYocto(cross?.pass_fee) || asYocto(live.pass_fee) || asYocto(gate?.fee);
  const feeNear = feeRaw && feeRaw !== '0' ? yoctoNear(feeRaw) : '';
  const foreignWei = asYocto(cross?.foreign_value) || asYocto(live.foreign_value) || asYocto(gate?.evm_value) || '';
  const chain = live.verify_chain || '';
  const payable = !!feeNear;
  return {
    ok: true,
    payable,
    feeYocto: payable ? feeRaw : '',
    feeNear,
    foreignTo: '',
    foreignWei,
    foreignEth: foreignWei ? formatWei(foreignWei) : '',
    allowTo: (live.allow_to || []).map(s => String(s).toLowerCase()).filter(Boolean),
    chain,
    chainId: live.chain_id ?? null,
    path: live.path || '',
    foreignAddress: live.foreign_address || '',
    // The contract no longer publishes an amount cap. Null means "the row decides".
    maxPerTx: null,
    maxToken: null,
    contract: live.contract || '',
    spent: asYocto(live.spent) || '',
    budget: asYocto(live.budget) || '',
    board: cross?.board || live.board || '',
    hint: payable ? '' : 'The live policy has no visitor fee. Nothing was signed.',
  };
}

export function relayDecision({ judged, quote, record, receipt } = {}) {
  if (!judged || judged.ok === false || judged.decision !== 'allowed' || judged.receiver !== TOLL_ACCT) {
    return { ok: false, step: 'near', claim: 'none', text: 'This hash is not your pass to toll.nearcarta.near. Nothing moved on Base.' };
  }
  if (!quote?.payable || String(judged.amount) !== String(quote.feeYocto)) {
    return { ok: false, step: 'fee', claim: 'none', text: 'This pass does not match the live policy fee. Nothing moved on Base.' };
  }
  const hash = record?.tx_hash || '';
  const explorer = foreignExplorer(quote.chain, hash);
  if (receipt && Number(receipt.status) === 1 && explorer) {
    return { ok: true, step: 'paid', claim: 'paid', explorer, text: `Paid on Base. ${explorer}` };
  }
  if (record?.status === 'signed' && record.raw_signed) {
    return { ok: true, step: 'broadcast', claim: 'signed', explorer, text: 'The signature is on NEAR. Broadcasting it is not a Base payment until the receipt succeeds.' };
  }
  return { ok: true, step: 'waiting', claim: 'signed', explorer, text: 'The NEAR pass is in. The foreign signature is not on the toll yet. Nothing moved on Base.' };
}

export function splitWords(live) {
  const q = live?.quote || policyQuote(live || {});
  const fee = q.payable ? ` The visitor fee is ${q.feeNear} NEAR.` : ' The live policy has no visitor fee.';
  const splits = Array.isArray(live?.price?.splits) ? live.price.splits : [];
  const split = splits.length
    ? ` Configured split ${splits.map(s => `${Number(s.bps) / 100}% to ${s.account}`).join(', ')}.`
    : ' This policy has no revenue split.';
  const surplus = live?.surplus != null && live.surplus !== '' && live.surplus !== '0'
    ? ` Surplus ${yoctoNear(String(live.surplus)) || live.surplus} NEAR.`
    : '';
  return `Service fees accrue on toll.nearcarta.near.${fee}${split}${surplus} Foreign transfers are not revenue. A signature is not a Base payment.`;
}

function asYocto(v) {
  if (v == null || typeof v === 'object') return null;
  return String(v);
}

/** Shape returned by GET /api/toll/live. Recent rows never claim a Base payment. */
export function assembleTollLive({ contract, policy, txs = [] } = {}) {
  const chainName = policy?.verify_chain || '';
  const recent = (txs || []).filter(Boolean).map(tx => {
    const words = proofWords(tx);
    const explorer = foreignExplorer(chainName, tx.tx_hash || '');
    return {
      nonce: tx.nonce,
      status: tx.status,
      to: tx.to || '',
      value: tx.value == null ? '' : String(tx.value),
      tx_hash: tx.tx_hash || null,
      raw_signed: tx.raw_signed || null,
      sign_path: tx.sign_path || tx.path || null,
      explorer,
      can_broadcast: tx.status === 'signed' && !!tx.raw_signed,
      words: words.text,
      claim: words.claim,
    };
  });
  const g = policy?.gate || null;
  const feeRaw = g ? asYocto(g.fee) : null;
  const gate = g ? {
    payee: g.payee || '',
    fee: feeRaw,
    fee_near: feeRaw ? yoctoNear(feeRaw) : '',
    memo: g.memo || '',
    evm_to: g.evm_to || '',
    evm_value: asYocto(g.evm_value) || '',
  } : null;
  const cross = policy?.cross || null;
  const shaped = {
    ok: !!policy,
    network: 'mainnet',
    contract: contract || '',
    mpc: policy?.mpc || null,
    path: policy?.path || '',
    chain_id: policy?.chain_id ?? null,
    verify_chain: chainName,
    foreign_address: policy?.foreign_address || '',
    allow_to: Array.isArray(policy?.allow_to) ? policy.allow_to : [],
    max_per_tx: policy?.max_per_tx == null ? '' : String(policy.max_per_tx),
    budget: policy?.budget == null ? '' : String(policy.budget),
    spent: policy?.spent == null ? '' : String(policy.spent),
    frozen: !!policy?.frozen,
    next_nonce: policy?.next_nonce ?? null,
    gate,
    cross,
    chains: Array.isArray(policy?.chains) ? policy.chains : [],
    fee: policy?.fee == null ? '' : String(policy.fee),
    split: Array.isArray(policy?.split) ? policy.split : [],
    board: policy?.board || policy?.price?.board || '',
    price: policy?.price || null,
    surplus: policy?.surplus == null ? '' : String(policy.surplus),
    service_held: policy?.service_held == null ? '' : String(policy.service_held),
    fees_held: policy?.fees_held == null ? '' : String(policy.fees_held),
    pass_fee: cross?.pass_fee == null ? '' : String(cross.pass_fee),
    foreign_value: cross?.foreign_value == null ? '' : String(cross.foreign_value),
    recent,
    note: 'A NEAR pass is not a Base payment.',
  };
  shaped.quote = policyQuote(shaped);
  return shaped;
}

/** Natural-language commands. The NEAR number is the live service fee. ETH or USDC is the foreign amount. */
export function parseTollCommand(text, quote) {
  const raw = String(text || '').trim();
  if (!raw) return { ok: false, action: 'miss', hint: TOLL_HINT };
  const lower = raw.toLowerCase();
  const addr = (raw.match(/0x[0-9a-fA-F]{40}/) || [])[0] || '';
  const nums = [...lower.replace(/0x[0-9a-f]+/g, ' ').matchAll(/(\d+(?:\.\d+)?)/g)].map(m => Number(m[1]));
  if (/\barbitrum\b/.test(lower)) {
    return { ok: false, action: 'route', hint: 'This toll signs one chain. Arbitrum needs its own instance. Nothing was signed.' };
  }
  const pay = /\b(pay|pass|cross)\b/.test(lower) || /\bthe toll\b/.test(lower) || /\bpay toll\b/.test(lower) || /\bpass the bridge\b/.test(lower);
  const check = /\bsignature\b|\bsign\b/.test(lower) && !pay;
  const policy = /\bpolicy\b/.test(lower) && !pay;
  const ledger = /\b(ledger|receipt)\b/.test(lower) && !pay;
  const address = /\b(address|wallet|foreign|explain|balance)\b/.test(lower) && !pay && !policy;
  if (pay) {
    if (!quote?.payable || !quote.feeNear) {
      return { ok: false, action: 'fee', hint: quote?.hint || 'The live policy has no visitor fee. Nothing was signed.' };
    }
    const fee = Number(quote.feeNear);
    if (/\bnear\b/.test(lower) && nums.some(n => Number.isFinite(n) && Math.abs(n - fee) > 1e-9)) {
      return { ok: false, action: 'amount', hint: `The pass is ${quote.feeNear} NEAR. This gate will not pay a different amount. Nothing was signed.` };
    }
    const asset = /\busdc\b/.test(lower) ? 'usdc' : (/\beth\b/.test(lower) ? 'native' : '');
    if (!asset) return { ok: false, action: 'asset', hint: 'Name the asset, ETH or USDC. Nothing was signed.' };
    if (!addr) return { ok: false, action: 'recipient', hint: 'Name a Base address, 0x and 40 hex. Nothing was signed.' };
    const foreign = nums.filter(n => Number.isFinite(n) && !(/\bnear\b/.test(lower) && Math.abs(n - fee) < 1e-9));
    if (!foreign.length) return { ok: false, action: 'amount', hint: 'Name the amount. Nothing was signed.' };
    if (asset === 'native' && quote.foreignEth && foreign[0] > Number(quote.foreignEth) + 1e-12) {
      return { ok: false, action: 'cap', hint: `That is over the ${quote.foreignEth} ETH cap. Nothing was signed.` };
    }
    return { ok: true, action: 'pay', to: addr.toLowerCase(), asset, amount: String(foreign[0]), amountNear: quote.feeNear, feeYocto: quote.feeYocto, hint: '' };
  }
  if (check) return { ok: true, action: 'check', hint: '' };
  if (policy) return { ok: true, action: 'policy', hint: '' };
  if (ledger) return { ok: true, action: 'ledger', hint: '' };
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

export function passPaidCopy({ balanceNear, feeNear, to } = {}) {
  const fee = feeNear || 'The policy fee in';
  const bal = balanceNear ? ` Row balance ${balanceNear} NEAR.` : '';
  const dest = to ? ` to ${to}` : '';
  return `Pass paid. ${fee} NEAR went to toll.nearcarta.near.${bal} This receipt is not a Base payment. The board opened the crossing${dest}. Nothing was signed on Base.`;
}

export function policyWords(live) {
  if (!live || live.ok === false) return 'The live policy did not answer. Nothing was signed.';
  const q = live.quote || policyQuote(live);
  const fee = q.payable
    ? `Visitor fee ${q.feeNear} NEAR, paid from your board row under your /setup caps.`
    : 'This gate has no visitor fee right now.';
  const chain = live.verify_chain
    || (live.chain_id === 8453 ? 'Base' : (live.chain_id == null || live.chain_id === '' ? '' : `chain ${live.chain_id}`));
  const path = live.path ? ` The gate's recorded path (${live.path}) is not your wallet.` : '';
  const where = chain ? ` Crossings target ${chain}.` : '';
  return `Toll on ${live.contract || TOLL_ACCT}. ${fee}${where}${path} The NEAR fee opens the crossing; it is not itself a Base payment.`;
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
  const near = yoctoNear(judged.amount) || 'the policy fee';
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
    // Visitor ledger: only Allowed / Refused. Operator deploy/migrate hashes used to fill the
    // Ledger tab with method names (toll_v8_upgrade_migrate, fund_toll, …) that are not a pass.
    const label = /not_allow|refus/i.test(k) ? 'Refused on NEAR' : /allow|pay/i.test(k) ? 'Allowed on NEAR' : null;
    if (!label) continue;
    bits.push(`<a class="rc tx" data-testid="toll-record" href="https://nearblocks.io/txns/${esc(h)}" target="_blank" rel="noopener">${esc(label)}</a>`);
  }
  return bits.join(' ');
}

export function tollMarkup(state = {}) {
  const tab = state.tab || 'pass';
  const on = name => tab === name ? ' on' : '';
  const sel = name => tab === name ? 'true' : 'false';
  const live = state.live || {};
  const quote = live.quote || policyQuote(live.ok ? live : { ok: false });
  const wallet = walletWords({ owner: state.owner || '', address: state.rowAddress || null });
  const asset = state.asset === 'USDC' ? 'USDC' : 'ETH';
  const near = tokenStack('NEAR', 'near', { size: 48, chainSize: 16 });
  const chainIcon = tokenStack(asset === 'USDC' ? 'USDC' : 'ETH', 'base', { size: 48, chainSize: 16 });
  const payLabel = state.pending ? esc(state.pending) : (quote.payable ? 'Pay on Base' : 'Live policy has no visitor fee');
  const feeLine = live.ok === false
    ? 'The live policy did not answer.'
    : (quote.payable
      ? `Fee ${quote.feeNear} NEAR. Your spend limit caps the amount.`
      : 'The live policy has no visitor fee.');
  const status = state.seal || '';
  // A visitor with no board row cannot pass: the board has nothing to spend.
  // That is a setup step, not an error, so it gets its own line and link.
  const needsRow = !!state.needsRow;
  const rowNote = needsRow
    ? `<p class="toll-needs-row" data-testid="toll-needs-row" role="status">Open your row in <a href="/setup/" data-testid="toll-setup-link">/setup</a> first. The toll spends from that row, under your caps. Nothing was signed.</p>`
    : '';
  // With no row the button is the way to /setup, so it stays pressable.
  const ctaBlocked = state.pending || (needsRow ? false : !quote.payable);
  const ctaText = needsRow ? 'Open your row in /setup' : payLabel;
  const passTx = state.passTx
    ? `<a class="rc tx" data-testid="toll-pass-tx" href="https://nearblocks.io/txns/${esc(state.passTx)}" target="_blank" rel="noopener">NEAR pass</a>`
    : '';
  const sig = state.sig ? `<p id="toll-sig-out" data-testid="check-signature-out">${esc(state.sig)}</p>` : '<p id="toll-sig-out" data-testid="check-signature-out"></p>';
  const recent = (live.recent || []).map(r => {
    const link = r.explorer ? ` <a class="rc tx" data-testid="toll-foreign-tx" href="${esc(r.explorer)}" target="_blank" rel="noopener">basescan</a>` : '';
    return `<li data-testid="toll-live-row"><b>#${esc(r.nonce)}</b> ${esc(r.status || '')}. ${esc(r.words || '')}${link}</li>`;
  }).join('');
  const canBroadcast = (live.recent || []).some(r => r.can_broadcast);
  const records = txLinks(state.recorded?.txs);
  return `<div class="shop-stack ferry-card toll-card" data-testid="toll-card">
    <div class="ferry-tabs toll-tabs" role="tablist" aria-label="Toll">
      <button type="button" class="ferry-tab toll-tab${on('pass')}" role="tab" id="toll-tab-pass" data-testid="toll-tab-pass" data-tab="pass" aria-selected="${sel('pass')}">Pay</button>
      <button type="button" class="ferry-tab toll-tab${on('proof')}" role="tab" id="toll-tab-proof" data-testid="toll-tab-proof" data-tab="proof" aria-selected="${sel('proof')}">Wallet</button>
      <button type="button" class="ferry-tab toll-tab${on('split')}" role="tab" id="toll-tab-split" data-testid="toll-tab-split" data-tab="split" aria-selected="${sel('split')}">Ledger</button>
    </div>
    <div class="ferry-pane toll-pane" data-testid="toll-pane-pass"${tab === 'pass' ? '' : ' hidden'}>
      <div class="ferry-flow tok-done" data-testid="toll-flow">${near}<span class="ferry-flow-arrow">→</span>${chainIcon}</div>
      <div class="toll-pair">
        <label class="field ferry-field"><span>Chain</span>
          <select id="toll-chain" data-testid="toll-chain" aria-label="Chain">
            <option data-testid="toll-route-base" value="base" selected>Base${quote.chainId ? ` · ${esc(quote.chainId)}` : ''}</option>
            <option data-testid="toll-route-arb" value="arbitrum">Arbitrum · own instance</option>
          </select>
        </label>
        <label class="field ferry-field"><span>Asset</span>
          <select id="toll-asset" data-testid="toll-asset" aria-label="Asset">
            <option ${asset === 'ETH' ? 'selected' : ''}>ETH</option>
            <option ${asset === 'USDC' ? 'selected' : ''}>USDC</option>
          </select>
        </label>
      </div>
      <label class="field ferry-field"><span>Amount</span>
        <input id="toll-amount" data-testid="toll-amount" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${esc(state.amount || '')}" aria-label="Amount">
      </label>
      <label class="field ferry-field"><span>Destination</span>
        <input id="toll-to" data-testid="toll-to" autocomplete="off" spellcheck="false" placeholder="0x and 40 hex" value="${esc(state.to || '')}" aria-label="Destination">
      </label>
      <p class="ferry-rate tok-done" data-testid="toll-foreign">${esc(feeLine)}</p>
      <p class="ferry-charter-note tok-done" data-testid="toll-refuse"${status ? '' : ' hidden'}>${esc(status)}</p>
      ${rowNote}
      ${passTx ? `<p class="toll-pass-tx">${passTx}</p>` : ''}
      <button type="button" class="ferry-cta" id="toll-pay" data-testid="toll-pay"${ctaBlocked ? ' disabled' : ''}>${esc(ctaText)}</button>
    </div>
    <div class="ferry-pane toll-pane" data-testid="toll-pane-proof"${tab === 'proof' ? '' : ' hidden'}>
      <div class="ferry-flow tok-done">${chainIcon}<p class="toll-address" data-testid="toll-address">${esc(wallet.address || 'No address yet')}</p></div>
      <p class="ferry-rate" data-testid="toll-address-words">${esc(wallet.text)}</p>
      <p class="ferry-rate" data-testid="toll-balance">${esc(state.balanceWords || (wallet.address ? 'Balance unread until this page asks the chain.' : 'No balance yet. The address is not recovered.'))}</p>
      ${deriveLine(state)}
      <button type="button" class="toll-quiet" id="toll-copy" data-testid="toll-copy"${wallet.address ? '' : ' disabled'}>Copy address</button>
      <button type="button" class="toll-quiet" id="toll-gas" data-testid="toll-gas"${wallet.address ? '' : ' disabled'}>${esc(state.gasNear ? `Fill gas · ${state.gasNear} NEAR` : 'Fill gas')}</button>
      ${sig}
      <button type="button" class="toll-quiet" id="toll-sig" data-testid="check-signature"${state.pending ? ' disabled' : ''}>Check signature</button>
    </div>
    <div class="ferry-pane toll-pane" data-testid="toll-pane-split"${tab === 'split' ? '' : ' hidden'}>
      <p class="ferry-rate" data-testid="toll-split">${esc(state.policyNote || splitWords(live))}</p>
      ${recent ? `<ul class="toll-live">${recent}</ul>` : '<p class="ferry-rate">No foreign row yet. A signature is not a Base payment.</p>'}
      ${records ? `<p class="toll-records">${records}</p>` : ''}
      ${canBroadcast ? '<button type="button" class="toll-quiet" id="toll-broadcast" data-testid="toll-broadcast">Broadcast</button>' : ''}
    </div>
  </div>`;
}

/**
 * The toll's own recorded Base address, checked against the public key it was derived from.
 * `checkDerived` was already computed at mount and then thrown away, so the verification existed
 * only in the code. A judge asking "does this contract really control that address" had nothing to
 * look at. It is rendered now, with the honest caveat that the toll holds the key and does not pay
 * the visitor from it.
 */
function deriveLine(state) {
  const d = state?.derive;
  if (!d || !d.recorded) return '';
  if (d.error) {
    return `<p class="ferry-rate" data-testid="toll-derive">Could not derive the address in this browser: ${esc(d.error)}</p>`;
  }
  return `<p class="ferry-rate" data-testid="toll-derive">${d.ok
    ? `Derived ${esc(d.computed)} from the toll public key. The toll signs with it and does not pay your account from it.`
    : `The derived address ${esc(d.computed || '?')} does not match the recorded ${esc(d.recorded)}. Do not trust either until they agree.`}</p>`;
}

export function mountTollRoom(root, hooks = {}, env = {}) {
  if (!root) return;
  const state = hooks.state || (hooks.state = {});
  if (!state.tab) state.tab = 'pass';
  if (!state.derive) state.derive = checkDerived({ publicKey: TOLL_KEY, recorded: TOLL_ADDRESS });
  // Read the visitor at mount, not only when an action asks for it. The Wallet tab renders
  // from `state.owner`, so leaving it empty showed a signed-in visitor "Sign in at /setup".
  if (typeof hooks.account === 'function') {
    const who = String(hooks.account() || '');
    if (who) state.owner = who;
  }
  const apiBase = env.api ?? ((globalThis.NEARCARTA_API || '').replace(/\/$/, ''));
  const doc = env.doc || (typeof document !== 'undefined' ? document : null);

  // The row's own derived address, read from the toll's `address_of` for this visitor.
  // Two unrelated visitors get different paths (`row:{owner}:base`) and so different
  // addresses. Nothing is invented: before the first signature this stays null.
  async function loadWallet() {
    const owner = typeof hooks.account === 'function' ? String(hooks.account() || '') : '';
    if (!owner) { state.rowAddress = null; state.balanceWords = ''; return; }
    state.walletOwner = owner;
    let got = null;
    try { got = await fetch(apiBase + '/api/toll/address/' + encodeURIComponent(owner)).then(r => r.json()); }
    catch { got = null; }
    state.rowAddress = got?.address || null;
    state.balanceWords = got?.address
      ? (got?.balance_eth ? `Balance ${got.balance_eth} ETH on Base.` : 'Balance not read yet.')
      : 'No address yet. The signer returns one with this row\'s first crossing.';
  }

  const paint = () => {
    if (typeof hooks.row === 'function') state.row = hooks.row() || null;
    // No row means the board has nothing to spend from. Show that as a setup
    // step before the visitor presses the button, not as a refusal after.
    state.needsRow = !state.row;
    state.capText = capLine(state.row, policyQuote(state.live?.ok ? state.live : { ok: false }));
    root.innerHTML = tollMarkup(state);
    bind();
    bindTokenFallbacks(root);
    const goto = root.querySelector('[data-testid="toll-setup-link"]');
    if (goto) goto.onclick = (e) => { if (e) e.preventDefault(); globalThis.location?.assign?.('/setup/'); };
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
    const quote = policyQuote(state.live?.ok ? state.live : { ok: false });
    const plan = parseTollCommand(typeof text === 'string' ? text : '', quote);
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
    if (plan.action === 'ledger') {
      state.tab = 'split';
      paint();
      return { ok: true, action: 'ledger', hint: splitWords(state.live) };
    }
    if (plan.action === 'address') {
      state.owner = typeof hooks.account === 'function' ? String(hooks.account() || '') : (state.owner || '');
      state.tab = 'proof';
      paint();
      return { ok: true, action: 'address', hint: walletWords({ owner: state.owner, address: state.rowAddress || null }).text };
    }
    if (!hooks.onPay) {
      const hint = 'Set up your agent in /setup. Nothing was signed.';
      return { ok: false, action: 'pay', hint };
    }
    state.tab = 'pass';
    state.to = plan.to || state.to || '';
    state.amount = plan.amount || state.amount || '';
    state.asset = plan.asset === 'usdc' ? 'USDC' : (plan.asset === 'native' ? 'ETH' : (state.asset || 'ETH'));
    state.pending = PENDING_PAY;
    paint();
    const res = await hooks.onPay({ ...quote, to: plan.to, asset: plan.asset, amount: plan.amount });
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
    const sendPay = () => {
      const to = root.querySelector('#toll-to')?.value?.trim() || '';
      const amount = root.querySelector('#toll-amount')?.value?.trim() || '';
      const asset = root.querySelector('#toll-asset')?.value || 'ETH';
      const chain = root.querySelector('#toll-chain')?.value || 'base';
      state.to = to;
      state.amount = amount;
      state.asset = asset;
      if (chain === 'arbitrum') { runAgent('cross to Arbitrum'); return; }
      const line = amount && to ? `pay ${amount} ${asset} to ${to} on Base` : (to ? `pay the toll on Base to ${to}` : 'Pay the toll');
      runAgent(line);
    };
    if (pay) pay.onclick = () => {
      if (state.needsRow) { globalThis.location?.assign?.('/setup/'); return; }
      sendPay();
    };
    root.querySelectorAll('#toll-to, #toll-amount').forEach(input => {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); sendPay(); }
      });
    });
    const tabs = root.querySelector('.ferry-tabs');
    if (tabs) tabs.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const list = [...root.querySelectorAll('[data-tab]')];
      const i = list.findIndex(t => t.getAttribute('aria-selected') === 'true');
      const n = e.key === 'ArrowRight' ? (i + 1) % list.length : (i - 1 + list.length) % list.length;
      list[n]?.focus();
      list[n]?.click();
    });
    const gas = root.querySelector('#toll-gas');
    if (gas) gas.onclick = async () => {
      // Gas lands on this row's own derived address, never the shared path and never
      // another visitor's row. The amount is the visitor's call, defaulting to a small
      // top-up. This is a NEAR transfer from the row, so it is stated before it runs.
      if (!state.rowAddress) {
        state.seal = 'No derived address for this row yet. The signer returns one with its first crossing. Nothing was sent.';
        state.tab = 'proof'; paint(); return;
      }
      const near = state.gasNear || '0.02';
      const words = `Fill ${near} NEAR of gas to ${state.rowAddress}? The row pays, under its own cap.`;
      let go = true;
      if (typeof hooks.confirm === 'function') go = await hooks.confirm(words);
      else if (doc && typeof doc.defaultView?.confirm === 'function') go = doc.defaultView.confirm(words);
      if (!go) { state.seal = 'Cancelled. Nothing was sent.'; state.tab = 'proof'; paint(); return; }
      state.pending = 'Filling gas…'; state.tab = 'proof'; paint();
      let r = null;
      try { r = await hooks.onGas?.(state.rowAddress, near); }
      catch (e) { r = { ok: false, hint: String(e?.message || e).slice(0, 160) }; }
      state.pending = '';
      state.seal = r?.hint || (r?.ok ? `Gas sent to ${state.rowAddress}.` : 'The gas fill did not answer. Nothing was sent.');
      paint();
    };
    const cast = root.querySelector('#toll-broadcast');
    if (cast) cast.onclick = async () => {
      state.pending = 'Broadcasting the signed transaction…';
      state.tab = 'pass';
      paint();
      let r = null;
      try { r = await hooks.onBroadcast?.(); } catch { r = null; }
      state.pending = '';
      state.sig = r?.text || 'The broadcast did not answer. Nothing moved on Base.';
      if (r?.claim === 'paid') hooks.onBasePaid?.();
      state.tab = 'proof';
      paint();
    };
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
  // The Wallet tab names this visitor's own derived address, so read it once the row
  // is known. A visitor with no row has no address and sees the setup line instead.
  loadWallet().then(() => { if (root.isConnected !== false) paint(); }).catch(() => {});
}

if (typeof window !== 'undefined') prefetchTollPolicy();
