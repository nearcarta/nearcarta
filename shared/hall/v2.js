// Town Hall calls on the board v2 surface (propose_call_as / stamp / holds).
// The shop reads the top-level row_owner the board injects. This module never
// treats a nested row_owner as the visitor, and it names no payee of its own.
import { BOARD_V2, callAsMessage, confirmMessage, injectRowOwner, refundActionArgs, settleArgs } from '../board/call-as.js';

// One source of method names: BOARD_V2 is the object the city bundle and the
// toll room use, so a rename on chain shows up here too. `stamp` is a board
// call the shops ask for by name, not a hold.
export const BOARD_METHODS = Object.freeze([
  BOARD_V2.open,
  BOARD_V2.confirm,
  BOARD_V2.cancel,
  BOARD_V2.expire,
  BOARD_V2.settle,
  BOARD_V2.refund,
  'stamp',
]);

export function proposeCallAs({ owner, receiver, method, args, deposit, expiry, effects, hold, signature }) {
  const body = typeof args === 'string' ? args : JSON.stringify(args || {});
  return {
    method: BOARD_V2.open,
    args: {
      owner,
      receiver,
      method,
      args: body,
      deposit: String(deposit),
      expiry: String(expiry),
      effects: effects || [],
      hold: !!hold,
      signature: signature || '',
    },
  };
}

export function confirmHold({ owner, actionId, signature }) {
  return { method: BOARD_V2.confirm, args: { owner, action_id: String(actionId), signature } };
}

export function cancelHold({ actionId }) {
  return { method: BOARD_V2.cancel, args: { action_id: String(actionId) } };
}

export function expireSent({ owner, actionId }) {
  return { method: BOARD_V2.expire, args: { owner, action_id: String(actionId) } };
}

// The shop, after the call it received has settled, marks the hold kept.
export function settleHold({ owner, actionId }) {
  return { method: BOARD_V2.settle, args: settleArgs(owner, actionId) };
}

// The shop returns a sent hold's exact NEAR; the row gets it back. `deposit` is
// the hold amount, so a refund cannot be short and cannot overpay.
export function refundAction({ owner, actionId, deposit }) {
  return { method: BOARD_V2.refund, args: refundActionArgs(owner, actionId), deposit: String(deposit) };
}

// `stamp` is a call on the board itself. The attached NEAR returns to the same row.
export function stampCall({ owner }) {
  return { method: 'stamp', receiverIsBoard: true, args: { owner } };
}

/**
 * Hold path for one shop call. propose_call_as with hold=true reserves the row.
 * confirm_hold sends it. cancel_hold returns a hold that was never sent.
 * expire_sent clears a sent hold after its expiry when the shop did not settle.
 * settle keeps a sent hold the shop accepted; refund_action returns its NEAR.
 */
export function holdFlow(input) {
  const injected = injectRowOwner(typeof input.args === 'string' ? input.args : JSON.stringify(input.args || {}), input.owner);
  const message = callAsMessage({ ...input, args: typeof input.args === 'string' ? input.args : JSON.stringify(input.args || {}), hold: true });
  return {
    injected,
    message,
    propose: proposeCallAs({ ...input, hold: true }),
    confirm: confirmHold({ owner: input.owner, actionId: input.actionId, signature: input.confirmSignature || '' }),
    cancel: cancelHold({ actionId: input.actionId }),
    expire: expireSent({ owner: input.owner, actionId: input.actionId }),
    settle: settleHold({ owner: input.owner, actionId: input.actionId }),
    refund: refundAction({ owner: input.owner, actionId: input.actionId, deposit: input.deposit || '0' }),
    confirmText: confirmMessage({
      contract: input.contract,
      owner: input.owner,
      actionId: input.actionId,
      digest: input.digest || '0'.repeat(64),
    }),
  };
}

export { callAsMessage, confirmMessage, injectRowOwner, BOARD_V2 };
