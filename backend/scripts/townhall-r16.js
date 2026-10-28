// Town Hall on the R16.1 charter (R16 oath + propose_batch). One batch from a council member
// creates the account, funds it, deploys contracts/artifacts/oath.r16_1.wasm and calls
// new{owner: DAO, dao: DAO}: the account never has a full-access key. The DAO then votes the
// reward clause and the agent key (2-of-2 council), and the agent pays a reward round:
// one batch to 3 receivers (allowed) and one batch over the DAO's daily total (refused whole).
// Usage (testnet only): DEPLOYER=<council key file> COUNCIL1=... COUNCIL2=... RECEIVERS=a,b,c AGENT_OUT=... OUT=...
//   DAO=r7thmvr8maey.sputnikv2.testnet NAME=townhall node backend/scripts/townhall-r16.js
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Account, JsonRpcProvider, KeyPair, KeyPairSigner, actions } from 'near-api-js';
import { cfg } from '../src/config.js';
import { view, accessKeys } from '../src/near.js';

if (!/testnet|:\/\/test\./.test(String(cfg.rpc))) { console.error('testnet only'); process.exit(2); }
const E = process.env;
const provider = new JsonRpcProvider({ url: cfg.rpc });
const acct = f => { const k = JSON.parse(readFileSync(f, 'utf8')); return new Account(k.account_id, provider, KeyPairSigner.fromSecretKey(k.private_key)); };
const NEAR = n => (BigInt(Math.round(n * 1e6)) * 10n ** 18n).toString();
const TG = t => String(BigInt(t) * 10n ** 12n);
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64');
const DAO = E.DAO, deployer = acct(E.DEPLOYER), c1 = acct(E.COUNCIL1), c2 = acct(E.COUNCIL2);
const CH = `${E.NAME || 'townhall'}.${deployer.accountId}`;
const RECV = E.RECEIVERS.split(',');
const WASM = new URL('../../contracts/artifacts/oath.r16_1.wasm', import.meta.url);
const out = existsSync(E.OUT) ? JSON.parse(readFileSync(E.OUT, 'utf8')) : { charter: CH, dao: DAO, release: 'R16.1', tx: {}, refused: {} };
const save = () => writeFileSync(E.OUT, JSON.stringify(out, null, 1) + '\n');

let agentPub;
if (existsSync(E.AGENT_OUT)) agentPub = JSON.parse(readFileSync(E.AGENT_OUT, 'utf8')).public_key;
else {
  const kp = KeyPair.fromRandom('ed25519');
  agentPub = kp.getPublicKey().toString();
  writeFileSync(E.AGENT_OUT, JSON.stringify({ account_id: CH, public_key: agentPub, private_key: kp.toString() }), { mode: 0o600 });
}

function record(step, r) {
  const fail = r.status?.Failure || r.receipts_outcome.find(o => o.outcome.status.Failure)?.outcome.status.Failure;
  const rec = { tx: r.transaction.hash };
  if (fail) rec.error = (JSON.stringify(fail).match(/ERR_[A-Z_]+|Smart contract panicked: [^"\\]+/) || [JSON.stringify(fail).slice(0, 200)])[0];
  const sv = r.status?.SuccessValue; if (sv) rec.ret = Buffer.from(sv, 'base64').toString();
  (fail ? out.refused : out.tx)[step] = rec; save();
  console.log(step, JSON.stringify(rec).slice(0, 600));
  return rec;
}
async function send(step, who, receiverId, acts) {
  if (out.tx[step] || out.refused[step]) return out.tx[step] || out.refused[step];
  return record(step, await who.signAndSendTransaction({ receiverId, actions: acts, waitUntil: 'FINAL', throwOnFailure: false }));
}
const call = (m, a, dep = '0', gas = TG(100)) => actions.functionCall(m, a, BigInt(gas), BigInt(dep));
const fcProp = (receiver_id, acts, description) => ({ proposal: { description, kind: { FunctionCall: { receiver_id, actions: acts.map(a => ({ method_name: a[0], args: b64(a[1]), deposit: a[2] || '0', gas: a[3] || TG(40) })) } } } });
async function voted(step, acts, receiver, description) {
  if (out.tx[step + '_vote2']) return;
  const r = await send(step + '_add', c1, DAO, [call('add_proposal', fcProp(receiver, acts, description), NEAR(0.1))]);
  const id = Number(r.ret);
  for (const [who, w] of [['_vote1', c1], ['_vote2', c2]]) {
    const p = await view(DAO, 'get_proposal', { id });
    await send(step + who, w, DAO, [call('act_proposal', { id, action: 'VoteApprove', proposal: p.kind }, '0', TG(300))]);
  }
  const p = await view(DAO, 'get_proposal', { id });
  out.tx[step + '_status'] = p.status; save();
  if (p.status !== 'Approved') throw new Error(`${step}: proposal ${id} is ${p.status}`);
}

// 1. One batch, no key: create, fund, deploy R16.1, init with the DAO as owner and governor.
const wasm = readFileSync(WASM);
out.wasm_sha256 = createHash('sha256').update(wasm).digest('hex');
await send('deploy_batch_no_key', deployer, CH, [
  actions.createAccount(), actions.transfer(BigInt(NEAR(Number(E.FUND || 4.4)))), actions.deployContract(wasm),
  call('new', { owner: DAO, dao: DAO, policy_delay_ns: null, storage_reserve: null, setup_window: true }, '0', TG(30)),
]);
// 2. The DAO votes the reward clause (3 receivers, 0.05 NEAR each, 0.1 NEAR a day) and the agent key.
//    The setup window lets these apply at once; setting the agent key closes it. Then a 10-minute delay.
const clause = { asset: 'Native', receivers: RECV, per_action_cap: NEAR(0.05), daily_budget: NEAR(0.1),
  window_start_min: 0, window_end_min: 0, requires_receipt: false, escalation_max: null, min_amount: NEAR(0.001),
  max_actions_per_day: 10, min_receiver_age_days: 0, code_hash_pins: {} };
await voted('p1_dao_votes_round', [
  ['set_clause', { clause_id: 'reward', clause }],
  ['set_agent_key', { public_key: agentPub, allowance: NEAR(0.25) }, '0', TG(60)],
  ['set_policy_delay', { delay_ns: String(600n * 10n ** 9n) }],
], CH, 'Town Hall R16.1: reward round up to 0.05 NEAR each to 3 listed contributors, 0.1 NEAR a day in total; agent key may only propose or propose_batch');

// 3. The agent pays rounds with its function-call key only.
const agent = new Account(CH, provider, KeyPairSigner.fromSecretKey(JSON.parse(readFileSync(E.AGENT_OUT, 'utf8')).private_key));
async function round(step, items, memo) {
  if (out.tx[step] || out.refused[step]) return;
  const st = await view(CH, 'get_state');
  const ps = items.map(([receiver, amt], i) => ({ shop: 'townhall', clause_id: 'reward', receiver, amount: NEAR(amt),
    nonce: String(BigInt(st.next_nonce) + BigInt(i)), policy_version: st.policy_version,
    expires_at: String(BigInt(Date.now() + 600_000) * 1_000_000n), memo, receipt: null }));
  const r = await agent.signAndSendTransaction({ receiverId: CH, actions: [call('propose_batch', { ps }, '0', TG(150))], waitUntil: 'FINAL', throwOnFailure: false });
  const sv = r.status?.SuccessValue; const outc = sv ? JSON.parse(Buffer.from(sv, 'base64').toString()) : null;
  const allowed = outc && outc.every(o => o.decision === 'allowed');
  const rec = { tx: r.transaction.hash, items: items.map(([a, n]) => `${a}:${n}`), outcomes: outc,
    receipts_failed: r.receipts_outcome.filter(o => o.outcome.status.Failure).length };
  (allowed ? out.tx : out.refused)[step] = rec; save();
  console.log(step, JSON.stringify(rec).slice(0, 700));
}
await round('batch_3_receivers', RECV.map(a => [a, 0.02]), 'town hall reward round 1');
await round('batch_over_total', RECV.map(a => [a, 0.03]), 'town hall reward round 2 (0.09 more would pass 0.1 a day)');
out.final_state = await view(CH, 'get_state');
out.reputation = await view(CH, 'get_reputation');
out.access_keys = (await accessKeys(CH)).keys.map(k => ({ public_key: k.public_key, permission: k.access_key.permission }));
out.code_hash = (await provider.query({ request_type: 'view_account', finality: 'final', account_id: CH })).code_hash;
save();
console.log(JSON.stringify(out.access_keys), out.code_hash);
