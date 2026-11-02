#!/usr/bin/env node
// Run the fictional bakery sample offline: no wallet, no keys, no network.
//   node scripts/sample-run.mjs
import { readFileSync } from 'node:fs';
import { ATTACKS, plan } from '../shared/vault/attacks.js';
import { receipt } from '../shared/vault/receipt.js';
import { nearToYocto } from '../shared/vault/ask.js';
import { preview } from '../shared/samples/preview.js';
const here = new URL('../shared/samples/', import.meta.url);
const charter = JSON.parse(readFileSync(new URL('charter.json', here)));
const invoices = JSON.parse(readFileSync(new URL('invoices.json', here)));
const clause = charter.clauses.supplies;
export function run() {
  const out = { invoices: [], attacks: [] };
  let usage = { spent: '0', count: 0 };
  for (const inv of invoices) {
    const amount = nearToYocto(inv.near);
    const decision = preview(clause, { receiver: inv.receiver, amount }, usage);
    if (decision === 'allowed') usage = { spent: (BigInt(usage.spent) + BigInt(amount)).toString(), count: usage.count + 1 };
    out.invoices.push({ id: inv.id, decision, receipt: receipt({ note: inv.text, receiver: inv.receiver, amount, decision: decision === 'allowed' ? 'allowed' : 'refused', reason: decision === 'allowed' ? null : decision, clause_id: 'supplies' }, clause) });
  }
  for (const a of ATTACKS) {
    let u = { spent: '0', count: 0 }, last = 'allowed';
    for (const step of plan(a.id, clause, u)) {
      last = preview(clause, step, u);
      if (last !== 'allowed') break;
      u = { spent: (BigInt(u.spent) + BigInt(step.amount)).toString(), count: u.count + 1 };
    }
    out.attacks.push({ id: a.id, expects: a.expects, got: last });
  }
  return out;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const r = run();
  for (const i of r.invoices) console.log(`${i.id}  ${i.decision.padEnd(26)} ${i.receipt.counter_offer ? 'counter-offer: ' + i.receipt.counter_offer.why : ''}`);
  for (const a of r.attacks) console.log(`attack ${a.id.padEnd(20)} ${a.got === a.expects ? 'BLOCKED' : 'MISMATCH'} (${a.got})`);
}
