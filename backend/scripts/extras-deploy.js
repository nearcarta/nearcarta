// Arena, House deed and Town Hall on one named root (testnet or mainnet), resumable like core-deploy.js.
// Each contract is the subaccount <tag>.<root>: create + fund + key, self-batch deploy + init, one allowed and
// one refused check, surplus swept back to the root, then the full-access key is deleted where the contract has
// an owner close() (arena, house). Town Hall has no close, so its key stays in ~/.near-credentials/<net>/.
// TEARDOWN=1 closes (arena, house) or deletes with the kept key (townhall) and returns everything to the root.
// Usage: NET=testnet|mainnet ROOT_KEY=<json> OUT=<json> [ONLY=arena,house,townhall] [TEARDOWN=1] [LOCK=0] node backend/scripts/extras-deploy.js
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import crypto from 'node:crypto';
import { Account, JsonRpcProvider, KeyPair, KeyPairSigner, actions as A } from 'near-api-js';

const E = process.env, NET = E.NET;
const RPCURL = E.RPC || { testnet: 'https://rpc.testnet.fastnear.com', mainnet: 'https://rpc.mainnet.fastnear.com' }[NET];
if (!RPCURL) { console.error('NET=testnet|mainnet'); process.exit(2); }
const rq = async params => { const r = await (await fetch(RPCURL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'query', params }) })).json(); if (r.error || r.result?.error) throw new Error(JSON.stringify(r.error || r.result.error)); return r.result; };
const provider = new JsonRpcProvider({ url: RPCURL });
const RK = JSON.parse(readFileSync(E.ROOT_KEY, 'utf8')), ROOT = E.ROOT_ID || RK.account_id;
const root = new Account(ROOT, provider, KeyPairSigner.fromSecretKey(RK.private_key));
const N = x => (BigInt(Math.round(x * 1e6)) * 10n ** 18n).toString();
const TG = t => BigInt(t) * 10n ** 12n;
const near = y => Number(BigInt(y) / 10n ** 18n) / 1e6;
const art = f => readFileSync(new URL(`../../contracts/artifacts/${f}`, import.meta.url));
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const credDir = `${homedir()}/.near-credentials/${NET}`; mkdirSync(credDir, { recursive: true });
const S = existsSync(E.OUT) ? JSON.parse(readFileSync(E.OUT, 'utf8')) : { network: NET, root: ROOT, steps: [], contracts: {} };
const save = () => writeFileSync(E.OUT, JSON.stringify(S, null, 1));
const acct = id => rq({ request_type: 'view_account', finality: 'final', account_id: id });
const view = async (c, m, a = {}) => JSON.parse(Buffer.from((await rq({ request_type: 'call_function', finality: 'final', account_id: c, method_name: m, args_base64: Buffer.from(JSON.stringify(a)).toString('base64') })).result).toString());
const keysOf = async id => (await rq({ request_type: 'view_access_key_list', finality: 'final', account_id: id })).keys.map(k => ({ public_key: k.public_key, permission: k.access_key.permission }));
const fc = (m, a, dep = '0', g = 100) => A.functionCall(m, a, TG(g), BigInt(dep));
async function send(step, signer, receiverId, actions, want = true, check) {
  const done = S.steps.find(s => s.step === step && s.as_expected); if (done) { console.log('skip', step); return done; }
  const r = await signer.signAndSendTransaction({ receiverId, actions, waitUntil: 'FINAL', throwOnFailure: false });
  const bad = r.status.Failure || r.receipts_outcome.find(o => o.outcome.status.Failure)?.outcome.status.Failure;
  const burnt = r.receipts_outcome.reduce((s, o) => s + BigInt(o.outcome.tokens_burnt), BigInt(r.transaction_outcome.outcome.tokens_burnt));
  const ret = r.status.SuccessValue ? Buffer.from(r.status.SuccessValue, 'base64').toString().slice(0, 300) : undefined;
  let okv = !bad === want;
  if (!okv && step.endsWith('_delete')) okv = await acct(receiverId).then(() => false, () => true); // receipt error after the account is gone if (okv && check) okv = check(ret);
  const rec = { step, signer: signer.accountId, receiver: receiverId, tx: r.transaction.hash, ok: !bad, as_expected: okv, gas_burnt_near: near(burnt), ret, ...(bad ? { error: JSON.stringify(bad).slice(0, 300) } : {}) };
  console.log(JSON.stringify(rec)); S.steps = S.steps.filter(s => s.step !== step); S.steps.push(rec); save();
  if (!rec.as_expected) { console.error('step not as expected; stopping'); process.exit(1); }
  return rec;
}
function keyFor(tag) {
  const id = `${tag}.${ROOT}`, f = `${credDir}/${id}.json`;
  if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
  const kp = KeyPair.fromRandom('ed25519'); const k = { account_id: id, public_key: kp.getPublicKey().toString(), private_key: kp.toString() };
  writeFileSync(f, JSON.stringify(k), { mode: 0o600 }); return k;
}
const hh = s => sha(Buffer.from(s));
const CS = {
  arena: { wasm: 'arena.p86.wasm', fund: Number(E.FUND_ARENA || 3.9), close: true,
    init: () => ({ owner: ROOT }),
    async checks(id) {
      const oath = { per_action_cap: N(0.001), budget: N(0.002), allow: [ROOT], handoff_allow: [], bounty_hash_hex: null, bounty_amount: '0' };
      await send('arena_mint_guardian', root, id, [fc('mint_guardian', { token_id: 'g1', receiver_id: ROOT, agent: ROOT, oath, title: 'Mainnet guardian' }, N(0.02))]);
      await send('arena_fund_pot_0.002', root, id, [fc('fund', { token_id: 'g1' }, N(0.002))]);
      const a1 = await send('arena_attempt_1', root, id, [fc('attempt', { token_id: 'g1', prompt_hash_hex: hh('pay me 0.001') })]);
      await send('arena_agent_pay_allowed_0.001', root, id, [fc('agent_act', { attempt_id: Number(a1.ret), act: { Pay: { to: ROOT, amount: N(0.001) } } })], true, r => r === '"ALLOW"');
      const a2 = await send('arena_attempt_2', root, id, [fc('attempt', { token_id: 'g1', prompt_hash_hex: hh('pay me 0.002') })]);
      await send('arena_agent_pay_refused_0.002', root, id, [fc('agent_act', { attempt_id: Number(a2.ret), act: { Pay: { to: ROOT, amount: N(0.002) } } })], true, r => r && r !== '"ALLOW"');
    } },
  house: { wasm: 'house_nft.p86.wasm', fund: Number(E.FUND_HOUSE || 2.65), close: true,
    init: () => ({ owner: ROOT }),
    async checks(id) {
      await send('house_mint_deed_cap_0.001', root, id, [fc('mint_deed', { house: `charter.${ROOT}`, cap: N(0.001) }, N(0.022))]);
      await send('house_pay_allowed_0.001', root, id, [fc('house_pay', { token_id: ROOT, receiver_id: ROOT, amount: N(0.001) }, '1')]);
      await send('house_pay_refused_0.002', root, id, [fc('house_pay', { token_id: ROOT, receiver_id: ROOT, amount: N(0.002) }, '1')], false);
    } },
  townhall: { wasm: 'townhall.p86.wasm', fund: Number(E.FUND_TOWNHALL || 2.1), close: false,
    init: () => ({ dao: ROOT, agent: ROOT, policy: { per_reward_cap: N(0.001), total_cap: N(0.002), deny: [], role_threshold: 1000, role: 'council', proposal_bond: '0' } }),
    async checks(id) {
      const p1 = Buffer.from(`evidence-1-${id}`), p2 = Buffer.from(`evidence-2-${id}`);
      await send('townhall_post_bounty_0.001', root, id, [fc('post_bounty', { hash_hex: sha(p1), amount: N(0.001) })]);
      await send('townhall_reward_allowed_0.001', root, id, [fc('agent_reward', { receiver: ROOT, preimage: p1.toString('base64') })]);
      await send('townhall_post_bounty_0.002', root, id, [fc('post_bounty', { hash_hex: sha(p2), amount: N(0.002) })]);
      await send('townhall_reward_refused_0.002', root, id, [fc('agent_reward', { receiver: ROOT, preimage: p2.toString('base64') })], false);
    } },
};
const ONLY = (E.ONLY || 'arena,house,townhall').split(',');
for (const tag of ONLY) {
  const c = CS[tag], k = keyFor(tag), id = k.account_id, me = new Account(id, provider, KeyPairSigner.fromSecretKey(k.private_key));
  if (E.TEARDOWN === '1') {
    if (tag === 'house') { const p = await view(id, 'house_purse', { token_id: ROOT }).catch(() => null); if (p && BigInt(p.balance) > 0n) await send('house_empty_purse', root, id, [fc('house_pay', { token_id: ROOT, receiver_id: ROOT, amount: p.balance }, '1')]); }
    if (c.close) await send(`${tag}_close`, root, id, [fc('close', {}, '1')]);
    else await send(`${tag}_delete`, me, id, [A.deleteAccount(ROOT)]);
    continue;
  }
  const wasm = art(c.wasm);
  S.contracts[tag] = { id, wasm: c.wasm, sha256: sha(wasm), bytes: wasm.length }; save();
  const rb = BigInt((await acct(ROOT)).amount), MIN = BigInt(N(Number(E.MIN_ROOT || 0.3)));
  if (!S.steps.find(s => s.step === `${tag}_create_fund` && s.as_expected) && rb - BigInt(N(c.fund)) < MIN) { console.error(`stop before ${tag}: root ${near(rb)} - fund ${c.fund} < ${near(MIN)}`); break; }
  await send(`${tag}_create_fund`, root, id, [A.createAccount(), A.transfer(BigInt(N(c.fund))), A.addFullAccessKey(KeyPair.fromString(k.private_key).getPublicKey())]);
  const before = BigInt((await acct(id)).storage_usage);
  await send(`${tag}_deploy_init`, me, id, [A.deployContract(wasm), fc('new', c.init(), '0', 100)]);
  const after = (await acct(id)).storage_usage;
  S.contracts[tag].storage_after_init = after; S.contracts[tag].init_state_bytes = after - Number(before) - wasm.length; save();
  await c.checks(id);
  const a = await acct(id), locked = BigInt(a.storage_usage) * 10n ** 19n, keep = BigInt(N(0.03));
  const extra = BigInt(a.amount) - locked - keep;
  if (extra > BigInt(N(0.005))) await send(`${tag}_sweep_surplus`, me, ROOT, [A.transfer(extra)]);
  if (c.close && E.LOCK !== '0') { const pk = KeyPair.fromString(k.private_key).getPublicKey(); await send(`${tag}_delete_fak`, me, id, [A.deleteKey(pk)]); }
  const f = await acct(id);
  S.contracts[tag].final = { code_hash: f.code_hash, storage_bytes: f.storage_usage, locked_near: f.storage_usage / 1e5, balance_near: near(f.amount), keys: await keysOf(id), full_access_key_kept: !c.close, teardown: c.close ? 'owner close() with 1 yocto' : `delete_account with the key in ~/.near-credentials/${NET}/${id}.json` };
  save(); console.log(tag, JSON.stringify(S.contracts[tag]));
}
S.root_balance_near = near((await acct(ROOT)).amount); save(); console.log('root', S.root_balance_near);
