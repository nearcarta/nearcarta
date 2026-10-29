// Toll gate (v5, any listed charter factory): a visitor's own charter pays the toll, the visitor's wallet calls gate.pay_for, and the gate
// MPC-signs a fixed Base Sepolia payout. This module only reads: the gate record from NEAR, the tx from Base Sepolia.
// broadcast() relays the raw tx the gate already signed (read from chain, never from the caller), so it cannot
// sign, change or spend anything; settle is a NEAR tx the visitor signs.
import { DEP } from './config.js';
import { view } from './near.js';

const G = () => DEP.toll_gate;
const BASE = process.env.BASE_SEPOLIA_RPC || 'https://sepolia.base.org';
const SCAN = 'https://sepolia.basescan.org';
async function evm(method, params) {
  const r = await fetch(BASE, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(8000) });
  const j = await r.json(); if (j.error) throw Object.assign(new Error(j.error.message), { evm: true }); return j.result;
}
const err = (status, m) => Object.assign(new Error(m), { status });
// one retry after a short pause: a single slow or dropped RPC read should not fail the whole gate page
const again = async f => { try { return await f(); } catch { await new Promise(r => setTimeout(r, 700)); return f(); } };

export async function gate() {
  const g = G(); if (!g) throw err(404, 'no toll gate deployed');
  const [policy, bal] = await Promise.all([again(() => view(g.gate, 'policy')), evm('eth_getBalance', [g.foreign_address, 'latest']).catch(() => null)]);
  const ns = []; for (let n = Math.max(0, policy.next_nonce - 4); n < policy.next_nonce; n++) ns.push(n);
  const recent = await Promise.all(ns.map(n => visit(n).catch(() => null)));
  return { gate: g.gate, mpc: g.mpc, wasm_sha256: g.wasm_sha256, source_tag: g.source_tag, policy, foreign_address: g.foreign_address,
    foreign_balance_wei: bal ? BigInt(bal).toString() : null, foreign_explorer: `${SCAN}/address/${g.foreign_address}`, recent: recent.filter(Boolean).reverse(),
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
    const [rc, fin] = await Promise.all([evm('eth_getTransactionReceipt', [rec.tx_hash]).catch(() => null), evm('eth_getBlockByNumber', ['finalized', false]).catch(() => null)]);
    out.base = rc ? { status: rc.status === '0x1' ? 'success' : 'reverted', block: parseInt(rc.blockNumber), block_hash: rc.blockHash } : null;
    out.finalized_head = fin ? parseInt(fin.number) : null;
    out.final = !!(rc && fin && parseInt(fin.number) >= parseInt(rc.blockNumber));
    // Base Sepolia finality trails the head by ~20 min (L1 finality): the wait is the time between the finalized head and the tx block
    const blk = rc && fin && !out.final ? await evm('eth_getBlockByNumber', [rc.blockNumber, false]).catch(() => null) : null;
    out.eta_s = blk ? Math.max(0, parseInt(blk.timestamp) - parseInt(fin.timestamp)) : 0;
    out.settle = out.final && rec.status === 'signed' ? { method: 'settle', args: { nonce, block_hash: rc.blockHash }, gas_tgas: 150 } : null;
  }
  return out;
}

/** Relay the raw tx the gate signed (read from chain) to Base Sepolia. Idempotent. */
export async function broadcast(nonce) {
  const g = G(); if (!g) throw err(404, 'no toll gate deployed');
  nonce = Number(nonce); if (!Number.isInteger(nonce) || nonce < 0) throw err(400, 'nonce must be a whole number');
  const rec = await view(g.gate, 'get_tx', { nonce });
  if (!rec?.raw_signed) throw err(409, 'the gate has not signed this record');
  const seen = await evm('eth_getTransactionByHash', [rec.tx_hash]).catch(() => null);
  if (!seen) {
    try { await evm('eth_sendRawTransaction', [rec.raw_signed]); }
    catch (e) { if (!/already known|nonce too low/i.test(e.message)) throw err(502, 'Base Sepolia said: ' + String(e.message).slice(0, 120)); }
  }
  for (let i = 0; i < 6; i++) { const v = await visit(nonce); if (v.base) return v; await new Promise(r => setTimeout(r, 1500)); }
  return visit(nonce);
}
