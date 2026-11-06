// Board v2 call the house shop sends. The method names and the message text match
// contracts/charter_board/src/v2.rs on the board v2 branch (propose_call_as).
// The board replaces a top-level row_owner. A nested row_owner is not authority.
// This module does not sign and does not send.

import { sha256Hex } from './sha256.js';

export const CALL_AS_VERSION = '2';
export const CALL_AS_METHODS = ['propose_call_as', 'confirm_hold', 'cancel_hold', 'expire_sent'];

const EFFECT_TOKEN = /^[A-Za-z0-9_.:@-]{1,64}$/;

export function effectTokenOk(s) {
  return EFFECT_TOKEN.test(String(s ?? ''));
}

/** Same replacement as the board's inject_row_owner. Other keys keep their order. */
export function injectRowOwner(args, owner) {
  const text = String(args ?? '').trim();
  if (!text.startsWith('{')) throw new Error('ERR_ARGS');
  const value = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('ERR_ARGS');
  const out = {};
  for (const key of Object.keys(value)) {
    if (key === 'row_owner') continue;
    out[key] = value[key];
  }
  out.row_owner = String(owner);
  return JSON.stringify(out);
}

function dec(n) {
  const s = String(n ?? '0');
  if (!/^\d+$/.test(s)) throw new Error('ERR_AMOUNT');
  return s.replace(/^0+(?=\d)/, '');
}

export function effectsCanon(effects) {
  const list = effects || [];
  if (!list.length) return '-';
  return list.map(e => [e.chain, e.asset, e.to, dec(e.value), dec(e.fee)].join('|')).join(';');
}

export function callAsText({ network, board, owner, receiver, method, argsOut, deposit, nonce, expiry, epoch, effects, hold }) {
  return [
    'board-call-as-v1',
    network,
    board,
    CALL_AS_VERSION,
    owner,
    receiver,
    method,
    sha256Hex(argsOut),
    dec(deposit),
    dec(nonce),
    dec(expiry),
    dec(epoch),
    effectsCanon(effects),
    hold ? 'hold' : 'exec',
  ].join('|');
}

export function confirmText({ board, owner, actionId, method, args, deposit, effects }) {
  const argsBytes = typeof args === 'string' ? args : JSON.stringify(args);
  const body = [method, sha256Hex(argsBytes), dec(deposit), effectsCanon(effects)].join('|');
  return ['board-confirm-v1', board, owner, dec(actionId), sha256Hex(body), 'present'].join('|');
}

/**
 * Unsigned propose_call_as. `args` is the shop JSON before the board writes row_owner.
 * The message is what the row's agent key signs. signature stays empty here.
 */
export function proposeCallAs({
  network, board, owner, receiver, method, args, deposit, expiry, nonce, epoch, effects = [], hold = false,
}) {
  const argsIn = typeof args === 'string' ? args : JSON.stringify(args);
  const argsOut = injectRowOwner(argsIn, owner);
  for (const e of effects) {
    if (!effectTokenOk(e.chain) || !effectTokenOk(e.asset) || !effectTokenOk(e.to)) {
      throw new Error('ERR_EFFECT');
    }
  }
  const message = callAsText({
    network, board, owner, receiver, method, argsOut, deposit, nonce, expiry, epoch, effects, hold,
  });
  return {
    method: 'propose_call_as',
    receiver: board,
    signed: false,
    live: false,
    message,
    argsOut,
    args: {
      owner,
      receiver,
      method,
      args: argsIn,
      deposit: dec(deposit),
      expiry: dec(expiry),
      effects: effects.map(e => ({
        chain: e.chain, asset: e.asset, to: e.to, value: dec(e.value), fee: dec(e.fee ?? 0),
      })),
      hold: !!hold,
      signature: '',
    },
  };
}

export function cancelHoldArgs(actionId) {
  return { method: 'cancel_hold', args: { action_id: dec(actionId) }, signed: false };
}

export function expireSentArgs(owner, actionId) {
  return { method: 'expire_sent', args: { owner, action_id: dec(actionId) }, signed: false };
}
