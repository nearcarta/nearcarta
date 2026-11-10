// What the relayer pays gas for (NEP-366 meta transactions). Pure checks, no network, shared by the
// API and the tests. The rule: only zero-deposit Market Day moves, and NEAR spends only through a board
// row, so the relayer can never be used to move anyone's NEAR or to call anything else.
export const TGAS = 10n ** 12n;
export const MARKET_DIRECT = ['gather', 'sell', 'craft', 'fill_order', 'cancel_order', 'claim', 'purse', 'stall'];
export const MARKET_VIA_BOARD = ['buy', 'invest', 'post_order', 'restock'];

export function policy({ market, board }) {
  return { market, board, maxActions: 3, maxGasPerAction: 100n * TGAS, maxGasTotal: 150n * TGAS, maxBlocksAhead: 2000n };
}

const utf8 = (a) => { try { return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(a)); } catch { return null; } };

/**
 * Check one decoded SignedDelegate (borsh shape from near-api-js SCHEMA.SignedDelegate).
 * Returns { ok, why } with a short reason code on refusal.
 */
export function checkDelegate(sd, pol, { height } = {}) {
  const d = sd?.delegateAction; if (!d) return { ok: false, why: 'ERR_DECODE' };
  const to = d.receiverId; const acts = d.actions || [];
  if (to !== pol.market && to !== pol.board) return { ok: false, why: 'ERR_RECEIVER' };
  if (!acts.length || acts.length > pol.maxActions) return { ok: false, why: 'ERR_ACTIONS' };
  if (!d.publicKey?.ed25519Key) return { ok: false, why: 'ERR_KEY_TYPE' };
  if (height != null && (BigInt(d.maxBlockHeight) <= BigInt(height) || BigInt(d.maxBlockHeight) > BigInt(height) + pol.maxBlocksAhead)) return { ok: false, why: 'ERR_EXPIRY' };
  let gas = 0n;
  for (const a of acts) {
    const f = a.functionCall; if (!f || Object.keys(a).length !== 1) return { ok: false, why: 'ERR_ACTION_KIND' };
    if (BigInt(f.deposit) !== 0n) return { ok: false, why: 'ERR_DEPOSIT' };
    const g = BigInt(f.gas); if (g > pol.maxGasPerAction) return { ok: false, why: 'ERR_GAS' }; gas += g;
    if (to === pol.market) { if (!MARKET_DIRECT.includes(f.methodName)) return { ok: false, why: 'ERR_METHOD' }; }
    else {
      if (f.methodName !== 'propose_call_as') return { ok: false, why: 'ERR_METHOD' };
      const s = utf8(f.args); let j; try { j = JSON.parse(s); } catch { return { ok: false, why: 'ERR_ARGS' }; }
      if (j.receiver !== pol.market || !MARKET_VIA_BOARD.includes(j.method)) return { ok: false, why: 'ERR_BOARD_TARGET' };
    }
  }
  if (gas > pol.maxGasTotal) return { ok: false, why: 'ERR_GAS' };
  return { ok: true, gas };
}

/**
 * The access key the delegate names must be fresh (nonce) and either a function-call key on the same
 * receiver, or the one full-access key of an implicit account (an email-login wallet: the account id is
 * the hex of that key). The full key is accepted only because checkDelegate already limits the actions to
 * zero-deposit market moves, so it can spend no NEAR here either.
 */
export function checkKey(key, d, pkHex) {
  if (!key) return { ok: false, why: 'ERR_NO_KEY' };
  const p = key.permission;
  if (BigInt(d.nonce) <= BigInt(key.nonce)) return { ok: false, why: 'ERR_NONCE' };
  if (p === 'FullAccess') {
    if (pkHex && /^[0-9a-f]{64}$/.test(d.senderId) && d.senderId === pkHex) return { ok: true, implicit: true };
    return { ok: false, why: 'ERR_FULL_ACCESS_KEY' };
  }
  if (!p?.FunctionCall) return { ok: false, why: 'ERR_FULL_ACCESS_KEY' };
  if (p.FunctionCall.receiver_id !== d.receiverId) return { ok: false, why: 'ERR_KEY_RECEIVER' };
  return { ok: true };
}

/** Day counters: per sender and for the whole relayer, by UTC day. */
export function caps({ perSender = 300, perDay = 4000, sessionsPerDay = 4 } = {}) {
  let day = '', bySender = new Map(), total = 0, sessions = 0;
  const roll = () => { const d = new Date().toISOString().slice(0, 10); if (d !== day) { day = d; bySender = new Map(); total = 0; sessions = 0; } };
  return {
    take(sender) { roll(); const n = bySender.get(sender) || 0; if (n >= perSender) return 'ERR_SENDER_DAILY_CAP'; if (total >= perDay) return 'ERR_DAILY_CAP'; bySender.set(sender, n + 1); total++; return null; },
    session() { roll(); if (sessions >= sessionsPerDay) return 'ERR_SESSION_DAILY_CAP'; sessions++; return null; },
    status() { roll(); return { day, total, sessions, perSender, perDay, sessionsPerDay }; },
  };
}
