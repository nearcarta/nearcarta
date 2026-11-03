// Town Hall open vote, live on testnet: one non-member files a text motion, three non-members vote yes;
// all three votes land on chain (the motion stays InProgress: only the council passes it). A non-member's vote on a charter-changing proposal is refused.
// Usage: P=<json> V1=<json> V2=<json> V3=<json> OUT=judges/proofs/townhall-vote.json node backend/scripts/townhall-vote-proof.js
import { readFileSync, writeFileSync } from 'node:fs';
import { Account, JsonRpcProvider, KeyPairSigner, actions as A } from 'near-api-js';
import { cfg } from '../src/config.js';

if (!/testnet|:\/\/test\./.test(String(cfg.rpc))) { console.error('testnet only'); process.exit(2); }
const DAO = 'r7thmvr8maey.sputnikv2.testnet', E = process.env;
const provider = new JsonRpcProvider({ url: cfg.rpc });
const acct = f => { const j = JSON.parse(readFileSync(f, 'utf8')); return new Account(j.account_id, provider, KeyPairSigner.fromSecretKey(j.private_key)); };
const view = async (m, a = {}) => JSON.parse(Buffer.from((await provider.query({ request_type: 'call_function', finality: 'final', account_id: DAO, method_name: m, args_base64: Buffer.from(JSON.stringify(a)).toString('base64') })).result).toString());
const steps = [];
const call = async (who, step, m, a, dep = 0n, want = true) => {
  const r = await who.signAndSendTransaction({ receiverId: DAO, actions: [A.functionCall(m, a, 100n * 10n ** 12n, dep)], waitUntil: 'FINAL', throwOnFailure: false });
  const bad = r.status.Failure || r.receipts_outcome.find(o => o.outcome.status.Failure)?.outcome.status.Failure;
  const rec = { step, signer: who.accountId, tx: r.transaction.hash, ok: !bad, as_expected: !bad === want, ...(bad ? { error: JSON.stringify(bad).match(/panicked: [^"\\]+/)?.[0] } : {}) };
  console.log(JSON.stringify(rec)); steps.push(rec); return r;
};
const p = await view('get_policy');
const filer = acct(E.P), voters = [E.V1, E.V2, E.V3].map(acct);
const r = await call(filer, 'non_member_files_motion', 'add_proposal', { proposal: { description: 'Motion: keep the Town Hall reward cap at 0.05 NEAR per action this month.', kind: 'Vote' } }, BigInt(p.proposal_bond));
const id = JSON.parse(Buffer.from(r.status.SuccessValue, 'base64').toString());
for (const [i, v] of voters.entries()) await call(v, `non_member_votes_yes_${i + 1}`, 'act_proposal', { id, action: 'VoteApprove', proposal: 'Vote' });
// A charter-changing proposal stays council-only: find one and try to vote as a non-member.
const last = await view('get_last_proposal_id');
const fc = (await view('get_proposals', { from_index: 0, limit: last })).filter(x => x.kind?.FunctionCall).pop();
if (fc) await call(voters[0], 'non_member_vote_on_charter_change_refused', 'act_proposal', { id: fc.id, action: 'VoteApprove', proposal: fc.kind }, 0n, false);
const fin = await view('get_proposal', { id });
writeFileSync(E.OUT, JSON.stringify({ dao: DAO, motion_id: id, motion_status: fin.status, votes: fin.votes, vote_counts: fin.vote_counts, steps }, null, 1));
console.log(id, fin.status, JSON.stringify(fin.vote_counts));
