// Mist Bank send worker. Runs on the operator box, never on Render. It is the only place that holds
// the Zcash testnet spending key (inside the bank wallet) and knows the fixed amount.
//  - every 30 s: POST /api/mistbank/worker/sync (token from the box env) with what it holds, and
//    take new requests (id, address, charter, approval tx);
//  - re-checks each approval on chain with the same code the server uses (src/mistqueue.js), and
//    applies its own limits (1 per charter per 24 h, a daily cap);
//  - waits a random delay, then pays the fixed amount from the bank wallet to the visitor's
//    Orchard-only address. The encrypted memo carries the approval tx and a fresh salt;
//  - reports back only the state, the Zcash txid and the commitment sha256("mistbank:v1:<amount>:<salt>").
// The address, amount and salt stay in a mode-600 state file outside the repo. Logs carry ids and states only.
// Run: bash backend/scripts/mist-worker.sh start|stop|status (env from /workspace/near/.secrets/mist-worker.env).
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes, randomInt } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { verifyApproval, checkUa } from '../src/mistqueue.js';
import { commitment } from '../src/mistbank.js';

const ex = promisify(execFile);
const env = process.env;
const API = env.MIST_API || 'https://nearcarta-api.onrender.com';
const TOKEN = env.MIST_WORKER_TOKEN;
const MIST_DIR = env.MIST_DIR || '/workspace/near/.secrets/zcash-testnet';
const ZCASH_DEVTOOL = env.ZCASH_DEVTOOL || '/workspace/zec/zcash-devtool/target/release/zcash-devtool';
const STATE = env.MIST_STATE || '/workspace/near/.secrets/mist-queue/state.json';
const ZATS = Number(env.MIST_QUEUE_ZATS);
const DMIN = Number(env.MIST_DELAY_MIN_S || 900), DMAX = Number(env.MIST_DELAY_MAX_S || 2700);
const DAILY = Number(env.MIST_QUEUE_DAILY_MAX || 10);
const POLL = Number(env.MIST_POLL_S || 30) * 1e3;
const DAY = 24 * 3600e3, KEEP = 26 * 3600e3;
if (!TOKEN || TOKEN.length < 32) { console.error('MIST_WORKER_TOKEN missing'); process.exit(2); }
if (!Number.isInteger(ZATS) || ZATS < 1 || ZATS > 1e6) { console.error('MIST_QUEUE_ZATS must be a small integer (zatoshi)'); process.exit(2); }

const log = (...a) => console.log(new Date().toISOString(), ...a);
const load = () => existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : { records: {} };
let st = load();
const save = () => { mkdirSync(dirname(STATE), { recursive: true, mode: 0o700 }); writeFileSync(STATE + '.tmp', JSON.stringify(st), { mode: 0o600 }); renameSync(STATE + '.tmp', STATE); };
// zcash-devtool through flock, so this worker and the one-off recorder never use the bank wallet at once.
const z = (...a) => ex('flock', [join(MIST_DIR, '.bank.lock'), ZCASH_DEVTOOL, ...a], { cwd: MIST_DIR, encoding: 'utf8', timeout: 900e3, maxBuffer: 32 << 20 }).then(r => r.stdout);

// A send cut off mid-way is never retried automatically (it may have gone out): mark it for a human.
for (const r of Object.values(st.records)) if (r.state === 'sending') { r.state = 'failed'; r.error = 'interrupted'; log(r.id.slice(0, 8), 'interrupted: check the bank list-tx for', r.approval_tx); }
save();

const report = () => Object.values(st.records).filter(r => Date.now() - Date.parse(r.queued_at) < KEEP)
  .map(({ id, charter, approval_tx, queued_at, state, sent_at, txid, commitment: cm, error }) => ({ id, charter, approval_tx, queued_at, state, sent_at, txid, commitment: cm, error }));

async function sync() {
  const r = await fetch(`${API}/api/mistbank/worker/sync`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ records: report() }), signal: AbortSignal.timeout(30e3) });
  if (!r.ok) throw new Error(`sync http ${r.status}`);
  return (await r.json()).pending || [];
}

async function accept(p) {
  if (st.records[p.id]) return false;
  const now = Date.now();
  const mine = Object.values(st.records).filter(r => r.state !== 'failed' && now - Date.parse(r.queued_at) < DAY);
  const fail = error => { st.records[p.id] = { id: p.id, charter: p.charter, approval_tx: p.approval_tx, queued_at: p.queued_at, state: 'failed', error }; save(); log(p.id.slice(0, 8), 'failed', error); return true; };
  try { checkUa(p.ua); } catch { return fail('bad_address'); }
  if (Object.values(st.records).some(r => r.approval_tx === p.approval_tx)) return fail('approval_reused');
  if (mine.some(r => r.charter === p.charter)) return fail('charter_daily_limit');
  if (mine.length >= DAILY) return fail('daily_limit');
  try { await verifyApproval(p, { maxAgeMs: DAY + 3600e3 }); }
  catch (e) { if (e.status) return fail('approval_rejected'); log(p.id.slice(0, 8), 'verify retry later'); return false; } // RPC trouble: Render keeps it queued
  const delay = randomInt(DMIN, DMAX + 1) * 1e3;
  st.records[p.id] = { id: p.id, ua: p.ua, charter: p.charter, approval_tx: p.approval_tx, queued_at: p.queued_at, state: 'waiting', send_at: new Date(now + delay).toISOString() };
  save(); log(p.id.slice(0, 8), 'waiting', Math.round(delay / 60e3), 'min');
  return true;
}

async function send(r) {
  r.salt = randomBytes(16).toString('hex'); r.state = 'sending'; save();
  log(r.id.slice(0, 8), 'sending');
  try {
    await z('wallet', '-w', join(MIST_DIR, 'bank'), 'sync');
    const out = await z('wallet', '-w', join(MIST_DIR, 'bank'), 'send', '-i', join(MIST_DIR, 'age-identity.txt'), '--address', r.ua, '--value', String(ZATS), '--memo', `nearcarta mistbank v1 oath=${r.approval_tx} salt=${r.salt}`);
    const txid = (out.match(/\b[0-9a-f]{64}\b/g) || []).at(-1);
    if (!txid) throw new Error('no txid');
    Object.assign(r, { state: 'sent', txid, commitment: commitment(ZATS, r.salt), sent_at: new Date().toISOString() });
    log(r.id.slice(0, 8), 'sent', txid);
  } catch (e) {
    // The send command failed before printing a txid; nothing left the wallet that we know of.
    Object.assign(r, { state: 'failed', error: 'send_failed' });
    log(r.id.slice(0, 8), 'send_failed', String(e.message).split('\n')[0].slice(0, 120).replace(/utest1[0-9a-z]+/g, '<ua>'));
  }
  save();
}

let busy = false;
async function tick() {
  if (busy) return; busy = true;
  try {
    let fresh = false;
    for (const p of await sync()) fresh = (await accept(p)) || fresh;
    if (fresh) await sync(); // tell Render at once so it drops the address
    const due = Object.values(st.records).find(r => r.state === 'waiting' && Date.parse(r.send_at) <= Date.now());
    if (due) { await send(due); await sync(); }
    for (const [id, r] of Object.entries(st.records)) if (Date.now() - Date.parse(r.queued_at) > 7 * DAY) delete st.records[id];
    save();
  } catch (e) { log('tick error', String(e.message).slice(0, 120)); }
  finally { busy = false; }
}
log('mist worker up', API, 'delay', DMIN, '-', DMAX, 's');
await tick();
setInterval(tick, POLL);
