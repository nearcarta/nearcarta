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

export const AGENT_METHODS = ['propose', 'propose_call'];
export const SESSION_HOURS = [1, 2, 24];
// 0.05 NEAR of gas. The key cannot spend it as a transfer.
export const GAS_ALLOWANCE_YOCTO = (10n ** 24n / 20n).toString();
// Prepaid gas for a silent board propose. 30 Tgas covers propose plus the 8 Tgas
// on_paid callback (measured use is about 4.67 Tgas). 80 Tgas is bought for ~0.081
// NEAR and exceeds this allowance. The 0.005 stamp is a contract argument, not a deposit.
export const BOARD_PROPOSE_TGAS = 30;
// Method name + JSON of the live Ferry propose that returned NotEnoughAllowance.
export const FERRY_PROPOSE_BYTES = 310;

/** Yocto the session key must have free for one board propose at this gas. */
export function boardProposeAllowanceYocto(tgas = BOARD_PROPOSE_TGAS, numBytes = FERRY_PROPOSE_BYTES) {
  return functionCallAllowanceCost({ tgas, numBytes });
}
// Storage for the call allowlist. Unused yocto is refunded by charge_len.
export const CALLS_DEPOSIT_YOCTO = (10n ** 24n / 200n).toString();

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

export function callPolicy(receivers, capYocto, sessionCapYocto, method = 'ft_transfer', extra = FERRY_CALL_TARGETS) {
  const shop = receivers.map(receiver => ({ receiver, method, cap: String(capYocto) }));
  const ferry = (extra || []).map(c => ({ receiver: c.receiver, method: c.method, cap: String(c.cap || capYocto) }));
  return {
    calls: [...shop, ...ferry],
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
