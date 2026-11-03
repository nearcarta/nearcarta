// One demo charter on oath.r18 (agent key allowance optional) on testnet, and its true cost.
// One batch from the owner creates <name>.<owner>, funds it, deploys contracts/artifacts/oath.r18.wasm and calls
// new(..., setup_window: true); no full-access key on the charter. The owner sets a clause and an agent key with
// allowance: null (no gas cap). The agent key then proposes: one allowed payment and one over-cap refusal.
// Cost is measured from balances: owner spend, charter locked storage, and the gas each propose burned.
// Usage (testnet only): OWNER_KEY=<json> RCV=<account> AGENT_OUT=<json 0600> OUT=judges/proofs/oath-r18.json node backend/scripts/oath-r18.js
import { readFileSync, writeFileSync } from 'node:fs';
import crypto from 'node:crypto';
import { Account, JsonRpcProvider, KeyPair, KeyPairSigner, actions as A } from 'near-api-js';
import { cfg } from '../src/config.js';
import { accessKeys } from '../src/near.js';

if (!/testnet|:\/\/test\./.test(String(cfg.rpc))) { console.error('testnet only'); process.exit(2); }
const E = process.env;
const OWN = JSON.parse(readFileSync(E.OWNER_KEY, 'utf8'));
const provider = new JsonRpcProvider({ url: cfg.rpc });
const OWNER = OWN.account_id, C = `${E.NAME || 'r18demo'}.${OWNER}`, RCV = E.RCV;
const owner = new Account(OWNER, provider, KeyPairSigner.fromSecretKey(OWN.private_key));
const N = x => (BigInt(Math.round(x * 1e6)) * 10n ** 18n).toString();
const TG = t => BigInt(t) * 10n ** 12n;
const near = y => Number(BigInt(y) / 10n ** 18n) / 1e6;
const wasm = readFileSync(new URL('../../contracts/artifacts/oath.r18.wasm', import.meta.url));
const FUND = BigInt(N(Number(E.FUND || 4.3)));
const log = []; const save = x => writeFileSync(E.OUT, JSON.stringify({ charter: C, owner: OWNER, wasm: 'contracts/artifacts/oath.r18.wasm', wasm_sha256: crypto.createHash('sha256').update(wasm).digest('hex'), wasm_bytes: wasm.length, steps: log, ...x }, null, 1));
const acct = async id => (await provider.query({ request_type: 'view_account', finality: 'final', account_id: id }));
const view = async (m, a = {}) => JSON.parse(Buffer.from((await provider.query({ request_type: 'call_function', finality: 'final', account_id: C, method_name: m, args_base64: Buffer.from(JSON.stringify(a)).toString('base64') })).result).toString());
async function send(step, signer, actions, want = true) {
  const r = await signer.signAndSendTransaction({ receiverId: C, actions, waitUntil: 'FINAL', throwOnFailure: false });
  const bad = r.status.Failure || r.receipts_outcome.find(o => o.outcome.status.Failure)?.outcome.status.Failure;
  const burnt = r.receipts_outcome.reduce((s, o) => s + BigInt(o.outcome.tokens_burnt), BigInt(r.transaction_outcome.outcome.tokens_burnt));
  const ret = r.status.SuccessValue ? Buffer.from(r.status.SuccessValue, 'base64').toString() : undefined;
  const rec = { step, signer: signer.accountId, tx: r.transaction.hash, ok: !bad, as_expected: !bad === want, gas_burnt_near: near(burnt), ret, ...(bad ? { error: JSON.stringify(bad).slice(0, 240) } : {}) };
  console.log(JSON.stringify(rec)); log.push(rec); save(); return rec;
}
const ownerBefore = BigInt((await acct(OWNER)).amount);
const dep = await send('deploy_batch', owner, [A.createAccount(), A.transfer(FUND), A.deployContract(wasm),
  A.functionCall('new', { owner: OWNER, dao: null, policy_delay_ns: String(90e9), storage_reserve: null, setup_window: true }, TG(100), 0n)]);
if (!dep.ok) process.exit(1);
const clause = { asset: 'Native', receivers: [RCV], per_action_cap: N(0.02), daily_budget: N(0.05), window_start_min: 0, window_end_min: 0, requires_receipt: false, escalation_max: null, min_amount: N(0.001), max_actions_per_day: 3, min_receiver_age_days: 0, code_hash_pins: {} };
await send('set_clause', owner, [A.functionCall('set_clause', { clause_id: 'pay', clause }, TG(100), 0n)]);
const kp = KeyPair.fromRandom('ed25519'); writeFileSync(E.AGENT_OUT, JSON.stringify({ account_id: C, public_key: kp.getPublicKey().toString(), private_key: kp.toString() }), { mode: 0o600 });
await send('set_agent_key_no_allowance', owner, [A.functionCall('set_agent_key', { public_key: kp.getPublicKey().toString(), allowance: null }, TG(100), 0n)]);
const keys = (await accessKeys(C)).keys.map(k => ({ public_key: k.public_key, permission: k.access_key.permission }));
console.log('keys', JSON.stringify(keys));
const agent = new Account(C, provider, KeyPairSigner.fromSecretKey(kp.toString()));
const prop = async (step, amount, want) => { const st = await view('get_state');
  return send(step, agent, [A.functionCall('propose', { p: { shop: 'r18-demo', clause_id: 'pay', receiver: RCV, amount, nonce: String(st.next_nonce), policy_version: st.policy_version, expires_at: String((BigInt(Date.now()) + 600000n) * 1_000_000n), memo: step, receipt: null } }, TG(60), 0n)], want); };
const c0 = BigInt((await acct(C)).amount);
const a1 = await prop('agent_propose_allowed_0.01', N(0.01), true);
const a2 = await prop('agent_propose_over_cap_0.03', N(0.03), true);
const c2 = await acct(C);
const ownerAfter = BigInt((await acct(OWNER)).amount);
const cost = { owner_spent_near: near(ownerBefore - ownerAfter), funded_to_charter_near: near(FUND), charter_storage_bytes: c2.storage_usage,
  charter_locked_storage_near: near(BigInt(c2.storage_usage) * 10n ** 19n), charter_balance_after_near: near(c2.amount),
  charter_spent_on_two_proposes_near: near(c0 - BigInt(c2.amount)), of_which_payment_near: 0.01,
  gas_per_propose_near: [a1.gas_burnt_near, a2.gas_burnt_near], owner_setup_gas_near: log.slice(0, 3).reduce((s, x) => s + x.gas_burnt_near, 0) };
save({ keys, cost }); console.log(JSON.stringify(cost));
