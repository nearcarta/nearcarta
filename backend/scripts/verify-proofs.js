// Checks every proof tx in shared/deployments/testnet.json on NEAR testnet.
// For each hash: asks FastNEAR who signed it, reads the final status from RPC, prints the
// contract's return value or error. Writes judges/proofs/proof-check.json. Read-only.
// FastNEAR's tx index sometimes misses an old tx; then each account named in that shop's
// deployment entry is tried as the signer straight against NEAR RPC (source: "rpc").
import { writeFileSync } from 'node:fs';
import { DEP } from '../src/config.js';
import { txStatus, txResult, eventsFromOutcome, explorerTx } from '../src/near.js';

async function signerOf(hash) {
  const r = await fetch('https://tx.test.fastnear.com/v0/transactions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tx_hashes: [hash] }) });
  const j = await r.json(); return j.transactions?.[0]?.transaction?.signer_id ?? null;
}
// Account ids named in a shop's deployment entry, the likely signers.
const candidates = (o) => [...new Set(JSON.stringify(o).match(/[a-z0-9][a-z0-9._-]*\.testnet/g) || [])];
async function findByRpc(hash, shop) {
  for (const acct of candidates(DEP[shop])) {
    try { const tx = await txStatus(hash, acct); if (tx?.transaction?.signer_id === acct) return tx; } catch {}
  }
  return null;
}
const out = [];
for (const shop of ['guardhouse', 'townhall', 'arena', 'toll', 'toll_arbitrum', 'mistbank', 'house']) {
  for (const [label, hash] of Object.entries(DEP[shop].proof_txs || {})) {
    const row = { shop, label, hash, url: explorerTx(hash) };
    try {
      const signer = await signerOf(hash).catch(() => null);
      const tx = signer ? await txStatus(hash, signer) : await findByRpc(hash, shop);
      if (!tx) throw new Error('not found by FastNEAR or RPC');
      row.signer = tx.transaction.signer_id; row.source = signer ? 'fastnear' : 'rpc';
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
// The USDC Toll payout on Base Sepolia: an ERC-20 transfer sent from its MPC-derived address.
if (DEP.toll_usdc?.signed?.broadcast) {
  const h = DEP.toll_usdc.signed.evm_tx_hash;
  const r = await (await fetch('https://sepolia.base.org', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getTransactionReceipt', params: [h] }) })).json();
  const ok = r.result?.status === '0x1' && r.result.from.toLowerCase() === DEP.toll_usdc.derived_address.toLowerCase() && r.result.to.toLowerCase() === DEP.toll_usdc.token.toLowerCase();
  out.push({ shop: 'toll_usdc', label: 'base_sepolia_usdc_payout', hash: h, url: 'https://sepolia.basescan.org/tx/' + h, found: ok, from: r.result?.from, to: r.result?.to });
  console.log(ok ? 'FOUND ' : 'MISSING', 'toll_usdc'.padEnd(10), 'base_sepolia_usdc_payout'.padEnd(28), 'from MPC-derived address', r.result?.from);
}
// The Mist Bank payout on Zcash testnet: mined, and the amount hidden from the street.
{
  const { fetchStreet, streetCheck } = await import('../src/mistbank.js');
  const h = DEP.mistbank.payout.txid;
  const st = await fetchStreet(h).catch(e => ({ error: e.message }));
  const c = st.error ? null : streetCheck(st);
  const ok = !!(st.blockHeight && c?.amount_hidden);
  out.push({ shop: 'mistbank', label: 'zcash_payout_amount_hidden', hash: h, url: 'https://testnet.cipherscan.app/tx/' + h, found: ok, height: st.blockHeight, hidden: c?.amount_hidden, reasons: c?.reasons });
  console.log(ok ? 'FOUND ' : 'MISSING', 'mistbank'.padEnd(10), 'zcash_payout_amount_hidden'.padEnd(28), 'height', st.blockHeight, 'hidden', c?.amount_hidden);
}
writeFileSync(new URL('../../judges/proofs/proof-check.json', import.meta.url), JSON.stringify({ at: new Date().toISOString(), rows: out }, null, 1));
const missing = out.filter(r => !r.found).length;
console.log(`${out.length - missing}/${out.length} proof txs found on testnet`);
process.exit(missing ? 1 : 0);
