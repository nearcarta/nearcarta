// Payouts: a real testnet USDC payroll on an R18 charter (testnet only; never prints a private key).
// The owner makes a charter through the R18 factory, writes a USDC rule (two allowlisted staff, 1 USDC per payment,
// 2 USDC per day), registers the charter and both staff on the token (storage_deposit), and moves USDC in.
// The agent key (propose only, no full access) then pays one salary inside the cap and is refused one over it.
// Usage: OWNER=guestfund.r2own.testnet STAFF=a.testnet,b.testnet AGENT_OUT=<json 0600> OUT=judges/proofs/payroll-usdc.json node backend/scripts/payroll-usdc.js
import { readFileSync, writeFileSync } from 'node:fs';
import { Account, JsonRpcProvider, KeyPair, KeyPairSigner, actions as A } from 'near-api-js';
import { cfg } from '../src/config.js';

if (!/testnet|:\/\/test\./.test(String(cfg.rpc))) { console.error('testnet only'); process.exit(2); }
const E = process.env;
const USDC = '3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af'; // Circle testnet USDC, 6 decimals
const FACTORY = E.FACTORY || 'nccharters-22195.testnet';
const OWNER = E.OWNER, STAFF = E.STAFF.split(',');
const cred = JSON.parse(readFileSync(`${process.env.HOME}/.near-credentials/testnet/${OWNER}.json`, 'utf8'));
const provider = new JsonRpcProvider({ url: cfg.rpc });
const owner = new Account(OWNER, provider, KeyPairSigner.fromSecretKey(cred.private_key));
const TG = t => BigInt(t) * 10n ** 12n, MILLI = 10n ** 21n;
const U = x => String(Math.round(x * 1e6));
const name = 'payroll-' + Math.random().toString(36).slice(2, 6), C = `${name}.${FACTORY}`;
const log = []; const save = x => writeFileSync(E.OUT, JSON.stringify({ charter: C, owner: OWNER, factory: FACTORY, token: USDC, staff: STAFF, steps: log, ...x }, null, 1));
const view = async (acc, m, a = {}) => JSON.parse(Buffer.from((await provider.query({ request_type: 'call_function', finality: 'final', account_id: acc, method_name: m, args_base64: Buffer.from(JSON.stringify(a)).toString('base64') })).result).toString());
async function send(step, signer, to, actions, want = true) {
  const r = await signer.signAndSendTransaction({ receiverId: to, actions, waitUntil: 'FINAL', throwOnFailure: false });
  const bad = r.status.Failure || r.receipts_outcome.find(o => o.outcome.status.Failure)?.outcome.status.Failure;
  const ret = r.status.SuccessValue ? Buffer.from(r.status.SuccessValue, 'base64').toString() : undefined;
  const rec = { step, signer: signer.accountId, to, tx: r.transaction.hash, ok: !bad, as_expected: !bad === want, ret, ...(bad ? { error: JSON.stringify(bad).slice(0, 240) } : {}) };
  console.log(JSON.stringify(rec)); log.push(rec); save(); return rec;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const c = await send('create_charter', owner, FACTORY, [A.functionCall('create_charter', { name }, TG(150), BigInt(E.DEPOSIT || 1) * 10n ** 24n)]);
if (!c.ok) process.exit(1);
for (let j = 0; j < 20 && !(await view(FACTORY, 'is_charter', { account_id: C })); j++) await sleep(1500);
// storage on the token for the charter (payer) and every staff member (payees); the charter refuses unregistered payees
for (const a of [C, ...STAFF]) {
  const s = await view(USDC, 'storage_balance_of', { account_id: a });
  if (!s) await send('storage_deposit ' + a, owner, USDC, [A.functionCall('storage_deposit', { account_id: a, registration_only: true }, TG(30), 1250n * MILLI)]);
}
const clause = { asset: { Ft: { token: USDC } }, receivers: STAFF, per_action_cap: U(1), daily_budget: U(2), window_start_min: 0, window_end_min: 0,
  requires_receipt: false, escalation_max: null, min_amount: U(0.01), max_actions_per_day: 4, min_receiver_age_days: 0, code_hash_pins: {} };
const kp = KeyPair.fromRandom('ed25519'); writeFileSync(E.AGENT_OUT, JSON.stringify({ account_id: C, public_key: kp.getPublicKey().toString(), private_key: kp.toString() }), { mode: 0o600 });
await send('owner_sets_usdc_rule_and_agent_key', owner, C, [A.functionCall('set_clause', { clause_id: 'payroll', clause }, TG(40), 0n),
  A.functionCall('set_agent_key', { public_key: kp.getPublicKey().toString(), allowance: null }, TG(60), 0n)]);
await send('owner_funds_charter_usdc', owner, USDC, [A.functionCall('ft_transfer', { receiver_id: C, amount: U(Number(E.FUND || 5)), memo: 'payroll float' }, TG(30), 1n)]);
const agent = new Account(C, provider, KeyPairSigner.fromSecretKey(kp.toString()));
const prop = async (step, to, amount) => { const st = await view(C, 'get_state');
  return send(step, agent, C, [A.functionCall('propose', { p: { shop: 'payouts', clause_id: 'payroll', receiver: to, amount, nonce: String(st.next_nonce), policy_version: st.policy_version, expires_at: String((BigInt(Date.now()) + 600000n) * 1_000_000n), memo: step, receipt: null } }, TG(150), 0n)]); };
const a1 = await prop('agent_pays_0.5_usdc_in_cap', STAFF[0], U(0.5));
const a2 = await prop('agent_tries_1.5_usdc_over_cap', STAFF[1], U(1.5));
await sleep(3000);
const bal = {}; for (const a of [C, ...STAFF]) bal[a] = await view(USDC, 'ft_balance_of', { account_id: a });
save({ clause, agent_public_key: kp.getPublicKey().toString(), outcomes: { paid: a1.ret, refused: a2.ret }, usdc_balances_after: bal, at: new Date().toISOString() });
console.log(JSON.stringify(bal));
