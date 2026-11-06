// The call the guard shop asks the board to make. The board overwrites
// row_owner. This file does not sign and does not name a payee of its own.
// https://github.com/nearcarta/nearcarta/pull/52

import { injectRowOwner } from '../board/row-owner.js';

export function payArgs({ payee, chain, asset, amount, actionId, invoice = '' }) {
  return JSON.stringify({
    payee: String(payee),
    chain: String(chain),
    asset: String(asset),
    amount: String(amount),
    action_id: String(actionId),
    invoice: String(invoice || ''),
  });
}

export function proposePay({
  network = 'mainnet', board, owner, guard, nonce, expiry, epoch = '0',
  payee, chain, asset, amount, invoice = '', hold = false,
}) {
  if (!board || !owner || !guard || nonce == null || nonce === '' || expiry == null || expiry === '') {
    return { ready: false, signed: false, tx: null, method: 'propose_call_as', hint: 'The row is not loaded. Nothing was signed.' };
  }
  if (!payee || amount == null || amount === '') {
    return { ready: false, signed: false, tx: null, method: 'propose_call_as', hint: 'Name a payee and an amount. Nothing was signed.' };
  }
  const args = payArgs({ payee, chain, asset, amount, actionId: nonce, invoice });
  const injected = injectRowOwner(args, owner);
  return {
    ready: true, signed: false, tx: null, method: 'propose_call_as',
    network, args: {
      owner, receiver: guard, method: 'pay', args, deposit: String(amount),
      expiry: String(expiry), effects: [], hold: !!hold, signature: '',
    },
    epoch: String(epoch), nonce: String(nonce), injected,
  };
}

export function confirmHold({ owner, actionId }) {
  return { ready: !!(owner && actionId != null && actionId !== ''), signed: false, tx: null, method: 'confirm_hold', args: { owner, action_id: String(actionId), signature: '' } };
}

export function cancelHold({ actionId }) {
  return { ready: actionId != null && actionId !== '', signed: false, tx: null, method: 'cancel_hold', args: { action_id: String(actionId) } };
}

export function expireSent({ owner, actionId }) {
  return { ready: !!(owner && actionId != null && actionId !== ''), signed: false, tx: null, method: 'expire_sent', args: { owner, action_id: String(actionId) } };
}

/** Block does not call the board. Warn holds. Allow executes. */
export function boardStep(kind, fields) {
  if (kind === 'block') return { ready: false, signed: false, tx: null, method: null, hint: 'Blocked. No call was built.' };
  if (kind === 'confirm') return confirmHold(fields);
  if (kind === 'cancel') return cancelHold(fields);
  if (kind === 'expire') return expireSent(fields);
  return proposePay({ ...fields, hold: kind === 'hold' });
}
