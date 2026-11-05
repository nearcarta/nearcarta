// Preview only: would this payee pass the visitor's row. Nothing is signed.
import { reasonLabel } from '../../shared/net/reasons.js';
import { mainnetReceiverOk } from '../../shared/net/accounts.js';
import { MAINNET_DEP } from './config.js';
import { view } from './near.js';

export const BOARD = MAINNET_DEP?.board?.contract || 'board.nearcarta.near';

export function previewPayee(charter, payee) {
  if (!mainnetReceiverOk(payee)) {
    return { preview: true, found: false, payee, decision: 'would refuse', reason: 'receiver must be a valid mainnet .near or implicit account', label: 'Refused' };
  }
  if (!charter) return { preview: true, found: false, payee, decision: 'would refuse', reason: 'no row', label: 'No row on the board' };
  const list = charter.receivers || [];
  const on = list.includes(payee);
  const reason = on ? null : 'receiver_not_allowlisted';
  return {
    preview: true, found: true, payee, receivers: list, sealed: !!charter.sealed,
    decision: on ? 'would allow' : 'would refuse', reason,
    label: on ? 'On your list' : reasonLabel(reason),
    seal_note: charter.sealed ? 'A sealed rule is checked when the payment is proposed. This line is a preview of the list only.' : null,
  };
}

export async function previewOwner(owner, payee, read = view) {
  const charter = await read(BOARD, 'get_charter', { owner });
  return { owner, board: BOARD, ...previewPayee(charter, payee) };
}
