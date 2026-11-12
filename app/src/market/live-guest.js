// The guest's real Market Day: every story step becomes a real NEAR testnet transaction, signed in this
// browser by the guest key, or sent through the testnet relayer so the guest pays no gas.
//
// This is the guest twin of `app/house/play.js`: same shape (`current`, `ensureSession`, `move`, `view`,
// `account`, `step`, `demo`), so `app/src/market/city.js` drives either one without knowing which. The
// difference is who signs: the email wallet signs NEP-366 delegate actions, the guest signs the same
// delegate actions with the key it made locally, and its direct calls (board, house, toll) it signs and
// sends itself with its own test NEAR.
//
// Every step returns `{ hash, ... }` and every card shows a TESTNET pill and a receipt link, so a judge
// can open each one on the testnet explorer.
//
// Docs: https://docs.near.org/protocol/transactions/meta-tx (NEP-366 delegate actions)
//       https://docs.near.org/tools/near-api · https://docs.near.org/protocol/accounts-contracts/access-keys
//       https://docs.near.org/chain-abstraction/chain-signatures (the Toll's MPC signature)
//       https://api-testnet.nearblocks.io/api-docs (the timeline v3 reads)
import { NET, cfg, api, txUrl, setShops } from '../../../shared/net/net.js';
import TESTNET from '../../../shared/deployments/testnet.json' with { type: 'json' };
import { guestRecord, guestSigner, guestSecret, welcomeCrate, hasGuest } from '../guest/key.js';
import { crossArgs } from '../board-call-as.js';

// The shop accounts and the guest row defaults come from the testnet record. Nothing else on the page
// installs them, and without them a row would open with no receivers. A page or harness that already
// installed its own keeps them.
if (NET === 'testnet' && !cfg.shops?.board) setShops(TESTNET.shops || {}, TESTNET.guest?.row || null);

const TG = 10n ** 12n;
const MILLI = 10n ** 21n;
export const GUEST_STEPS = ['cargo', 'sell', 'invest', 'seal', 'pay', 'order', 'cross', 'check', 'write'];

const store = () => {
  try { return JSON.parse(globalThis.localStorage?.getItem('nearcarta.guest.play.v1') || '{}'); } catch { return {}; }
};
const save = (v) => { try { globalThis.localStorage?.setItem('nearcarta.guest.play.v1', JSON.stringify(v)); } catch { /* private mode */ } };
export const play = store();
export const on = () => NET === 'testnet' && hasGuest() && !!guestRecord()?.account;
export const account = () => (on() ? guestRecord().account : null);

/** Keep every guest transaction the story made, so the Chronicle and the welcome card can list them. */
export function record(step, what, r) {
  const all = store();
  (all.txs ||= []).push({ step, what, hash: r?.hash || null, net: 'testnet', at: Date.now() });
  save(all);
  return r;
}
export const txs = () => store().txs || [];

/** Bytes as base64 in a browser or in node (a browser has no Buffer). */
const b64 = (bytes) => {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (typeof btoa !== 'function') return Buffer.from(u).toString('base64');
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};

/** One move on the market through the testnet relayer: the guest signs a delegate action, the relayer pays. */
/**
 * A market move right after the one before it can reach the relayer before its RPC has the new block, so
 * the relayer's balance pre-check still sees the old bag or purse. Those refusals cost nothing (nothing
 * is sent), so the move is tried again a few times, a moment apart.
 */
export async function move(calls, opts = {}) {
  for (let i = 0; ; i++) {
    try { return await moveOnce(calls, opts); } catch (e) {
      if (i >= 4 || !/^ERR_PRECHECK_(BAG|PURSE)$/.test(String(e?.code || ''))) throw e;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}

async function moveOnce(calls, { signer } = {}) {
  const s = signer || (await guestSigner());
  if (!s) throw new Error('ERR_NO_GUEST');
  const { PublicKey, actions, buildDelegateAction, encodeSignedDelegate, KeyPairSigner } = await import('near-api-js');
  // Only the guest's own key signs here. It never leaves the browser; the relayer sees a signed action.
  const secret = guestSecret();
  if (!secret) throw new Error('ERR_NO_GUEST');
  const kp = KeyPairSigner.fromSecretKey(secret);
  const pk = await kp.getPublicKey();
  const market = cfg.shops.market || 'arena.nearcarta.testnet';
  const list = Array.isArray(calls) ? calls : [calls];
  // The access key nonce and the block height, from the same RPC the rest of the city reads.
  const rpcUrl = cfg.rpc[0];
  const rpc = async (method, params) => {
    const r = await fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    const j = await r.json();
    if (j.error) throw new Error(j.error.cause?.name || 'rpc');
    return j.result;
  };
  const [accessKey, head] = await Promise.all([
    rpc('query', { request_type: 'view_access_key', finality: 'final', account_id: s.accountId, public_key: pk.toString() }),
    rpc('block', { finality: 'final' }),
  ]);
  const da = buildDelegateAction({
    senderId: s.accountId,
    receiverId: market,
    publicKey: PublicKey.from(pk.toString()),
    nonce: BigInt(accessKey.nonce) + 1n,
    maxBlockHeight: BigInt(head.header.height) + 200n,
    actions: list.map((c) => actions.functionCall(c.method, c.args || {}, (c.tgas ? BigInt(c.tgas) : 30n) * TG, 0n)),
  });
  const { signedDelegate } = await kp.signDelegateAction(da);
  const res = await fetch(api('/api/relay'), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ signed_delegate: b64(encodeSignedDelegate(signedDelegate)) }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.ok === false) throw Object.assign(new Error(j.why || `http ${res.status}`), { code: j.why, detail: j });
  return j;
}

/** The first visit: the relayer tops up the guest's market storage. The account is already funded. */
export async function ensureSession() {
  if (!on()) return null;
  const s = await guestSigner();
  if (!s) return null;
  const res = await fetch(api('/api/relay/session'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account_id: s.accountId }) });
  return res.json().catch(() => null);
}

/**
 * Open the guest's own board row: `open_charter` and `set_calls`, signed and paid by the guest from the
 * float its funder gave it. The receivers are the record's shops, so nothing is hardcoded, and the caps
 * are the guest defaults in the record. Safe to call again: a row that exists is left alone.
 *
 * The agent key the row names is the guest's own public key. The guest already holds it as a
 * full-access key, so no second function-call key has to be added, and every later `propose_call_as`
 * is signed in this browser.
 * Docs: https://docs.near.org/protocol/accounts-contracts/access-keys · https://docs.near.org/protocol/accounts-contracts/account-id
 */
export async function openRow({ signer } = {}) {
  const s = signer || (await guestSigner());
  if (!s) return null;
  const board = cfg.shops.board || 'board.nearcarta.testnet';
  const existing = await s.view(board, 'get_charter', { owner: s.accountId }).catch(() => null);
  if (existing?.rules) return { already: true, hash: null };
  const g = cfg.guestRow || {};
  const receivers = (g.receivers || []).filter(Boolean);
  if (!receivers.length) return { refused: 'ERR_NO_RECEIVERS', hash: null };
  const rules = {
    receivers,
    per_action_cap: String(g.per_action_cap || '5000000000000000000000'),
    daily_budget: String(g.daily_budget || '20000000000000000000000'),
    max_actions_per_day: Number(g.max_actions_per_day || 8),
    window_start_min: 0, window_end_min: 0, min_amount: '1', expires_at: '0',
  };
  // The exact shop methods the story sends through the row, each with its own cap. The board refuses a
  // method that is not on this list (`method_not_allowlisted`) and a value over its cap (`over_shop_cap`),
  // which is the refusal the scam errand shows.
  const cap = String(g.per_action_cap || '5000000000000000000000');
  const shop = (k, fb) => cfg.shops[k] || fb;
  const calls = [
    { receiver: shop('townhall', 'townhall.nearcarta.testnet'), method: 'post_job', cap },
    { receiver: shop('toll', 'toll.nearcarta.testnet'), method: 'cross', cap },
    { receiver: shop('guard', 'guard.nearcarta.testnet'), method: 'pay', cap },
  ].filter((c) => receivers.includes(c.receiver));
  const open = await s.call(board, 'open_charter', { rules, agent: s.publicKey, fund: String(g.row_fund || '15000000000000000000000') }, { deposit: BigInt(g.row_deposit || '60000000000000000000000'), gas: 60n * TG });
  if (open.failure) return record('row', 'The board refused the row (testnet)', open);
  const set = await s.call(board, 'set_calls', { calls, session_cap: rules.daily_budget }, { deposit: BigInt(g.calls_deposit || '50000000000000000000000'), gas: 60n * TG });
  return record('row', 'Opened your board row (testnet)', { hash: set.hash || open.hash, set_hash: set.hash, open_hash: open.hash, failure: set.failure || null });
}

const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
/** A fresh anchor salt: the board takes 8 to 64 letters or digits. */
const newSalt = () => hex(globalThis.crypto.getRandomValues(new Uint8Array(12)));
const expiryNs = () => String(BigInt(Date.now()) * 1_000_000n + 600_000_000_000n);

/**
 * One call through the guest's own board row. The board builds the exact text it will check
 * (`call_as_message`, with its own network word and epoch), the guest key signs it here, and
 * `propose_call_as` carries the signature. `args` may be a function of the row nonce, for shops whose
 * arguments name the action id.
 * Docs: contracts/charter_board/src/v2.rs `call_as_message`, `propose_call_as`
 */
export async function callAs(s, { receiver, method, args, deposit = '0' }) {
  const board = cfg.shops.board || 'board.nearcarta.testnet';
  const row = await s.view(board, 'get_charter', { owner: s.accountId }).catch(() => null);
  if (!row) return { hash: null, failure: 'ERR_NO_CHARTER' };
  const nonce = String(row.nonce ?? '0');
  const argText = typeof args === 'function' ? args(nonce) : (typeof args === 'string' ? args : JSON.stringify(args));
  const expiry = expiryNs();
  const body = { owner: s.accountId, receiver, method, args: argText, deposit: String(deposit), expiry, effects: [], hold: false };
  const text = await s.view(board, 'call_as_message', { ...body, nonce, expiry });
  const signature = await s.sign(text);
  return s.call(board, 'propose_call_as', { ...body, signature }, { deposit: 0n, gas: 150n * TG });
}

/** The reason a failed receipt names, in the contract's own words. */
export const reasonOf = (failure) => {
  const m = /panicked: ([^"\\]+)/.exec(String(failure || ''));
  return m ? m[1].trim() : (failure ? String(failure).slice(0, 120) : null);
};
/** The refusals a row's caps produce. Anything else is a bug or an outage, never a "refused by design". */
export const CAP_REFUSAL = /^(over_shop_cap|over_session_cap|over_per_action_cap|over_daily_budget|over_daily_action_count)/;

export async function view(method, args = {}, contract) {
  const s = await guestSigner();
  if (!s) return null;
  return s.view(contract || cfg.shops.market || 'arena.nearcarta.testnet', method, args);
}

const purse = async () => { try { const sq = await view('square', { account_id: account() }); return BigInt(sq?.purse ?? 0n); } catch { return null; } };

/**
 * Walk one story step for real on testnet. Returns `{ hash, ... }` or null when this step has nothing
 * real to do (Practice mode stays the floor).
 */
export async function step(id, ctx = {}) {
  if (!on()) return null;
  const s = await guestSigner();
  if (!s) return null;
  // The guest pays no gas on market moves, but its market storage has to exist first.
  if (id === 'cargo') {
    // Three gathers through the relayer: each one mints NEP-245 salt to the guest.
    const r = await move(['ferry-1', 'ferry-2', 'ferry-3'].map((node) => ({ method: 'gather', args: { node }, tgas: 15 })));
    return record(id, 'Unloaded 3 salt at the Ferry (testnet)', r);
  }
  if (id === 'sell') {
    const q = await view('quote', { shop: 'arena', good: 'good:salt' });
    const n = 3;
    const min = q?.sell ? (BigInt(q.sell) * BigInt(n) * 8n) / 10n : 1n;
    const before = await purse();
    const r = await move({ method: 'sell', args: { shop: 'arena', good: 'good:salt', qty: n, min_total: String(min), keep: true }, tgas: 20 });
    await new Promise((r2) => setTimeout(r2, 1500));
    const after = await purse();
    return record(id, `Sold ${n} salt at the Arena (testnet)`, { ...r, total: before != null && after != null ? after - before : null });
  }
  if (id === 'invest') {
    await ensureSession();
    const shop = ctx.shop || 'ferry';
    const r = await move({ method: 'purse', args: { action: 'invest', amount: String(MILLI), shop }, tgas: 20 });
    return record(id, `Bought a ${shop} share (testnet)`, r);
  }
  // The steps that act through the guest's own board row open it first, once. openRow is a no-op when
  // the row exists, and a refusal comes back as this step's receipt instead of a silent practice step.
  if (['seal', 'order', 'cross', 'check', 'write'].includes(id)) {
    const row = await openRow({ signer: s }).catch((e) => ({ hash: null, failure: String(e?.message || e) }));
    if (row?.failure || row?.refused) return { hash: row.hash || null, failure: row.failure || row.refused, row_hash: row.hash || null };
  }
  if (id === 'seal') return sealProfit(s);
  if (id === 'pay') return payPorter(s);
  if (id === 'order') return postOrder(s);
  if (id === 'cross') return crossBridge(s);
  if (id === 'check') return checkBuyers(s);
  if (id === 'write') return writeDay(s);
  return null;
}

/**
 * The scam errand, step 1: ask the keeper, then anchor the signed refusal on chain.
 *
 * The refusal is TEE-signed by NEAR AI Cloud; the digest of that signature text is what the guest's own
 * row writes with `board.anchor`, so a "no" becomes a transaction instead of an API field. Only the digest
 * goes on chain. Returns `{ ask, hash, failure }` where `ask` is everything the card shows.
 * Docs: https://docs.near.ai/cloud/verification/reference/response-signature-verification
 *       https://docs.near.org/protocol/accounts-contracts/access-keys
 */
export async function scamAsk(text, { signer } = {}) {
  const s = signer || (await guestSigner());
  if (!s) return { refusal: 'ERR_NO_GUEST' };
  const res = await fetch(api('/api/scam/ask'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
  const ask = await res.json().catch(() => ({ ok: false, why: 'ERR_ASK' }));
  if (!ask?.ok) return { ask, refusal: ask?.why || 'ERR_ASK' };
  const board = cfg.shops.board || 'board.nearcarta.testnet';
  const r = await s.call(board, 'anchor', { kind: 'keeper_refusal', digest: ask.digest, salt: newSalt() }, { deposit: 0n, gas: 40n * TG });
  return record('refusal', 'The keeper refused, and the refusal is on chain (testnet)', { ask, hash: r.hash, failure: r.failure, url: r.hash ? txUrl(r.hash) : null });
}

/**
 * The scam errand, step 2: submit the over-limit intent ANYWAY, and let the charter refuse it.
 *
 * The server does not trim the amount. This builds the intent the keeper refused and posts it through the
 * board; the board's caps reject it, so the card can link a failed receipt and name the reason. A successful
 * send here would be a bug in the charter, and the card says that too.
 * Docs: https://docs.near.org/protocol/transactions (a failed outcome is a real transaction)
 */
export async function scamForce({ signer } = {}) {
  const s = signer || (await guestSigner());
  if (!s) return { refusal: 'ERR_NO_GUEST' };
  const guard = cfg.shops.guard || 'guard.nearcarta.testnet';
  const limit = (cfg.scamLimit || {}).amount_near || '0.5';
  const yocto = BigInt(Math.round(Number(limit) * 1e6)) * 10n ** 18n;
  const payee = cfg.shops['keeper-guard'] || 'keeper-guard.nearcarta.testnet';
  // The exact intent the keeper refused, signed by the row's own key so the signature is valid: the
  // only thing that can stop it is the row's cap.
  const r = await callAs(s, {
    receiver: guard, method: 'pay', deposit: String(yocto),
    args: (nonce) => JSON.stringify({ payee, chain: 'near', asset: 'NEAR', amount: String(yocto), action_id: nonce, invoice: '' }),
  });
  const reason = reasonOf(r.failure);
  // Only a cap refusal is the leash working. A signature or balance error is an outage, and the card says so.
  const refused = !!r.failure && CAP_REFUSAL.test(reason || '');
  const what = refused ? `The charter refused an over-limit payment: ${reason} (testnet)`
    : r.failure ? `The forced payment failed for another reason: ${reason} (testnet)`
      : 'The charter allowed an over-limit payment (testnet)';
  return record('force', what, { hash: r.hash, failure: r.failure, refused, reason, amount_near: limit, url: r.hash ? txUrl(r.hash) : null });
}

/**
 * Bank seal: the guest's own row anchors a fingerprint of the purse. Only sha256(salt‖digest) goes on
 * chain through `board.anchor`; the salt and the amount stay in this browser, so the reveal is the
 * guest's to make. The board writes the commitment into its log, not the amount.
 * Docs: https://docs.near.org/protocol/accounts-contracts/access-keys
 */
async function sealProfit(s) {
  const amount = String((await purse()) ?? 0n);
  const saltBytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
  const salt = hex(saltBytes);
  const digest = hex(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${s.accountId}:${amount}:${salt}`)));
  const board = cfg.shops.board || 'board.nearcarta.testnet';
  const r = await s.call(board, 'anchor', { kind: 'bank_profit', digest, salt }, { deposit: 0n, gas: 40n * TG });
  if (r.hash) {
    try {
      const all = JSON.parse(globalThis.localStorage.getItem('nearcarta.bank.seals') || '[]');
      all.push({ account: s.accountId, amount, salt, digest, hash: r.hash, net: 'testnet', at: Date.now() });
      globalThis.localStorage.setItem('nearcarta.bank.seals', JSON.stringify(all));
    } catch { /* the seal still landed; the reveal key is lost, and the card says so */ }
  }
  return record('seal', 'The Bank sealed your purse (testnet)', { ...r, by_bank: false, own_row: true });
}

/**
 * Payouts: the guest pays the porter 3 test dollars with `ft_transfer` on the test USD contract. The
 * guest signs and sends it, so the receipt is under the guest's own account and names the amount.
 * Docs: https://docs.near.org/primitives/ft/standard · https://github.com/near/NEPs/blob/master/neps/nep-0141.md
 */
async function payPorter(s) {
  const token = cfg.shops.tusdc || 'tusdc.nearcarta.testnet';
  const keeper = cfg.shops['keeper-payouts'] || 'keeper-payouts.nearcarta.testnet';
  const r = await s.call(token, 'ft_transfer', { receiver_id: keeper, amount: '3000000' }, { deposit: 1n, gas: 30n * TG });
  return record('pay', 'Porter paid 3 test dollars (testnet)', r);
}

/**
 * Town Hall: the guest's row posts a job through the board. The worker who bids is the city's keeper, a
 * real testnet account, so the hire is real NEP-171-free work on testnet, not a scripted line.
 * Docs: https://docs.near.org/tools/near-api
 */
async function postOrder(s) {
  const hall = cfg.shops.townhall || 'townhall.nearcarta.testnet';
  const deadline = String(BigInt(Date.now()) * 1_000_000n + 86_400n * 1_000_000_000n);
  const worker = cfg.shops['keeper-hall'] || 'keeper-hall.nearcarta.testnet';
  // A board row call: the board injects row_owner, so the guest's row pays and the Hall sees the row.
  const r = await callAs(s, {
    receiver: hall, method: 'post_job', deposit: String(MILLI),
    args: { task: 'carry three salt to the Square', parts: 1, deadline, workers: [worker], idempotency: `guest-${s.accountId}-${Date.now()}` },
  });
  return record('order', 'Order posted at the Town Hall (testnet)', r);
}

/**
 * Toll: a real Chain Signature. The row opens the crossing (`toll.cross` through the board), then the
 * guest calls `toll.sign_cross` and the MPC network signs a Base Sepolia transaction. There is no Base
 * Sepolia ETH, so the backend does NOT broadcast it: the card shows the signed transaction and the
 * exact link it would appear at, and says in one line that it was not sent.
 * Docs: https://docs.near.org/chain-abstraction/chain-signatures
 *       https://docs.near.org/chain-abstraction/chain-signatures/implementation
 */
async function crossBridge(s) {
  const toll = cfg.shops.toll || 'toll.nearcarta.testnet';
  const policy = await s.view(toll, 'policy', {}).catch(() => null);
  const fee = String(policy?.price?.fee || MILLI);
  // The crossing pays out to the toll's own Base address: nothing is broadcast on the guest network,
  // so the recipient only shapes the signed transaction.
  const to = cfg.shops.tollTo && /^0x[0-9a-fA-F]{40}$/.test(cfg.shops.tollTo) ? cfg.shops.tollTo : (policy?.foreign_address || '0x0000000000000000000000000000000000000001');
  const amount = '10000000000000';
  const order = await callAs(s, {
    receiver: toll, method: 'cross', deposit: fee,
    // The row budget is the visitor's own ceiling for crossings on this toll; ten crossings' worth lets a
    // guest who reloads mid-step cross again instead of hitting `the row budget is spent`.
    args: (nonce) => crossArgs({ actionId: nonce, chain: 'base', asset: 'native', to, amount, rowBudget: String(BigInt(amount) * 10n) }),
  });
  if (order.failure) return record('cross', 'Toll crossing refused (testnet)', order);
  const id = crossIdOf(order.raw, toll);
  if (id == null) return record('cross', 'Toll crossing opened, its id was not readable (testnet)', { ...order, failure: 'ERR_NO_ORDER_ID' });
  // The signature is a separate call: 150 Tgas or more, because the MPC reply is a cross-contract call.
  const signed = await s.call(toll, 'sign_cross', { id: Number(id) }, { deposit: 0n, gas: 160n * TG }).catch((e) => ({ hash: null, failure: String(e?.message || e) }));
  const tx = signedTxOf(signed.raw);
  return record('cross', signed.failure ? 'The MPC signature did not come back (testnet)' : 'Signed by NEAR MPC on testnet, not sent to Base Sepolia', {
    hash: signed.hash, failure: signed.failure, order_hash: order.hash, order_id: String(id), broadcast: false,
    evm_hash: tx?.tx_hash || null, raw_signed: tx?.raw_signed || null, evm_to: tx?.to || null, evm_value: tx?.value || null,
  });
}

/** The signed Base transaction `sign_cross` returned: its hash and raw bytes, never broadcast here. */
export function signedTxOf(raw) {
  const v = raw?.status?.SuccessValue;
  if (!v) return null;
  try {
    const txt = typeof atob === 'function' ? atob(v) : Buffer.from(v, 'base64').toString('utf8');
    const j = JSON.parse(txt);
    return j && typeof j === 'object' ? j : null;
  } catch { return null; }
}

/** The order id `toll.cross` returned, read from its receipt in the board transaction. */
export function crossIdOf(raw, toll) {
  for (const o of raw?.receipts_outcome || []) {
    if (o?.outcome?.executor_id !== toll) continue;
    const v = o?.outcome?.status?.SuccessValue;
    if (!v) continue;
    try {
      const txt = typeof atob === 'function' ? atob(v) : Buffer.from(v, 'base64').toString('utf8');
      if (/^\d+$/.test(txt.trim())) return txt.trim();
    } catch { /* not this one */ }
  }
  return null;
}

/**
 * Guardhouse: the honest buyer is paid through the row and the look-alike is refused on chain. The
 * refusal is a real failed receipt, so the card links a transaction that actually says no.
 * Docs: https://docs.near.org/protocol/accounts-contracts/account-id (look-alike ids)
 */
async function checkBuyers(s) {
  const guard = cfg.shops.guard || 'guard.nearcarta.testnet';
  const honest = cfg.shops['keeper-guard'] || 'keeper-guard.nearcarta.testnet';
  const lookAlike = cfg.shops.lookalike || 'keeper-gaurd.nearcarta.testnet';
  const amount = '100000000000000000000';
  // The honest buyer: the guard forwards the payment through the row.
  const allowed = await callAs(s, {
    receiver: guard, method: 'pay', deposit: amount,
    args: (nonce) => JSON.stringify({ payee: honest, chain: 'near', asset: 'NEAR', amount, action_id: nonce, invoice: '' }),
  });
  // The look-alike asks to be paid directly. It is not on the row's list, so the board refuses it on chain.
  const refused = await callAs(s, {
    receiver: lookAlike, method: 'pay', deposit: amount,
    args: (nonce) => JSON.stringify({ payee: lookAlike, chain: 'near', asset: 'NEAR', amount, action_id: nonce, invoice: '' }),
  });
  return record('check', 'Guard: honest buyer paid, con artist refused (testnet)', {
    hash: allowed.hash, failure: allowed.failure, refused_hash: refused.hash, refused_failure: refused.failure, refused_reason: reasonOf(refused.failure), lookalike: lookAlike,
  });
}

/**
 * Chronicle: the day is read from the testnet index (nearblocks v3 and the FastNEAR tx index) and the
 * guest's own row anchors the digest of that list, so the day itself is on chain.
 * Docs: https://api-testnet.nearblocks.io/api-docs · https://docs.fastnear.com/
 */
async function writeDay(s) {
  let day = null;
  try { day = await (await fetch(api('/api/chronicle/live?account=' + encodeURIComponent(s.accountId)))).json(); } catch { day = null; }
  const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
  const rows = day?.rows || day?.receipts || [];
  const list = rows.map((r) => r.hash).filter(Boolean).sort().join(',');
  const digest = hex(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(list || s.accountId)));
  const board = cfg.shops.board || 'board.nearcarta.testnet';
  const r = await s.call(board, 'anchor', { kind: 'chronicle_day', digest, salt: newSalt() }, { deposit: 0n, gas: 40n * TG });
  return record('write', 'The day anchored on testnet', { ...r, events: rows.length });
}

/** Read every guest transaction the story made, newest last, ready for the Chronicle list. */
export function history() {
  return txs().map((t) => ({ ...t, url: txUrl(t.hash) }));
}

/** The welcome crate, for the card. */
export { welcomeCrate };
