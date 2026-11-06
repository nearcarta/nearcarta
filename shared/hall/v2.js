// Town Hall calls on the board v2 surface (PR #52, propose_call_as / stamp / holds).
// The shop reads the top-level row_owner the board injects. This module never
// treats a nested row_owner as the visitor, and it names no payee of its own.
import { callAsMessage, confirmMessage, injectRowOwner } from '../board/call-as.js';

export const BOARD_METHODS = Object.freeze([
  'propose_call_as',
  'confirm_hold',
  'cancel_hold',
  'expire_sent',
  'stamp',
]);

export function proposeCallAs({ owner, receiver, method, args, deposit, expiry, effects, hold, signature }) {
  const body = typeof args === 'string' ? args : JSON.stringify(args || {});
  return {
    method: 'propose_call_as',
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
  return { method: 'confirm_hold', args: { owner, action_id: String(actionId), signature } };
}

export function cancelHold({ actionId }) {
  return { method: 'cancel_hold', args: { action_id: String(actionId) } };
}

export function expireSent({ owner, actionId }) {
  return { method: 'expire_sent', args: { owner, action_id: String(actionId) } };
}

// `stamp` is a call on the board itself. The attached NEAR returns to the same row.
export function stampCall({ owner }) {
  return { method: 'stamp', receiverIsBoard: true, args: { owner } };
}

/**
 * Hold path for one shop call. propose_call_as with hold=true reserves the row.
 * confirm_hold sends it. cancel_hold returns a hold that was never sent.
 * expire_sent clears a sent hold after its expiry when the shop did not settle.
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
    confirmText: confirmMessage({
      contract: input.contract,
      owner: input.owner,
      actionId: input.actionId,
      digest: input.digest || '0'.repeat(64),
    }),
  };
}

export { callAsMessage, confirmMessage, injectRowOwner };
