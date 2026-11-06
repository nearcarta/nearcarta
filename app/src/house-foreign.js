// House's side of the foreign signer. Toll owns the signature; this module only
// builds the request and decides what the deferred-live state is allowed to claim.
//
// The interface is docs/internal/house-foreign-signer.md, version 1. Nothing here
// pretends Toll has shipped it: `signerReady` is read from chain, and when it is
// false the vault is not described as controlled.
//
// https://docs.near.org/chain-abstraction/chain-signatures/tutorials/controlling-near-accounts/1-setup

export const FOREIGN_SIGNER_VERSION = 1;
/** The one method Toll must export. A contract calls it; a person cannot. */
export const FOREIGN_SIGNER_METHOD = 'sign_effect';
export const FOREIGN_SIGNER_DOMAIN_ID = 0;

/** The deed's stable path. The holder cannot choose it, so a transfer cannot move the coins. */
export function vaultPath(tokenId, chain) {
  const id = String(tokenId || '').trim();
  const c = String(chain || '').trim().toLowerCase();
  if (!id) throw new Error('no deed');
  if (c !== 'base' && c !== 'btc') throw new Error('chain must be base or btc');
  return `${id}-${c}-1`;
}

/** Base addresses are 0x + 40 hex. Bitcoin is bech32; only a shape check, never a derivation. */
export function foreignAddressOk(chain, to) {
  const s = String(to || '').trim();
  if (String(chain).toLowerCase() === 'base') return /^0x[0-9a-fA-F]{40}$/.test(s);
  return /^(bc1|tb1)[a-z0-9]{8,87}$/.test(s);
}

/** The request Toll must answer. Bitcoin with a value is refused here, before anything is sent. */
export function signRequest({ tokenId, chain, to, asset, value, gasLimit, actionId }) {
  const c = String(chain || '').toLowerCase();
  const v = String(value ?? '0');
  if (!/^\d+$/.test(v)) throw new Error('value must be an integer in the asset unit');
  if (c === 'btc' && BigInt(v) > 0n) throw new Error('Bitcoin is signing only: this house does not broadcast a value');
  if (!foreignAddressOk(c, to)) throw new Error('name a ' + (c === 'btc' ? 'bech32 bitcoin' : '0x base') + ' address');
  if (!actionId) throw new Error('no action id');
  const assetName = String(asset || (c === 'btc' ? 'BTC' : 'native'));
  return {
    interface_version: FOREIGN_SIGNER_VERSION,
    method: FOREIGN_SIGNER_METHOD,
    path: vaultPath(tokenId, c),
    chain: c,
    to: String(to).trim(),
    asset: assetName,
    value: v,
    gas_limit: Number(gasLimit || 0),
    action_id: String(actionId),
    domain_id: FOREIGN_SIGNER_DOMAIN_ID,
  };
}

/**
 * What a prepared send may claim. `prepared.live` is set by the house contract and
 * stays false until a signer exists. This mirrors that, so the UI cannot say more.
 */
export function claimFor({ prepared, signerReady }) {
  if (!prepared) return { live: false, label: 'none', note: 'No send is prepared. Nothing was signed.' };
  if (!signerReady) {
    return {
      live: false, label: 'held',
      note: 'Held on the board. The signer has not shipped, so this is not a spend and no address is claimed.',
    };
  }
  return {
    live: true, label: 'held',
    note: 'Held on the board. A second key confirms it before the signer is asked to sign.',
  };
}

/** Does the live Toll contract export the interface? A view, never a guess. */
export function signerReadyFromExports(exports) {
  return Array.isArray(exports) && exports.includes(FOREIGN_SIGNER_METHOD);
}
