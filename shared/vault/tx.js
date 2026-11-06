// Minimal NEAR transaction signer for one job: an agent key calling `propose` on its own charter.
// Isomorphic (Node and browser). The secret key never leaves the caller; nothing here logs it.
import nacl from 'tweetnacl';
import { sha256 } from '@noble/hashes/sha2.js';
import bs58 from 'bs58';

const enc = new TextEncoder();
const u32 = n => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b; };
const u64 = n => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(n), true); return b; };
const u128 = n => { let v = BigInt(n); const b = new Uint8Array(16); for (let i = 0; i < 16; i++) { b[i] = Number(v & 0xffn); v >>= 8n; } return b; };
const str = s => { const b = enc.encode(s); return cat(u32(b.length), b); };
function cat(...parts) { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; }
const b64 = bytes => (typeof Buffer !== 'undefined' ? Buffer.from(bytes).toString('base64') : btoa(String.fromCharCode(...bytes)));

/** The one browser slot for an account's agent secret. Every signer reads this at sign time. */
export const AGENT_LS = account => 'nearcarta.vault.agent.' + account;

/** Key from that slot, or null. `getItem` is read when this is called, never earlier. */
export function storedAgentKey(getItem, account) {
  const secret = account && typeof getItem === 'function' ? getItem(AGENT_LS(account)) : null;
  return secret ? keyFrom(secret) : null;
}

/** ed25519 key from "ed25519:<base58 64-byte secret>" or a fresh one. */
export function keyFrom(secret) {
  const kp = secret ? nacl.sign.keyPair.fromSecretKey(bs58.decode(secret.replace(/^ed25519:/, ''))) : nacl.sign.keyPair();
  return { publicKey: 'ed25519:' + bs58.encode(kp.publicKey), secretKey: 'ed25519:' + bs58.encode(kp.secretKey), _pk: kp.publicKey, _sk: kp.secretKey };
}

const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');

/** 64 hex chars. The board stores this, without the ed25519: prefix. */
export function pubkeyHex(key) { return hex(key._pk); }

/** 128 hex chars. Detached ed25519 signature of the raw message bytes. */
export function signMessage(key, message) { return hex(nacl.sign.detached(enc.encode(message), key._sk)); }

export function functionCall(method, args, gas, deposit = 0n) {
  const a = enc.encode(JSON.stringify(args));
  return cat(new Uint8Array([2]), str(method), u32(a.length), a, u64(gas), u128(deposit));
}

/** Borsh SignedTransaction (V0) as base64, plus its hash (base58). */
export function signTx({ key, signerId, receiverId, nonce, blockHash, actions }) {
  const tx = cat(str(signerId), new Uint8Array([0]), key._pk, u64(nonce), str(receiverId), bs58.decode(blockHash), u32(actions.length), ...actions);
  const h = sha256(tx);
  const sig = nacl.sign.detached(h, key._sk);
  return { base64: b64(cat(tx, new Uint8Array([0]), sig)), hash: bs58.encode(h) };
}

/** JSON-RPC helper bound to an endpoint. */
// `urls` may be one URL or a list. HTTP 408/429/5xx means the node did not take the request, so the
// next URL is tried (rounds with backoff). A JSON-RPC error or a network failure is not retried here:
// a send_tx that may have reached a node must not be sent twice.
const RETRY_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
export function rpcClient(urls, fetchImpl = fetch, { rounds = 3, backoffMs = 300, sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  const list = (Array.isArray(urls) ? urls : [urls]).filter(Boolean);
  let id = 0;
  return async (method, params) => {
    let last;
    for (let round = 0; round < rounds; round++) {
      for (const url of list) {
        let r;
        // A network error (offline host, DNS, CORS) falls through to the next URL like a 429.
        try { r = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) }); }
        catch (e) { last = new Error(`rpc ${method} network error at ${url}: ${e.message}`); continue; }
        if (!r.ok) { last = new Error(`rpc ${method} http ${r.status}`); if (RETRY_STATUS.has(r.status)) continue; throw last; }
        const j = await r.json();
        if (j.error) { const e = new Error(`rpc ${method}: ${j.error.cause?.name || j.error.name || 'error'} ${JSON.stringify(j.error.data ?? j.error.cause?.info ?? '').slice(0, 300)}`); e.rpc = j.error; throw e; }
        return j.result;
      }
      if (round + 1 < rounds) await sleep(backoffMs * 2 ** round);
    }
    throw last;
  };
}

export async function viewFn(rpc, accountId, method, args = {}) {
  const res = await rpc('query', { request_type: 'call_function', finality: 'final', account_id: accountId, method_name: method,
    args_base64: b64(enc.encode(JSON.stringify(args))) });
  const raw = res?.result;
  if (raw == null) return null;
  const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
  const txt = new TextDecoder().decode(bytes);
  return txt ? JSON.parse(txt) : null;
}

/** Decode the propose Outcome from a final tx result, or the failure text. */
export function outcomeOf(r) {
  const fail = r.status?.Failure || (r.receipts_outcome || []).map(o => o.outcome.status?.Failure).find(Boolean);
  if (fail) return { ok: false, error: fail.ActionError?.kind?.FunctionCallError?.ExecutionError || JSON.stringify(fail).slice(0, 200) };
  const v = r.status?.SuccessValue;
  if (!v) return { ok: true, value: null };
  const txt = typeof Buffer !== 'undefined' ? Buffer.from(v, 'base64').toString('utf8') : new TextDecoder().decode(Uint8Array.from(atob(v), c => c.charCodeAt(0)));
  try { return { ok: true, value: JSON.parse(txt) }; } catch { return { ok: true, value: txt }; }
}

/** 30 Tgas covers an allowed native payment with its settle callback (sandbox-checked); a refusal uses far less. */
export const PROPOSE_TGAS = 30;

/** Sign and send one `propose` with an agent key on its own charter; waits for FINAL. */
export async function sendPropose(rpc, { key, charter, p, gasTgas = PROPOSE_TGAS }) {
  const ak = await rpc('query', { request_type: 'view_access_key', finality: 'optimistic', account_id: charter, public_key: key.publicKey });
  const signed = signTx({ key, signerId: charter, receiverId: charter, nonce: BigInt(ak.nonce) + 1n, blockHash: ak.block_hash,
    actions: [functionCall('propose', { p }, BigInt(gasTgas) * 10n ** 12n)] });
  const r = await rpc('send_tx', { signed_tx_base64: signed.base64, wait_until: 'FINAL' });
  return { hash: signed.hash, ...outcomeOf(r) };
}
