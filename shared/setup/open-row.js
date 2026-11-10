// The two transactions that open a visitor's row on the board.
// One is sent to the board: `open_charter` writes the rules and the agent key, and
// `set_calls` writes the shop allowlist. The other stays on the visitor's own account:
// it adds the function-call access key that lets the agent ask without a wallet popup.
// The key is limited to SESSION_METHODS on the board and carries a gas allowance only.
// Source: contracts/charter_board/src/lib.rs open_charter, set_calls, MAX_ROW_YOCTO.
// https://docs.near.org/protocol/accounts-contracts/access-keys
import { SESSION_METHODS } from '../board/session.js';

/**
 * @param {object} o
 * @param {string} o.accountId            the visitor, who signs the key transaction
 * @param {string} o.contract             the board account (board.nearcarta.near)
 * @param {object} o.rules                `ruleArgs()` output, the rules written on chain
 * @param {string} o.agentPublicKey       the key this browser keeps
 * @param {string} o.fundYocto            spendable balance kept in the row
 * @param {string} o.rowDepositYocto      the board's MAX_ROW_YOCTO
 * @param {string} o.callsDepositYocto    what set_calls may use for storage
 * @param {string} o.gasOpen              gas for open_charter, in yocto
 * @param {string} o.gasAgent             gas for set_calls and for the key add
 * @param {string[]} [o.methodNames]      defaults to SESSION_METHODS
 * @param {string} o.allowance            gas allowance for the agent key, in yocto
 * @returns {{ open: object, key: object }}
 */
export function openRowTransactions({
  accountId,
  contract,
  rules,
  agentPublicKey,
  fundYocto,
  rowDepositYocto,
  callsDepositYocto,
  calls,
  effects,
  gasOpen,
  gasAgent,
  methodNames = SESSION_METHODS,
  allowance,
}) {
  if (!accountId || !contract || !agentPublicKey) throw new Error('open row needs an account, the board and a key');
  if (!rules || !Array.isArray(rules.receivers) || !rules.receivers.length) throw new Error('open row needs at least one receiver');
  if (!Array.isArray(calls) || !calls.length) throw new Error('open row needs the call allowlist');
  const open = {
    receiverId: contract,
    actions: [
      {
        type: 'FunctionCall',
        params: {
          methodName: 'open_charter',
          args: { rules, agent: agentPublicKey, fund: String(fundYocto) },
          gas: String(gasOpen),
          deposit: String(rowDepositYocto),
        },
      },
      {
        type: 'FunctionCall',
        params: {
          methodName: 'set_calls',
          args: { calls, session_cap: String(rules.daily_budget) },
          gas: String(gasAgent),
          deposit: BigInt(callsDepositYocto || 0) > 0n ? String(callsDepositYocto) : '1', // board B4: never 0
        },
      },
    ],
  };
  // A ferry crossing reserves an effect budget before the board calls the toll, so a row
  // without one is refused ERR_EFFECT after the wallet has approved. `set_calls` has just
  // charged the 600-byte SIDE RESERVE for exactly this kind of write, and a first cap costs
  // 351 bytes of it, so this rides along in the same approval at no extra cost. It comes
  // after `set_calls` because that is what creates the reserve.
  // Left out when the caller passes no effects (a row that will never move a foreign asset).
  if (Array.isArray(effects) && effects.length) {
    open.actions.push({
      type: 'FunctionCall',
      params: {
        methodName: 'set_effects',
        args: { effects },
        gas: String(gasAgent),
        deposit: '1', // the board refuses 0 on loosening calls (B4); the yocto is refunded
      },
    });
  }
  const key = {
    receiverId: accountId,
    actions: [{
      type: 'AddKey',
      params: {
        publicKey: agentPublicKey,
        accessKey: {
          permission: { receiverId: contract, methodNames: [...methodNames], allowance: String(allowance) },
        },
      },
    }],
  };
  return { open, key };
}
