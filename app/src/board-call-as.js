// Signed envelope for board.propose_call_as, matching contracts/charter_board
// on cursor/board-v2-1e87 (a5d9bfe and later). The contract rebuilds this
// string. A shop trusts row_owner only when the predecessor is the board.
// A nested row_owner is not authority.
//
// This module is served raw to the browser (the city imports /board-call-as.js),
// so it must use relative paths: a bare specifier such as @noble/hashes cannot
// resolve in a browser without an import map. sha256.js is the same hash.
import { sha256Hex } from './sha256.js';

export const CALL_AS_VERSION = '2';
export const BOARD_V2 = {
  open: 'propose_call_as',
  confirm: 'confirm_hold',
  cancel: 'cancel_hold',
  expire: 'expire_sent',
  refund: 'refund_action',
  settle: 'settle',
};

export function injectRowOwner(args, owner) {
  const value = JSON.parse(args);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('ERR_ARGS');
  const body = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === 'row_owner') continue;
    body[key] = item;
  }
  body.row_owner = owner;
  return JSON.stringify(body);
}

export function effectsCanon(effects) {
  if (!effects || effects.length === 0) return '-';
  return effects.map(e => `${e.chain}|${e.asset}|${e.to}|${e.value}|${e.fee}`).join(';');
}

export function callAsMessage({ network, contract, owner, receiver, method, args, deposit, nonce, expiry, epoch, effects, hold }) {
  const injected = injectRowOwner(args, owner);
  const hash = sha256Hex(injected);
  return [
    'board-call-as-v1', network, contract, CALL_AS_VERSION, owner, receiver, method, hash,
    String(deposit), String(nonce), String(expiry), String(epoch), effectsCanon(effects),
    hold ? 'hold' : 'exec',
  ].join('|');
}

export function confirmMessage({ contract, owner, actionId, digest }) {
  return `board-confirm-v1|${contract}|${owner}|${actionId}|${digest}|present`;
}

/** Board v2 refund_action / settle arguments. action_id is the row nonce. */
export function refundActionArgs(owner, actionId) {
  return { owner, action_id: String(actionId) };
}

export function settleArgs(owner, actionId) {
  return { owner, action_id: String(actionId) };
}

/** Smallest units. ETH is 18 decimals. USDC on Base is 6. Extra digits are refused. */
export function unitsOf(amount, decimals) {
  const s = String(amount ?? '').trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error('Name the amount. Nothing was signed.');
  const [whole, frac = ''] = s.split('.');
  if (frac.length > decimals) throw new Error('That amount has more decimals than the asset. Nothing was signed.');
  const scale = 10n ** BigInt(decimals);
  const padded = (frac + '0'.repeat(decimals)).slice(0, decimals);
  const units = BigInt(whole) * scale + BigInt(padded || '0');
  if (units <= 0n) throw new Error('Name the amount. Nothing was signed.');
  return units.toString();
}

/** Canonical shop args. The board appends row_owner after this text is hashed. */
export function crossArgs({ actionId, chain, asset, to, amount, rowBudget }) {
  if (!/^\d+$/.test(String(actionId))) throw new Error('ERR_ARGS');
  if (!/^\d+$/.test(String(amount)) || !/^\d+$/.test(String(rowBudget))) throw new Error('ERR_ARGS');
  return `{"action_id":${actionId},"chain":${JSON.stringify(chain)},"asset":${JSON.stringify(asset)},"to":${JSON.stringify(to)},"amount":${JSON.stringify(String(amount))},"row_budget":${JSON.stringify(String(rowBudget))}}`;
}
