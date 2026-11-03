// Core launch (charter + toll) on testnet or mainnet, from one root account, with no subaccounts.
// A 64-hex implicit root cannot have subaccounts (an id like charter.<64 hex> is over the 64-char limit), so each
// contract gets its own implicit account: free to create (a plain transfer), keys kept in ~/.near-credentials/<net>.
// Steps (resumable; state in OUT):
//   1 fund   root -> charter id, root -> toll id
//   2 charter self-batch: deploy oath.r18 + new(owner = root, policy_delay 90 s, setup_window)
//   3 root:  set_clause "pay" (receiver = root, tiny caps) + set_agent_key(agent, allowance null)
//   4 toll self-batch: deploy toll.v6 + new(owner = root, mpc, derived address) + agent FC key (pay, settle)
//   5 tests: agent propose allowed + over-cap; agent toll pay (MPC sign) allowlisted
//   6 lock:  each contract account deletes its own full-access key (recovery stays with root, see TEARDOWN)
// Usage: NET=testnet|mainnet ROOT_KEY=<json> AGENT_OUT=<json 0600> OUT=<json> [FUND_CHARTER=4.2] [FUND_TOLL=2.4] [KEEP_CHARTER=0.1] [KEEP_TOLL=0.02] [STORAGE_RESERVE=0.02] [TOLL_PAY_BY=root|agent] node backend/scripts/core-deploy.js
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import crypto from 'node:crypto';
import { Account, JsonRpcProvider, KeyPair, KeyPairSigner, actions as A } from 'near-api-js';
import { keccak_256 } from '@noble/hashes/sha3';
import { base58 } from '@scure/base';

const E = process.env, NET = E.NET;
const N_ = { testnet: { rpc: 'https://rpc.testnet.fastnear.com', mpc: 'v1.signer-prod.testnet', chain_id: 84532 },
             mainnet: { rpc: 'https://rpc.mainnet.fastnear.com', mpc: 'v1.signer', chain_id: 8453 } }[NET];
if (!N_) { console.error('NET=testnet|mainnet'); process.exit(2); }
const RECIPIENT = (E.RECIPIENT || '0x1cdbf67e974a3b07b2a52ee7c2d3821c8ec7ea0f').toLowerCase();
const RPCURL = E.RPC || N_.rpc;
const rq = async params => { const r = await (await fetch(RPCURL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'query', params }) })).json(); if (r.error || r.result?.error) throw new Error(JSON.stringify(r.error || r.result.error)); return r.result; };
const provider = new JsonRpcProvider({ url: RPCURL });
const RK = JSON.parse(readFileSync(E.ROOT_KEY, 'utf8'));
const ROOT = E.ROOT_ID || RK.account_id;
const root = new Account(ROOT, provider, KeyPairSigner.fromSecretKey(RK.private_key));
const N = x => BigInt(Math.round(x * 1e6)) * 10n ** 18n;
const TG = t => BigInt(t) * 10n ** 12n;
const near = y => Number(BigInt(y) / 10n ** 18n) / 1e6;
const art = f => readFileSync(new URL(`../../contracts/artifacts/${f}`, import.meta.url));
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const credDir = `${homedir()}/.near-credentials/${NET}`; mkdirSync(credDir, { recursive: true });
const S = existsSync(E.OUT) ? JSON.parse(readFileSync(E.OUT, 'utf8')) : { network: NET, root: ROOT, steps: [] };
const save = () => writeFileSync(E.OUT, JSON.stringify(S, null, 1));
function implicitKey(tag) {
  if (S[tag]) return JSON.parse(readFileSync(`${credDir}/${S[tag]}.json`, 'utf8'));
  const kp = KeyPair.fromRandom('ed25519'); const pk = kp.getPublicKey();
  const id = Buffer.from(pk.data).toString('hex');
  const k = { account_id: id, public_key: pk.toString(), private_key: kp.toString() };
  writeFileSync(`${credDir}/${id}.json`, JSON.stringify(k), { mode: 0o600 });
  S[tag] = id; save(); return k;
}
const acct = id => rq({ request_type: 'view_account', finality: 'final', account_id: id });
const view = async (c, m, a = {}) => JSON.parse(Buffer.from((await rq({ request_type: 'call_function', finality: 'final', account_id: c, method_name: m, args_base64: Buffer.from(JSON.stringify(a)).toString('base64') })).result).toString());
const keysOf = async id => (await rq({ request_type: 'view_access_key_list', finality: 'final', account_id: id })).keys.map(k => ({ public_key: k.public_key, permission: k.access_key.permission }));
async function send(step, signer, receiverId, actions, want = true) {
  if (S.steps.find(s => s.step === step && s.as_expected)) { console.log('skip', step); return S.steps.find(s => s.step === step); }
  const r = await signer.signAndSendTransaction({ receiverId, actions, waitUntil: 'FINAL', throwOnFailure: false });
  const bad = r.status.Failure || r.receipts_outcome.find(o => o.outcome.status.Failure)?.outcome.status.Failure;
  const burnt = r.receipts_outcome.reduce((s, o) => s + BigInt(o.outcome.tokens_burnt), BigInt(r.transaction_outcome.outcome.tokens_burnt));
  const ret = r.status.SuccessValue ? Buffer.from(r.status.SuccessValue, 'base64').toString().slice(0, 400) : undefined;
  const rec = { step, signer: signer.accountId, receiver: receiverId, tx: r.transaction.hash, ok: !bad, as_expected: !bad === want, gas_burnt_near: near(burnt), ret, ...(bad ? { error: JSON.stringify(bad).slice(0, 300) } : {}) };
  console.log(JSON.stringify(rec)); S.steps = S.steps.filter(s => s.step !== step); S.steps.push(rec); save();
  if (!rec.as_expected) { console.error('step not as expected; stopping'); process.exit(1); }
  return rec;
}
const ck = implicitKey('charter'), tk = implicitKey('toll');
const C = ck.account_id, T = tk.account_id;
const charter = new Account(C, provider, KeyPairSigner.fromSecretKey(ck.private_key));
const toll = new Account(T, provider, KeyPairSigner.fromSecretKey(tk.private_key));
let agent;
if (existsSync(E.AGENT_OUT)) agent = JSON.parse(readFileSync(E.AGENT_OUT, 'utf8'));
else { const kp = KeyPair.fromRandom('ed25519'); agent = { public_key: kp.getPublicKey().toString(), private_key: kp.toString() }; writeFileSync(E.AGENT_OUT, JSON.stringify(agent), { mode: 0o600 }); }
const agentPk = KeyPair.fromString(agent.private_key).getPublicKey();
S.agent_public_key = agent.public_key;
if (S.root_before == null) { S.root_before = (await acct(ROOT)).amount; save(); }

// 1 fund the charter (the toll is funded after the charter returns its surplus, so the root never needs both at once).
// A deploy tx reserves its prepaid gas from the contract account up front, so the account briefly needs ~0.1 NEAR
// above its final storage; the surplus is swept back to the root before the full-access key is deleted.
const sweep = async (step, signer, id, keep) => {
  const a = await acct(id); const out = BigInt(a.amount) - BigInt(a.storage_usage) * 10n ** 19n - N(keep) - N(0.002);
  if (out > 0n) await send(step, signer, ROOT, [A.transfer(out)]); };
await send('fund_charter', root, C, [A.transfer(N(Number(E.FUND_CHARTER || 4.2)))]);
// 2 charter
const oath = art('oath.r18.wasm'); S.charter_wasm = { file: 'oath.r18.wasm', sha256: sha(oath), bytes: oath.length };
await send('charter_deploy_init', charter, C, [A.deployContract(oath),
  A.functionCall('new', { owner: ROOT, dao: null, policy_delay_ns: String(90e9), storage_reserve: N(Number(E.STORAGE_RESERVE || 0.02)).toString(), setup_window: true }, TG(100), 0n)]);
await sweep('charter_sweep_surplus', charter, C, Number(E.KEEP_CHARTER || 0.1));
// 3 clause + agent key (from root, the owner)
const clause = { asset: 'Native', receivers: [ROOT], per_action_cap: N(0.002).toString(), daily_budget: N(0.005).toString(), window_start_min: 0, window_end_min: 0, requires_receipt: false, escalation_max: null, min_amount: N(0.001).toString(), max_actions_per_day: 3, min_receiver_age_days: 0, code_hash_pins: {} };
await send('set_clause_pay', root, C, [A.functionCall('set_clause', { clause_id: 'pay', clause }, TG(100), 0n)]);
await send('set_agent_key', root, C, [A.functionCall('set_agent_key', { public_key: agent.public_key, allowance: null }, TG(100), 0n)]);
// 4 toll
await send('fund_toll', root, T, [A.transfer(N(Number(E.FUND_TOLL || 2.4)))]);
const tw = art('toll.v6.wasm'); S.toll_wasm = { file: 'toll.v6.wasm', sha256: sha(tw), bytes: tw.length };
const MPC = N_.mpc, PATH_ = 'base-1';
const derived = await view(MPC, 'derived_public_key', { path: PATH_, predecessor: T, domain_id: 0 });
const rootPk = await view(MPC, 'public_key', { domain_id: 3 });
const foreign = '0x' + Buffer.from(keccak_256(base58.decode(derived.replace('secp256k1:', '')))).subarray(12).toString('hex');
S.toll_foreign_address = foreign; save();
const init = { owner: ROOT, mpc: MPC, path: PATH_, chain_id: N_.chain_id, foreign_address: foreign,
  fx_root_key: Buffer.from(base58.decode(rootPk.replace('secp256k1:', ''))).toString('hex'),
  allow_to: [RECIPIENT], max_per_tx: '10000000000000', budget: '30000000000000', max_fee_cap: '5000000000', verify_chain: 'Base' };
await send('toll_deploy_init_agentkey', toll, T, [A.deployContract(tw), A.functionCall('new', init, TG(100), 0n),
  A.addFunctionCallAccessKey(agentPk, T, ['pay', 'settle'], null)]);
await sweep('toll_sweep_surplus', toll, T, Number(E.KEEP_TOLL || 0.02));
// 5 tests with the agent keys
const agC = new Account(C, provider, KeyPairSigner.fromSecretKey(agent.private_key));
// TOLL_PAY_BY=root (default) lets the owner pay the gas of the toll test, so the toll needs no gas float of its own.
const agT = E.TOLL_PAY_BY === 'agent' ? new Account(T, provider, KeyPairSigner.fromSecretKey(agent.private_key)) : root;
const prop = async (step, amount) => { const st = await view(C, 'get_state');
  return send(step, agC, C, [A.functionCall('propose', { p: { shop: 'mainnet-core', clause_id: 'pay', receiver: ROOT, amount: N(amount).toString(), nonce: String(st.next_nonce), policy_version: st.policy_version, expires_at: String((BigInt(Date.now()) + 600000n) * 1_000_000n), memo: step, receipt: null } }, TG(60), 0n)]); };
await prop('agent_propose_allowed_0.001', 0.001);
await prop('agent_propose_over_cap_0.003', 0.003);
await send(`${E.TOLL_PAY_BY === 'agent' ? 'agent' : 'owner'}_toll_pay_allowlisted`, agT, T, [A.functionCall('pay', { to: RECIPIENT, value: '1000000000000', max_fee_per_gas: '100000000', max_priority_fee_per_gas: '1000000', gas_limit: 21000 }, TG(120), 0n)]);
await send(`${E.TOLL_PAY_BY === 'agent' ? 'agent' : 'owner'}_toll_pay_not_allowlisted`, agT, T, [A.functionCall('pay', { to: '0x000000000000000000000000000000000000dead', value: '1', max_fee_per_gas: '100000000', max_priority_fee_per_gas: '1000000', gas_limit: 21000 }, TG(120), 0n)], false);
// 6 lock: delete each account's own full-access key
await send('charter_delete_fak', charter, C, [A.deleteKey(KeyPair.fromString(ck.private_key).getPublicKey())]);
await send('toll_delete_fak', toll, T, [A.deleteKey(KeyPair.fromString(tk.private_key).getPublicKey())]);
const [ca, ta, ra] = await Promise.all([acct(C), acct(T), acct(ROOT)]);
S.final = { charter: { id: C, code_hash: ca.code_hash, storage_bytes: ca.storage_usage, locked_near: near(BigInt(ca.storage_usage) * 10n ** 19n), balance_near: near(ca.amount), keys: await keysOf(C), state: await view(C, 'get_state') },
  toll: { id: T, code_hash: ta.code_hash, storage_bytes: ta.storage_usage, locked_near: near(BigInt(ta.storage_usage) * 10n ** 19n), balance_near: near(ta.amount), keys: await keysOf(T), policy: await view(T, 'policy'), tx0: await view(T, 'get_tx', { nonce: 0 }) },
  root_balance_near: near(ra.amount), root_spent_near: near(BigInt(S.root_before) - BigInt(ra.amount)),
  gas_burnt_total_near: S.steps.reduce((s, x) => s + x.gas_burnt_near, 0) };
save(); console.log(JSON.stringify(S.final, null, 1));
