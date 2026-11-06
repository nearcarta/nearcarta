// Unsigned reads for Your House. No key, no broadcast.
// derived_public_key: https://github.com/near/mpc (v1.signer, domain_id 0)
// A missing house_line means the live deed has not grown the inheritance methods.

import { derivationRequest, readDerivedKey } from '../../app/src/house-derive.js';
import { FOREIGN_SIGNER_METHOD, signerReadyFromExports } from '../../app/src/house-foreign.js';
import { wasmExports } from '../../scripts/house-recover.js';
import { MAINNET_DEP } from './config.js';
import { HOUSE_SHOP } from '../../shared/house/shop.js';

/** The Toll account from the deployment record. One value, not a literal. */
const TOLL = MAINNET_DEP?.toll?.contract || '';

/**
 * Whether the live Toll exports the foreign signer. Read from the contract's own
 * exported names (`view_code` is a read), never assumed. A chain that cannot be read
 * is treated as "not shipped", which is the honest default.
 */
export async function signerShipped(rpc, toll = TOLL) {
  if (!toll || typeof rpc !== 'function') return { ready: false, toll, why: 'no toll account in the record' };
  try {
    const code = await rpc('query', { request_type: 'view_code', finality: 'final', account_id: toll });
    const bytes = Buffer.from(code?.code_base64 || '', 'base64');
    const ready = signerReadyFromExports(wasmExports(bytes));
    return { ready, toll, why: ready ? FOREIGN_SIGNER_METHOD + ' is exported by ' + toll : toll + ' does not export ' + FOREIGN_SIGNER_METHOD };
  } catch (e) {
    return { ready: false, toll, why: String(e?.message || e).slice(0, 160) };
  }
}

export async function derivedFor(owner, viewFn, signer = { ready: false }) {
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
  const ready = !!signer?.ready;
  return {
    signer: 'v1.signer',
    owner,
    predecessor: rows[0]?.predecessor || HOUSE_SHOP,
    live: ready,
    toll: signer?.toll || null,
    why: ready
      ? 'Toll exports ' + FOREIGN_SIGNER_METHOD + ', so the deed\'s path can be signed for ' + (signer?.toll || 'toll') + '. A confirm key still checks every send.'
      : 'This address is the path for ' + HOUSE_SHOP + ', but no contract on ' + (signer?.toll || 'toll') + ' can sign it yet (' + (signer?.why || 'not shipped') + '). The deed does not control it, so nothing here is a vault.',
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
