// Chain-signature path for a house deed.
// The signer view is derived_public_key on v1.signer.
// domain_id 0 is secp256k1 (Ethereum and Bitcoin). domain 1 is Ed25519, not Bitcoin.
// https://docs.near.org/chain-abstraction/chain-signatures
// https://docs.near.org/chain-abstraction/chain-signatures/implementation
// The predecessor is the house contract, so the address stays when the deed moves.
// https://docs.near.org/chain-abstraction/chain-signatures/tutorials/controlling-near-accounts/1-setup
// The address is keccak256 of the 64-byte key, last 20 bytes (same as toll-derive).
// The live house contract does not call the signer. This module does not sign.

import { addressFromKey } from './toll-derive.js';
import { HOUSE_LEGACY, HOUSE_SHOP } from './house-shop.js';

export const SIGNER_ACCOUNT = 'v1.signer';
// Predecessor for a Toll signature is the successor shop, not the legacy account.
// Toll must expose one function this contract can call. The predecessor is HOUSE_CONTRACT
// (extras.house.shop). The path is `{token_id}-eth-1` or `{token_id}-btc-1`. domain_id is 0.
// The argument is the effect { chain, to, asset, value, gas_limit }. It returns a receipt.
// live stays false until Toll ships that function. The shop does not wait on it.
export const HOUSE_CONTRACT = HOUSE_SHOP;
export const HOUSE_LEGACY_CONTRACT = HOUSE_LEGACY;

/** Args for one unsigned view. Predecessor is the house contract, not the current holder. */
export function derivationRequest(tokenId, chain, predecessor = HOUSE_CONTRACT) {
  const id = String(tokenId || '').trim();
  const which = chain === 'btc' ? 'btc' : 'eth';
  return {
    chain: which,
    path: `${id}-${which}-1`,
    predecessor: predecessor || HOUSE_CONTRACT,
    domain_id: 0,
    method: 'derived_public_key',
    account: SIGNER_ACCOUNT,
    live: false,
  };
}

/** Turn a signer public key into a display row. Bitcoin address bytes are not claimed. */
export function readDerivedKey(publicKey, chain) {
  const key = String(publicKey || '').trim();
  if (chain === 'btc') {
    return {
      public_key: key,
      address: null,
      note: 'Bitcoin uses this secp256k1 key (domain 0). Signing only. This page does not print a Bitcoin address.',
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
      note: 'Ethereum address is the last 20 bytes of keccak256 of the 64-byte key. The path stays with the deed. The live contract does not call the signer.',
    };
  } catch {
    return { public_key: key, address: null, note: 'The key could not be read.' };
  }
}
