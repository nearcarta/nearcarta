// R18: the agent key gets no gas allowance by default (a capped key locks out for good once its gas runs out).
// Needs oath.r18.wasm (or newer); older builds panic ERR_ALLOWANCE_ZERO on null, so set ALLOWANCE=<NEAR> for them.
// Town Hall on the R14 charter. The Sputnik DAO itself creates the charter through the factory
// (one voted proposal), then votes the clause, the agent key and the DAO lock (a second proposal).
// The charter account is created by the factory with the global R14 code, so it never has a
// full-access key; its only key is the agent's function-call key (method: propose).
// Usage (testnet only): COUNCIL1=... COUNCIL2=... NEWCOMER_ID=... ALICE_ID=... AGENT_OUT=... OUT=...
//   DAO=r7thmvr8maey.sputnikv2.testnet FACTORY=nccharters-17102.testnet node backend/scripts/townhall-r14.js
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { Account, JsonRpcProvider, KeyPair, KeyPairSigner, actions } from 'near-api-js';
import { cfg } from '../src/config.js';
import { view, accessKeys } from '../src/near.js';
import { proposal, propose } from '../src/guardhouse.js';

if (!/testnet|:\/\/test\./.test(String(cfg.rpc))) { console.error('testnet only'); process.exit(2); }
const E = process.env;
const provider = new JsonRpcProvider({ url: cfg.rpc });
const acct = f => { const k = JSON.parse(readFileSync(f, 'utf8')); return new Account(k.account_id, provider, KeyPairSigner.fromSecretKey(k.private_key)); };
const NEAR = n => (BigInt(Math.round(n * 1e6)) * 10n ** 18n).toString();
const TG = t => String(BigInt(t) * 10n ** 12n);
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64');
const DAO = E.DAO, FACTORY = E.FACTORY, NAME = E.NAME || 'townhall';
const CH = `${NAME}.${FACTORY}`;
const c1 = acct(E.COUNCIL1), c2 = acct(E.COUNCIL2);
const out = existsSync(E.OUT) ? JSON.parse(readFileSync(E.OUT, 'utf8')) : { charter: CH, dao: DAO, factory: FACTORY, tx: {}, refused: {} };
const save = () => writeFileSync(E.OUT, JSON.stringify(out, null, 1) + '\n');

let agentPub;
if (existsSync(E.AGENT_OUT)) agentPub = JSON.parse(readFileSync(E.AGENT_OUT, 'utf8')).public_key;
else {
  const kp = KeyPair.fromRandom('ed25519');
  agentPub = kp.getPublicKey().toString();
  writeFileSync(E.AGENT_OUT, JSON.stringify({ account_id: CH, public_key: agentPub, private_key: kp.toString() }), { mode: 0o600 });
}

async function send(step, who, receiverId, method, args, deposit = '0', gas = TG(100)) {
  if (out.tx[step] || out.refused[step]) return out.tx[step] || out.refused[step];
  const r = await who.signAndSendTransaction({ receiverId, actions: [actions.functionCall(method, args, BigInt(gas), BigInt(deposit))], waitUntil: 'FINAL', throwOnFailure: false });
  const fail = r.status?.Failure || r.receipts_outcome.find(o => o.outcome.status.Failure)?.outcome.status.Failure;
  const rec = { tx: r.transaction.hash };
  if (fail) rec.error = (JSON.stringify(fail).match(/ERR_[A-Z_]+|Smart contract panicked: [^"\\]+/) || [JSON.stringify(fail).slice(0, 200)])[0];
  const sv = r.status?.SuccessValue; if (sv) rec.ret = Buffer.from(sv, 'base64').toString();
  (fail ? out.refused : out.tx)[step] = rec; save();
  console.log(step, JSON.stringify(rec));
  return rec;
}
const fcProp = (receiver_id, acts, description) => ({ proposal: { description, kind: { FunctionCall: { receiver_id, actions: acts.map(a => ({ method_name: a[0], args: b64(a[1]), deposit: a[2] || '0', gas: a[3] || TG(40) })) } } } });
async function voted(step, acts, receiver, description) {
  if (out.tx[step + '_vote2']) return;
  const r = await send(step + '_add', c1, DAO, 'add_proposal', fcProp(receiver, acts, description), NEAR(0.1), TG(100));
  const id = Number(r.ret);
  for (const [who, w] of [['_vote1', c1], ['_vote2', c2]]) {
    const p = await view(DAO, 'get_proposal', { id });
    await send(step + who, w, DAO, 'act_proposal', { id, action: 'VoteApprove', proposal: p.kind }, '0', TG(300));
  }
  const p = await view(DAO, 'get_proposal', { id });
  out.tx[step + '_status'] = p.status; save();
  if (p.status !== 'Approved') throw new Error(`${step}: proposal ${id} is ${p.status}`);
}

// 1. The DAO creates its own charter through the factory (owner = DAO, never a full-access key).
await voted('p1_dao_creates_charter', [['create_charter', { name: NAME }, NEAR(1), TG(150)]], FACTORY,
  `Town Hall: create the ${CH} charter from the R14 global code`);
// 2. The DAO votes the rule, the agent key, the DAO lock and a 10-minute timelock in one proposal.
const clause = { asset: 'Native', receivers: [E.ALICE_ID], per_action_cap: NEAR(0.05), daily_budget: NEAR(0.2),
  window_start_min: 0, window_end_min: 0, requires_receipt: false, escalation_max: null, min_amount: NEAR(0.001),
  max_actions_per_day: 10, min_receiver_age_days: 0, code_hash_pins: {} };
await voted('p2_dao_votes_rule', [
  ['set_clause', { clause_id: 'reward', clause }],
  ['set_agent_key', { public_key: agentPub, allowance: (process.env.ALLOWANCE ? NEAR(+process.env.ALLOWANCE) : null) }, '0', TG(60)],
  ['set_dao', { dao: DAO }],
  ['set_policy_delay', { delay_ns: String(600n * 10n ** 9n) }],
], CH, 'Town Hall rule: rewards up to 0.05 NEAR to listed contributors, 0.2 NEAR a day; agent key may only propose');

// 3. Agent acts under the rule with its function-call key only.
const agent = new Account(CH, provider, KeyPairSigner.fromSecretKey(JSON.parse(readFileSync(E.AGENT_OUT, 'utf8')).private_key));
async function agentTry(step, receiver, amount) {
  if (out.tx[step] || out.refused[step]) return;
  const r = await propose(agent, await proposal({ clause_id: 'reward', receiver, amount, memo: 'town hall reward', shop: 'townhall' }, CH), { oath: CH });
  const o = r.result?.value || r.result || {};
  const rec = { tx: r.hash, decision: o.decision, status: o.status, reason: o.reason };
  (o.decision === 'allowed' ? out.tx : out.refused)[step] = rec; save();
  console.log(step, JSON.stringify(rec), JSON.stringify(r.result).slice(0, 300));
}
await agentTry('agent_reward_alice_0p02', E.ALICE_ID, NEAR(0.02));
await agentTry('agent_over_cap_0p08', E.ALICE_ID, NEAR(0.08));
await agentTry('agent_unlisted_newcomer', E.NEWCOMER_ID, NEAR(0.02));
// 4. A single council member cannot touch the rule, freeze or unfreeze alone.
await send('council1_set_clause_direct', c1, CH, 'set_clause', { clause_id: 'reward', clause: { ...clause, per_action_cap: NEAR(1) } });
await send('council1_freeze_direct', c1, CH, 'freeze', {});
// 5. Kill switch by vote, then the agent is refused, then only the DAO can unfreeze.
await voted('p3_dao_freeze', [['freeze', {}]], CH, 'Freeze the Town Hall agent');
await agentTry('agent_after_freeze', E.ALICE_ID, NEAR(0.02));
await send('council1_unfreeze_direct', c1, CH, 'unfreeze', {});
await voted('p4_dao_unfreeze', [['unfreeze', {}]], CH, 'Unfreeze the Town Hall agent');
out.final_state = await view(CH, 'get_state');
out.access_keys = (await accessKeys(CH)).keys.map(k => ({ public_key: k.public_key, permission: k.access_key.permission }));
save();
console.log(JSON.stringify(out.access_keys));
