// Town Hall: let anyone vote on text motions (Sputnik kind "vote") while the charter stays council-only.
// The council files ONE ChangePolicyAddOrUpdateRole proposal that gives the existing Everyone role "all"
// vote:VoteApprove and vote:VoteReject (with a 3-vote policy for motions; live, Sputnik does not count the Everyone role toward passing, so the tally is a signal and the council decides).
// FunctionCall, ChangePolicy and every other kind keep the council-only default policy.
// Both council members approve it. Usage (testnet only):
// C1=<json> C2=<json> OUT=judges/proofs/townhall-open-vote.json node backend/scripts/townhall-open-vote.js
import { readFileSync, writeFileSync } from 'node:fs';
import { Account, JsonRpcProvider, KeyPairSigner, actions as A } from 'near-api-js';
import { cfg } from '../src/config.js';

if (!/testnet|:\/\/test\./.test(String(cfg.rpc))) { console.error('testnet only'); process.exit(2); }
const DAO = 'r7thmvr8maey.sputnikv2.testnet';
const provider = new JsonRpcProvider({ url: cfg.rpc });
const acct = f => { const j = JSON.parse(readFileSync(f, 'utf8')); return new Account(j.account_id, provider, KeyPairSigner.fromSecretKey(j.private_key)); };
const c1 = acct(process.env.C1), c2 = acct(process.env.C2);
const view = async (m, a = {}) => JSON.parse(Buffer.from((await provider.query({ request_type: 'call_function', finality: 'final', account_id: DAO, method_name: m, args_base64: Buffer.from(JSON.stringify(a)).toString('base64') })).result).toString());
const steps = [];
const call = async (who, step, m, a, dep = 0n) => {
  const r = await who.signAndSendTransaction({ receiverId: DAO, actions: [A.functionCall(m, a, 100n * 10n ** 12n, dep)], waitUntil: 'FINAL', throwOnFailure: false });
  const bad = r.status.Failure || r.receipts_outcome.find(o => o.outcome.status.Failure)?.outcome.status.Failure;
  const rec = { step, tx: r.transaction.hash, ok: !bad, ...(bad ? { error: JSON.stringify(bad).slice(0, 300) } : {}) };
  console.log(JSON.stringify(rec)); steps.push(rec); return r;
};
const p = await view('get_policy');
const all = p.roles.find(r => r.name === 'all');
const role = { ...all, permissions: [...new Set([...all.permissions, 'vote:VoteApprove', 'vote:VoteReject'])],
  vote_policy: { vote: { weight_kind: 'RoleWeight', quorum: '3', threshold: '3' } } };
const r = await call(c1, 'council_files_policy_change', 'add_proposal', { proposal: { description: 'Town Hall: anyone may vote on text motions (3 yes votes pass a motion). Charter changes stay council-only.', kind: { ChangePolicyAddOrUpdateRole: { role } } } }, BigInt(p.proposal_bond));
const id = JSON.parse(Buffer.from(r.status.SuccessValue, 'base64').toString());
await call(c1, 'council1_approves', 'act_proposal', { id, action: 'VoteApprove', proposal: { ChangePolicyAddOrUpdateRole: { role } } });
await call(c2, 'council2_approves', 'act_proposal', { id, action: 'VoteApprove', proposal: { ChangePolicyAddOrUpdateRole: { role } } });
const after = await view('get_policy');
writeFileSync(process.env.OUT, JSON.stringify({ dao: DAO, proposal_id: id, steps, role_after: after.roles.find(x => x.name === 'all'), status: (await view('get_proposal', { id })).status }, null, 1));
console.log(JSON.stringify(after.roles.find(x => x.name === 'all')));
