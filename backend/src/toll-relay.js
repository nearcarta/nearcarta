// Broadcast a toll raw transaction that is already signed on NEAR. This file does not sign NEAR.
// https://docs.near.org/chain-abstraction/chain-signatures/implementation
import { assembleTollLive, foreignExplorer, relayDecision } from '../../app/src/panels/toll-room.js';

export function pickSigned(live) {
  const rows = live?.recent || [];
  return [...rows].reverse().find(r => r && r.status === 'signed' && r.raw_signed) || null;
}

export async function sendRawTransaction(raw, { fetchImpl = fetch, rpc = process.env.BASE_RPC || 'https://mainnet.base.org' } = {}) {
  if (!/^0x[0-9a-fA-F]+$/.test(String(raw || ''))) return { ok: false, error: 'raw tx is not hex' };
  const r = await fetchImpl(rpc, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_sendRawTransaction', params: [raw] }),
  });
  const j = await r.json();
  if (j.error) return { ok: false, error: String(j.error.message || j.error || 'broadcast refused').slice(0, 180) };
  return { ok: true, hash: j.result || '' };
}

export async function receiptStatus(hash, { fetchImpl = fetch, rpc = process.env.BASE_RPC || 'https://mainnet.base.org' } = {}) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(String(hash || ''))) return null;
  const r = await fetchImpl(rpc, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getTransactionReceipt', params: [hash] }),
  });
  const j = await r.json();
  const rcpt = j.result;
  if (!rcpt) return null;
  const status = rcpt.status == null ? null : Number(BigInt(rcpt.status));
  return { status, block: rcpt.blockNumber || null };
}

/** Broadcast one signed raw tx the toll contract stored, chosen by id. Does not sign NEAR. */
export async function relayById({ id, policy, txs, fetchImpl, rpc } = {}) {
  const rows = (txs || []).filter(t => String(t.nonce) === String(id));
  return broadcastLatest({ policy, txs: rows, fetchImpl, rpc });
}

/** Broadcast the newest signed raw tx the toll contract stored. Does not sign NEAR. */
export async function broadcastLatest({ policy, txs, fetchImpl = fetch, rpc } = {}) {
  const rows = txs || policy?.recent || [];
  const record = pickSigned({ recent: rows });
  const allow = (policy?.allow_to || []).map(s => String(s).toLowerCase());
  if (!record?.raw_signed) return { ok: false, step: 'waiting', claim: 'none', text: 'No signed foreign transaction is waiting. Nothing moved on Base.' };
  if (!record.sign_path && allow.length && record.to && !allow.includes(String(record.to).toLowerCase())) {
    return { ok: false, step: 'allow', claim: 'none', text: 'The signed recipient is not on the live allow list. Nothing was broadcast.' };
  }
  const chain = policy?.verify_chain || policy?.quote?.chain || '';
  const explorer = foreignExplorer(chain, record.tx_hash || '');
  const receipt = record.tx_hash ? await receiptStatus(record.tx_hash, { fetchImpl, rpc }).catch(() => null) : null;
  if (receipt && Number(receipt.status) === 1 && explorer) {
    return { ok: true, step: 'paid', claim: 'paid', explorer, text: `Paid on Base. ${explorer}` };
  }
  const sent = await sendRawTransaction(record.raw_signed, { fetchImpl, rpc });
  return {
    ok: !!sent.ok,
    step: 'broadcast',
    claim: 'signed',
    explorer,
    broadcast: sent,
    text: sent.ok
      ? 'The signed transaction was broadcast. A Base receipt is still required before this is a payment.'
      : `The broadcast was refused. ${sent.error || ''} Nothing on Base was confirmed.`.trim(),
  };
}

/** Read the chain, decide, and broadcast only a raw tx the toll contract already stored. */
export async function relaySigned({ judged, policy, txs, fetchImpl, rpc }) {
  const live = assembleTollLive({ contract: 'toll.nearcarta.near', policy, txs });
  const record = pickSigned({ recent: (txs || []).filter(Boolean) });
  const quote = live.quote;
  let receipt = null;
  if (record?.tx_hash) receipt = await receiptStatus(record.tx_hash, { fetchImpl, rpc }).catch(() => null);
  const decision = relayDecision({ judged, quote, record, receipt });
  if (decision.step !== 'broadcast' || !record?.raw_signed) return { ...decision, broadcast: null };
  const sent = await sendRawTransaction(record.raw_signed, { fetchImpl, rpc });
  return {
    ...decision,
    broadcast: sent,
    text: sent.ok
      ? 'The signed transaction was broadcast. A Base receipt is still required before this is a payment.'
      : `The broadcast was refused. ${sent.error || ''} Nothing on Base was confirmed.`.trim(),
  };
}
