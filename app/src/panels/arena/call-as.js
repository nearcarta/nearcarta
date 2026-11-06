// Browser twin of shared/board/call-as.js. The board contract rebuilds this
// string, so the bytes have to match that file. A nested row_owner is left
// alone. The board overwrites the top-level one after the signature check.
import { sha256Hex } from '../../chronicle-audit.js';

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
  const hash = sha256Hex(injected);
  return [
    'board-call-as-v1', network, contract, CALL_AS_VERSION, owner, receiver, method, hash,
    String(deposit), String(nonce), String(expiry), String(epoch), effectsCanon(effects),
    hold ? 'hold' : 'exec',
  ].join('|');
}

export function confirmMessage({ contract, owner, actionId, digest }) {
  return `board-confirm-v1|${contract}|${owner}|${actionId}|${digest}|present`;
}
