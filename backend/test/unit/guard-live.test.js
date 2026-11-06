import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GUARD_METHODS, KEY_FOR, callArgs, createGuardLedger, expiryAt, guardPlan, guardSend, messageArgs, payArgs,
} from '../../../app/src/panels/guard-live.js';

const ROW = {
  owner: 'alice.near', per_action_cap: '2000000000000000000000', daily_budget: '5000000000000000000000',
  receivers: ['cafe.near', 'guard.nearcarta.near'], frozen: false, nonce: '7', agent: 'ed25519:abc',
};
const OWNER = 'alice.near';
const GUARD = 'guard.nearcarta.near';

/** Deps that record what was asked, and never touch the chain. */
function deps({ text = (m) => `${m}-text`, sendResult = { ok: true, tx: 'TX', reason: 'ok' }, keys = { agent: 'AK', confirm: 'CK', owner: 'OK' } } = {}) {
  const seen = { views: [], signs: [], sends: [] };
  return {
    seen,
    boardView: async (method, args) => { seen.views.push({ method, args }); return text(method, args); },
    signText: (key, t) => { seen.signs.push({ key, text: t }); return `sig:${key}`; },
    send: async (call) => { seen.sends.push(call); return sendResult; },
    keyFor: (kind) => keys[kind] || null,
    ledger: createGuardLedger(),
  };
}

test('the guard method names are the board v2 methods', () => {
  assert.deepEqual(GUARD_METHODS, { open: 'propose_call_as', confirm: 'confirm_hold', cancel: 'cancel_hold', expire: 'expire_sent' });
  assert.equal(KEY_FOR.confirm, 'confirm', 'confirm needs the confirm key, never the agent key');
  assert.equal(KEY_FOR.pay, 'agent');
});

test('a typed payment is validated before anything is signed', () => {
  const base = { payee: 'cafe.near', amountYocto: '1000000000000000000000', row: ROW };
  assert.equal(guardPlan(base).ok, true);
  assert.match(guardPlan({ ...base, amountYocto: '0' }).why, /Name an amount/);
  assert.match(guardPlan({ ...base, payee: 'not an account' }).why, /Name a payee/);
  assert.match(guardPlan({ ...base, amountYocto: '3000000000000000000000' }).why, /over your max per payment/);
  assert.match(guardPlan({ ...base, payee: 'stranger.near' }).why, /not on your row/);
  assert.match(guardPlan({ ...base, chain: 'base' }).why, /Foreign spend stays with Toll/);
  assert.match(guardPlan({ ...base, row: { ...ROW, frozen: true } }).why, /frozen/);
  assert.match(guardPlan({ ...base, row: null }).why, /No row on the board/);
});

test('ALLOW signs propose_call_as with hold:false, using the text the board returned', async () => {
  const d = deps();
  const out = await guardSend({ action: 'pay', payee: 'cafe.near', amountYocto: '1000000000000000000000', row: ROW, owner: OWNER, guard: GUARD }, d);
  assert.equal(out.ok, true);
  assert.equal(out.signed, true);
  assert.equal(out.tx, 'TX');
  // The board was asked for the text; this module never assembles it (the epoch is the board's).
  assert.equal(d.seen.views[0].method, 'call_as_message');
  assert.equal(d.seen.views[0].args.hold, false);
  assert.equal(d.seen.views[0].args.nonce, '7');
  assert.equal(d.seen.sends[0].method, 'propose_call_as');
  assert.equal(d.seen.sends[0].args.hold, false);
  assert.match(d.seen.sends[0].args.signature, /^sig:AK$/, 'signed with the agent key');
  assert.equal(JSON.parse(d.seen.sends[0].args.args).payee, 'cafe.near');
  assert.equal(d.seen.signs[0].text, 'call_as_message-text', 'the signed text is exactly what the board returned');
});

test('WARN signs propose_call_as with hold:true and nothing is forwarded yet', async () => {
  const d = deps();
  const out = await guardSend({ action: 'hold', payee: 'cafe.near', amountYocto: '1000000000000000000000', row: ROW, owner: OWNER, guard: GUARD }, d);
  assert.equal(out.ok, true);
  assert.equal(out.hold, true);
  assert.equal(d.seen.sends[0].args.hold, true);
});

test('confirm needs the confirm key and refuses without it, never the agent key', async () => {
  const noConfirm = deps({ keys: { agent: 'AK' } });
  const refused = await guardSend({ action: 'confirm', holdId: '7', row: ROW, owner: OWNER, guard: GUARD }, noConfirm);
  assert.equal(refused.ok, false);
  assert.equal(refused.signed, false);
  assert.match(refused.why, /confirm key is not in this browser/);
  assert.equal(noConfirm.seen.sends.length, 0, 'nothing is sent without the confirm key');

  const d = deps();
  const ok = await guardSend({ action: 'confirm', holdId: '7', row: ROW, owner: OWNER, guard: GUARD }, d);
  assert.equal(ok.ok, true);
  assert.equal(d.seen.views[0].method, 'confirm_message');
  assert.equal(d.seen.sends[0].method, 'confirm_hold');
  assert.equal(d.seen.signs[0].key, 'CK', 'the confirm key signs, not the agent key');
  assert.deepEqual(Object.keys(d.seen.sends[0].args).sort(), ['action_id', 'owner', 'signature']);
});

test('cancel and expire use the row owner and refund exactly once', async () => {
  const d = deps();
  const first = await guardSend({ action: 'cancel', holdId: '9', row: ROW, owner: OWNER, guard: GUARD }, d);
  assert.equal(first.ok, true);
  assert.equal(d.seen.sends[0].method, 'cancel_hold');
  assert.deepEqual(d.seen.sends[0].args, { action_id: '9' });
  const again = await guardSend({ action: 'cancel', holdId: '9', row: ROW, owner: OWNER, guard: GUARD }, d);
  assert.equal(again.ok, false);
  assert.equal(again.duplicate, true);
  assert.equal(d.seen.sends.length, 1, 'a second cancel must not send');

  const e = deps();
  const exp = await guardSend({ action: 'expire', holdId: '9', row: ROW, owner: OWNER, guard: GUARD }, e);
  assert.equal(exp.ok, true);
  assert.equal(e.seen.sends[0].method, 'expire_sent');
  const exp2 = await guardSend({ action: 'expire', holdId: '9', row: ROW, owner: OWNER, guard: GUARD }, e);
  assert.equal(exp2.duplicate, true);
  assert.equal(e.seen.sends.length, 1);
});

test('a replayed verdict does not sign twice from this browser', async () => {
  const d = deps();
  const first = await guardSend({ action: 'pay', payee: 'cafe.near', amountYocto: '1000000000000000000000', row: ROW, owner: OWNER, guard: GUARD }, d);
  assert.equal(first.ok, true);
  const second = await guardSend({ action: 'pay', payee: 'cafe.near', amountYocto: '1000000000000000000000', row: ROW, owner: OWNER, guard: GUARD }, d);
  assert.equal(second.ok, false);
  assert.equal(second.duplicate, true);
  assert.equal(d.seen.sends.length, 1, 'the second click signs nothing');
});

test('a failed send releases the replay guard so the visitor can retry', async () => {
  const d = deps({ sendResult: { ok: false, tx: null, reason: 'ERR_BAD_SIG' } });
  const first = await guardSend({ action: 'pay', payee: 'cafe.near', amountYocto: '1000000000000000000000', row: ROW, owner: OWNER, guard: GUARD }, d);
  assert.equal(first.ok, false);
  assert.equal(first.signed, true, 'a signature was made, but the send was refused');
  const again = await guardSend({ action: 'pay', payee: 'cafe.near', amountYocto: '1000000000000000000000', row: ROW, owner: OWNER, guard: GUARD }, d);
  assert.equal(again.duplicate, undefined, 'a refusal is not a replay');
  assert.equal(d.seen.sends.length, 2);
});

test('the board view args and the sent args describe the same payment', () => {
  const view = messageArgs({ owner: OWNER, guard: GUARD, nonce: '7', expiry: expiryAt(0), payee: 'cafe.near', chain: 'near', asset: 'NEAR', amountYocto: '5', invoice: 'coffee' });
  const args = callArgs({ view, signature: 'ab' });
  assert.deepEqual(args.args, view.args);
  assert.equal(args.deposit, '5');
  assert.equal(args.hold, false);
  assert.equal(args.expiry, view.expiry);
  const parsed = JSON.parse(payArgs({ payee: 'cafe.near', chain: 'near', asset: 'NEAR', amountYocto: '5', actionId: '7', invoice: 'coffee' }));
  assert.deepEqual(parsed, { payee: 'cafe.near', chain: 'near', asset: 'NEAR', amount: '5', action_id: '7', invoice: 'coffee' });
  // row_owner is the board's to add; the shop must not pretend to send it.
  assert.equal('row_owner' in parsed, false);
});

test('a hold expiry is inside the board day limit', () => {
  const ns = BigInt(expiryAt(0));
  assert.ok(ns > 0n && ns <= 86_400n * 1_000_000_000n, 'a hold cannot be more than a day out');
});
