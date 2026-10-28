// Two fresh testnet proposals through the agent's propose-only key:
//   A) tip2, 0.001 NEAR to the allowlisted bakery  -> expected: allowed, paid
//   B) tip,  0.001 NEAR to the attacker            -> expected: denied receiver_not_allowlisted
// Usage: AGENT_KEY_FILE=path/to/agent.json node scripts/guardhouse-demo.js
import { writeFileSync } from 'node:fs';
import { agentFromFile, proposal, propose, snapshot } from '../src/guardhouse.js';
import { DEP } from '../src/config.js';

const file = process.env.AGENT_KEY_FILE;
if (!file) { console.error('set AGENT_KEY_FILE'); process.exit(2); }
const agent = agentFromFile(file);
const MILLI = '1000000000000000000000';
const runs = [];
for (const [label, clause_id, receiver] of [
  ['allowed: tip2 to bakery', 'tip2', DEP.guardhouse.allowed_receiver],
  ['refused: tip to attacker', 'tip', DEP.guardhouse.attacker],
]) {
  const p = await proposal({ clause_id, receiver, amount: MILLI, memo: 'nearcarta guardhouse demo' });
  const r = await propose(agent, p);
  const ev = r.events.find(e => e.event === 'action')?.data?.[0] || {};
  runs.push({ label, hash: r.hash, url: r.url, decision: r.result.value?.decision ?? ev.decision, reason: r.result.value?.reason ?? ev.reason, gas_tgas: r.gas_tgas });
  console.log(JSON.stringify(runs.at(-1)));
}
const after = await snapshot();
writeFileSync(new URL('../../judges/proofs/guardhouse-demo.json', import.meta.url), JSON.stringify({ at: new Date().toISOString(), runs, next_nonce: after.state.next_nonce, usage: after.usage }, null, 1));
