// Arena live executor. The gold CTA and the AI agent both come through here, so the
// two cannot drift: one validated plan, one signature, one send.
//
// What signs, and with what (the same split Guard uses, from shared/board/session.js):
//   mint / feed / withdraw   agent key  -> propose_call_as hold:false  (board calls arena)
//   attack                   agent key  -> propose_call_as hold:true   (board waits)
//   confirm                  CONFIRM key -> confirm_hold               (human button only)
//   cancel                   row owner  -> cancel_hold                (row owner's key)
//   expire                   row owner  -> expire_sent                (after the hold expired)
//
// The agent can never confirm: the board stores a separate confirm key, `set_confirm_key`
// refuses `pk == agent`, and `confirm_hold` accepts only a signature from that key. On
// top of that contract rule this module never hands the confirm key to the agent path,
// so a model that asks to confirm cannot produce the signature even if it controls text.
//
// The signed text is NOT assembled in the browser. The board derives the policy epoch
// itself (`epoch_of(owner)`), and `get_charter` does not return it, so the only correct
// source for the exact bytes is the board's own `call_as_message` / `confirm_message`
// view. Signing a locally guessed text fails with ERR_BAD_SIG once the visitor's epoch
// is not 0. Both paths therefore ask the board first.
//
// contracts/charter_board/src/v2.rs: propose_call_as, confirm_hold, cancel_hold, expire_sent.
// docs.near.org/protocol/accounts-contracts/access-keys: a function-call key cannot attach
// a deposit, so every spend comes from the visitor's board row, never from the key.

export const ARENA_METHODS = Object.freeze({
  open: 'propose_call_as',
  confirm: 'confirm_hold',
  cancel: 'cancel_hold',
  expire: 'expire_sent',
});

/** Which key may sign each action. `confirm` is deliberately not the agent. */
export const ARENA_KEY_FOR = Object.freeze({
  mint: 'agent', feed: 'agent', withdraw: 'agent', attack: 'agent',
  confirm: 'confirm', cancel: 'owner', expire: 'owner',
});

const DIGITS = /^\d+$/;

/** A hold is at most a day out; 30 minutes leaves room to inspect it. */
export const HOLD_NS = 30n * 60n * 1_000_000_000n;
export const holdExpiryAt = (nowMs = Date.now(), ns = HOLD_NS) => (BigInt(nowMs) * 1_000_000n + ns).toString();

/**
 * True when this action is one the agent key may send. The agent path calls this before
 * it looks for a key, so "confirm" can never reach a signature here.
 */
export function agentMaySend(action) {
  return ARENA_KEY_FOR[String(action || '')] === 'agent';
}

/**
 * Local ledger so a double click or a replayed verdict cannot send twice. The board also
 * rejects a spent nonce; this stops the second signature from existing at all.
 * `refunded` is keyed by hold id so cancel/expire pays the row back exactly once.
 */
export function createArenaLedger() {
  const sent = new Set();
  const refunded = new Set();
  return {
    sent,
    refunded,
    claim(key) { if (sent.has(key)) return false; sent.add(key); return true; },
    release(key) { sent.delete(key); },
    claimRefund(actionId) {
      const id = String(actionId);
      if (refunded.has(id)) return false;
      refunded.add(id);
      return true;
    },
    releaseRefund(actionId) { refunded.delete(String(actionId)); },
    hasRefunded(actionId) { return refunded.has(String(actionId)); },
  };
}

/**
 * Build the send step for one Arena action. `deps` is injected so this runs offline in
 * the tests:
 *   deps.boardView(method, args)  -> Promise<any>    board view call
 *   deps.signText(key, text)      -> signature string
 *   deps.send(method, args)       -> { ok, tx, reason }
 *   deps.keyFor(kind)             -> key | null      (agent / confirm / owner)
 *   deps.row                      -> the visitor's board row
 * Every refusal is a sentence with `signed:false`. Nothing is stubbed as success.
 *
 * `humanIntent` is the guard on the hold lifecycle. Only a visitor's own button sets it;
 * the AI path (`agentArenaSend` below) hard-codes it false, so a model that asks to
 * confirm, cancel or expire is refused before any key is looked up. The contract's
 * separate confirm key is the second, independent lock.
 */
export async function arenaSend(input = {}, deps = {}) {
  const { action, plan = null, holdId = null, row = null, owner = '', arena = '', nowMs = Date.now(), humanIntent = false } = input;
  const { boardView, signText, send, keyFor, ledger = createArenaLedger() } = deps;
  const need = ARENA_KEY_FOR[action];
  const no = (why, extra = {}) => ({ ok: false, signed: false, tx: null, why, ...extra });

  if (!need) return no(`Unknown Arena action ${action}. Nothing was signed.`);
  if (!owner) return no('Sign in first. Nothing was signed.');
  if (!arena) return no('The Arena account is unknown. Nothing was signed.');
  if (!row) return no('No row on the board yet. Finish /setup. Nothing was signed.');

  // ---- hold lifecycle: confirm, cancel, expire ----
  if (action === 'confirm' || action === 'cancel' || action === 'expire') {
    // A model may describe an attack; it may not release, cancel or expire one.
    if (humanIntent !== true) {
      return no('An attack is released, cancelled or expired only by you, from this button. Nothing was signed.', { agentRefused: true });
    }
    const id = holdId == null ? '' : String(holdId);
    if (!DIGITS.test(id)) return no('No held attempt to act on. Nothing was signed.');
    // The agent path must never reach here. Belt and braces: the key lookup below asks
    // for the confirm/owner key, never the agent key.
    if (action !== 'confirm' && !ledger.claimRefund(id)) {
      return no('That hold was already refunded once. Nothing else moves.', { duplicate: true });
    }
    const key = typeof keyFor === 'function' ? keyFor(need) : null;
    if (!key) {
      const why = need === 'confirm'
        ? 'The confirm key is not in this browser. An attack is released only by you, from this button, with that key. Nothing was signed.'
        : 'Connect the visitor wallet to cancel or expire this attempt. Nothing was signed.';
      if (action !== 'confirm') ledger.releaseRefund(id);
      return no(why);
    }
    let signature = '';
    if (action === 'confirm') {
      // The board returns board-confirm-v1|… for this hold and owner.
      const text = await boardView('confirm_message', { owner, action_id: id });
      if (!text) return no('The board did not return a confirm message. Nothing was signed.');
      signature = signText(key, text);
      const out = await send(ARENA_METHODS.confirm, { owner, action_id: id, signature });
      return { ...out, signed: true, action, holdId: id, key: 'confirm' };
    }
    const method = action === 'cancel' ? ARENA_METHODS.cancel : ARENA_METHODS.expire;
    const args = action === 'cancel' ? { action_id: id } : { owner, action_id: id };
    const out = await send(method, args);
    return { ...out, signed: true, action, holdId: id, key: 'owner' };
  }

  // ---- spend: mint, feed, withdraw, attack ----
  if (!agentMaySend(action)) return no('That action is not one the agent may send. Nothing was signed.');
  const call = plan?.call;
  if (!call || call.boardMethod !== 'propose_call_as') return no('Nothing was planned. Nothing was signed.');
  if (call.receiver !== arena) return no('The plan is not for this Arena account. Nothing was signed.');
  const key = typeof keyFor === 'function' ? keyFor('agent') : null;
  if (!key) return no('Finish /setup to add the agent key. Nothing was signed.');

  const nonce = String(row?.nonce ?? '').replace(/^0+(?=\d)/, '');
  if (!DIGITS.test(nonce)) return no('The row has no nonce yet. Finish /setup. Nothing was signed.');
  if (row?.frozen === true) return no('Your row is frozen. Nothing was signed.');

  const hold = action === 'attack';
  const expiry = call.expiry && BigInt(call.expiry) > BigInt(nowMs) * 1_000_000n
    ? String(call.expiry)
    : holdExpiryAt(nowMs);
  const claim = `${nonce}|${hold ? 'hold' : 'exec'}`;
  if (!ledger.claim(claim)) return no('That attempt was already sent from this browser. Nothing else was signed.', { duplicate: true });

  const view = {
    owner, receiver: arena, method: call.method, args: call.args,
    deposit: String(call.deposit), nonce, expiry, effects: call.effects || [], hold,
  };
  const text = await boardView('call_as_message', view);
  if (!text) { ledger.release(claim); return no('The board did not return a call message. Nothing was signed.'); }
  const signature = signText(key, text);
  const out = await send(ARENA_METHODS.open, {
    owner, receiver: arena, method: call.method, args: call.args,
    deposit: String(call.deposit), expiry, effects: call.effects || [], hold, signature,
  });
  if (!out?.ok) ledger.release(claim);
  return { ...out, signed: true, action, nonce, hold, expiry, key: 'agent' };
}

/**
 * The AI agent's only way in. `humanIntent` is fixed to false here, not read from the
 * caller, so no model output can release, cancel or expire a held attack. The agent can
 * mint, feed, withdraw and open an attack; a confirm is the visitor's button.
 */
export function agentArenaSend(input = {}, deps = {}) {
  return arenaSend({ ...input, humanIntent: false }, deps);
}

/**
 * The visitor's button path for a held attack. The key comes from the human key slot, and
 * `humanIntent` is set here because this function only runs from a click handler.
 */
export function visitorHoldAction(input = {}, deps = {}) {
  return arenaSend({ ...input, humanIntent: true }, deps);
}

/**
 * Settle one open attempt with the model's signed verdict. Permissionless in the contract,
 * so any visitor's wallet can call it; the model signature is what makes it valid, not the
 * caller. `arena.resolve` is a plain function call, not a board row spend.
 */
export function resolveArgs({ envelope }) {
  const e = envelope || {};
  return {
    envelope: {
      attempt_id: Number(e.attempt_id),
      player: e.player,
      prompt_hash: e.prompt_hash,
      oath_hash: e.oath_hash,
      persona_hash: e.persona_hash,
      response_hash: e.response_hash,
      nonce: Number(e.nonce),
      pay_to: e.pay_to ?? null,
      pay_amount: String(e.pay_amount ?? '0'),
      model: e.model,
      completion_id: e.completion_id || '',
      signature: e.signature,
    },
    response: e.response,
  };
}
