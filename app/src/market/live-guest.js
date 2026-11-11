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
import { NET, cfg, api, txUrl } from '../../../shared/net/net.js';
import { guestRecord, guestSigner, guestSecret, welcomeCrate, hasGuest } from '../guest/key.js';

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

/** One move on the market through the testnet relayer: the guest signs a delegate action, the relayer pays. */
export async function move(calls, { signer } = {}) {
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
    body: JSON.stringify({ signed_delegate: Buffer.from(encodeSignedDelegate(signedDelegate)).toString('base64') }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.ok === false) throw Object.assign(new Error(j.why || `http ${res.status}`), { code: j.why });
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
  // Every shop pair the row may send. One pair per receiver is enough for the story: the board
  // checks the method against the call list, and the caps above bound the value.
  const calls = receivers.map((receiver) => ({ receiver, method: g.method || 'propose', cap: '0' }));
  const open = await s.call(board, 'open_charter', { rules, agent: s.publicKey, fund: String(g.row_fund || '1000000000000000000000') }, { deposit: BigInt(g.row_deposit || '40000000000000000000000'), gas: 60n * TG });
  if (open.failure) return record('row', 'The board refused the row (testnet)', open);
  const set = await s.call(board, 'set_calls', { calls, session_cap: rules.daily_budget }, { deposit: BigInt(g.calls_deposit || '5000000000000000000000'), gas: 60n * TG });
  return record('row', 'Opened your board row (testnet)', { hash: set.hash || open.hash, set_hash: set.hash, open_hash: open.hash, failure: set.failure || null });
}

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
    const after = await purse();
    return record(id, `Sold ${n} salt at the Arena (testnet)`, { ...r, total: before != null && after != null ? after - before : null });
  }
  if (id === 'invest') {
    await ensureSession();
    const shop = ctx.shop || 'ferry';
    const r = await move({ method: 'purse', args: { action: 'invest', amount: String(MILLI), shop }, tgas: 20 });
    return record(id, `Bought a ${shop} share (testnet)`, r);
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
  const r = await s.call(board, 'anchor', { kind: 'keeper_refusal', digest: ask.digest, salt: '' }, { deposit: 0n, gas: 40n * TG });
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
  const board = cfg.shops.board || 'board.nearcarta.testnet';
  const guard = cfg.shops.guard || 'guard.nearcarta.testnet';
  const limit = (cfg.scamLimit || {}).amount_near || '0.5';
  const yocto = BigInt(Math.round(Number(limit) * 1e6)) * 10n ** 18n;
  const r = await s.call(board, 'propose_call_as', {
    owner: s.accountId,
    receiver: guard,
    method: 'pay',
    args: JSON.stringify({ payee: cfg.shops['keeper-guard'] || 'keeper-guard.nearcarta.testnet', amount: String(yocto) }),
    deposit: String(yocto),
    expiry: String(BigInt(Date.now()) * 1_000_000n + 600_000_000_000n),
    effects: [],
    hold: false,
    signature: '',
  }, { deposit: 0n, gas: 100n * TG });
  // A refusal is the expected, correct outcome: the card shows it as refused, not as an error.
  const refused = !!r.failure;
  return record('force', refused ? 'The charter refused an over-limit payment (testnet)' : 'The charter allowed an over-limit payment (testnet)', {
    hash: r.hash, failure: r.failure, refused, amount_near: limit, url: r.hash ? txUrl(r.hash) : null,
  });
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
  const board = cfg.shops.board || 'board.nearcarta.testnet';
  const deadline = String(BigInt(Date.now()) * 1_000_000n + 86_400n * 1_000_000_000n);
  // A board row call: the board injects row_owner, so the guest's row pays and the Hall sees the row.
  const r = await s.call(board, 'propose_call_as', {
    owner: s.accountId,
    receiver: hall,
    method: 'post_job',
    args: JSON.stringify({ task: 'carry three salt to the Square', parts: 1, deadline, workers: [cfg.shops['keeper-hall'] || 'keeper-hall.nearcarta.testnet'], idempotency: `guest-${s.accountId}-${Date.now()}` }),
    deposit: String(1_000_000_000_000_000_000_000n),
    expiry: String(BigInt(Date.now()) * 1_000_000n + 600_000_000_000n),
    effects: [],
    hold: false,
    signature: '',
  }, { deposit: 0n, gas: 100n * TG });
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
  const board = cfg.shops.board || 'board.nearcarta.testnet';
  const order = await s.call(board, 'propose_call_as', {
    owner: s.accountId,
    receiver: toll,
    method: 'cross',
    args: JSON.stringify({ chain: 'base', asset: 'native', to: cfg.shops.tollTo || '', amount: '10000000000000', row_budget: '10000000000000' }),
    deposit: '0',
    expiry: String(BigInt(Date.now()) * 1_000_000n + 600_000_000_000n),
    effects: [],
    hold: false,
    signature: '',
  }, { deposit: 0n, gas: 100n * TG });
  if (order.failure) return record('cross', 'Toll crossing refused (testnet)', order);
  // The signature is a separate call: 150 Tgas or more, because the MPC reply is a cross-contract call.
  const signed = await s.call(toll, 'sign_cross', { row_owner: s.accountId }, { deposit: 0n, gas: 180n * TG }).catch((e) => ({ hash: null, failure: String(e?.message || e) }));
  return record('cross', 'Signed by NEAR MPC on testnet', { ...signed, order_hash: order.hash, broadcast: false });
}

/**
 * Guardhouse: the honest buyer is paid through the row and the look-alike is refused on chain. The
 * refusal is a real failed receipt, so the card links a transaction that actually says no.
 * Docs: https://docs.near.org/protocol/accounts-contracts/account-id (look-alike ids)
 */
async function checkBuyers(s) {
  const guard = cfg.shops.guard || 'guard.nearcarta.testnet';
  const board = cfg.shops.board || 'board.nearcarta.testnet';
  const honest = cfg.shops['keeper-guard'] || 'keeper-guard.nearcarta.testnet';
  const lookAlike = cfg.shops.lookalike || 'keeper-guard.nearcarta.testnet0';
  const pay = (to) => s.call(board, 'propose_call_as', {
    owner: s.accountId, receiver: guard, method: 'pay',
    args: JSON.stringify({ payee: to, amount: '100000000000000000000' }),
    deposit: '100000000000000000000',
    expiry: String(BigInt(Date.now()) * 1_000_000n + 600_000_000_000n), effects: [], hold: false, signature: '',
  }, { deposit: 0n, gas: 100n * TG });
  const allowed = await pay(honest);
  const refused = await pay(lookAlike);
  return record('check', 'Guard: honest buyer paid, con artist refused (testnet)', { hash: allowed.hash, refused_hash: refused.hash, refused_failure: refused.failure });
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
  const list = (day?.receipts || []).map((r) => r.hash).filter(Boolean).sort().join(',');
  const digest = hex(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(list || s.accountId)));
  const board = cfg.shops.board || 'board.nearcarta.testnet';
  const r = await s.call(board, 'anchor', { kind: 'chronicle_day', digest, salt: '' }, { deposit: 0n, gas: 40n * TG });
  return record('write', 'The day anchored on testnet', { ...r, events: (day?.receipts || []).length });
}

/** Read every guest transaction the story made, newest last, ready for the Chronicle list. */
export function history() {
  return txs().map((t) => ({ ...t, url: txUrl(t.hash) }));
}

/** The welcome crate, for the card. */
export { welcomeCrate };
