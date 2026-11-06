// Guard live executor. The gold CTA and the AI agent both come through here, so the two
// cannot drift: one validated plan, one signature, one send.
//
// What signs, and with what:
//   pay (ALLOW)      agent key  -> propose_call_as hold:false -> board calls guard.pay
//   hold (WARN)      agent key  -> propose_call_as hold:true  -> board waits for confirm_hold
//   confirm          CONFIRM key -> confirm_hold               (human button only, see below)
//   cancel           row owner  -> cancel_hold                (row owner's key; refunds the row)
//   expire           row owner  -> expire_sent                (after the hold expired)
//
// The signed text is NOT built here. The live board derives the policy epoch itself
// (`epoch_of(owner)` inside `call_as_message`) and `get_charter` does not return it, so
// any text assembled in the browser is a guess and the board rejects it with ERR_BAD_SIG
// once the visitor's epoch is not 0 (setup's set_rules bumps it). This module asks the
// board for the exact string and signs that.
//
// The agent key can never confirm: the board stores a separate confirm key and
// `confirm_hold` requires a signature from it (`ERR_CONFIRM` otherwise). This module is
// the second half of that rule: the agent path never receives the confirm key at all, so
// a model that asks to confirm cannot produce the signature even if it controls the text.
// contracts/charter_board/src/v2.rs: propose_call_as, confirm_hold, cancel_hold, expire_sent.

export const GUARD_METHODS = Object.freeze({
  open: 'propose_call_as',
  confirm: 'confirm_hold',
  cancel: 'cancel_hold',
  expire: 'expire_sent',
});

/** Which method an action needs, and whose key may sign it. */
export const KEY_FOR = Object.freeze({ pay: 'agent', hold: 'agent', confirm: 'confirm', cancel: 'owner', expire: 'owner' });

const DIGITS = /^\d+$/;

/**
 * Validate a typed payment before anything is signed. Pure, so the tray and the agent
 * share it and the tests can drive it without a network.
 * Returns { ok, why } — `why` is a sentence a visitor can act on.
 */
export function guardPlan({ action = 'pay', payee, chain = 'near', asset = 'NEAR', amountYocto, row = null, invoice = '' } = {}) {
  if (!DIGITS.test(String(amountYocto || '')) || BigInt(amountYocto || 0) <= 0n) {
    return { ok: false, why: 'Name an amount. Nothing was signed.' };
  }
  if (!payee || typeof payee !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,62}\.near$/.test(payee) && !/^[0-9a-f]{64}$/.test(payee)) {
    return { ok: false, why: 'Name a payee account. Nothing was signed.' };
  }
  if (String(chain).toLowerCase() !== 'near') {
    // The guard contract forwards NEAR or refunds. A foreign chain is Toll's job.
    return { ok: false, why: 'Foreign spend stays with Toll. This guard pays NEAR only. Nothing was signed.' };
  }
  if (String(asset).toUpperCase() !== 'NEAR') {
    return { ok: false, why: 'This guard pays NEAR only. Nothing was signed.' };
  }
  if (!row) return { ok: false, why: 'No row on the board yet. Finish /setup. Nothing was signed.' };
  if (row.frozen === true) return { ok: false, why: 'Your row is frozen. Nothing was signed.' };
  const cap = BigInt(row.per_action_cap ?? '0');
  if (cap > 0n && BigInt(amountYocto) > cap) {
    return { ok: false, why: 'That amount is over your max per payment. Nothing was signed.' };
  }
  const receivers = Array.isArray(row.receivers) ? row.receivers.map(r => String(r).toLowerCase()) : [];
  // The board enforces the list. Saying so here means the tray explains it before a wallet
  // or a signature instead of surfacing a chain refusal.
  if (receivers.length && !receivers.includes(String(payee).toLowerCase())) {
    return { ok: false, why: 'That payee is not on your row. Add it in /setup. Nothing was signed.' };
  }
  return { ok: true, why: '', args: { action, payee: String(payee).toLowerCase(), chain: 'near', asset: 'NEAR', amountYocto: String(amountYocto), invoice: String(invoice || '') } };
}

/** Args the board hashes and that the guard contract reads. `row_owner` is added by the board. */
export function payArgs({ payee, chain, asset, amountYocto, actionId, invoice = '' }) {
  return JSON.stringify({
    payee: String(payee), chain: String(chain), asset: String(asset),
    amount: String(amountYocto), action_id: String(actionId), invoice: String(invoice || ''),
  });
}

/** The view args for `call_as_message`. The board fills in the epoch. */
export function messageArgs({ owner, guard, nonce, expiry, payee, chain, asset, amountYocto, invoice = '', hold = false }) {
  return {
    owner, receiver: guard, method: 'pay',
    args: payArgs({ payee, chain, asset, amountYocto, actionId: nonce, invoice }),
    deposit: String(amountYocto), nonce: String(nonce), expiry: String(expiry),
    effects: [], hold: !!hold,
  };
}

/** A hold is at most a day out; this uses 30 minutes so a hold is easy to inspect. */
export const HOLD_NS = 30n * 60n * 1_000_000_000n;
export const expiryAt = (nowMs = Date.now(), ns = HOLD_NS) => (BigInt(nowMs) * 1_000_000n + ns).toString();

/** The exact args to send once the board returned the text and the agent signed it. */
export function callArgs({ view, signature }) {
  return {
    owner: view.owner, receiver: view.receiver, method: view.method, args: view.args,
    deposit: view.deposit, expiry: view.expiry, effects: view.effects, hold: view.hold, signature,
  };
}

/**
 * One local ledger of what this browser already sent, so a double click or a replayed
 * verdict cannot send twice. The board also rejects a spent nonce; this stops the second
 * signature before it exists. `refunded` is keyed by hold id so a cancel or an expiry pays
 * the row back exactly once.
 */
export function createGuardLedger() {
  const sent = new Set();      // `${nonce}|${hold?'hold':'exec'}` already signed here
  const refunded = new Set();  // action ids already cancelled or expired
  return {
    sent,
    refunded,
    /** Reserve this intent; false when it was already sent from this browser. */
    claim(key) { if (sent.has(key)) return false; sent.add(key); return true; },
    release(key) { sent.delete(key); },
    /** Cancel/expire once. A second attempt is refused, not sent. */
    claimRefund(actionId) {
      const id = String(actionId);
      if (refunded.has(id)) return false;
      refunded.add(id);
      return true;
    },
    /** A send that failed never happened, so its refund claim is returned. */
    releaseRefund(actionId) { refunded.delete(String(actionId)); },
    hasRefunded(actionId) { return refunded.has(String(actionId)); },
  };
}

/**
 * Build the send step for an action. `deps` is injected so this is testable offline:
 *   deps.boardView(method, args) -> Promise<any>     (view call)
 *   deps.signText(key, text)     -> signature string  (bytes for the board)
 *   deps.send(call)              -> { ok, tx, reason }
 *   deps.keyFor(kind)            -> key | null        (agent / confirm / owner)
 *   deps.row                     -> the row object
 * Every refusal is a sentence and `signed:false`; nothing is stubbed as success.
 */
export async function guardSend({ action, payee, chain = 'near', asset = 'NEAR', amountYocto, invoice = '', holdId = null, row, owner, guard, nowMs = Date.now() }, deps = {}) {
  const { boardView, signText, send, keyFor, ledger = createGuardLedger() } = deps;
  const need = KEY_FOR[action];
  if (!need) return { ok: false, signed: false, tx: null, why: `Unknown guard action ${action}. Nothing was signed.` };

  if (action === 'confirm' || action === 'cancel' || action === 'expire') {
    const id = holdId == null ? '' : String(holdId);
    if (!DIGITS.test(id)) return { ok: false, signed: false, tx: null, why: 'No held payment to act on. Nothing was signed.' };
    if (action !== 'confirm' && !ledger.claimRefund(id)) {
      return { ok: false, signed: false, tx: null, duplicate: true, why: 'That hold was already refunded once. Nothing else moves.' };
    }
    const key = typeof keyFor === 'function' ? keyFor(need) : null;
    if (!key) {
      const why = need === 'confirm'
        ? 'The confirm key is not in this browser. A warning is released only by you, from this button, with that key. Nothing was signed.'
        : 'Connect the visitor wallet to cancel or expire this hold. Nothing was signed.';
      if (action !== 'confirm') ledger.releaseRefund(id);
      return { ok: false, signed: false, tx: null, why };
    }
    let signature = '';
    if (action === 'confirm') {
      // The board returns board-confirm-v1|… for this hold and owner.
      const text = await boardView('confirm_message', { owner, action_id: id });
      if (!text) return { ok: false, signed: false, tx: null, why: 'The board did not return a confirm message. Nothing was signed.' };
      signature = signText(key, text);
      const out = await send({ method: GUARD_METHODS.confirm, args: { owner, action_id: id, signature } });
      return { ...out, signed: true, action };
    }
    const method = action === 'cancel' ? GUARD_METHODS.cancel : GUARD_METHODS.expire;
    const args = action === 'cancel' ? { action_id: id } : { owner, action_id: id };
    const out = await send({ method, args });
    return { ...out, signed: true, action };
  }

  const plan = guardPlan({ action, payee, chain, asset, amountYocto, row, invoice });
  if (!plan.ok) return { ok: false, signed: false, tx: null, why: plan.why };
  const key = typeof keyFor === 'function' ? keyFor('agent') : null;
  if (!key) return { ok: false, signed: false, tx: null, why: 'Finish /setup to add the agent key. Nothing was signed.' };

  const nonce = String(row?.nonce ?? '').replace(/^0+(?=\d)/, '');
  if (!DIGITS.test(nonce)) return { ok: false, signed: false, tx: null, why: 'The row has no nonce yet. Finish /setup. Nothing was signed.' };
  const hold = action === 'hold';
  const expiry = expiryAt(nowMs);
  const view = messageArgs({ owner, guard, nonce, expiry, payee: plan.args.payee, chain: 'near', asset: 'NEAR', amountYocto: plan.args.amountYocto, invoice: plan.args.invoice, hold });

  const claim = `${nonce}|${hold ? 'hold' : 'exec'}`;
  if (!ledger.claim(claim)) return { ok: false, signed: false, tx: null, duplicate: true, why: 'This payment was already sent from this browser. Nothing else was signed.' };

  const text = await boardView('call_as_message', view);
  if (!text) { ledger.release(claim); return { ok: false, signed: false, tx: null, why: 'The board did not return a call message. Nothing was signed.' }; }
  const signature = signText(key, text);
  const out = await send({ method: GUARD_METHODS.open, args: callArgs({ view, signature }) });
  if (!out?.ok) ledger.release(claim);
  return { ...out, signed: true, action, nonce, hold, expiry, payee: plan.args.payee, amountYocto: plan.args.amountYocto };
}
