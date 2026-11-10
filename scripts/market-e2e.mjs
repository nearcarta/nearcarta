// One real Market Day run on prod with a brand-new account, smallest amounts.
// The account is a fresh implicit key saved chmod 600 BEFORE the city funds it; every move goes as a
// signed delegate action through the prod relayer (the visitor pays no gas). Every tx is recorded.
//   node scripts/market-e2e.mjs [--base https://nearcarta.vercel.app] [--out file.json]
import { KeyPair, KeyPairSigner, JsonRpcProvider, actions, buildDelegateAction, encodeSignedDelegate } from 'near-api-js';
import { writeFileSync, readFileSync, existsSync, mkdirSync, chmodSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg('--base', 'https://nearcarta.vercel.app');
const MARKET = 'arena.nearcarta.near';
const TG = 10n ** 12n, MILLI = 10n ** 21n;
const p = new JsonRpcProvider({ url: 'https://rpc.mainnet.near.org' });
const bq = { finality: 'final' };
const near = (y) => (Number(BigInt(y) / 10n ** 18n) / 1e6).toFixed(6);
const view = (method, args = {}) => p.callFunction({ contractId: MARKET, method, args, blockQuery: bq });
const balance = async (id) => { try { return (await p.viewAccount({ accountId: id, blockQuery: bq })).amount.toString(); } catch { return '0'; } };
const post = async (path, body) => (await fetch(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --resume <key file>: carry on with the same account after an interrupted run (no second session).
const resume = arg('--resume');
let kp, file;
if (resume) {
  if ((statSync(resume).mode & 0o077) !== 0) throw new Error('key file not 600');
  kp = KeyPair.fromString(JSON.parse(readFileSync(resume, 'utf8')).private_key); file = resume;
} else {
  kp = KeyPair.fromRandom('ed25519');
  const dir = join(homedir(), '.near-credentials', 'mainnet'); mkdirSync(dir, { recursive: true });
  file = join(dir, `e2e-${Buffer.from(kp.getPublicKey().data).toString('hex').slice(0, 12)}.json`);
  writeFileSync(file, JSON.stringify({ account_id: Buffer.from(kp.getPublicKey().data).toString('hex'), public_key: kp.getPublicKey().toString(), private_key: kp.toString() }), { mode: 0o600 });
  chmodSync(file, 0o600); if ((statSync(file).mode & 0o777) !== 0o600) throw new Error('key file not 600');
}
const id = Buffer.from(kp.getPublicKey().data).toString('hex');
const signer = KeyPairSigner.fromSecretKey(kp.toString());
const out = arg('--out', `/workspace/near/e2e/market-e2e-${id.slice(0, 8)}.json`);
const log = resume && existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : { base: BASE, account: id, key_file: file, started: new Date().toISOString(), txs: [], balances: {} };
const done = (step) => log.txs.some((t) => t.ok && t.step.startsWith(step));
mkdirSync(join(out, '..'), { recursive: true });
const save = () => writeFileSync(out, JSON.stringify(log, null, 1));
log.balances.relayer_before = near(await balance('relayer.nearcarta.near'));

async function move(step, calls) {
  const key = await p.viewAccessKey({ accountId: id, publicKey: kp.getPublicKey(), blockQuery: bq });
  const block = await p.viewBlock(bq);
  const da = buildDelegateAction({ senderId: id, receiverId: MARKET, publicKey: kp.getPublicKey(), nonce: BigInt(key.nonce) + 1n,
    maxBlockHeight: BigInt(block.header.height) + 200n,
    actions: calls.map((c) => actions.functionCall(c.method, c.args || {}, BigInt(c.tgas || 30) * TG, 0n)) });
  const { signedDelegate } = await signer.signDelegateAction(da);
  const r = await post('/api/relay', { signed_delegate: Buffer.from(encodeSignedDelegate(signedDelegate)).toString('base64') });
  log.txs.push({ step, ok: r.ok, hash: r.hash || null, burnt_near: r.burnt_near, failure: r.failure || r.error || null, methods: r.methods }); save();
  console.log(step, r.ok, r.hash || '', r.failure || r.error || '');
  if (!r.ok) throw new Error(`${step}: ${JSON.stringify(r).slice(0, 300)}`);
  await sleep(2500); return r;
}

if (!resume) {
  const s = await post('/api/relay/session', { account_id: id });
  log.session = s; save(); console.log('session', JSON.stringify(s));
  if (!s.ok) throw new Error('session refused');
  for (let i = 0; i < 20 && BigInt(await balance(id)) === 0n; i++) await sleep(1500);
  await sleep(2500);
  log.balances.player_after_session = near(await balance(id));
}

if (!done('cargo')) await move('cargo: gather 3 salt at the Ferry', ['ferry-1', 'ferry-2', 'ferry-3'].map((node) => ({ method: 'gather', args: { node }, tgas: 15 })));
const salt = Number(await view('mt_balance_of', { account_id: id, token_id: 'good:salt' }));
const q = await view('quote', { shop: 'arena', good: 'good:salt' });
const qty = Math.min(3, salt); const min = (BigInt(q.sell) * BigInt(qty) * 8n) / 10n;
if (!done('sell')) await move(`sell: ${qty} salt at the Arena into the purse`, [{ method: 'sell', args: { shop: 'arena', good: 'good:salt', qty, min_total: String(min), keep: true }, tgas: 20 }]);
log.purse_after_sell = near((await view('square', { account_id: id })).purse);
const sq = await view('square', { account_id: id });
const free = [1, 2, 3, 4].find((n) => !sq.stalls.some((x) => x.id === n && x.holder && Number(x.until) > Date.now() * 1e6)) || 1;
{ const t = await post('/api/relay/session', { account_id: id }); log.topups = [...(log.topups || []), t]; save(); console.log('session top-up', JSON.stringify(t)); await sleep(3000); }
if (!done('stall')) await move(`stall: rent stall ${free} for ${near(sq.rules.stall_rent)} NEAR`, [{ method: 'stall', args: { stall: free, action: 'rent' }, tgas: 20 }]);
// One share costs 0.001 from the purse. If the day's sales have not covered it yet, work one more round.
if (!done('invest') && BigInt((await view('square', { account_id: id })).purse) < MILLI) {
  await sleep(31000); // a node can be gathered again after 30 s
  if (!done('cargo 2')) await move('cargo 2: gather 3 more salt', ['ferry-1', 'ferry-2', 'ferry-3'].map((node) => ({ method: 'gather', args: { node }, tgas: 15 })));
  const n = Number(await view('mt_balance_of', { account_id: id, token_id: 'good:salt' }));
  const q2 = await view('quote', { shop: 'arena', good: 'good:salt' });
  if (!done('sell 2') && n) await move(`sell 2: ${Math.min(3, n)} salt into the purse`, [{ method: 'sell', args: { shop: 'arena', good: 'good:salt', qty: Math.min(3, n), min_total: String((BigInt(q2.sell) * BigInt(Math.min(3, n)) * 8n) / 10n), keep: true }, tgas: 20 }]);
  { const t = await post('/api/relay/session', { account_id: id }); log.topups = [...(log.topups || []), t]; save(); }
}
if (!done('invest')) await move('invest: 0.001 NEAR from the purse into the ferry', [{ method: 'purse', args: { action: 'invest', amount: String(MILLI), shop: 'ferry' }, tgas: 20 }]);

await sleep(3000);
const end = await view('square', { account_id: id });
log.square = end;
log.shares_ferry = (await view('market_board')).find((x) => x.id === 'ferry')?.shares;
log.dividends_ferry = await view('dividends_of', { account_id: id, shop: 'ferry' });
log.balances.player_end = near(await balance(id));
log.balances.relayer_after = near(await balance('relayer.nearcarta.near'));
log.player_paid_gas = log.balances.player_end !== log.balances.player_after_session;
log.finished = new Date().toISOString(); save();
console.log(JSON.stringify({ out, account: id, balances: log.balances, purse: near(end.purse), stalls: end.stalls.filter((x) => x.holder === id).map((x) => x.id), txs: log.txs.map((t) => t.hash) }, null, 1));
