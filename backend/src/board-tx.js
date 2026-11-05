// Read a mainnet board `propose` back from EXPERIMENTAL_tx_status.
// The live wasm cannot be upgraded, so this only checks a transaction that already exists.
import { MAINNET_DEP, cfg } from './config.js';

export const BOARD = MAINNET_DEP?.board?.contract || 'board.nearcarta.near';
export const MAX_YOCTO = 5_000_000_000_000_000_000_000n; // 0.005 NEAR
export const TOLL_YOCTO = 1_000_000_000_000_000_000_000n; // 0.001 NEAR
const TXHASH = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;
const ACCOUNT = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

const err = (status, message) => Object.assign(new Error(message), { status });

export function toYocto(amount) {
  const s = String(amount ?? '').trim();
  if (/^\d{20,30}$/.test(s)) return BigInt(s);
  if (!/^\d+(\.\d{1,6})?$/.test(s)) throw err(400, 'amount must be NEAR (up to 6 decimals) or yoctoNEAR');
  const [w, f = ''] = s.split('.');
  return BigInt(w + f.padEnd(6, '0')) * 10n ** 18n;
}

function b64json(args) {
  try { return JSON.parse(Buffer.from(args, 'base64').toString('utf8')); } catch { return null; }
}

function transferOf(receipt) {
  const actions = receipt?.receipt?.Action?.actions || receipt?.receipt?.action?.actions || [];
  const t = actions.find(a => a?.Transfer || a?.transfer);
  const deposit = t?.Transfer?.deposit ?? t?.transfer?.deposit;
  return deposit == null ? null : BigInt(deposit);
}

/** What a propose tx paid, or why it does not count. Pure: no network. */
export function judgePropose(tx, { visitor, payee, amount, board = BOARD } = {}) {
  if (!tx?.transaction) return { ok: false, reason: 'tx not found' };
  const t = tx.transaction;
  if (t.signer_id !== visitor) return { ok: false, reason: 'signer is not the visitor' };
  if (t.receiver_id !== board) return { ok: false, reason: 'receiver is not the board' };
  const fc = (t.actions || []).map(a => a.FunctionCall || a.function_call).find(Boolean);
  if (!fc || (fc.method_name || fc.methodName) !== 'propose') return { ok: false, reason: 'not a propose' };
  const args = typeof fc.args === 'string' ? b64json(fc.args) : fc.args;
  const want = toYocto(amount);
  if (want <= 0n || want > MAX_YOCTO) return { ok: false, reason: 'amount is above 0.005 NEAR' };
  if (!args || args.owner !== visitor || args.receiver !== payee || BigInt(args.amount) !== want) return { ok: false, reason: 'propose args do not match the visitor, payee and amount' };
  const status = tx.status || {};
  if (Object.prototype.hasOwnProperty.call(status, 'Failure')) return { ok: false, reason: 'propose failed' };
  const receipts = tx.receipts || [];
  const hit = receipts.find(r => r.receiver_id === payee && transferOf(r) === want);
  if (!hit) return { ok: false, reason: 'no transfer receipt for that payee and amount' };
  const outcome = (tx.receipts_outcome || []).find(o => o.id === hit.receipt_id);
  if (outcome && Object.prototype.hasOwnProperty.call(outcome.outcome?.status || {}, 'Failure')) return { ok: false, reason: 'transfer receipt failed' };
  const onPaidReceipt = receipts.find(r => (r.receipt?.Action?.actions || []).some(a => a.FunctionCall?.method_name === 'on_paid'));
  let on_paid = null;
  if (onPaidReceipt) {
    const o = (tx.receipts_outcome || []).find(x => x.id === onPaidReceipt.receipt_id);
    on_paid = o && Object.prototype.hasOwnProperty.call(o.outcome?.status || {}, 'Failure') ? 'failure' : 'success';
  }
  return { ok: true, signer: t.signer_id, board, payee, amount: want.toString(), method: 'propose', on_paid, network: 'mainnet' };
}

let fetchImpl = globalThis.fetch;
export const _setFetch = fn => { fetchImpl = fn || globalThis.fetch; };

export async function loadTx(hash, sender, { rpc = cfg.mainnetRpc, fetchFn = fetchImpl } = {}) {
  if (!TXHASH.test(String(hash))) throw err(400, 'tx must be a NEAR tx hash');
  if (!ACCOUNT.test(String(sender)) || String(sender).length > 64) throw err(400, 'visitor must be an account id');
  const res = await fetchFn(rpc, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: '1', method: 'EXPERIMENTAL_tx_status', params: { tx_hash: hash, sender_account_id: sender, wait_until: 'NONE' } }),
  });
  const j = await res.json();
  if (!j.result?.transaction) throw err(422, j.error?.cause?.name || j.error?.name || 'tx not found');
  return j.result;
}

export async function verifyBoardPayment({ hash, visitor, payee, amount, board = BOARD }, deps) {
  if (!ACCOUNT.test(String(payee)) || String(payee).length > 64) throw err(400, 'payee must be an account id');
  const tx = await loadTx(hash, visitor, deps);
  const judged = judgePropose(tx, { visitor, payee, amount, board });
  if (!judged.ok) throw err(422, judged.reason);
  return { ...judged, hash, url: `https://nearblocks.io/txns/${hash}` };
}
