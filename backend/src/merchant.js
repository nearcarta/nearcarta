// The city's demo purse: visitors who have not signed in still play the Ferry, the sale and the invest as
// real, receipted market moves, on ONE shared account (an implicit account that already holds market storage).
// The server signs each move as a delegate action and the relayer sends it, so nothing new is funded per visitor.
// Limits, all checked before a move is signed:
//   - runs a day: read on chain from the market's own gathers_today counter (3 gathers per run), so it holds
//     across server instances and restarts;
//   - gas per move: a fixed prepaid cap (gather 3x15, sell 20, invest 20 TGas);
//   - the relayer's balance floor, read on chain.
// The key comes only from the server env and is never logged.
import { KeyPairSigner, actions, buildDelegateAction, encodeSignedDelegate } from 'near-api-js';
import { rpc, view } from './near.js';
import { relay, session, conf as relayConf } from './relayer.js';
const F = { fresh: true };
const fv = (c, m, a) => view(c, m, a, undefined, F);

const NEAR = 10n ** 24n, TG = 10n ** 12n, MILLI = 10n ** 21n;
const toYocto = (s) => { const [a, b = ''] = String(s).split('.'); return BigInt(a || 0) * NEAR + BigInt((b + '0'.repeat(24)).slice(0, 24)); };
export const conf = () => ({
  account: process.env.MERCHANT_ACCOUNT || '',
  runsPerDay: Number(process.env.MERCHANT_RUNS_PER_DAY || 60),
  floor: toYocto(process.env.MERCHANT_FLOOR_NEAR || '0.005'),
  maxTgas: Number(process.env.MERCHANT_MAX_TGAS || 45),
});
const hasKey = () => !!(process.env.MERCHANT_PRIVATE_KEY || '').trim() && !!conf().account;
export const GATHER_MS = 30_000;
let last = 0, chain = Promise.resolve();
const lock = (fn) => { const run = chain.then(fn, fn); chain = run.catch(() => {}); return run; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const status = () => ({ on: hasKey(), account: conf().account || null, runs_per_day: conf().runsPerDay, floor_near: (Number(conf().floor / 10n ** 18n) / 1e6).toString(), max_tgas: conf().maxTgas });

/** The calls for one story step on the demo purse. Pure, for tests. */
export function callsFor(step, { bag = 0, quote = 0n, purse = 0n, shop = 'ferry' } = {}) {
  if (step === 'cargo') return { calls: ['ferry-1', 'ferry-2', 'ferry-3'].map((node) => ({ method: 'gather', args: { node }, tgas: 15 })) };
  if (step === 'sell') { const qty = Math.min(3, Number(bag)); if (!qty) return { why: 'ERR_MERCHANT_BAG' }; return { calls: [{ method: 'sell', args: { shop: 'arena', good: 'good:salt', qty, min_total: String((BigInt(quote) * BigInt(qty) * 8n) / 10n), keep: true }, tgas: 20 }] }; }
  if (step === 'invest') { if (BigInt(purse) < MILLI) return { why: 'ERR_MERCHANT_PURSE', have: String(purse) }; return { calls: [{ method: 'purse', args: { action: 'invest', amount: String(MILLI), shop }, tgas: 20 }] }; }
  return { why: 'ERR_STEP' };
}
/** The limits, as a pure check. */
export function limits({ step, calls, gathersToday, relayerYocto }, c = conf()) {
  if (calls.some((x) => x.tgas > c.maxTgas)) return 'ERR_MERCHANT_GAS_CAP';
  if (step === 'cargo' && Number(gathersToday) + 3 > c.runsPerDay * 3) return 'ERR_MERCHANT_DAILY';
  if (BigInt(relayerYocto) < c.floor) return 'ERR_MERCHANT_FLOOR';
  return null;
}

export async function demoStep(step, ctx = {}) {
  const c = conf(); const rc = relayConf();
  if (!hasKey()) return { ok: false, why: 'ERR_MERCHANT_OFF', status: 503 };
  if (!['cargo', 'sell', 'invest'].includes(step)) return { ok: false, why: 'ERR_STEP', status: 400 };
  return lock(async () => {
    const me = c.account;
    const [cit, bag, q, sq, rel] = await Promise.all([
      fv(rc.market, 'get_citizen', { account_id: me }), fv(rc.market, 'mt_balance_of', { account_id: me, token_id: 'good:salt' }),
      fv(rc.market, 'quote', { shop: 'arena', good: 'good:salt' }), fv(rc.market, 'square', { account_id: me }), rpc('query', { request_type: 'view_account', finality: 'final', account_id: rc.account }, undefined, F)]);
    const built = callsFor(step, { bag: Number(bag), quote: BigInt(q.sell), purse: BigInt(sq.purse), shop: 'ferry' });
    if (built.why) return { ok: false, why: built.why, have: built.have, status: 409 };
    const why = limits({ step, calls: built.calls, gathersToday: cit.gathers_today, relayerYocto: rel.amount }, c);
    if (why) return { ok: false, why, status: 429 };
    if (step === 'cargo') { const wait = last + GATHER_MS + 1500 - Date.now(); if (wait > 0) await sleep(Math.min(wait, GATHER_MS + 1500)); }
    // The demo purse reuses its own market storage; when a share would not fit, the relayer tops it up once.
    if (step === 'invest') { const st = BigInt(await fv(rc.market, 'storage_balance_of', { account_id: me })); if (st < 6n * MILLI) await session(me, { sponsor: 'merchant' }); }
    const signer = KeyPairSigner.fromSecretKey(process.env.MERCHANT_PRIVATE_KEY.trim());
    const pk = await signer.getPublicKey();
    const key = await rpc('query', { request_type: 'view_access_key', finality: 'optimistic', account_id: me, public_key: pk.toString() }, undefined, F);
    const block = await rpc('block', { finality: 'final' }, undefined, F);
    const da = buildDelegateAction({ senderId: me, receiverId: rc.market, publicKey: pk, nonce: BigInt(key.nonce) + 1n, maxBlockHeight: BigInt(block.header.height) + 200n,
      actions: built.calls.map((x) => actions.functionCall(x.method, x.args, BigInt(x.tgas) * TG, 0n)) });
    const { signedDelegate } = await signer.signDelegateAction(da);
    const before = BigInt(sq.purse);
    const r = await relay(Buffer.from(encodeSignedDelegate(signedDelegate)).toString('base64'), { sponsor: 'merchant' });
    if (step === 'cargo' && r.ok) last = Date.now();
    if (r.ok && step === 'sell') { try { // read right after the move: optimistic, not final, or the sale is not in it yet
      const q2 = await rpc('query', { request_type: 'call_function', finality: 'optimistic', account_id: rc.market, method_name: 'square', args_base64: Buffer.from(JSON.stringify({ account_id: me })).toString('base64') }, undefined, F);
      r.total = (BigInt(JSON.parse(Buffer.from(q2.result).toString()).purse) - before).toString(); } catch {} }
    return { ...r, demo: true, account: me };
  });
}

export function register(app, { limiter, globalCap }) {
  app.get('/api/merchant/status', limiter(30), (c) => c.json(status()));
  app.post('/api/merchant/step', limiter(10), globalCap('merchant', 30), async (c) => {
    let b; try { b = await c.req.json(); } catch { b = null; }
    let r; try { r = await demoStep(String(b?.step || ''), { shop: b?.shop }); } catch (e) { r = { ok: false, why: 'ERR_MERCHANT: ' + String(e.message || e).slice(0, 120), status: 502 }; }
    return c.json(r, r.ok === false && r.status ? r.status : 200);
  });
}
