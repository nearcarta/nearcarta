// One visitor seal on prod: digest = sha256("<account>:<purse>:<salt>"), posted to /api/bank/seal, then the
// board's anchor log is read back and checked against sha256(board_salt || digest). The salt is kept chmod 600.
//   node e2e/bank-seal-e2e.mjs <implicit account> [--base https://nearcarta.vercel.app]
import { createHash, randomBytes } from 'node:crypto';
import { writeFileSync, existsSync } from 'node:fs';
const id = process.argv[2]; const i = process.argv.indexOf('--base'); const BASE = i > 0 ? process.argv[i + 1] : 'https://nearcarta.vercel.app';
const RPC = 'https://rpc.mainnet.fastnear.com';
const rpc = async (method, params) => (await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json()).result;
const OUT = `/workspace/near/bank/visitor-seal-${id.slice(0, 8)}.json`;
if (existsSync(OUT)) throw new Error(`${OUT} exists: this visitor was already sealed; check it on chain first`);
const sq = await rpc('query', { request_type: 'call_function', finality: 'final', account_id: 'arena.nearcarta.near', method_name: 'square', args_base64: Buffer.from(JSON.stringify({ account_id: id })).toString('base64') });
const amount = JSON.parse(Buffer.from(sq.result).toString()).purse;
const salt = randomBytes(16).toString('hex');
const digest = createHash('sha256').update(`${id}:${amount}:${salt}`).digest('hex');
writeFileSync(OUT, JSON.stringify({ account: id, amount, salt, digest }), { mode: 0o600 });
const r = await (await fetch(`${BASE}/api/bank/seal`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account_id: id, digest }) })).json();
console.log('seal', JSON.stringify(r));
if (!r.ok) process.exit(1);
const tx = await rpc('tx', { tx_hash: r.hash, sender_account_id: r.by, wait_until: 'FINAL' });
const log = tx.receipts_outcome.flatMap((o) => o.outcome.logs).find((l) => l.includes('"anchor"'));
const ev = JSON.parse(log.replace(/^EVENT_JSON:/, ''));
const expect = createHash('sha256').update(Buffer.concat([Buffer.from(r.board_salt), Buffer.from(digest, 'hex')])).digest('hex');
const rec = { account: id, amount, salt, digest, ...r, chain_commitment: ev.commitment, matches: ev.commitment === expect, amount_on_chain: log.includes(amount) };
writeFileSync(OUT, JSON.stringify(rec, null, 1), { mode: 0o600 });
console.log(JSON.stringify({ hash: r.hash, burnt_near: r.burnt_near, commitment_matches: rec.matches, amount_visible_on_chain: rec.amount_on_chain }));
