// Time one guest's Toll from the NEAR pay click to its Base Sepolia receipt.
// Usage: node e2e/toll-timing.mjs <tour-output.json>   (written by e2e/tour-live.mjs). Pass = under 120 s.
import { readFileSync } from 'node:fs';
const j = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const rpc = async (method, params) => (await (await fetch('https://sepolia.base.org', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json()).result;
for (const [w, p] of Object.entries(j.passes)) {
  const v = p.pay?.visit; if (!v?.base_tx) { console.log(w, 'no toll visit'); continue; }
  const rc = await rpc('eth_getTransactionReceipt', [v.base_tx]);
  if (!rc) { console.log(w, 'nonce', v.nonce, 'NO RECEIPT yet', v.base_tx); continue; }
  const b = await rpc('eth_getBlockByNumber', [rc.blockNumber, false]);
  const s = parseInt(b.timestamp, 16) - Math.floor(v.at / 1000);
  console.log(s < 120 ? 'PASS' : 'SLOW', w, 'nonce', v.nonce, 'base', v.base_tx, 'block', parseInt(rc.blockNumber, 16), rc.status === '0x1' ? 'success' : 'reverted', 'pay->receipt', s + 's');
}
