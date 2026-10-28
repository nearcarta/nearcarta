// Your House: the agent asks for a spend over its cap, so the House holds it for the owner (NEP-519 yield).
//   clause tip: cap 0.01 NEAR, escalation_max 0.05 NEAR. 0.02 NEAR -> escalated, waits ~200 blocks for the owner's wallet.
// Prints "ESCALATED <id>" as soon as the action waits, then exits with the propose result as JSON once the owner answers.
// Usage: HOUSE_AGENT_KEY_FILE=... node backend/scripts/house-escalate.js   (testnet only; the agent key can only call propose)
import { agentFromFile, proposal, propose, action } from '../src/guardhouse.js';
import { DEP, cfg } from '../src/config.js';
import { view } from '../src/near.js';

if (!/testnet|:\/\/test\./.test(String(cfg.rpc))) { console.error('testnet only'); process.exit(2); }
const H = DEP.house.oath;
const agent = agentFromFile(process.env.HOUSE_AGENT_KEY_FILE);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const amount = process.env.AMOUNT_YOCTO || '20000000000000000000000'; // 0.02 NEAR
const id = (await view(H, 'get_state')).next_action;
const p = await proposal({ clause_id: 'tip', receiver: 'bakery.r10own-19371.testnet', amount, memo: 'house: over the cap, owner decides', shop: 'house' }, H);
const pending = propose(agent, p, { oath: H });
let rec = null;
for (let i = 0; i < 40 && rec?.status !== 'escalated'; i++) { await sleep(1500); rec = await action(id, H).catch(() => null); }
if (rec?.status !== 'escalated') { console.error('not escalated', rec?.status); process.exit(1); }
console.log('ESCALATED', id);
const res = await pending;
for (let i = 0; i < 20 && !['confirmed', 'denied', 'failed', 'expired'].includes(rec?.status); i++) { await sleep(2000); rec = await action(id, H); }
console.log('RESULT ' + JSON.stringify({ action_id: id, amount_yocto: amount, propose: { hash: res.hash, url: res.url, value: res.result }, final_status: rec?.status,
  events: res.events.map(e => ({ event: e.event, data: e.data })) }));
