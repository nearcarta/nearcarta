// Demo charter pool for the shared arena (testnet only). The one shared charter allows 4 payments a day, so after a
// few visitors every honest payment was refused until UTC midnight. This builds N more charters with the SAME clause
// (same allowlist, caps, budget and 4-a-day count, so every attack is refused exactly as before) and the SAME
// propose-only server agent public key. The server sends each visitor to the pool charter with the most room left.
// Each charter has its own fresh owner from the testnet helper; owner keys stay in .secrets (mode 600), never printed.
// Usage: N=8 OUT=shared/deployments/arena-pool.json KEYS=.secrets/arena-pool/owners.json node backend/scripts/arena-pool.js
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { rpcClient, viewFn, keyFrom, signTx, functionCall } from '../../shared/vault/tx.js';

const E = process.env, N = Number(E.N || 8), FACTORY = E.FACTORY || 'nccharters-53836.testnet';
const KEYS = E.KEYS || '.secrets/arena-pool/owners.json', OUT = E.OUT || 'shared/deployments/arena-pool.json';
const rpc = rpcClient(['https://rpc.testnet.near.org', 'https://test.rpc.fastnear.com']);
const view = (c, m, a = {}) => viewFn(rpc, c, m, a);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const toY = n => (BigInt(Math.round(n * 1e6)) * 10n ** 18n).toString();
const K = existsSync(KEYS) ? JSON.parse(readFileSync(KEYS, 'utf8')) : {};
const saveK = () => writeFileSync(KEYS, JSON.stringify(Object.fromEntries(Object.entries(K).map(([t, v]) => [t, v.from_credentials ? { ...v, secret: undefined } : v]))), { mode: 0o600 });
const out = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : { factory: FACTORY, charters: [] };
const save = () => writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
const SHARED = 'arena.nccharters-53681.testnet';

async function send(signerId, secret, receiverId, actions) {
  const key = keyFrom(secret);
  const ak = await rpc('query', { request_type: 'view_access_key', finality: 'optimistic', account_id: signerId, public_key: key.publicKey });
  const s = signTx({ key, signerId, receiverId, nonce: BigInt(ak.nonce) + 1n, blockHash: ak.block_hash, actions });
  const r = await rpc('send_tx', { signed_tx_base64: s.base64, wait_until: 'FINAL' });
  const bad = r.status.Failure || r.receipts_outcome.find(o => o.outcome.status.Failure);
  if (bad) throw new Error('tx failed ' + s.hash + ' ' + JSON.stringify(bad).slice(0, 300));
  return s.hash;
}

const st = await view(SHARED, 'get_state'), clause = (await view(SHARED, 'get_clauses')).pay;
const agentPk = st.agent_key; // public key only
for (let i = 0; i < N; i++) {
  const tag = 'p' + i;
  if (out.charters.find(c => c.tag === tag)) continue;
  if (!K[tag] && E.OWNER) { // fallback when the helper rate-limits: an existing testnet account owns several pool charters
    const c = JSON.parse(readFileSync(`${process.env.HOME}/.near-credentials/testnet/${E.OWNER}.json`, 'utf8'));
    K[tag] = { id: E.OWNER, secret: c.private_key, from_credentials: true };
  }
  if (!K[tag]) {
    const key = keyFrom(); const id = `ncarenapool-${Math.random().toString(36).slice(2, 10)}.testnet`;
    const r = await fetch('https://helper.nearprotocol.com/account', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ newAccountId: id, newAccountPublicKey: key.publicKey }) });
    if (!r.ok) throw new Error('helper ' + r.status);
    K[tag] = { id, secret: key.secretKey }; saveK();
    for (let j = 0; j < 30; j++) { try { await rpc('query', { request_type: 'view_account', finality: 'final', account_id: id }); break; } catch { await sleep(2000); } }
  }
  const g = K[tag];
  if (!g.charter) {
    const name = 'arenapool' + i + '-' + Math.random().toString(36).slice(2, 6);
    g.create_tx = await send(g.id, g.secret, FACTORY, [functionCall('create_charter', { name }, 150n * 10n ** 12n, BigInt(toY(Number(E.DEPOSIT || 3))))]);
    g.charter = `${name}.${FACTORY}`; saveK();
    for (let j = 0; j < 20 && !(await view(FACTORY, 'is_charter', { account_id: g.charter })); j++) await sleep(1500);
  }
  const rules_tx = await send(g.id, g.secret, g.charter, [functionCall('set_clause', { clause_id: 'pay', clause }, 40n * 10n ** 12n),
    functionCall('set_agent_key', { public_key: agentPk, allowance: toY(1) }, 60n * 10n ** 12n)]);
  out.charters.push({ tag, charter: g.charter, owner: g.id, create_tx: g.create_tx, rules_tx }); save();
  console.log(tag, g.charter, 'ok');
}
console.log('pool', out.charters.length);
