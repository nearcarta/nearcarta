// The shared foreign-signer interface. Toll owns it; any shop calls it.
//
// A caller (House today) asks one question: for this owner and chain, what foreign
// address does the signer derive, and can this shop ask Toll to sign for it?
//
// The answer is a plain read: `derived_public_key` on v1.signer with the toll contract
// as the predecessor and the row path. Toll does not hold a key and does not sign here.
// Signature requests go through the same per-row order a visitor's crossing uses:
// `cross` opens it (the board authenticates the owner), `sign_cross` signs it, and the
// raw transaction is broadcast by the keyless relay. So this module exposes the address
// and the capability, and deliberately cannot produce a signature by itself.
//
// Interface version 1. A shop that pins a version fails loudly rather than guessing.
import { addressFromKey } from '../../app/src/toll-derive.js';

export const SIGNER = 'v1.signer';
export const SIGNER_VERSION = 1;
/** The toll contract is the predecessor, so the address stays with that contract. */
export const SIGNER_CONTRACT = 'toll.nearcarta.near';
export const DOMAIN_SECP256K1 = 0;

/** The row path for one owner. Same path the toll's `cross` and `sign_cross` use. */
export function rowPath(owner) {
  const id = String(owner || '').trim();
  return id ? `row:${id}:base` : '';
}

/**
 * What a caller passes to the signer view. `predecessor` is the toll contract, not the
 * caller: the address belongs to the toll, and a house deed reads it, it does not own it.
 */
export function signerRequest(owner, { contract = SIGNER_CONTRACT } = {}) {
  const path = rowPath(owner);
  if (!path) return { ok: false, hint: 'Name an owner account. Nothing was signed.' };
  return {
    ok: true,
    version: SIGNER_VERSION,
    account: SIGNER,
    method: 'derived_public_key',
    args: { path, predecessor: contract, domain_id: DOMAIN_SECP256K1 },
    path,
    predecessor: contract,
  };
}

/** Turn the signer's answer into an address, or say why there is none yet. */
export function readSignerKey(publicKey) {
  const key = String(publicKey || '').trim();
  if (!key) {
    return { address: null, public_key: '', hint: 'The signer returned no key for this path yet.' };
  }
  if (!key.startsWith('secp256k1:')) {
    return { address: null, public_key: key, hint: 'The signer did not return a secp256k1 key.' };
  }
  try {
    const got = addressFromKey(key);
    if (got.bytes !== 64) return { address: null, public_key: key, hint: 'The public key was not 64 bytes.' };
    return { address: got.address, public_key: key, hint: '' };
  } catch {
    return { address: null, public_key: key, hint: 'The key could not be read.' };
  }
}

/**
 * One call a shop makes. Returns the address and whether a crossing can be opened for it.
 * `live` is true only when the signer answered with a usable key: the address is then the
 * same one the toll will sign for, because it is the same path and the same contract.
 * `live` false is an honest "not yet", never a fabricated address.
 */
export async function foreignAddress(owner, viewFn, { contract = SIGNER_CONTRACT } = {}) {
  const req = signerRequest(owner, { contract });
  if (!req.ok) return { version: SIGNER_VERSION, owner, live: false, address: null, hint: req.hint, request: null };
  let publicKey = '';
  let error = '';
  try {
    publicKey = await viewFn(req.account, req.method, req.args);
  } catch (e) {
    error = String(e?.message || e).slice(0, 180);
  }
  const read = readSignerKey(publicKey);
  // A crossing needs the derived key and a row on the board; the address alone is enough
  // for a shop to show it. `methods` says the toll path exists, not that a tx was sent.
  return {
    version: SIGNER_VERSION,
    owner,
    contract,
    path: req.path,
    public_key: read.public_key,
    address: read.address,
    live: !!read.address,
    error: error || undefined,
    hint: read.hint,
    // The methods a caller uses. There is no "sign" here: the per-row order is the way.
    methods: { open: 'cross', sign: 'sign_cross', cancel: 'cancel_order', refund: 'refund_order' },
    caveat: 'The toll signs one stored order at a time for this row. This read creates no order and no signature.',
  };
}
