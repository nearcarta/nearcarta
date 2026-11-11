// Market Day for real. After an email sign-in (no popup, no wallet, no gas), the steps that are market
// moves go to the market contract on mainnet through the relayer; the rest stay as they are, with the
// recorded transaction of the same action. The chain shows only in the Receipt. The signing code
// (Privy and the delegate actions) loads only when the visitor asks to sign in: /market/play.bundle.js.
import { precheck, goodsOf } from '/shared/relay/precheck.js';
const KEY = 'nearcarta.marketday.live';
const MILLI = 10n ** 21n;
let P = null;
const lib = () => (P ||= import('/market/play.bundle.js'));
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
export const live = load();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(live)); } catch {} };
export const on = () => !!live.account;

export async function resume() {
  if (!live.account) return null;
  try { const a = await (await lib()).current(); if (a !== live.account) { live.account = null; save(); } } catch { /* keep the record; signing asks again */ }
  return live.account;
}
export async function sendCode(email) { await (await lib()).sendCode(email); }
/** Log in, then the relayer opens the wallet (once). Returns the account. */
export async function login(email, code) {
  const L = await lib(); const account = await L.login(email, code);
  const s = await L.ensureSession();
  live.account = account; live.txs ||= [];
  for (const h of s.txs || []) if (h) live.txs.push({ step: 'open', what: 'Wallet opened by the city', hash: h });
  save(); return account;
}
export async function logout() { try { await (await lib()).logout(); } catch {} live.account = null; save(); }

async function purse() { try { const sq = await (await lib()).view('square', { account_id: live.account }); return BigInt(sq.purse); } catch { return null; } }
export async function coins() { return live.account ? purse() : null; }
async function bal(token) { try { return BigInt(await (await lib()).view('mt_balance_of', { account_id: live.account, token_id: token })); } catch { return 0n; } }
const record = (step, what, r) => { live.txs ||= []; live.txs.push({ step, what, hash: r.hash, burnt: r.burnt_near }); save(); return r; };
// Same balance pre-check as the relayer: a move the market would refuse is never sent.
const PRE = { ERR_PRECHECK_PURSE: 'Not enough coins in your purse yet. Sell more first.', ERR_PRECHECK_BAG: 'Not enough goods in your bag.', ERR_PRECHECK_STALL_TAKEN: 'Someone holds that stall.', ERR_PRECHECK_GATHER_CAP: 'The berths are done for you today. Come back tomorrow.', ERR_PRECHECK_PAYOUT_CAP: 'The market has paid you all it pays one merchant today.', ERR_PRECHECK_STORAGE: 'Getting your market space ready. Press again in a moment.', ERR_PRECHECK_NOT_HOLDER: 'Rent the stall first.' };
async function guard(L, calls) {
  const list = Array.isArray(calls) ? calls : [calls]; const goods = goodsOf(list);
  let st; try {
    const [sq, bals] = await Promise.all([L.view('square', { account_id: live.account }), goods.length ? L.view('mt_batch_balance_of', { account_id: live.account, token_ids: goods }) : []]);
    st = { purse: sq.purse, rules: sq.rules, stalls: sq.stalls, me: live.account, now_ns: BigInt(Date.now()) * 1_000_000n, bag: Object.fromEntries(goods.map((g, i) => [g, Number(bals[i] || 0)])) };
  } catch { return; } // cannot read: the relayer checks again
  const pc = precheck(list, st);
  if (!pc.ok) throw Object.assign(new Error(PRE[pc.why] || 'Not yet.'), { code: pc.why, need: pc.need, have: pc.have });
}
const send = async (L, calls) => { await guard(L, calls); return L.move(calls); };
const check = (r) => { if (!r.ok) throw Object.assign(new Error(r.failure?.match(/ERR_[A-Z_]+/)?.[0] || 'The market said no.'), { code: r.failure?.match(/ERR_[A-Z_]+/)?.[0] }); return r; };

// The real move behind each story step. Steps with no market move return null (the story runs as before).
export async function step(id, ctx = {}) {
  if (!live.account) return null;
  const L = await lib();
  if (id === 'cargo') {
    const r = check(await send(L, ['ferry-1', 'ferry-2', 'ferry-3'].map((node) => ({ method: 'gather', args: { node }, tgas: 15 }))));
    return record(id, 'Unloaded 3 salt at the Ferry', r);
  }
  if (id === 'sell') {
    const n = Number(await bal('good:salt')); if (!n) throw Object.assign(new Error('ERR_BALANCE'), { code: 'ERR_BALANCE' });
    const q = await L.view('quote', { shop: 'arena', good: 'good:salt' });
    const qty = Math.min(3, n); const min = (BigInt(q.sell) * BigInt(qty) * 8n) / 10n;
    const before = await purse();
    const r = check(await send(L, { method: 'sell', args: { shop: 'arena', good: 'good:salt', qty, min_total: String(min), keep: true }, tgas: 20 }));
    const after = await purse(); r.total = before != null && after != null ? after - before : null;
    return record(id, `Sold ${qty} salt at the Arena`, r);
  }
  if (id === 'invest') {
    const shop = ctx.shop || 'ferry';
    await L.ensureSession(); // tops the market storage back up if the day used it
    const r = check(await send(L, { method: 'purse', args: { action: 'invest', amount: String(MILLI), shop }, tgas: 20 }));
    return record(id, `Invested 10 coins in the ${shop}`, r);
  }
  if (id === 'seal') return sealProfit();
  return null;
}

// Not signed in: the Ferry, the sale and the invest still run for real, on the city's demo purse (one shared
// account, server-signed, relayer-paid). Any refusal falls back to the practice step, said as practice.
export const DEMO_STEPS = ['cargo', 'sell', 'invest'];
export async function demo(id) {
  if (live.account || !DEMO_STEPS.includes(id)) return null;
  const api = (window.NEARCARTA_API || '').replace(/\/$/, '');
  try {
    const r = await (await fetch(`${api}/api/merchant/step`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ step: id }) })).json();
    if (r.why === 'ERR_MERCHANT_PURSE') return { saving: true, have: r.have };
    if (!r.ok || !r.hash) return null;
    return { ...r, demo: true, total: r.total != null ? BigInt(r.total) : null };
  } catch { return null; }
}

// Mist Bank seal: the Bank keeper's board row anchors a fingerprint of (account, purse, salt). Only the
// fingerprint leaves this browser; the salt and the amount stay here, so the visitor can reveal them later.
const SEALS = 'nearcarta.bank.seals';
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
async function sealProfit() {
  const amount = String((await purse()) ?? 0n);
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  const digest = hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${live.account}:${amount}:${salt}`)));
  const api = (window.NEARCARTA_API || '').replace(/\/$/, '');
  const r = await (await fetch(`${api}/api/bank/seal`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account_id: live.account, digest }) })).json().catch(() => ({ ok: false }));
  if (!r.ok) return null; // the story step still runs as practice
  try { const all = JSON.parse(localStorage.getItem(SEALS) || '[]'); all.push({ account: live.account, amount, salt, digest, board_salt: r.board_salt, commitment: r.commitment, hash: r.hash, at: Date.now() }); localStorage.setItem(SEALS, JSON.stringify(all)); } catch {}
  return record('seal', 'The Bank sealed your purse', { ...r, by_bank: true });
}

/** Rent a stall in the Arena square from the purse. */
export async function rentStall(stall = 1) {
  const L = await lib();
  await L.ensureSession();
  const r = check(await send(L, { method: 'stall', args: { stall, action: 'rent' }, tgas: 20 }));
  return record('stall', `Rented stall ${stall} in the Arena`, r);
}
export async function listStall(stall, good, qty, price) {
  const L = await lib();
  const r = check(await send(L, { method: 'stall', args: { stall, action: 'list', good, qty, price: String(price) }, tgas: 20 }));
  return record('stall', `Put ${qty} ${good.slice(5)} on stall ${stall}`, r);
}
export async function square() { try { return await (await lib()).view('square', { account_id: live.account }); } catch { return null; } }
