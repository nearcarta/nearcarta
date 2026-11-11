// The Arena tray uses the same signed envelope as every other shop. This file
// used to hold a second copy; it now re-exports the one browser twin so the
// Arena can never drift from `shared/board/call-as.js`.
export {
  CALL_AS_VERSION,
  BOARD_V2,
  effectsCanon,
  injectRowOwner,
  boardNetwork,
  callAsMessage,
  confirmMessage,
  refundActionArgs,
  settleArgs,
  unitsOf,
  crossArgs,
} from '../../board-call-as.js';
