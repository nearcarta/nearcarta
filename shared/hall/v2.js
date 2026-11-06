// Town Hall calls on the board v2 surface. The browser loads app/src/panels/hall-v2.js,
// which is the implementation and is served as-is; this file keeps the node import path
// so a test or a script can import shared/hall/v2.js without a bundler.
export {
  BOARD_METHODS, HALL_SHOP_ID, HALL_BOARD_ID,
  proposeCallAs, confirmHold, cancelHold, expireSent, settleHold, refundAction, stampCall,
  holdFlow, lifecycleStep,
} from '../../app/src/panels/hall-v2.js';
export { callAsMessage, confirmMessage, injectRowOwner, BOARD_V2 } from '../../app/src/board-call-as.js';
