// The guard shop's board call. The browser loads app/src/board-pay.js, which
// is the implementation; this file keeps the node import path. Both sides share
// one copy of the message rules, so a change cannot drift between them.
// https://github.com/nearcarta/nearcarta/pull/52
export {
  GUARD_BOARD, payArgs, messageArgs, proposePay, confirmHold, cancelHold, expireSent, boardStep,
} from '../../app/src/board-pay.js';
