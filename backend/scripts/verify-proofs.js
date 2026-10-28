// Checks every proof tx in shared/deployments/testnet.json on NEAR testnet.
// For each hash: asks FastNEAR who signed it, reads the final status from RPC, prints the
// contract's return value or error. Writes judges/proofs/proof-check.json. Read-only.
import { writeFileSync } from 'node:fs';
import { DEP } from '../src/config.js';
import { txStatus, txResult, eventsFromOutcome, explorerTx } from '../src/near.js';

async function signerOf(hash) {
  const r = await fetch('https://tx.test.fastnear.com/v0/transactions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tx_hashes: [hash] }) });
  const j = await r.json(); return j.transactions?.[0]?.transaction?.signer_id ?? null;
}
const out = [];
for (const shop of ['guardhouse', 'townhall', 'arena', 'toll']) {
  for (const [label, hash] of Object.entries(DEP[shop].proof_txs || {})) {
    const row = { shop, label, hash, url: explorerTx(hash) };
    try {
      const signer = await signerOf(hash); row.signer = signer;
      if (!signer) throw new Error('not found by FastNEAR');
      const tx = await txStatus(hash, signer);
      row.receiver = tx.transaction.receiver_id;
      row.method = tx.transaction.actions.map(a => a.FunctionCall?.method_name || Object.keys(a)[0]).join(',');
      row.result = txResult(tx);
      row.events = eventsFromOutcome(tx).events.map(e => e.event);
      row.found = true;
    } catch (e) { row.found = false; row.error = e.message; }
    out.push(row);
    console.log(row.found ? 'FOUND ' : 'MISSING', shop.padEnd(10), label.padEnd(28), row.method || '', JSON.stringify(row.result?.value ?? row.result?.error ?? row.error ?? '').slice(0, 110));
  }
}
// The Chain Signatures payout on Base Sepolia: sent from the MPC-derived address.
{
  const h = DEP.toll.foreign_txs.base_sepolia_broadcast;
  const r = await (await fetch('https://sepolia.base.org', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getTransactionReceipt', params: [h] }) })).json();
  const ok = r.result?.status === '0x1' && r.result.from.toLowerCase() === DEP.toll.foreign_address.toLowerCase();
  out.push({ shop: 'toll', label: 'base_sepolia_broadcast', hash: h, url: 'https://sepolia.basescan.org/tx/' + h, found: ok, from: r.result?.from, to: r.result?.to });
  console.log(ok ? 'FOUND ' : 'MISSING', 'toll'.padEnd(10), 'base_sepolia_broadcast'.padEnd(28), 'from MPC-derived address', r.result?.from);
}
writeFileSync(new URL('../../judges/proofs/proof-check.json', import.meta.url), JSON.stringify({ at: new Date().toISOString(), rows: out }, null, 1));
const missing = out.filter(r => !r.found).length;
console.log(`${out.length - missing}/${out.length} proof txs found on testnet`);
process.exit(missing ? 1 : 0);
