// C5 hidden rules on testnet: one batch from the owner creates <name>.<owner>, funds it, deploys the
// reproducible contracts/artifacts/oath.c5.wasm and calls new(..., setup_window: true). No full-access key.
// Then: a visible clause, a sealed hidden rule (only its sha256 commitment goes on chain), two proposals that
// the sealed clause holds, a wrong-salt reveal (panics, nothing changes), a reveal that refuses one action
// (hidden_rule_cap) and a reveal that lets the other one pay.
// Usage (testnet only): OWNER_KEY=owner key json  RCV=allowlisted receiver  AGENT_OUT=agent keys json (0600)
//   OUT=proof json  NAME=c5oath  node backend/scripts/oath-c5.js
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import crypto from 'node:crypto';
import { Account, JsonRpcProvider, KeyPair, KeyPairSigner, actions as A } from 'near-api-js';
import { cfg } from '../src/config.js';
import { accessKeys } from '../src/near.js';

if (!/testnet|:\/\/test\./.test(String(cfg.rpc))) { console.error('testnet only'); process.exit(2); }
const E = process.env;
const OWN = JSON.parse(readFileSync(E.OWNER_KEY, 'utf8'));
const provider = new JsonRpcProvider({ url: cfg.rpc });
const OWNER = OWN.account_id, C = `${E.NAME || 'c5oath'}.${OWNER}`, RCV = E.RCV;
const owner = new Account(OWNER, provider, KeyPairSigner.fromSecretKey(OWN.private_key));
const N = x => (BigInt(Math.round(x * 1e6)) * 10n ** 18n).toString();
const TG = t => BigInt(t) * 10n ** 12n;
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const WASM = 'contracts/artifacts/oath.c5.wasm';
const AK = existsSync(E.AGENT_OUT) ? JSON.parse(readFileSync(E.AGENT_OUT, 'utf8')) : {};
const saveKeys = () => writeFileSync(E.AGENT_OUT, JSON.stringify(AK), { mode: 0o600 });
const log = []; const save = () => writeFileSync(E.OUT, JSON.stringify({ charter: C, owner: OWNER, wasm: WASM, steps: log }, null, 1));
const errOf = o => { const s = JSON.stringify(o); const m = s.match(/(ERR_[A-Z0-9_]+|Smart contract panicked: [^"\\]+)/); return m ? m[1] : s.slice(0, 300); };
const outcome = (rec, r) => {
  rec.tx = r.transaction.hash;
  const fails = r.receipts_outcome.filter(o => o.outcome.status.Failure);
  rec.ok = !r.status.Failure && fails.length === 0;
  if (!rec.ok) rec.error = errOf(r.status.Failure || fails[0].outcome.status.Failure);
  rec.logs = r.receipts_outcome.flatMap(o => o.outcome.logs);
  const sv = r.status.SuccessValue; if (sv) rec.ret = Buffer.from(sv, 'base64').toString();
};
async function send(step, signer, method, args, expect, gas = TG(100)) {
  const rec = { step, signer: signer.accountId, method, args, expect };
  try { outcome(rec, await signer.signAndSendTransaction({ receiverId: C, actions: [A.functionCall(method, args, gas, 0n)], waitUntil: 'FINAL', throwOnFailure: false })); }
  catch (e) { rec.ok = false; rec.error = errOf(e.message || e); }
  console.log(JSON.stringify({ step, ok: rec.ok, tx: rec.tx, error: rec.error, ret: rec.ret?.slice(0, 200) }));
  log.push(rec); save(); return rec;
}
const gov = (step, method, args, expect) => send(step, owner, method, args, expect);
const view = async (m, a = {}) => { const r = await provider.query({ request_type: 'call_function', finality: 'final', account_id: C, method_name: m, args_base64: Buffer.from(JSON.stringify(a)).toString('base64') }); return JSON.parse(Buffer.from(r.result).toString()); };
const vlog = async (step, m, a) => { const v = await view(m, a); console.log(step, JSON.stringify(v).slice(0, 400)); log.push({ step, view: m, args: a, value: v }); save(); return v; };
const keysLog = async step => { const k = await accessKeys(C); const v = k.keys.map(x => ({ public_key: x.public_key, permission: x.access_key.permission === 'FullAccess' ? 'FullAccess' : { methods: x.access_key.permission.FunctionCall.method_names, receiver: x.access_key.permission.FunctionCall.receiver_id } })); log.push({ step, count: v.length, keys: v }); save(); console.log(step, JSON.stringify(v)); return v; };
const agent = () => new Account(C, provider, KeyPairSigner.fromSecretKey(AK.k1.private_key));
async function propose(step, amount, expect) {
  const st = await view('get_state');
  const p = { shop: 'c5-proof', clause_id: 'tip', receiver: RCV, amount, nonce: String(st.next_nonce), policy_version: st.policy_version, expires_at: String((BigInt(Date.now()) + 600_000n) * 1_000_000n), memo: step, receipt: null };
  return send(step, agent(), 'propose', { p }, expect, TG(60));
}
const balance = async a => (await provider.query({ request_type: 'view_account', finality: 'final', account_id: a })).amount;

// ---- deploy: one batch, no full-access key on the charter account ----
const wasm = readFileSync(new URL('../../' + WASM, import.meta.url));
if (!E.SKIP_DEPLOY) {
  const dep = { step: 'deploy_batch', signer: OWNER, wasm_sha256: sha(wasm), wasm_bytes: wasm.length, init: { owner: OWNER, dao: null, policy_delay_ns: String(90e9), storage_reserve: null, setup_window: true } };
  outcome(dep, await owner.signAndSendTransaction({ receiverId: C, waitUntil: 'FINAL', throwOnFailure: false, actions: [
    A.createAccount(), A.transfer(45n * 10n ** 23n), A.deployContract(wasm), A.functionCall('new', dep.init, TG(100), 0n)] }));
  log.push(dep); save(); console.log('deploy', dep.ok, dep.tx, dep.error || '');
  if (!dep.ok) process.exit(1);
}
await keysLog('charter_keys_after_deploy');

// ---- visible clause (cap 0.02 NEAR) and a sealed hidden rule (cap 0.01 NEAR) ----
const clause = { asset: 'Native', receivers: [RCV], per_action_cap: N(0.02), daily_budget: N(0.05), window_start_min: 0, window_end_min: 0, requires_receipt: false, escalation_max: null, min_amount: N(0.001), max_actions_per_day: 5, min_receiver_age_days: 0, code_hash_pins: {} };
await gov('rule_set_clause', 'set_clause', { clause_id: 'tip', clause }, 'applied (setup window)');
const rule = { max_amount: N(0.01), deny: [] };
const salt = AK.salt || (AK.salt = crypto.randomBytes(16).toString('hex'));
const text = `oath-hidden-v1|${C}|tip|${rule.max_amount}|${rule.deny.join(',')}|${salt}`;
const commitment = sha(Buffer.from(text));
log.push({ step: 'commitment_offchain', note: 'only the hash goes on chain until the reveal', commitment }); save();
await gov('seal_rule', 'seal_rule', { clause_id: 'tip', commitment }, 'applied (first seal)');
await vlog('get_seal', 'get_seal', { clause_id: 'tip' });
if (!AK.k1) { const kp = KeyPair.fromRandom('ed25519'); AK.k1 = { public_key: kp.getPublicKey().toString(), private_key: kp.toString() }; }
saveKeys();
await gov('agent_key_k1', 'set_agent_key', { public_key: AK.k1.public_key, allowance: N(0.25) }, 'applied; closes setup');
await keysLog('charter_keys_with_k1');
await vlog('rules_tip', 'get_rules', { clause_id: 'tip' });

// ---- both proposals pass the visible clause, so the sealed clause holds them ----
const a1 = await propose('p_held_over_hidden_cap', N(0.015), 'held hidden_rule_check');
const a2 = await propose('p_held_under_hidden_cap', N(0.005), 'held hidden_rule_check');
const id1 = JSON.parse(a1.ret).action_id, id2 = JSON.parse(a2.ret).action_id;
await vlog('hold_eta_1', 'get_hold', { action_id: id1 });
await gov('reveal_wrong_salt', 'reveal_hidden', { action_id: id2, rule, salt: 'wrong-salt-0123456789' }, 'ERR_SEAL_MISMATCH (nothing changes)');
const rcv0 = await balance(RCV);
await gov('reveal_refuses', 'reveal_hidden', { action_id: id1, rule, salt }, 'denied hidden_rule_cap; reserve released');
await gov('reveal_allows', 'reveal_hidden', { action_id: id2, rule, salt }, 'approved hidden_rule_passed; 0.005 NEAR paid');
const rcv1 = await balance(RCV);
log.push({ step: 'receiver_balance_delta', receiver: RCV, before: rcv0, after: rcv1, delta: (BigInt(rcv1) - BigInt(rcv0)).toString() }); save();
console.log('receiver delta', (BigInt(rcv1) - BigInt(rcv0)).toString());
await vlog('action_1', 'get_action', { action_id: id1 });
await vlog('action_2', 'get_action', { action_id: id2 });
await vlog('reputation_final', 'get_reputation');
await vlog('state_final', 'get_state');
await keysLog('charter_keys_end');
console.log('charter', C);
