// Guardhouse on oath R18 (testnet only). The R11 guardhouse charter cannot hold an agent key without a gas allowance,
// so its capped key was revoked; this builds the replacement from the R18 factory (global code, no full-access key):
// same three clauses as R11 (tip, tip2, vendor; bakery allowlist), the same DAO guardian, a propose-only agent key
// with allowance null, setup window closed, then one allowed tip and one over-cap tip from the agent key.
// Usage: OWNER_KEY=<json> AGENT_OUT=<json 0600> OUT=judges/proofs/guardhouse-r18.json node backend/scripts/guardhouse-r18.js
import { readFileSync, writeFileSync } from 'node:fs';
import { Account, JsonRpcProvider, KeyPair, KeyPairSigner, actions as A } from 'near-api-js';
import { cfg } from '../src/config.js';
import { accessKeys } from '../src/near.js';

if (!/testnet|:\/\/test\./.test(String(cfg.rpc))) { console.error('testnet only'); process.exit(2); }
const E = process.env, OLD = E.OLD || 'r11oath-82930.testnet', FACTORY = E.FACTORY || 'nccharters-22195.testnet';
const provider = new JsonRpcProvider({ url: cfg.rpc });
const OWN = JSON.parse(readFileSync(E.OWNER_KEY, 'utf8'));
const owner = new Account(OWN.account_id, provider, KeyPairSigner.fromSecretKey(OWN.private_key));
const TG = t => BigInt(t) * 10n ** 12n, N = x => (BigInt(Math.round(x * 1e6)) * 10n ** 18n).toString();
const near = y => Number(BigInt(y) / 10n ** 18n) / 1e6;
const vw = async (c, m, a = {}) => JSON.parse(Buffer.from((await provider.query({ request_type: 'call_function', finality: 'final', account_id: c, method_name: m, args_base64: Buffer.from(JSON.stringify(a)).toString('base64') })).result).toString());
const acct = async id => provider.query({ request_type: 'view_account', finality: 'final', account_id: id });
const log = []; let C;
const save = x => writeFileSync(E.OUT, JSON.stringify({ charter: C, owner: OWN.account_id, factory: FACTORY, replaces: OLD, steps: log, ...x }, null, 1) + '\n');
async function send(step, signer, receiverId, actions, want = true) {
  const r = await signer.signAndSendTransaction({ receiverId, actions, waitUntil: 'FINAL', throwOnFailure: false });
  const bad = r.status.Failure || r.receipts_outcome.find(o => o.outcome.status.Failure)?.outcome.status.Failure;
  const burnt = r.receipts_outcome.reduce((s, o) => s + BigInt(o.outcome.tokens_burnt), BigInt(r.transaction_outcome.outcome.tokens_burnt));
  const ret = r.status.SuccessValue ? Buffer.from(r.status.SuccessValue, 'base64').toString() : undefined;
  const rec = { step, tx: r.transaction.hash, ok: !bad, as_expected: !bad === want, gas_burnt_near: near(burnt), ret, ...(bad ? { error: JSON.stringify(bad).slice(0, 240) } : {}) };
  console.log(JSON.stringify(rec)); log.push(rec); save(); return rec;
}
const old = await vw(OLD, 'get_state'), clauses = await vw(OLD, 'get_clauses');
const ownerBefore = BigInt((await acct(OWN.account_id)).amount);
const name = 'guardhouse-' + Math.random().toString(36).slice(2, 6); C = `${name}.${FACTORY}`;
const mk = await send('create_charter', owner, FACTORY, [A.functionCall('create_charter', { name, policy_delay_ns: String(600e9), dao: old.dao }, TG(150), BigInt(N(Number(E.DEPOSIT || 1))))]);
if (!mk.ok) process.exit(1);
for (let j = 0; j < 20 && !(await vw(FACTORY, 'is_charter', { account_id: C })); j++) await new Promise(r => setTimeout(r, 1500));
const kp = KeyPair.fromRandom('ed25519');
writeFileSync(E.AGENT_OUT, JSON.stringify({ account_id: C, public_key: kp.getPublicKey().toString(), private_key: kp.toString() }), { mode: 0o600 });
await send('set_clauses_and_agent_key_no_allowance', owner, C, [
  ...Object.entries(clauses).map(([id, cl]) => A.functionCall('set_clause', { clause_id: id, clause: cl }, TG(30), 0n)),
  A.functionCall('set_agent_key', { public_key: kp.getPublicKey().toString(), allowance: null }, TG(60), 0n)]);
await send('close_setup', owner, C, [A.functionCall('close_setup', {}, TG(20), 0n)]);
const keys = (await accessKeys(C)).keys.map(k => ({ public_key: k.public_key, permission: k.access_key.permission }));
const agent = new Account(C, provider, KeyPairSigner.fromSecretKey(kp.toString()));
const RCV = clauses.tip.receivers[0];
const prop = async (step, clause_id, amount) => { const st = await vw(C, 'get_state');
  return send(step, agent, C, [A.functionCall('propose', { p: { shop: 'guardhouse', clause_id, receiver: RCV, amount, nonce: String(st.next_nonce), policy_version: st.policy_version, expires_at: String((BigInt(Date.now()) + 600000n) * 1_000_000n), memo: step, receipt: null } }, TG(150), 0n)]); };
const a1 = await prop('agent_tip_allowed_0.01', 'tip', N(0.01));
const a2 = await prop('agent_tip2_over_cap_0.02', 'tip2', N(0.02));
const c = await acct(C), ownerAfter = BigInt((await acct(OWN.account_id)).amount);
save({ keys, state: await vw(C, 'get_state'), cost: { owner_spent_near: near(ownerBefore - ownerAfter), charter_balance_after_near: near(c.amount), charter_storage_bytes: c.storage_usage, gas_per_propose_near: [a1.gas_burnt_near, a2.gas_burnt_near] } });
console.log('done', C);
