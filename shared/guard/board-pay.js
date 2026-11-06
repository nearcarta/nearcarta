// The call the guard shop asks the board to make. The board overwrites
// row_owner. This file does not sign and does not name a payee of its own.
//
// The signed text is NOT assembled here. The live board derives the epoch
// itself (`epoch_of(owner)` inside `call_as_message`) and `get_charter` does
// not return it, so the only correct source is the board view. Ask the board
// for `call_as_message` with these args, sign that string with the agent key,
// and put the bytes in `signature`.
// contracts/charter_board/src/v2.rs `call_as_message`, `propose_call_as`.
// https://github.com/nearcarta/nearcarta/pull/52
//
// The implementation lives in app/src/panels/guard-board-pay.js: the browser loads
// app/src/panels/guard-agent.js directly, and a module served from app/dist cannot
// resolve a path outside app/. This file keeps the node import path for the tests.
export {
  GUARD_BOARD, payArgs, messageArgs, proposePay, confirmHold, cancelHold, expireSent, boardStep,
} from '../../app/src/panels/guard-board-pay.js';
