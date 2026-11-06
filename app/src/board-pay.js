// The call the guard shop asks the board to make. The board overwrites
// row_owner. This file does not sign and does not name a payee of its own.
//
// Browser copy. app/src is copied to the dist root, so /panels/guard-agent.js
// reaches this as /board-pay.js. shared/guard/board-pay.js re-exports it for
// the node import path, the same way shared/board/call-as.js does. A relative
// ../../../shared/ import resolves to a path the build never publishes.
//
// The signed text is NOT assembled here. The live board derives the epoch
// itself (`epoch_of(owner)` inside `call_as_message`) and `get_charter` does
// not return it, so the only correct source is the board view. Ask the board
// for `call_as_message` with these args, sign that string with the agent key,
// and put the bytes in `signature`.
// contracts/charter_board/src/v2.rs `call_as_message`, `propose_call_as`.
// https://github.com/nearcarta/nearcarta/pull/52

import { BOARD_V2, injectRowOwner } from './board-call-as.js';

/** The board's method names. Nothing here invents one. */
export const GUARD_BOARD = BOARD_V2;

export function payArgs({ payee, chain, asset, amount, actionId, invoice = '' }) {
  return JSON.stringify({
    payee: String(payee),
    chain: String(chain),
    asset: String(asset),
    amount: String(amount),
    action_id: String(actionId),
    invoice: String(invoice || ''),
  });
}

/** Args for the board `call_as_message` view. The board fills in its own epoch. */
export function messageArgs({ owner, guard, nonce, expiry, payee, chain, asset, amount, invoice = '', hold = false }) {
  return {
    owner, receiver: guard, method: 'pay',
    args: payArgs({ payee, chain, asset, amount, actionId: nonce, invoice }),
    deposit: String(amount), nonce: String(nonce), expiry: String(expiry),
    effects: [], hold: !!hold,
  };
}

export function proposePay({
  board, owner, guard, nonce, expiry,
  payee, chain, asset, amount, invoice = '', hold = false,
}) {
  if (!board || !owner || nonce == null || nonce === '' || expiry == null || expiry === '') {
    return { ready: false, signed: false, tx: null, method: BOARD_V2.open, hint: 'The row is not loaded. Nothing was signed.' };
  }
  if (!guard) {
    return { ready: false, signed: false, tx: null, method: BOARD_V2.open, hint: 'The guard contract is not deployed yet. Nothing was signed.' };
  }
  if (!payee || amount == null || amount === '') {
    return { ready: false, signed: false, tx: null, method: BOARD_V2.open, hint: 'Name a payee and an amount. Nothing was signed.' };
  }
  const view = messageArgs({ owner, guard, nonce, expiry, payee, chain, asset, amount, invoice, hold });
  return {
    ready: true, signed: false, tx: null, method: BOARD_V2.open,
    // What to pass to propose_call_as once `signature` comes back from the
    // board view plus the agent key. The nonce is the row's, not ours.
    args: {
      owner, receiver: guard, method: 'pay', args: view.args, deposit: String(amount),
      expiry: String(expiry), effects: [], hold: !!hold, signature: '',
    },
    view,
    // The board replaces this with the row owner. It is here so a reader can
    // see the exact bytes the shop calls with.
    injected: injectRowOwner(view.args, owner),
  };
}

/** The confirm key signs `confirm_message`, not the agent key. */
export function confirmHold({ owner, actionId }) {
  return {
    ready: !!(owner && actionId != null && actionId !== ''), signed: false, tx: null, method: BOARD_V2.confirm,
    args: { owner, action_id: String(actionId), signature: '' },
    view: { owner, action_id: String(actionId) }, hint: 'The confirm key signs board-confirm-v1 from confirm_message.',
  };
}

/** The row owner signs this from their wallet. A session key cannot. */
export function cancelHold({ actionId }) {
  return { ready: actionId != null && actionId !== '', signed: false, tx: null, method: BOARD_V2.cancel, args: { action_id: String(actionId) } };
}

/** Callable after the hold was sent and the expiry passed. */
export function expireSent({ owner, actionId }) {
  return { ready: !!(owner && actionId != null && actionId !== ''), signed: false, tx: null, method: BOARD_V2.expire, args: { owner, action_id: String(actionId) } };
}

/** Block does not call the board. Warn holds. Allow executes. */
export function boardStep(kind, fields) {
  if (kind === 'block') return { ready: false, signed: false, tx: null, method: null, hint: 'Blocked. No call was built.' };
  if (kind === 'confirm') return confirmHold(fields);
  if (kind === 'cancel') return cancelHold(fields);
  if (kind === 'expire') return expireSent(fields);
  return proposePay({ ...fields, hold: kind === 'hold' });
}
