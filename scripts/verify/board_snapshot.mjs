// Regenerate the committed board snapshot (backend/data/vault-board-snapshot.json): every factory charter's propose
// txs from the tx index, each verified on RPC, plus the propose nonces each tx consumed. The server loads it at boot,
// re-reads every hash from chain, and uses the nonces to prove which charters have no unseen propose
// (get_state.next_nonce). Hashes and verdicts only; nothing in it is trusted without that re-read.
// Usage: node scripts/verify/board_snapshot.mjs [--check]   (--check: report coverage, write nothing)
import { writeFileSync, renameSync } from 'node:fs';
process.env.NODE_ENV = 'test'; // no background boot, no /tmp board
const v = await import('../../backend/src/vault.js');
const out = new URL('../../backend/data/vault-board-snapshot.json', import.meta.url).pathname;
const check = process.argv.includes('--check');
if (check) v.loadSnapshot(out);
let r, pass = 0;
const t0 = Date.now();
do {
  r = await v.backfill({ budget: 400, conc: 4, txs: c => v.charterTxs(c) });
  pass++;
  console.error(`pass ${pass}: checked ${r.checked}, errors ${r.errors}, charters ${r.charters}, by nonce ${r.by_nonce}, by index ${r.by_index}, rows ${v._attempts.size}`);
  if (!r.complete) await new Promise(res => setTimeout(res, 5000));
} while (!r.complete && pass < 20);
if (!r.complete) { console.error('incomplete after 20 passes; not writing'); process.exit(1); }
// Independent coverage report: for every charter, does the nonce set cover next_nonce?
const data = v.boardData();
const gaps = [];
for (const fa of v.FACTORIES) for (const c of await v.allCharters(fa.factory)) {
  const n = await v.nextNonce(c.charter);
  if (n !== null && !v.covered(c.charter, n)) gaps.push([c.charter, n]);
}
console.error(`done in ${Math.round((Date.now() - t0) / 1000)} s: rows ${data.rows.length}, skip ${data.skip.length}, nonce txs ${data.nonces.length}, charters with a nonce gap ${gaps.length}`, gaps.slice(0, 10));
if (check) process.exit(0);
data.made_at = new Date().toISOString();
writeFileSync(out + '.tmp', JSON.stringify(data));
renameSync(out + '.tmp', out);
console.error('wrote', out);
