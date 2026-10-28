// Deploys a second charter on the same R11 wasm for Your House, so the owner's wallet can freeze
// and approve without touching the main Guardhouse charter (whose freeze only the DAO can undo).
// No DAO is set here, so the owner can also unfreeze. Ends with 0 full-access keys, like R11.
// Usage (testnet only): HOUSE_KEY_FILE=... OWNER_KEY_FILE=... AGENT_OUT=... node backend/scripts/house-deploy.js
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { Account, JsonRpcProvider, KeyPair, KeyPairSigner, actions } from 'near-api-js';
import { cfg, DEP } from '../src/config.js';

if (!/testnet|:\/\/test\./.test(String(cfg.rpc))) { console.error('testnet only'); process.exit(2); }
const provider = new JsonRpcProvider({ url: cfg.rpc });
const acct = f => { const k = JSON.parse(readFileSync(f, 'utf8')); return [new Account(k.account_id, provider, KeyPairSigner.fromSecretKey(k.private_key)), k]; };
const [house, houseKey] = acct(process.env.HOUSE_KEY_FILE);
const [owner] = acct(process.env.OWNER_KEY_FILE);
const NEAR = n => (BigInt(Math.round(n * 1e6)) * 10n ** 18n).toString();
const TGAS = t => BigInt(t) * 10n ** 12n;

let agentPub;
if (existsSync(process.env.AGENT_OUT)) agentPub = JSON.parse(readFileSync(process.env.AGENT_OUT, 'utf8')).public_key;
else {
  const kp = KeyPair.fromRandom('ed25519');
  agentPub = kp.getPublicKey().toString();
  writeFileSync(process.env.AGENT_OUT, JSON.stringify({ account_id: house.accountId, public_key: agentPub, private_key: kp.toString() }), { mode: 0o600 });
}
const send = async (who, receiverId, acts) => {
  const r = await who.signAndSendTransaction({ receiverId, actions: acts, waitUntil: 'FINAL' });
  const fail = r.status?.Failure || r.receipts_outcome.find(o => o.outcome.status.Failure)?.outcome.status.Failure;
  if (fail) throw new Error(JSON.stringify(fail));
  console.log(acts.map(a => a.functionCall?.methodName || Object.keys(a).find(k => a[k]) ).join('+'), r.transaction.hash);
  return r.transaction.hash;
};
const call = (m, args, t = 50) => actions.functionCall(m, args, TGAS(t), 0n);
const tx = {};
const wasm = readFileSync(new URL('../../contracts/artifacts/oath.wasm', import.meta.url));
tx.deploy_init = await send(house, house.accountId, [actions.deployContract(wasm),
  call('new', { owner: owner.accountId, dao: null, policy_delay_ns: '0', storage_reserve: null }, 100)]);
tx.set_clause = await send(owner, house.accountId, [call('set_clause', { clause_id: 'tip', clause: {
  asset: 'Native', receivers: [DEP.guardhouse.allowed_receiver], per_action_cap: NEAR(0.01), daily_budget: NEAR(0.2),
  window_start_min: 0, window_end_min: 0, requires_receipt: false, escalation_max: NEAR(0.05), min_amount: NEAR(0.001),
  max_actions_per_day: 20, min_receiver_age_days: 0, code_hash_pins: {} } })]);
tx.set_agent_key = await send(owner, house.accountId, [call('set_agent_key', { public_key: agentPub, allowance: NEAR(0.25) })]);
tx.policy_delay_90s = await send(owner, house.accountId, [call('set_policy_delay', { delay_ns: String(90n * 10n ** 9n) })]);
tx.full_access_key_deleted = await send(house, house.accountId, [actions.deleteKey(KeyPair.fromString(houseKey.private_key).getPublicKey())]);
const dep = JSON.parse(readFileSync(new URL('../../shared/deployments/testnet.json', import.meta.url), 'utf8'));
dep.house = { oath: house.accountId, owner: owner.accountId, dao: null, code_hash: DEP.guardhouse.code_hash,
  note: 'Second charter on the R11 wasm for Your House. No DAO, so the owner may unfreeze. Agent key: propose only.',
  proof_txs: tx };
writeFileSync(new URL('../../shared/deployments/testnet.json', import.meta.url), JSON.stringify(dep, null, 2) + '\n');
console.log(JSON.stringify(tx));
