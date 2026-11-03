// R18: the agent key gets no gas allowance by default (a capped key locks out for good once its gas runs out).
// Needs oath.r18.wasm (or newer); older builds panic ERR_ALLOWANCE_ZERO on null, so set ALLOWANCE=<NEAR> for them.
// Fresh R16 oath charter on testnet: one batch from the owner creates <name>.<owner>, funds it, deploys the
// reproducible contracts/artifacts/oath.r16.wasm and calls new(..., setup_window: true). The charter account
// never gets a full-access key. Then live proofs of the R16 changes:
//   user-set rules (allowlist, per-action cap, min amount, daily count, expiry), refusals counted on chain
//   (get_reputation), atomic agent-key rotation (old key gone in the same receipt), clause expiry.
// Usage (testnet only): OWNER_KEY=owner key json  RCV=allowlisted receiver  OTHER=non-allowlisted account
//   AGENT_OUT=new agent keys json (0600)  OUT=proof json  NAME=r16oath  node backend/scripts/oath-r16.js
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import crypto from 'node:crypto';
import { Account, JsonRpcProvider, KeyPair, KeyPairSigner, actions as A } from 'near-api-js';
import { cfg } from '../src/config.js';
import { accessKeys } from '../src/near.js';

if (!/testnet|:\/\/test\./.test(String(cfg.rpc))) { console.error('testnet only'); process.exit(2); }
const E = process.env;
const OWN = JSON.parse(readFileSync(E.OWNER_KEY, 'utf8'));
const provider = new JsonRpcProvider({ url: cfg.rpc });
const OWNER = OWN.account_id, C = `${E.NAME || 'r16oath'}.${OWNER}`, RCV = E.RCV, OTHER = E.OTHER;
const owner = new Account(OWNER, provider, KeyPairSigner.fromSecretKey(OWN.private_key));
const N = x => (BigInt(Math.round(x * 1e6)) * 10n ** 18n).toString();
const TG = t => BigInt(t) * 10n ** 12n;
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const sleep = ms => new Promise(s => setTimeout(s, ms));
const DELAY_S = 90;
const AK = existsSync(E.AGENT_OUT) ? JSON.parse(readFileSync(E.AGENT_OUT, 'utf8')) : {};
const saveKeys = () => writeFileSync(E.AGENT_OUT, JSON.stringify(AK), { mode: 0o600 });
const log = []; const save = () => writeFileSync(E.OUT, JSON.stringify({ charter: C, owner: OWNER, wasm: 'contracts/artifacts/oath.r16.wasm', steps: log }, null, 1));
const errOf = o => { const s = JSON.stringify(o); const m = s.match(/(ERR_[A-Z0-9_]+|InvalidAccessKeyError|AccessKeyNotFound|Smart contract panicked: [^"\\]+)/); return m ? m[1] : s.slice(0, 300); };
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
  console.log(JSON.stringify({ step, ok: rec.ok, tx: rec.tx, error: rec.error, ret: rec.ret?.slice(0, 160) }));
  log.push(rec); save(); return rec;
}
const gov = (step, method, args, expect) => send(step, owner, method, args, expect);
const view = async (m, a = {}) => { const r = await provider.query({ request_type: 'call_function', finality: 'final', account_id: C, method_name: m, args_base64: Buffer.from(JSON.stringify(a)).toString('base64') }); return JSON.parse(Buffer.from(r.result).toString()); };
const vlog = async (step, m, a) => { const v = await view(m, a); console.log(step, JSON.stringify(v).slice(0, 400)); log.push({ step, view: m, args: a, value: v }); save(); return v; };
const keysLog = async step => { const k = await accessKeys(C); const v = k.keys.map(x => ({ public_key: x.public_key, permission: x.access_key.permission === 'FullAccess' ? 'FullAccess' : { methods: x.access_key.permission.FunctionCall.method_names, receiver: x.access_key.permission.FunctionCall.receiver_id } })); log.push({ step, count: v.length, keys: v }); save(); console.log(step, JSON.stringify(v)); return v; };
const agent = name => new Account(C, provider, KeyPairSigner.fromSecretKey(AK[name].private_key));
async function propose(step, name, receiver, amount, expect, { clause = 'pay', ttl = 600 } = {}) {
  const st = await view('get_state');
  const p = { shop: 'r16-proof', clause_id: clause, receiver, amount, nonce: String(st.next_nonce), policy_version: st.policy_version, expires_at: String((BigInt(Date.now()) + BigInt(ttl * 1000)) * 1_000_000n), memo: step, receipt: null };
  return send(step, agent(name), 'propose', { p }, expect, TG(60));
}

// ---- deploy: one batch, no full-access key on the charter account ----
const wasm = readFileSync(new URL('../../' + (process.env.WASM || 'contracts/artifacts/oath.r16.wasm'), import.meta.url));
if (!E.SKIP_DEPLOY) {
  const dep = { step: 'deploy_batch', signer: OWNER, wasm_sha256: sha(wasm), wasm_bytes: wasm.length, init: { owner: OWNER, dao: null, policy_delay_ns: String(DELAY_S * 1e9), storage_reserve: null, setup_window: true } };
  outcome(dep, await owner.signAndSendTransaction({ receiverId: C, waitUntil: 'FINAL', throwOnFailure: false, actions: [
    A.createAccount(), A.transfer(45n * 10n ** 23n), A.deployContract(wasm), A.functionCall('new', dep.init, TG(100), 0n)] }));
  log.push(dep); save(); console.log('deploy', dep.ok, dep.tx, dep.error || '');
  if (!dep.ok) process.exit(1);
}
await keysLog('charter_keys_after_deploy');
await vlog('state_after_deploy', 'get_state');

// ---- user-set rules, applied instantly while the setup window is open ----
const clause = { asset: 'Native', receivers: [RCV], per_action_cap: N(0.02), daily_budget: N(0.05), window_start_min: 0, window_end_min: 0, requires_receipt: false, escalation_max: null, min_amount: N(0.001), max_actions_per_day: 3, min_receiver_age_days: 0, code_hash_pins: {} };
await gov('rule_set_clause', 'set_clause', { clause_id: 'pay', clause }, 'applied (setup window)');
const exp1 = String((BigInt(Date.now()) + 3600n * 1000n) * 1_000_000n);
await gov('rule_set_expiry_1h', 'set_clause_expiry', { clause_id: 'pay', expires_at: exp1 }, 'applied (narrowing)');
for (const k of ['k1', 'k2']) if (!AK[k]) { const kp = KeyPair.fromRandom('ed25519'); AK[k] = { public_key: kp.getPublicKey().toString(), private_key: kp.toString() }; }
saveKeys();
await gov('agent_key_k1', 'set_agent_key', { public_key: AK.k1.public_key, allowance: (process.env.ALLOWANCE ? N(+process.env.ALLOWANCE) : null) }, 'applied; closes setup');
await keysLog('charter_keys_with_k1');
await vlog('rules_pay', 'get_rules', { clause_id: 'pay' });

// ---- proposals: 1 allowed, then refusals of each kind; all counted on chain ----
await propose('p_allowed', 'k1', RCV, N(0.01), 'allowed');
await propose('p_not_allowlisted', 'k1', OTHER, N(0.01), 'denied receiver_not_allowlisted');
await propose('p_over_cap', 'k1', RCV, N(0.03), 'denied over_per_action_cap');
await propose('p_below_min', 'k1', RCV, N(0.0005), 'denied below_min_amount');
await propose('p_unknown_clause', 'k1', RCV, N(0.01), 'denied unknown_clause', { clause: 'nope' });
await vlog('reputation_after_5', 'get_reputation');

// ---- atomic rotation: k1 -> k2 after the timelock; the old key is deleted in the AddKey batch ----
const q = await gov('rotate_queue_k2', 'set_agent_key', { public_key: AK.k2.public_key, allowance: (process.env.ALLOWANCE ? N(+process.env.ALLOWANCE) : null) }, 'queued (timelock)');
const pend = await vlog('pending_rotation', 'get_pending');
const cid = Object.keys(pend)[0];
await gov('rotate_execute_too_early', 'execute_change', { change_id: cid }, 'ERR_TIMELOCK_NOT_READY');
const eta = Number(BigInt(pend[cid].eta) / 1_000_000n);
await sleep(Math.max(0, eta - Date.now()) + 3000);
await gov('rotate_execute', 'execute_change', { change_id: cid }, 'AddKey(k2)+DeleteKey(k1) in one receipt');
await keysLog('charter_keys_after_rotation');
await propose('p_old_key_k1', 'k1', RCV, N(0.01), 'rejected by the protocol: k1 no longer exists');
await propose('p_new_key_k2', 'k2', RCV, N(0.01), 'allowed');

// ---- expiry: narrowing to a deadline seconds away applies at once; after it, the clause refuses ----
const soon = BigInt(Date.now() + 20_000) * 1_000_000n;
await gov('rule_expiry_narrow_20s', 'set_clause_expiry', { clause_id: 'pay', expires_at: String(soon) }, 'applied (narrowing)');
await sleep(Number(soon / 1_000_000n) - Date.now() + 5000);
await propose('p_after_expiry', 'k2', RCV, N(0.01), 'denied clause_expired');
await gov('rule_expiry_widen_queued', 'set_clause_expiry', { clause_id: 'pay', expires_at: null }, 'queued (widening)');
await vlog('expiry_now', 'get_clause_expiry', { clause_id: 'pay' });
await vlog('reputation_final', 'get_reputation');
await vlog('state_final', 'get_state');
await keysLog('charter_keys_end');
console.log('charter', C);
