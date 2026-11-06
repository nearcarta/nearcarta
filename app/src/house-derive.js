// Chain-signature paths for a house deed.
// The signer view is derived_public_key on v1.signer.
// domain_id 0 is secp256k1 (Ethereum and Bitcoin).
// https://docs.near.org/chain-abstraction/chain-signatures
// https://github.com/near/mpc/blob/main/crates/contract/src/api/keys.rs
// The address is keccak256 of the 64-byte key, last 20 bytes (same as toll-derive).
// This module does not sign.

import { addressFromKey } from './toll-derive.js';

export const SIGNER_ACCOUNT = 'v1.signer';

/** Args for one unsigned view. Predecessor is the owner's account. */
export function derivationRequest(owner, chain) {
  const id = String(owner || '').trim();
  const which = chain === 'btc' ? 'btc' : 'eth';
  return {
    chain: which,
    path: `${id}-${which}-1`,
    predecessor: id,
    domain_id: 0,
    method: 'derived_public_key',
    account: SIGNER_ACCOUNT,
  };
}

/** Turn a signer public key into a display row. Bitcoin address bytes are not claimed. */
export function readDerivedKey(publicKey, chain) {
  const key = String(publicKey || '').trim();
  if (chain === 'btc') {
    return {
      public_key: key,
      address: null,
      note: 'Bitcoin uses this secp256k1 key (domain 0). This page does not print a Bitcoin address.',
    };
  }
  if (!key.startsWith('secp256k1:')) {
    return { public_key: key, address: null, note: 'The signer did not return a secp256k1 key.' };
  }
  try {
    const got = addressFromKey(key);
    if (got.bytes !== 64) return { public_key: key, address: null, note: 'The public key was not 64 bytes.' };
    return {
      public_key: key,
      address: got.address,
      note: 'Ethereum address is the last 20 bytes of keccak256 of the 64-byte key. Predecessor is your account.',
    };
  } catch {
    return { public_key: key, address: null, note: 'The key could not be read.' };
  }
}
