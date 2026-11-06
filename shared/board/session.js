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
export const CALLS_DEPOSIT_YOCTO = (15n * 10n ** 21n).toString();

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

// A board row holds MAX_ROW_YOCTO (0.02 NEAR = 2000 bytes) of storage, and v2 bills
// the real trie bytes. The call list is the row's largest part, so how many shops fit
// depends on how long their account ids are. Measured on the committed wasm in
// `contracts/charter_board_sandbox/tests/setup_calls_deposit.rs`: seven 20-byte shops
// locked 0.01967 NEAR and eight failed ERR_ROW_TOO_BIG; six 32-byte shops locked
// 0.01984 and seven failed; five 48-byte shops locked 0.01997 and six failed; four
// 56-byte shops locked 0.01946 and five failed.
// A row costs about 501 bytes and the fixed side record takes the rest, leaving about
// 600 bytes for the pairs. Each pair adds the receiver, the method and a 16-byte cap,
// which is `receiver.length + method.length + 24`; the budget counts the wrap.near
// trio, the board stamp and the House shop's two calls too, with the 20-byte production
// board id. Measured in `contracts/charter_board_sandbox/tests/setup_calls_deposit.rs`:
// 5 shops of 20 bytes fit (597) and 6 do not (652); 4 of 26 fit (562) and 5 do not (622);
// 4 of 33 fit (590) and 5 do not (657); 3 of 41 fit (547) and 4 do not (622); 3 of 49 fit
// (571) and 4 do not (654); 3 of 57 fit (595) and 4 do not (686). 602 keeps that one byte
// of headroom below the first refusal.
export const MAX_PAIR_BYTES = 602;

/** Trie bytes one (receiver, method) pair adds to the row. */
export function callPairBytes(receiver, method) {
  return String(receiver).length + String(method).length + 24;
}

/**
 * True when this call list fits the row's 0.02 NEAR of storage.
 * The deposit does not decide this: ERR_ROW_TOO_BIG does, and the page should stop
 * before it sends. The budget was measured with the wrap.near trio and the stamp on
 * the same row, which is what `callPolicy` always puts there.
 */
export function callsFitRow(calls) {
  return (calls || []).reduce((n, c) => n + callPairBytes(c.receiver, c.method), 0) <= MAX_PAIR_BYTES;
}

const callKey = (receiver, method) => `${String(receiver).toLowerCase()}\0${String(method)}`;

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
    if (shops.length >= room) break;
    const row = { receiver, method, cap: String(capYocto) };
    const k = callKey(receiver, method);
    if (seen.has(k)) continue;
    seen.add(k);
    shops.push(row);
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
 * A function-call key is ready when method_names is empty (any method) or
 * includes every required agent method. Propose-only keys are stale for Ferry.
 * https://docs.near.org/protocol/accounts-contracts/access-keys#function-call-keys
 */
export function agentMethodsReady(methodNames, required = AGENT_METHODS) {
  const names = Array.isArray(methodNames) ? methodNames : [];
  if (!names.length) return true;
  return required.every(m => names.includes(m));
}

/** Board FunctionCall keys from view_access_key_list, split into ready vs stale. */
export function classifyBoardAgentKeys(keys, boardContract, required = AGENT_METHODS) {
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
  methodNames = AGENT_METHODS,
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
