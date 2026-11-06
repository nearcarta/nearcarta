// Unsigned reads for Your House. No key, no broadcast.
// derived_public_key: https://github.com/near/mpc (v1.signer, domain_id 0)
// A missing house_line means the live deed has not grown the inheritance methods.

import { derivationRequest, readDerivedKey } from '../../app/src/house-derive.js';

export async function derivedFor(owner, viewFn) {
  const chains = ['eth', 'btc'];
  const rows = [];
  for (const chain of chains) {
    const req = derivationRequest(owner, chain);
    try {
      const publicKey = await viewFn(req.account, req.method, {
        path: req.path,
        predecessor: req.predecessor,
        domain_id: req.domain_id,
      });
      const read = readDerivedKey(publicKey, chain);
      rows.push({ ...req, ...read });
    } catch (e) {
      rows.push({
        ...req,
        public_key: '',
        address: null,
        note: String(e?.message || e).slice(0, 180),
      });
    }
  }
  return { signer: 'v1.signer', owner, predecessor: owner, rows };
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
