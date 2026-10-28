// Over-cap action that waits for the owner (NEP-519 yield), then the owner approves it.
//   clause tip: per-action cap 0.1 NEAR, escalation_max 0.5 NEAR.
//   0.100001 NEAR to the allowlisted bakery -> escalated -> resolve_escalation(approve) -> paid
// Usage: AGENT_KEY_FILE=... OWNER_KEY_FILE=... node scripts/escalation-demo.js   (testnet only)
import { writeFileSync } from 'node:fs';
import { actions } from 'near-api-js';
import { agentFromFile, proposal, propose, explain, action, oathId } from '../src/guardhouse.js';
import { DEP, cfg } from '../src/config.js';
import { view } from '../src/near.js';

if (!/testnet|:\/\/test\./.test(String(cfg.rpc))) { console.error('testnet only'); process.exit(2); }
const agent = agentFromFile(process.env.AGENT_KEY_FILE);
const owner = agentFromFile(process.env.OWNER_KEY_FILE);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const amount = '100001000000000000000000'; // 0.100001 NEAR, just over the 0.1 NEAR cap
const id = (await view(oathId, 'get_state')).next_action;
const p = await proposal({ clause_id: 'tip', receiver: DEP.guardhouse.allowed_receiver, amount, memo: 'nearcarta escalation demo' });
const pending = propose(agent, p);
let rec = null;
for (let i = 0; i < 40 && rec?.status !== 'escalated'; i++) { await sleep(1500); rec = await action(id).catch(() => null); }
if (rec?.status !== 'escalated') { console.error('not escalated', rec?.status); process.exit(1); }
console.log('escalated action', id);
const res = await owner.signAndSendTransaction({ receiverId: oathId, waitUntil: 'FINAL',
  actions: [actions.functionCall('resolve_escalation', { action_id: id, approve: true }, 50n * 10n ** 12n, 0n)] });
const approveHash = res.transaction.hash;
console.log('owner approve', approveHash);
const prop = await pending;
for (let i = 0; i < 30 && !['confirmed', 'denied', 'failed'].includes(rec?.status); i++) { await sleep(2000); rec = await action(id); }
const settled = await explain(prop.hash);
const approve = await explain(approveHash, owner.accountId);
const out = { at: new Date().toISOString(), clause: 'tip', amount_yocto: amount, action_id: id,
  propose: { hash: prop.hash, url: prop.url, value: prop.result?.value ?? prop.result, events: settled.events.map(e => ({ event: e.event, data: e.data })) },
  approve: { hash: approveHash, url: approve.url, result: approve.result }, final_status: rec?.status };
writeFileSync(new URL('../../judges/proofs/escalation-approved.json', import.meta.url), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ final: rec?.status, events: out.propose.events.map(e => e.event + ':' + (e.data?.[0]?.decision || e.data?.[0]?.status || '')) }));
