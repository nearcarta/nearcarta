// Toll gate (v5, any listed charter factory): a visitor's own charter pays the toll, the visitor's wallet calls gate.pay_for, and the gate
// MPC-signs a fixed Base Sepolia payout. This module only reads: the gate record from NEAR, the tx from Base Sepolia.
// broadcast() relays the raw tx the gate already signed (read from chain, never from the caller), so it cannot
// sign, change or spend anything. settle is permissionless (the MPC foreign-tx proof, not the caller, confirms a record):
// the visitor's wallet may sign it, or the background settler below, whose key may only call gate.settle.
import { DEP } from './config.js';
import { view, rpc as nearRpc, explorerTx } from './near.js';
import { keyFrom, signTx, functionCall } from '../../shared/vault/tx.js';

const G = () => DEP.toll_gate;
const BASE = process.env.BASE_SEPOLIA_RPC || 'https://sepolia.base.org';
const SCAN = 'https://sepolia.basescan.org';
async function evm(method, params) {
  const r = await fetch(BASE, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(8000) });
  const j = await r.json(); if (j.error) throw Object.assign(new Error(j.error.message), { evm: true }); return j.result;
}
export const BROADCAST_WAIT_MS = Number(process.env.TOLL_BROADCAST_WAIT_MS || 45000);
const err = (status, m) => Object.assign(new Error(m), { status });
// one retry after a short pause: a single slow or dropped RPC read should not fail the whole gate page
const again = async f => { try { return await f(); } catch { await new Promise(r => setTimeout(r, 700)); return f(); } };

// Gas left on the gate's derived Base Sepolia address. Each visit is a plain transfer: 21000 gas plus the fixed payout.
export const LOW_VISITS = 25;
export function gasInfo(policy, balanceWei, gasPriceWei) {
  const g = policy?.gate || {}, value = BigInt(g.evm_value || 0), cap = BigInt(g.max_fee_per_gas || 0);
  const perCap = 21000n * cap + value;
  if (balanceWei == null) return { balance_wei: null, per_visit_at_cap_wei: perCap.toString(), visits_left_at_cap: null, visits_left_now: null, low: null, warning: null };
  const bal = BigInt(balanceWei);
  let price = gasPriceWei == null ? cap : BigInt(gasPriceWei) + BigInt(g.max_priority_fee_per_gas || 0); if (price > cap) price = cap;
  const perNow = 21000n * price + value;
  const atCap = perCap > 0n ? Number(bal / perCap) : null, now = perNow > 0n ? Number(bal / perNow) : null;
  const budgetLeft = value > 0n && policy?.budget ? Number((BigInt(policy.budget) - BigInt(policy.spent || 0)) / value) : null;
  const low = atCap != null && atCap < LOW_VISITS;
  return { balance_wei: bal.toString(), per_visit_at_cap_wei: perCap.toString(), per_visit_now_wei: perNow.toString(), visits_left_at_cap: atCap, visits_left_now: now,
    budget_visits_left: budgetLeft, low,
    warning: atCap === 0 ? 'The gate has no Base Sepolia gas left: a payout it signs now cannot be sent. Please wait until it is topped up.'
      : low ? `Low gas: the gate's Base Sepolia address has gas for about ${atCap} more visits at the fee cap.` : null };
}

export async function gate() {
  const g = G(); if (!g) throw err(404, 'no toll gate deployed');
  const [policy, bal, price] = await Promise.all([again(() => view(g.gate, 'policy')), evm('eth_getBalance', [g.foreign_address, 'latest']).catch(() => null), evm('eth_gasPrice', []).catch(() => null)]);
  const ns = []; for (let n = Math.max(0, policy.next_nonce - 4); n < policy.next_nonce; n++) ns.push(n);
  const recent = await Promise.all(ns.map(n => visit(n).catch(() => null)));
  return { gate: g.gate, mpc: g.mpc, wasm_sha256: g.wasm_sha256, source_tag: g.source_tag, policy, foreign_address: g.foreign_address,
    foreign_balance_wei: bal ? BigInt(bal).toString() : null, foreign_explorer: `${SCAN}/address/${g.foreign_address}`, recent: recent.filter(Boolean).reverse(),
    gas: gasInfo(policy, bal == null ? null : BigInt(bal), price == null ? null : BigInt(price)), settler: settlerInfo(),
    how: 'your agent key proposes the 0.01 NEAR toll on your charter (memo toll:base-sepolia); your wallet calls pay_for {charter, action_id} with 300 Tgas; POST /api/toll/gate/<nonce>/broadcast; after Base finality your wallet calls settle {nonce, block_hash}' };
}

/** One gate record, with its Base Sepolia receipt and finality, read live. */
export async function visit(nonce) {
  const g = G(); if (!g) throw err(404, 'no toll gate deployed');
  nonce = Number(nonce); if (!Number.isInteger(nonce) || nonce < 0) throw err(400, 'nonce must be a whole number');
  const rec = await again(() => view(g.gate, 'get_tx', { nonce })); if (!rec) throw err(404, 'no such gate record');
  const who = await view(g.gate, 'get_visit', { nonce }).catch(() => null);
  const out = { nonce, gate: g.gate, status: rec.status, to: rec.to, value: rec.value, tx_hash: rec.tx_hash || null, visit: who,
    proof_payload_hash: rec.proof_payload_hash || null, explorer: rec.tx_hash ? `${SCAN}/tx/${rec.tx_hash}` : null };
  if (rec.tx_hash) {
    const [inPool, head] = await Promise.all([evm('eth_getTransactionByHash', [rec.tx_hash]).catch(() => null), evm('eth_getTransactionCount', [g.foreign_address, 'latest']).catch(() => null)]);
    out.accepted = !!inPool; // show the hash only once a Base Sepolia RPC holds the tx
    out.evm_nonce_head = head == null ? null : parseInt(head, 16);
    out.queued_behind = out.evm_nonce_head == null ? null : Math.max(0, nonce - out.evm_nonce_head);
    const [rc, fin] = await Promise.all([evm('eth_getTransactionReceipt', [rec.tx_hash]).catch(() => null), evm('eth_getBlockByNumber', ['finalized', false]).catch(() => null)]);
    out.base = rc ? { status: rc.status === '0x1' ? 'success' : 'reverted', block: parseInt(rc.blockNumber), block_hash: rc.blockHash } : null;
    out.finalized_head = fin ? parseInt(fin.number) : null;
    out.final = !!(rc && fin && parseInt(fin.number) >= parseInt(rc.blockNumber));
    // Base Sepolia finality trails the head by ~20 min (L1 finality): the wait is the time between the finalized head and the tx block
    const blk = rc && fin && !out.final ? await evm('eth_getBlockByNumber', [rc.blockNumber, false]).catch(() => null) : null;
    out.eta_s = blk ? Math.max(0, parseInt(blk.timestamp) - parseInt(fin.timestamp)) : 0;
    out.settle = out.final && rec.status === 'signed' ? { method: 'settle', args: { nonce, block_hash: rc.blockHash }, gas_tgas: 150 } : null;
  }
  Object.assign(out, phaseOf(out));
  return out;
}

const sendErr = e => err(502, 'Base Sepolia said: ' + String(e.message).slice(0, 120));
/** Send one signed record unless Base Sepolia already has it. Returns true once the RPC holds the tx. */
export async function relay(rec, rpc = evm) {
  if (!rec?.raw_signed || !rec.tx_hash) return false;
  if (await rpc('eth_getTransactionByHash', [rec.tx_hash]).catch(() => null)) return true;
  try { await rpc('eth_sendRawTransaction', [rec.raw_signed]); }
  catch (e) { if (!/already known|nonce too low|known transaction/i.test(e.message)) throw sendErr(e); }
  return !!(await rpc('eth_getTransactionByHash', [rec.tx_hash]).catch(() => null));
}
/** Relay every signed record between the address's mined nonce and `upto` (exclusive), oldest first. */
const policyNext = async () => (await view(G().gate, 'policy')).next_nonce;
export async function relayGap(upto, { maxGap = 40, rpc = evm, gate = G(), read = n => view(gate.gate, 'get_tx', { nonce: n }) } = {}) {
  const g = gate; if (!g) return { from: null, sent: [] };
  const head = parseInt(await rpc('eth_getTransactionCount', [g.foreign_address, 'latest']), 16), sent = [];
  for (let n = head; n < upto && n < head + maxGap; n++) { // lowest Base nonce first: a later tx cannot mine before this one
    const r = await read(n).catch(() => null);
    if (r?.status === 'signed' && r.raw_signed) { try { if (await relay(r, rpc)) sent.push(n); } catch { /* next sweep retries */ } }
  }
  return { from: head, sent };
}

/** Relay the raw tx the gate signed (read from chain) to Base Sepolia. Idempotent. */
export async function broadcast(nonce) {
  const g = G(); if (!g) throw err(404, 'no toll gate deployed');
  nonce = Number(nonce); if (!Number.isInteger(nonce) || nonce < 0) throw err(400, 'nonce must be a whole number');
  // the visitor sees its visit nonce (optimistic) before the MPC signature lands and before our 'final' read catches up:
  // wait for the signed raw tx here instead of answering 409 to a caller that is only early
  let rec = null;
  for (let t0 = Date.now(); ; ) {
    rec = await view(g.gate, 'get_tx', { nonce }).catch(() => null);
    if (rec?.raw_signed || Date.now() - t0 > BROADCAST_WAIT_MS) break;
    await new Promise(r => setTimeout(r, 1500));
  }
  if (!rec?.raw_signed) throw err(409, 'the gate has not signed this record');
  // The gate signs payouts from one Base Sepolia address with nonce = record nonce. A record nobody relayed (a closed tab,
  // an aborted visit) leaves a nonce gap, and every later payout then waits in the mempool forever. Relay the gap first.
  await relayGap(nonce);
  await relay(rec);
  for (let i = 0; i < 6; i++) { const v = await visit(nonce); if (v.base) return v; await new Promise(r => setTimeout(r, 1500)); }
  return visit(nonce);
}

/** What a visitor sees for a record: "signed" alone reads as stuck mid-visit, so name the step it is in. */
export function phaseOf(v) {
  if (v.status === 'confirmed') return { phase: 'confirmed', label: 'confirmed' };
  if (v.status === 'refused_proof') return { phase: 'refused', label: 'proof refused' };
  if (v.status !== 'signed') return { phase: v.status, label: String(v.status).replace(/_/g, ' ') };
  if (!v.base) return { phase: 'broadcasting', label: 'sending to Base Sepolia' };
  if (v.base.status === 'reverted') return { phase: 'reverted', label: 'reverted on Base Sepolia' };
  if (!v.final) return { phase: 'finalizing', label: 'Base Sepolia finalizing' };
  return { phase: 'settling', label: 'final, settling' };
}

// ---------- background settler: anyone may trigger it; its key may only call gate.settle ----------
const SETTLER = () => {
  const s = (process.env.TOLL_SETTLER_KEY || '').trim(), a = (process.env.TOLL_SETTLER_ACCOUNT || '').trim();
  return s && a ? { key: keyFrom(s), account: a } : null;
};
const settled = new Map(); // nonce -> { tx, at }
let sweeping = null, lastSweep = 0, sendChain = Promise.resolve();
export function settlerInfo() { const s = SETTLER(); return { enabled: !!s, account: s ? s.account : null, last_sweep: lastSweep ? new Date(lastSweep).toISOString() : null }; }
export function _resetSettler() { settled.clear(); sweeping = null; lastSweep = 0; }

async function sendSettle(s, gateId, args) {
  const ak = await nearRpc('query', { request_type: 'view_access_key', finality: 'optimistic', account_id: s.account, public_key: s.key.publicKey });
  const tx = signTx({ key: s.key, signerId: s.account, receiverId: gateId, nonce: BigInt(ak.nonce) + 1n, blockHash: ak.block_hash, actions: [functionCall('settle', args, 150n * 10n ** 12n)] });
  const r = await nearRpc('send_tx', { signed_tx_base64: tx.base64, wait_until: 'EXECUTED_OPTIMISTIC' });
  if (r?.status?.Failure) throw err(502, 'settle failed on NEAR: ' + JSON.stringify(r.status.Failure).slice(0, 120));
  return tx.hash;
}

/** Settle one record if it is final on Base and still signed. Safe to call any number of times. */
export async function settleOne(nonce, { read = visit, send = sendSettle, settler = SETTLER() } = {}) {
  const g = G(); if (!g) throw err(404, 'no toll gate deployed');
  const v = await read(nonce);
  if (v.status !== 'signed') return { nonce: v.nonce, result: 'done', status: v.status };
  if (!v.settle) return { nonce: v.nonce, result: 'waiting', phase: v.phase, eta_s: v.eta_s ?? null };
  if (!settler) return { nonce: v.nonce, result: 'no_settler', settle: v.settle };
  const prev = settled.get(v.nonce);
  if (prev && Date.now() - prev.at < 60_000) return { nonce: v.nonce, result: 'sent', settle_tx: prev.tx, explorer: explorerTx(prev.tx) };
  // one settle tx at a time, so two callers never race on the key's nonce
  // re-read inside the queue: another caller (sweep or room) may have settled it while we waited
  const run = sendChain.then(async () => {
    const hit = settled.get(v.nonce);
    if (hit && Date.now() - hit.at < 60_000) return { dup: hit.tx };
    const now = await read(nonce).catch(() => v);
    if (now.status !== 'signed') return { done: now.status };
    return { tx: await send(settler, g.gate, v.settle.args) };
  });
  sendChain = run.catch(() => {});
  let r;
  try { r = await run; } catch (e) {
    const now = await read(nonce).catch(() => null);
    if (now && now.status !== 'signed') return { nonce: v.nonce, result: 'done', status: now.status };
    throw err(502, 'settle not accepted yet, retry shortly');
  }
  if (r.done) return { nonce: v.nonce, result: 'done', status: r.done };
  if (r.dup) return { nonce: v.nonce, result: 'sent', settle_tx: r.dup, explorer: explorerTx(r.dup) };
  const tx = r.tx;
  settled.set(v.nonce, { tx, at: Date.now() });
  return { nonce: v.nonce, result: 'sent', settle_tx: tx, explorer: explorerTx(tx) };
}

/** Settle every recent record that is final on Base Sepolia. Runs one sweep at a time. */
export function settleDue({ read = visit, send = sendSettle, settler = SETTLER(), policyRead = () => view(G().gate, 'policy'), window = 12, relayOnSweep = read === visit } = {}) {
  if (sweeping) return sweeping;
  sweeping = (async () => {
    const g = G(); if (!g) throw err(404, 'no toll gate deployed');
    const policy = await again(policyRead), out = [];
    if (relayOnSweep) await relayGap(policy.next_nonce).catch(() => null);
    for (let n = Math.max(0, policy.next_nonce - window); n < policy.next_nonce; n++) {
      const r = await settleOne(n, { read, send, settler }).catch(e => ({ nonce: n, result: 'error', error: String(e.message).slice(0, 120) }));
      if (r.result !== 'done') out.push(r);
    }
    lastSweep = Date.now();
    return { gate: g.gate, settler: settlerInfo(), records: out };
  })().finally(() => { sweeping = null; });
  return sweeping;
}

/** Sweep in the background every `ms` while a settler key is set (TOLL_SETTLER_AUTO=0 turns it off). */
export function startSettler(ms = 90_000) {
  // relay stuck payouts even without a settler key: anyone may relay a raw tx the gate signed
  if (G() && process.env.TOLL_RELAY_AUTO !== '0') { const r = setInterval(() => { policyNext().then(n => relayGap(n)).catch(() => {}); }, 60_000); r.unref?.(); }
  if (!SETTLER() || process.env.TOLL_SETTLER_AUTO === '0' || !G()) return null;
  const t = setInterval(() => { settleDue().catch(() => {}); }, ms); t.unref?.(); return t;
}
