// Signed envelope for board.propose_call_as. The contract rebuilds this
// string and checks the agent signature, so a shop cannot trust a hash the
// browser invented. Empty effects means the call moves NEAR only. A foreign
// asset is the effect list, and the board reserves it before the call.
//
// The contract overwrites the top-level row_owner after this text is signed.
// Shops trust that field only when the predecessor is the board. A nested
// row_owner is not authority. Duplicate keys are rejected on chain.
import { createHash } from 'node:crypto';

export const CALL_AS_VERSION = '2';

export function injectRowOwner(args, owner) {
  const value = JSON.parse(args);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('ERR_ARGS');
  const body = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === 'row_owner') continue;
    body[key] = item;
  }
  body.row_owner = owner;
  return JSON.stringify(body);
}

export function effectsCanon(effects) {
  if (!effects || effects.length === 0) return '-';
  return effects.map(e => `${e.chain}|${e.asset}|${e.to}|${e.value}|${e.fee}`).join(';');
}

export function callAsMessage({ network, contract, owner, receiver, method, args, deposit, nonce, expiry, epoch, effects, hold }) {
  const injected = injectRowOwner(args, owner);
  const hash = createHash('sha256').update(injected).digest('hex');
  return [
    'board-call-as-v1', network, contract, CALL_AS_VERSION, owner, receiver, method, hash,
    String(deposit), String(nonce), String(expiry), String(epoch), effectsCanon(effects),
    hold ? 'hold' : 'exec',
  ].join('|');
}

// The confirm key signs this. The agent key must not be that key.
// `present` is the browser's user-presence claim. A compromised browser
// that holds the confirm key can sign it. There is no second wallet popup.
export function confirmMessage({ contract, owner, actionId, digest }) {
  return `board-confirm-v1|${contract}|${owner}|${actionId}|${digest}|present`;
}
