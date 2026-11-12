// Session length and the function-call key the visitor adds for the board.
// A function-call key names one receiver, optional method names, and a gas allowance.
// It cannot attach a deposit. https://docs.near.org/protocol/accounts-contracts/access-keys
// The allowance is charged at the gas buy price (0.001 NEAR/Tgas on mainnet), then
// credited back for unused gas. An existing key's allowance cannot be raised.
// https://docs.near.org/protocol/transactions/gas#buying-vs-burning-gas
// The login plugin requests that key. https://docs.near.org/web3-apps/tutorials/wallet-login
// set_calls JSON is the contract's own parser: contracts/charter_board/src/lib.rs `set_calls`.
// ft_transfer is NEP-141: https://github.com/near/NEPs/blob/master/neps/nep-0141.md
import { functionCallAllowanceCost } from './cost.js';

// `anchor` is the Chronicle tray's own call: it logs one event and stores nothing, so it
// needs no cap and no deposit, but the session key must name it or the visitor signs twice.
export const AGENT_METHODS = ['propose', 'propose_call', 'propose_call_as', 'anchor'];

/**
 * The session key's scope for holds. Arena, Guard and Hall need three more board
 * methods, and they are not equal:
 *
 * - `confirm_hold` sends a held WARN. It is safe to *list* on the session key and
 *   useless to the agent: the contract stores a separate confirm key, `set_confirm_key`
 *   refuses `pk == agent`, and `confirm_hold` only accepts a signature from that stored
 *   key. The agent cannot hold the visitor's confirm secret. So a WARN can never be
 *   confirmed by the agent on its own, whatever the key's method list says. That is a
 *   contract check, not a UI rule: `holdsCanConfirmWithoutOwner` pins it in the tests.
 * - `cancel_hold` and `expire_sent` are the visitor changing their own record. Both are
 *   `predecessor == owner` in the contract. Neither is granted: an agent that can cancel
 *   a WARN can quietly undo it, and one that can expire a sent hold decides a liability.
 *   The visitor's own wallet calls those two.
 *
 * Two more are listed because a shop changes the visitor's own row with no wallet popup:
 *
 * - `tighten_rules` can only shrink. The contract refuses every field that is not at
 *   least as tight (`ERR_LOOSEN`: cap, daily budget, count, min amount, a payee that is
 *   not already listed, an expiry that is later, a wider window), and it refuses to
 *   move the nonce, the spend or the day. An agent calling it can make the row stricter,
 *   never looser, so it cannot widen its own authority.
 * - `anchor` writes nothing. It requires a row, hashes `salt || digest`, and logs one
 *   event; the contract asserts its state bytes are unchanged (`ERR_STATE`). A salted
 *   commitment is the only thing a shop publishes through it.
 */
export const SESSION_METHODS = [...new Set([...AGENT_METHODS, 'confirm_hold', 'tighten_rules'])];
/** Methods only the visitor's wallet may call. Never in a session key's list. */
export const OWNER_ONLY_METHODS = ['cancel_hold', 'expire_sent'];
/** The three hold methods a shop track needs, stated once for the shops and the docs. */
export const HOLD_METHODS = ['confirm_hold', 'cancel_hold', 'expire_sent'];

/**
 * True when a key scope would let the agent confirm a hold with nothing else. It cannot:
 * a confirm signature must come from the row's confirm key, and `set_confirm_key`
 * refuses to store the agent key. This is the invariant /setup and the shops rely on.
 */
export function agentCanConfirmAlone(methodNames, { confirmKeyEqualsAgent = false } = {}) {
  const names = Array.isArray(methodNames) ? methodNames : [];
  return confirmKeyEqualsAgent === true && names.includes('confirm_hold');
}

/** True when a scope asks for a method only the visitor's wallet may call. */
export function scopeHasOwnerOnly(methodNames) {
  const names = Array.isArray(methodNames) ? methodNames : [];
  return OWNER_ONLY_METHODS.some(m => names.includes(m));
}
export const SESSION_HOURS = [1, 2, 24];
// 0.05 NEAR of gas. The key cannot spend it as a transfer.
export const GAS_ALLOWANCE_YOCTO = (10n ** 24n / 20n).toString();
// 0.25 NEAR of gas for a Ferry session. Each propose_call prepays about 0.055 NEAR
// (54 Tgas at 0.001 NEAR/Tgas: 30 to the shop and 20 to the callback). A 0.05 key
// cannot buy one of those calls. Refresh replaces the key; it does not raise an
// existing allowance.
export const GAS_TOPUP_YOCTO = (10n ** 24n / 4n).toString();
// Prepaid gas for a silent board propose. The on_paid callback is 20 Tgas, so 40
// leaves room for propose itself. 80 Tgas is bought for ~0.081 NEAR and exceeds
// the 0.05 allowance. The stamp amount is a contract argument, not a deposit.
export const BOARD_PROPOSE_TGAS = 40;
// Method name + JSON of the live Ferry propose that returned NotEnoughAllowance.
export const FERRY_PROPOSE_BYTES = 310;

/** Yocto the session key must have free for one board propose at this gas. */
export function boardProposeAllowanceYocto(tgas = BOARD_PROPOSE_TGAS, numBytes = FERRY_PROPOSE_BYTES) {
  return functionCallAllowanceCost({ tgas, numBytes });
}
// Storage for the call allowlist, prepended as one deposit and refunded down to
// what the write used (`charge_calls_and_reserve`).
// Board v2 measures the real trie bytes: each pair is the receiver, the method and
// a 16-byte cap, plus the 600-byte side reserve. 0.005 NEAR was the old in-memory
// estimate and is refused with ERR_DEPOSIT now. A full default list measured
// 0.0116 NEAR in the sandbox, and the widest list the row cap allows measured
// 0.01494 (`contracts/charter_board_sandbox/tests/setup_calls_deposit.rs`).
// The hold build keeps a 1400-byte side reserve (0.014 NEAR) on top of the pairs, so 0.015 is
// refused ERR_DEPOSIT. 0.05 is what contracts/charter_board_sandbox/tests/setup_calls_deposit.rs
// sends; everything the write does not use is refunded in the same receipt.
export const CALLS_DEPOSIT_YOCTO = (5n * 10n ** 22n).toString();

export function sessionExpiresAt(hours, nowMs = Date.now()) {
  const h = SESSION_HOURS.includes(Number(hours)) ? Number(hours) : SESSION_HOURS[0];
  return ((BigInt(nowMs) + BigInt(h) * 3_600_000n) * 1_000_000n).toString();
}

export function sessionLabel(hours) {
  const h = SESSION_HOURS.includes(Number(hours)) ? Number(hours) : SESSION_HOURS[0];
  return h === 1 ? '1 hour' : `${h} hours`;
}

// wrap.near is the NEP-141 wNEAR used for NEAR→1Click deposit legs (brief-V V4; ferry_intents wrap_near tx).
// https://docs.near.org/tutorials/tokens/creating-a-ft ; near_deposit / ft_transfer / storage_deposit on wrap.near.
export const FERRY_CALL_TARGETS = [
  { receiver: 'wrap.near', method: 'near_deposit' },
  { receiver: 'wrap.near', method: 'ft_transfer' },
  { receiver: 'wrap.near', method: 'storage_deposit' },
];

/** wrap.near plus the board's own stamp. The stamp returns its NEAR to the row. */
export function stampCalls(board, capYocto) {
  return [...FERRY_CALL_TARGETS, { receiver: board, method: 'stamp', cap: String(capYocto) }];
}

// USDC on NEAR (the 64-hex contract). A Payouts row registers a zero-NEAR issuer for USDC through the
// visitor's own row, so the money can arrive. storage_deposit is bounded by the row's per-payment cap,
// and only the storage_deposit method is opened: this call cannot move USDC, only register an account.
// https://github.com/near/NEPs/blob/master/neps/nep-0141.md
export const USDC_NEAR = '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';
export const USDC_STORAGE_CALL = { receiver: USDC_NEAR, method: 'storage_deposit' };

/**
 * The call list a Payouts-capable row carries. The USDC storage pair is added only when the whole
 * list still fits the row's 0.02 NEAR: the 64-hex contract costs 104 bytes, which a long shop list
 * cannot spare. `fits` reports whether the pair made it, so the shop can say so instead of guessing.
 */
export function payoutsCalls(extra, capYocto) {
  const base = [...(extra || [])];
  const withUsdc = [...base, { ...USDC_STORAGE_CALL, cap: String(capYocto) }];
  return callsFitRow(withUsdc) ? { calls: withUsdc, fits: true } : { calls: base, fits: false };
}

/**
 * The Town Hall job lifecycle as board calls. Each one is a part of one job, and the
 * board's own row rules (per-action cap, daily budget, receiver list) still gate every
 * call: these pairs grant no spending power the row does not already have.
 *
 * A Hall row carries these instead of the ferry trio, which it never needs. The
 * measured cost is 430 of the row's 602 pair bytes, so a Hall-only row fits with
 * room for a second shop.
 */
export const HALL_SHOP = 'townhall.nearcarta.near';
export const HALL_CALL_METHODS = Object.freeze([
  'post_job', 'bid', 'counter', 'accept', 'deliver', 'review', 'refund',
]);
export function hallCalls(shop = HALL_SHOP) {
  return HALL_CALL_METHODS.map(method => ({ receiver: shop, method }));
}

// propose_call takes the deposit from the row and refuses it above this cap
// (`over_shop_cap`, contracts/charter_board/src/lib.rs line 334) and above the
// row's per_action_cap (line 337). set_calls stores the triple (line 293).
// A wrap.near cap below the rule cap would block a near_deposit the rules already allow.
function wrapCap(named, capYocto) {
  const rule = String(capYocto);
  const given = named == null || named === '' ? rule : String(named);
  try {
    if (BigInt(given) < BigInt(rule)) return rule;
  } catch { return rule; }
  return given;
}

// set_calls panics ERR_RECEIVERS when the list is longer than this or a
// (receiver, method) pair is repeated. contracts/charter_board MAX_CALLS.
// Pay receivers stay at MAX_RECEIVERS (8).
export const MAX_CALLS = 24;

// The row and its call list share one 0.02 NEAR of storage (MAX_ROW_YOCTO = 2000 bytes).
//
// The contract source now raises this to 0.03 NEAR and prepays a 1400-byte side reserve, so a
// shop row can write its per-action hold record. That build is STAGED, not live: until the
// upgrade lands the chain still answers with 2000 bytes, and this model must keep saying what
// the chain actually does. Measured 2026-11-08: a clean seven-pair Town Hall row locked 1858
// bytes and the hold write then panicked ERR_DEPOSIT, which is why the raise exists.
// The constants below are measured on mainnet, not modelled, because modelling refused
// shapes the chain accepted and accepted shapes it refused.
//
// 2026-11-07, visitor row `8ccd5d33…`, ONE fixed eight-pair list (402 pair bytes) and only
// the receiver count moved, so the slope is the per-receiver cost by construction:
//
//   receivers=1 -> 1916 bytes locked
//   receivers=2 -> 1940 bytes locked
//   receivers=3 -> 1964 bytes locked
//
// slope 24 bytes per receiver; fixed = 1916 - 24 - 402 = 1490.
//
// The two shapes that failed on the same row, and why:
//   four receivers, 9 pairs (472 bytes) -> ERR_ROW_TOO_BIG. The old model said 1940 of 2000.
//   four receivers, 8 pairs (424 bytes) -> ERR_ROW_TOO_BIG. The old model said 1892 of 2000.
// and the shape that landed:
//   four receivers, 7 pairs (375 bytes) -> 1993 bytes locked, 7 left. The model says 1961.
//
// Those 32 bytes ARE the contract's own `STORAGE_MARGIN_BYTES`: `charge` adds the margin on
// every write and never gives it back, so a row that is edited more than once carries it once
// per edit. That is why the model is a floor and `rowHeadroomBytes` is the number to trust on
// a live row. The margin is already inside the constants below, so a fresh row is budgeted
// pessimistically, which is the direction that matters: refuse early rather than on chain.
//
// Each pair is the receiver, the method and a 16-byte cap: `receiver.length + method.length
// + 24`. The list almost always carries the wrap.near trio, the board stamp and the House
// shop's two calls, and those count too.
// Those 1490 bytes were measured with the old 600-byte side reserve. The live board
// (code 51kKGvtV…, MAX_ROW_YOCTO 0.04 NEAR = 4000 bytes) prepays SIDE_RESERVE_BYTES = 1400 on
// `set_calls`, i.e. 800 more, so a fresh row's fixed cost is 1490 + 800 = 2290 bytes.
// Cross-check on chain 2026-11-12: row 8ccd5d33 with eight receivers locks 3469 bytes.
export const ROW_SIDE_RESERVE_EXTRA_BYTES = 800;
export const ROW_FIXED_BYTES = 1490 + ROW_SIDE_RESERVE_EXTRA_BYTES;
/**
 * Cushion kept free on a fresh row for the 32-byte margin each later edit adds and for a
 * hold larger than the prepaid reserve. A fresh row is budgeted pessimistically on purpose.
 */
export const ROW_EDIT_CUSHION_BYTES = 200;
export const ROW_BYTES_PER_RECEIVER = 24;
/**
 * The whole row's storage allowance: contracts/charter_board MAX_ROW_YOCTO (0.04 NEAR on the
 * live board, `get_config().max_row_yocto`) at 1e19 yocto per byte = 4000 bytes. The old 2000
 * left Town Hall (7 pairs) and any plain Payouts payee unable to fit any row.
 */
export const ROW_STORAGE_BYTES = 4000;

/**
 * Bytes the FIRST effect budget costs a row. Measured on mainnet 2026-11-07 by writing the
 * budgets one at a time against a bare toll row and reading `storage_locked` after each:
 *
 *   toll-only row, 1 pair              -> 1594 locked
 *   + one base/usdc cap                -> 1945   (+351, this also creates the ACTS record)
 *   + one base/native cap              -> 1979   (+34, the record already existed)
 *
 * The consequence is the ceiling the city actually hits: a row that reaches four shops leaves
 * 7 bytes and a three-shop row leaves 86, so NO shop-bearing row can hold a foreign effect
 * budget, and `propose_call_as` refuses every Base crossing with ERR_EFFECT before the shop is
 * ever called. Nothing in the app calls `set_effects` today, so this is not a page bug: it is
 * the 0.02 NEAR row limit meeting the effect design. Fixing it needs a contract change
 * (a larger MAX_ROW_YOCTO, or the effect record charged outside the row), not a UI fix.
 */
export const EFFECT_BUDGET_FIRST_BYTES = 351;
/** Each further asset cap on the same row, once the record exists. */
export const EFFECT_BUDGET_MORE_BYTES = 34;


/**
 * The largest call list four receivers can hold, measured on mainnet 2026-11-07 by growing the
 * list one pair at a time against a four-receiver row (order matters: grow the receivers while
 * the list is short, then grow the list):
 *
 *   four receivers, 4 pairs -> 1762 locked
 *   four receivers, 5 pairs -> 2000 locked, zero headroom (the largest that lands)
 *   four receivers, 6 pairs -> ERR_ROW_TOO_BIG
 *
 * So a four-shop row is exactly full at five pairs, and the seventh pair the default list wants
 * (both wrap legs, the House pair, the stamp and the optional storage_deposit) cannot join it.
 * A row at 2000 bytes has NO room for an effect budget, a hold, or a sixth pair.
 */
export const FOUR_SHOP_MAX_PAIRS = 5;

/**
 * Bytes a rule change can still add, from the CHAIN's own number.
 *
 * The formula below (`pairBudgetBytes`) models a row from scratch, and on 2026-11-07 it said
 * 554 bytes were free while the live row was already at its exact 0.02 NEAR cap: `set_rules`
 * panicked ERR_ROW_TOO_BIG and the visitor's wallet had already approved the call. Modelling a
 * row is a guess; `storage_locked` is the chain telling us. This returns the real headroom, or
 * null when the row does not report it.
 */
export function rowHeadroomBytes(row, maxRowBytes = ROW_STORAGE_BYTES) {
  const locked = row?.storage_locked;
  if (locked == null || locked === '') return null;
  // Storage costs 1e19 yocto per byte. BigInt, because Number(3.794e22) / 1e19 is 3793.9999…
  // and the floor then reports one byte less than the chain has.
  let lockedBytes;
  try { lockedBytes = Number((BigInt(locked) + 10n ** 19n - 1n) / 10n ** 19n); } catch { return null; }
  return Math.max(0, Math.floor(maxRowBytes - lockedBytes));
}
/** Room for the pair list when the rules name `receivers` receivers. */
export function pairBudgetBytes(receivers = 1) {
  const n = Math.max(1, Number(receivers) || 1);
  return Math.max(0, ROW_STORAGE_BYTES - ROW_FIXED_BYTES - ROW_EDIT_CUSHION_BYTES - ROW_BYTES_PER_RECEIVER * n);
}
/** Kept for callers that ask for the widest budget a one-receiver row allows. */
export const MAX_PAIR_BYTES = pairBudgetBytes(1);

/** Trie bytes one (receiver, method) pair adds to the row. */
export function callPairBytes(receiver, method) {
  return String(receiver).length + String(method).length + 24;
}

/**
 * True when this call list fits the row's 0.02 NEAR of storage alongside `receivers`
 * rule receivers. The deposit does not decide this: ERR_ROW_TOO_BIG does, and the page
 * must stop before it sends. Pass the receiver count from the same rules the row is
 * opened with, or the two disagree and the board refuses the second action.
 */
export function callsFitRow(calls, receivers = 1) {
  const used = (calls || []).reduce((n, c) => n + callPairBytes(c.receiver, c.method), 0);
  return used <= pairBudgetBytes(receivers);
}

/**
 * The largest subset of `receivers` whose call list still fits, so a page can tell the
 * visitor what to keep instead of only refusing. `build(receivers)` must return that
 * receiver list's pairs.
 *
 * Shops whose own contract takes a call (Toll, Guard, House) are kept ahead of a plain
 * `ft_transfer` payee, because dropping one of those breaks a shop the visitor just
 * allowed, while dropping an ordinary payee only narrows the list. Order is preserved
 * within each group.
 */
export const SHOP_PRIORITY_METHODS = ['cross', 'pay', 'house_session_check_in', 'house_session_prepare_send'];
export function fittingShops(receivers, build) {
  const list = Array.from(receivers || []);
  const important = r => (methodsForShop(r, 'ft_transfer').some(m => SHOP_PRIORITY_METHODS.includes(m)) ? 0 : 1);
  if (callsFitRow(build(list), list.length)) return list;
  // Drop the least important entries first: a plain payee before a shop whose own
  // contract takes the call. Within a rank, drop from the end so the typed order stays.
  const ranked = list.map((r, i) => ({ r, i, rank: important(r) })).sort((a, b) => b.rank - a.rank || b.i - a.i);
  for (let drop = 1; drop <= ranked.length; drop += 1) {
    const gone = new Set(ranked.slice(0, drop).map(x => x.i));
    const keep = list.filter((_, i) => !gone.has(i));
    if (keep.length && callsFitRow(build(keep), keep.length)) return keep;
  }
  return [];
}

const callKey = (receiver, method) => `${String(receiver).toLowerCase()}\0${String(method)}`;

/**
 * The pairs a row can lose without losing a shop, in the order to lose them. Every entry
 * names its cost to the visitor, because dropping one is a real trade and the page says so.
 *
 * The row is 2000 bytes and each shop takes a slice, so a visitor adding the fourth or fifth
 * shop runs out of room. Dropping a shop breaks something they just asked for; dropping one
 * of these does not. Measured on 2026-11-07: with this trim a four-shop row lands at 1993
 * bytes locked, and without it the same row was refused ERR_ROW_TOO_BIG (see
 * `ROW_FIXED_BYTES` for the four failed and successful shapes).
 */
export const OPTIONAL_CALL_PAIRS = [
  { receiver: 'wrap.near', method: 'storage_deposit', why: 'registers the board to receive wNEAR' },
  { receiver: 'board.nearcarta.near', method: 'stamp', why: 'Ask charter: the board returns that NEAR to your row' },
  // No `townhall ft_transfer` here on purpose. It looks optional because it is a plain
  // `ft_transfer`, but it is the only pair that reaches the Town Hall, so dropping it removes
  // a shop the visitor named. A test pins that every named shop survives the trim.
];

/**
 * Trim OPTIONAL_CALL_PAIRS until the list fits next to `receivers` receivers.
 * Returns the kept list and what was dropped, so a page can say what it traded away.
 */
export function dropOptionalPairs(calls, receivers) {
  let list = [...(calls || [])];
  const dropped = [];
  for (const opt of OPTIONAL_CALL_PAIRS) {
    if (callsFitRow(list, receivers)) break;
    const at = list.findIndex(c => String(c.receiver).toLowerCase() === opt.receiver && c.method === opt.method);
    if (at < 0) continue;
    list = [...list.slice(0, at), ...list.slice(at + 1)];
    dropped.push(opt);
  }
  return { calls: list, dropped, fits: callsFitRow(list, receivers) };
}

/**
 * The method each shop is actually reached on through `propose_call_as`. Paying
 * `ft_transfer` to a shop that answers on `cross` or `pay` is dead weight in the row's
 * call list, and the row has only 0.02 NEAR to share.
 *
 * - Toll's crossing is `cross` (app/design/D8_shops/js/apps.js builds it).
 * - Guard's payment is `pay` (app/src/panels/guard-board-pay.js).
 * - House needs its two session calls (shared/house/shop.js HOUSE_CALLS).
 * - Anything else keeps `ft_transfer`: townhall, arena, wrap.near, and a shop the visitor
 *   names that we do not know.
 */
export const SHOP_METHODS = {
  'toll.nearcarta.near': ['cross'],
  'guard.nearcarta.near': ['pay'],
  // The Town Hall answers on the job lifecycle, not on ft_transfer. Until Hall v2 was
  // deployed (2026-11-08) the account ran the legacy bounty code, where `post_job` did not
  // exist, so `ft_transfer` was the only honest pair. Pressing Post job in the city sent
  // `post_job` and the board refused `method_not_allowlisted`: the row allowed a method the
  // shop does not have, and the shop had a method the row did not allow.
  'townhall.nearcarta.near': ['post_job', 'bid', 'counter', 'accept', 'deliver', 'review', 'refund'],
  // House needs both session calls; Arena needs `fund` (its real method for adding to a
  // guardian's pot) as well as a plain pay. `fund` was missing, so pressing Feed in the city
  // sent a real transaction the board refused with `method_not_allowlisted` (2026-11-08).
  'house.nearcarta.near': ['house_session_check_in', 'house_session_prepare_send'],
  'arena.nearcarta.near': ['fund'],
};
/** The methods one allowed shop contributes to the call list. */
export function methodsForShop(receiver, fallback = 'ft_transfer') {
  return SHOP_METHODS[String(receiver || '').toLowerCase()] || [fallback];
}

export function callPolicy(receivers, capYocto, sessionCapYocto, method = 'ft_transfer', extra = FERRY_CALL_TARGETS) {
  // The wrap.near trio is kept first when the shop list would crowd it out.
  // A shop named wrap.near is the same ft_transfer pair the trio already has.
  const ferry = [];
  const seen = new Set();
  for (const c of extra || []) {
    const row = {
      receiver: c.receiver,
      method: c.method,
      cap: c.receiver === 'wrap.near' ? wrapCap(c.cap, capYocto) : String(c.cap || capYocto),
    };
    const k = callKey(row.receiver, row.method);
    if (seen.has(k)) continue;
    seen.add(k);
    ferry.push(row);
  }
  const reserved = ferry.slice(0, MAX_CALLS);
  const room = MAX_CALLS - reserved.length;
  const shops = [];
  for (const receiver of receivers || []) {
    // A known shop contributes only the method it answers on; anything else keeps the default.
    for (const m of methodsForShop(receiver, method)) {
      if (shops.length >= room) break;
      const row = { receiver, method: m, cap: String(capYocto) };
      const k = callKey(row.receiver, row.method);
      if (seen.has(k)) continue;
      seen.add(k);
      shops.push(row);
    }
  }
  return {
    calls: [...shops, ...reserved],
    session_cap: String(sessionCapYocto),
  };
}

// The live accept, in yocto-free NEAR strings. One allowed payment, then three refusals.
// open attaches a little more than row storage plus the spendable balance; close_charter returns it.
export const SESSION_BEATS = {
  shop: 'townhall.nearcarta.near',
  hours: 1,
  method: 'ft_transfer',
  perActionNear: '0.002',
  dailyNear: '0.005',
  minNear: '0.0001',
  fundNear: '0.002',
  openDepositNear: '0.012',
  callsDepositNear: '0.005',
  allowedNear: '0.001',
  overNear: '0.003',
  expect: ['allowed', 'over_per_action_cap', 'frozen', 'clause_expired'],
};

/**
 * A function-call key is ready when method_names is empty (any method) or includes every
 * method in the session scope. A key that only names propose, propose_call and
 * propose_call_as is stale: the shops' hold path needs confirm_hold in the list too.
 * Readiness follows SESSION_METHODS so /setup and the shops cannot disagree.
 * https://docs.near.org/protocol/accounts-contracts/access-keys#function-call-keys
 */
export function agentMethodsReady(methodNames, required = SESSION_METHODS) {
  const names = Array.isArray(methodNames) ? methodNames : [];
  if (!names.length) return true;
  return required.every(m => names.includes(m));
}

/** Board FunctionCall keys from view_access_key_list, split into ready vs stale. */
export function classifyBoardAgentKeys(keys, boardContract, required = SESSION_METHODS) {
  const board = [];
  for (const row of keys || []) {
    const fc = row?.access_key?.permission?.FunctionCall;
    if (!fc || fc.receiver_id !== boardContract) continue;
    const methodNames = Array.isArray(fc.method_names) ? fc.method_names : [];
    board.push({
      publicKey: row.public_key,
      methodNames,
      ready: agentMethodsReady(methodNames, required),
      allowance: fc.allowance ?? null,
    });
  }
  const ready = board.filter(k => k.ready);
  const stale = board.filter(k => !k.ready);
  return { board, ready, stale, needsRenew: stale.length > 0 && ready.length === 0 };
}

/**
 * Wallet-selector actions for one approval on the visitor account:
 * DeleteKey every stale board FunctionCall key, then AddKey the new one.
 * Same receiver (the account). Actions run in order; one failure rolls all back.
 * https://docs.near.org/protocol/transactions/transaction-anatomy#actions
 */
export function renewAgentKeyActions({
  stalePublicKeys = [],
  newPublicKey,
  boardContract,
  methodNames = SESSION_METHODS,
  allowance = GAS_ALLOWANCE_YOCTO,
} = {}) {
  if (!newPublicKey || !boardContract) throw new Error('renew needs a public key and the board contract');
  const seen = new Set();
  const dels = [];
  for (const pk of stalePublicKeys) {
    if (!pk || seen.has(pk) || pk === newPublicKey) continue;
    seen.add(pk);
    dels.push({ type: 'DeleteKey', params: { publicKey: pk } });
  }
  return [
    ...dels,
    {
      type: 'AddKey',
      params: {
        publicKey: newPublicKey,
        accessKey: {
          permission: {
            receiverId: boardContract,
            methodNames: [...methodNames],
            allowance: String(allowance),
          },
        },
      },
    },
  ];
}
