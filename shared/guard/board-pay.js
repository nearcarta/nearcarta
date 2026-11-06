// The guard shop's board call. The implementation lives in app/src/guard-board-pay.js
// so the browser can load it: a static host serves only app/dist, so a module under
// app/src cannot import ../../../shared. This file keeps the node import path, the
// same way shared/board/call-as.js re-exports app/src/board-call-as.js.
// The board overwrites row_owner. This file does not sign and names no payee of its own.
// contracts/charter_board/src/v2.rs `call_as_message`, `propose_call_as`.
export {
  GUARD_BOARD, payArgs, messageArgs, proposePay, confirmHold, cancelHold, expireSent, boardStep,
} from '../../app/src/guard-board-pay.js';
