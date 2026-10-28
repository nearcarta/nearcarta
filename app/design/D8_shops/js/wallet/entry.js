// Shop wallet bridge: re-exports the site wallet layer (app/shops/vault/wallet.js) and the shared signer unchanged.
// app/build.mjs bundles this file into js/wallet.bundle.js.
export { makeConnector, currentAccount, txHashOf, hasGuest, forgetGuest } from '../../../../shops/vault/wallet.js';
export { rpcClient, viewFn, keyFrom, sendPropose } from '../../../../../shared/vault/tx.js';
export { runSteps } from '../../../../../shared/vault/run.js';
export { ATTACKS } from '../../../../../shared/vault/attacks.js';
import { sha256 } from '@noble/hashes/sha2.js';
export const sha256hex = s => Array.from(sha256(new TextEncoder().encode(s)), b => b.toString(16).padStart(2, '0')).join('');
