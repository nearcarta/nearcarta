// Read a board propose back from a mainnet tx status. No signing.
import { MAINNET_DEP } from './config.js';
import { txStatus } from './near.js';

export const BOARD = MAINNET_DEP?.board?.contract || 'board.nearcarta.near';
export const MAX_YOCTO = 5_000_000_000_000_000_000_000n; // 0.005 NEAR

const SHOP = {
  'toll.nearcarta.near': 'toll',
  'charter.nearcarta.near': 'charter',
  'townhall.nearcarta.near': 'hall',
  'arena.nearcarta.near': 'arena',
  'house.nearcarta.near': 'house',
  'nearcarta.near': 'root',
};
const REASONS = /receiver_not_allowlisted|over_per_action_cap|over_daily_budget|over_daily_action_count|frozen|clause_expired|outside_time_window|below_min_amount|hidden_rule_receiver|hidden_rule_cap|ERR_BALANCE|ERR_BAD_SIG|ERR_NO_CHARTER/;

export function shopOf(payee) {
  const id = String(payee || '');
  return SHOP[id] || id.split('.')[0] || 'pay';
}

function decodeCall(action) {
  const fc = action?.FunctionCall || action?.function_call;
  if (!fc) return null;
  let args = fc.args;
  if (typeof args === 'string') {
    try { args = JSON.parse(Buffer.from(args, 'base64').toString('utf8')); }
    catch { try { args = JSON.parse(args); } catch { args = null; } }
  }
  return { method: fc.method_name || fc.methodName, args };
}

function transfers(tx) {
  const out = [];
  for (const r of tx.receipts || []) {
    const actions = r.receipt?.Action?.actions || [];
    for (const a of actions) {
      const t = a.Transfer || a.transfer;
      if (t && t.deposit != null) out.push({ to: r.receiver_id, deposit: BigInt(t.deposit) });
    }
  }
  return out;
}

export function failureReason(tx) {
  const blob = JSON.stringify(tx?.status || {}) + JSON.stringify(tx?.receipts_outcome || []);
  return blob.match(REASONS)?.[0] || null;
}

export function judgePropose(tx, { signer, board = BOARD, expectReceiver, maxYocto = MAX_YOCTO } = {}) {
  if (!tx || typeof tx !== 'object') return { ok: false, status: 400, error: 'missing tx' };
  const tr = tx.transaction || {};
  if (signer && tr.signer_id !== signer) return { ok: false, status: 400, error: 'signer does not match' };
  if (tr.receiver_id !== board) return { ok: false, status: 400, error: 'receiver is not the board' };
  const call = (tr.actions || []).map(decodeCall).find(a => a && a.method === 'propose');
  if (!call?.args) return { ok: false, status: 400, error: 'not a propose' };
  let amount;
  try { amount = BigInt(call.args.amount); } catch { return { ok: false, status: 400, error: 'amount is outside the cap' }; }
  const receiver = String(call.args.receiver || '');
  if (!receiver || receiver.includes('.testnet')) return { ok: false, status: 400, error: 'receiver must be a mainnet account' };
  if (expectReceiver && receiver !== expectReceiver) return { ok: false, status: 400, error: 'payee does not match' };
  if (amount <= 0n || amount > maxYocto) return { ok: false, status: 400, error: 'amount is outside the cap' };
  const reason = failureReason(tx);
  const paid = transfers(tx).some(t => t.to === receiver && t.deposit === amount);
  if (!reason && !paid) return { ok: false, status: 400, error: 'tx has no matching transfer or refusal' };
  return {
    ok: true, decision: reason ? 'refused' : 'allowed', signer: tr.signer_id, receiver, amount: amount.toString(),
    reason, shop: shopOf(receiver), board,
  };
}

export async function verifyPropose(hash, signer, opts = {}, status = txStatus) {
  const tx = await status(hash, signer);
  const judged = judgePropose(tx, { signer, ...opts });
  return { hash, ...judged };
}
