// The visitor's confirm key. A held Arena attack (and a held Guard warning) is released
// only by a signature from this key, and the board refuses to store any key equal to the
// row's agent key (`set_confirm_key` requires `pk != agent`). This module is the other half
// of that rule: the key lives in its own browser slot, and the AI agent path never reads
// that slot, so a model that asks to confirm has nothing to sign with.
//
// It signs exactly one board method, `confirm_hold`, and nothing else. It is not an agent
// key: it cannot propose, and it is not stored where the agent key is stored.
// contracts/charter_board/src/v2.rs set_confirm_key, confirm_hold.
// docs.near.org/protocol/accounts-contracts/access-keys
import { CONFIRM_KEY_METHODS, confirmKeyIsAgent } from '../../shared/board/session.js';

/** Where the confirm secret lives. Distinct from AGENT_LS, which the agent reads. */
export const confirmLS = accountId => 'nearcarta.vault.confirm.' + accountId;

/** True when this browser already holds a confirm key for the account. */
export function hasConfirmKey(accountId, store = globalThis.localStorage) {
  try { return !!store?.getItem(confirmLS(accountId)); } catch { return false; }
}

/**
 * The key pair to register. `makeKey` is injected (the setup page passes its ed25519
 * generator) so this file stays free of crypto choices and is testable offline.
 * Refuses to hand back the agent key: that is the one shape the board would reject.
 */
export function confirmKeyFor(accountId, { agentSecret, makeKey, store = globalThis.localStorage }) {
  if (!accountId) throw new Error('confirm key needs an account');
  if (typeof makeKey !== 'function') throw new Error('confirm key needs a key generator');
  let existing = null;
  try { existing = store?.getItem(confirmLS(accountId)); } catch { existing = null; }
  const secret = existing || makeKey().secretKey;
  if (confirmKeyIsAgent(secret, agentSecret)) throw new Error('ERR_CONFIRM: the confirm key may not be the agent key');
  return secret;
}

/**
 * The board call that registers the confirm public key on the visitor's own row.
 * `set_confirm_key` takes the public key as a string and is predecessor == owner, so the
 * visitor's wallet signs it. It charges the row only for the storage it writes.
 */
export function setConfirmKeyAction(publicKey) {
  if (!/^ed25519:[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(String(publicKey || ''))) throw new Error('set_confirm_key needs an ed25519 public key');
  return {
    type: 'FunctionCall',
    params: {
      methodName: 'set_confirm_key',
      args: { key: String(publicKey) },
      gas: '30000000000000',
      deposit: '0',
    },
  };
}

/** The method list the confirm key may sign. One method, never the agent scope. */
export const CONFIRM_SCOPE = Object.freeze([...CONFIRM_KEY_METHODS]);
