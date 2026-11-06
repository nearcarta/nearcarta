// Unsigned reads for Your House. No key, no broadcast.
// derived_public_key: https://github.com/near/mpc (v1.signer, domain_id 0)
// A missing house_line means the live deed has not grown the inheritance methods.
//
// The foreign address comes from the shared signer interface in shared/toll/signer.js.
// Toll owns it, so the address House shows is the same path Toll signs for, not a second
// derivation that could disagree. Toll signs one stored order at a time; this read
// creates no order and no signature.
import { readDerivedKey } from '../../app/src/house-derive.js';
import { HOUSE_SHOP } from '../../shared/house/shop.js';
import { foreignAddress, SIGNER_VERSION } from '../../shared/toll/signer.js';

export async function derivedFor(owner, viewFn) {
  // House shows the ETH row from the shared interface, and keeps the BTC row as the
  // signer's own answer for a chain Toll does not sign.
  const shared = await foreignAddress(owner, viewFn);
  const rows = [{
    chain: 'eth',
    path: shared.path,
    predecessor: shared.contract,
    domain_id: 0,
    public_key: shared.public_key,
    address: shared.address,
    note: shared.hint || 'Ethereum address is the last 20 bytes of keccak256 of the 64-byte key.',
  }];
  try {
    const publicKey = await viewFn('v1.signer', 'derived_public_key', {
      path: `${String(owner).trim()}-btc-1`, predecessor: HOUSE_SHOP, domain_id: 0,
    });
    const read = readDerivedKey(publicKey, 'btc');
    rows.push({ chain: 'btc', path: `${String(owner).trim()}-btc-1`, predecessor: HOUSE_SHOP, domain_id: 0, ...read });
  } catch (e) {
    rows.push({ chain: 'btc', path: `${String(owner).trim()}-btc-1`, predecessor: HOUSE_SHOP, public_key: '', address: null, note: String(e?.message || e).slice(0, 180) });
  }
  const eth = rows[0];
  return {
    signer: 'v1.signer',
    version: SIGNER_VERSION,
    owner,
    predecessor: shared.contract,
    // Live means the signer returned a usable key for this row: the address House shows
    // is the one Toll will sign for, because it is the same path and the same contract.
    live: !!shared.live,
    why: shared.live
      ? 'The signer derived this row\'s address. Toll signs one stored order at a time for it; this page creates no order and no signature.'
      : shared.hint || 'The signer has no key for this row yet. Nothing was signed.',
    // The toll methods a caller uses to move funds. There is no signer key here.
    methods: shared.methods,
    rows,
  };
}

export async function lineFor(account, contract, viewFn) {
  try {
    const line = await viewFn(contract, 'house_line', { token_id: account });
    return { live: true, contract, token_id: account, line: line || null };
  } catch (e) {
    const msg = String(e?.message || e);
    return {
      live: false,
      contract,
      token_id: account,
      line: null,
      why: /MethodNotFound|unknown method|house_line/i.test(msg)
        ? 'house_line is not on this deed. The prepared contract has check-in and a cancel window. Nothing was signed.'
        : msg.slice(0, 180),
    };
  }
}
