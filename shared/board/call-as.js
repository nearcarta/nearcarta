// Signed envelope for board.propose_call_as. The contract rebuilds this
// string and checks the agent signature, so a shop cannot trust a hash the
// browser invented. Empty effects means the call moves NEAR only. A foreign
// asset is the effect list, and the board reserves it before the call.
//
// The contract overwrites the top-level row_owner after this text is signed.
// Shops trust that field only when the predecessor is the board. A nested
// row_owner is not authority. Duplicate keys are rejected on chain.
//
// House, Arena, the toll room and the city bundle share this module. The
// browser loads app/src/board-call-as.js, which is the implementation; this
// file keeps the node import path. It must stay free of node:crypto so the
// city bundle can import it.
export {
  CALL_AS_VERSION, BOARD_V2, injectRowOwner, effectsCanon, callAsMessage, confirmMessage,
  refundActionArgs, settleArgs, unitsOf, crossArgs,
} from '../../app/src/board-call-as.js';
