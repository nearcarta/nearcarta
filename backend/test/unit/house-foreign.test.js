import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FOREIGN_SIGNER_METHOD, vaultPath, foreignAddressOk, signRequest, claimFor, signerReadyFromExports,
} from '../../../app/src/house-foreign.js';
import { derivedFor, signerShipped } from '../../src/house-views.js';

const BASE = '0x' + '1'.repeat(40);

test('the deed path is fixed by the token, so a transfer cannot move the coins', () => {
  assert.equal(vaultPath('alice.near', 'base'), 'alice.near-base-1');
  assert.equal(vaultPath('alice.near', 'BTC'), 'alice.near-btc-1');
  assert.throws(() => vaultPath('alice.near', 'sol'), /base or btc/);
  assert.throws(() => vaultPath('', 'base'), /no deed/);
});

test('the sign request names the interface Toll must implement', () => {
  const req = signRequest({ tokenId: 'alice.near', chain: 'base', to: BASE, asset: 'native', value: '1000', gasLimit: 21000, actionId: 'a1' });
  assert.equal(req.method, FOREIGN_SIGNER_METHOD);
  assert.equal(req.method, 'sign_effect');
  assert.equal(req.path, 'alice.near-base-1');
  assert.equal(req.domain_id, 0);
  assert.equal(req.value, '1000');
  assert.equal(req.interface_version, 1);
  // No field may carry a key or a secret.
  assert.deepEqual(Object.keys(req).filter(k => /key|secret|seed/i.test(k)), []);
});

test('a bad address, a non-integer value and a bitcoin value are refused before signing', () => {
  assert.equal(foreignAddressOk('base', BASE), true);
  assert.equal(foreignAddressOk('base', '0x1234'), false);
  assert.equal(foreignAddressOk('btc', 'bc1qexampleaddress'), true);
  assert.equal(foreignAddressOk('btc', BASE), false);
  assert.throws(() => signRequest({ tokenId: 'a.near', chain: 'base', to: 'nope', value: '1', actionId: 'x' }), /0x base/);
  assert.throws(() => signRequest({ tokenId: 'a.near', chain: 'base', to: BASE, value: '1.5', actionId: 'x' }), /integer/);
  assert.throws(() => signRequest({ tokenId: 'a.near', chain: 'btc', to: 'bc1qexampleaddress', value: '1', actionId: 'x' }), /signing only/);
  const zero = signRequest({ tokenId: 'a.near', chain: 'btc', to: 'bc1qexampleaddress', value: '0', actionId: 'x' });
  assert.equal(zero.value, '0');
});

test('nothing claims a live vault until Toll exports the signer', () => {
  assert.equal(signerReadyFromExports(['cross', 'sign_cross', 'on_signed']), false);
  assert.equal(signerReadyFromExports(['cross', 'sign_effect']), true);
  assert.equal(signerReadyFromExports(null), false);

  const held = { action_id: 'a1', chain: 'base', to: BASE, asset: 'native', value: '1000', live: false };
  const notShipped = claimFor({ prepared: held, signerReady: false });
  assert.equal(notShipped.live, false);
  assert.match(notShipped.note, /not a spend/);
  const shipped = claimFor({ prepared: held, signerReady: true });
  assert.equal(shipped.live, true);
  assert.match(shipped.note, /second key confirms/);
  assert.equal(claimFor({ prepared: null, signerReady: true }).live, false);
});

test('the derived view reports why it is not live, instead of a bare false', async () => {
  const { derivationRequest } = await import('../../../app/src/house-derive.js');
  const view = async () => null;
  const body = await derivedFor('alice.near', view, { ready: false, toll: 'toll.nearcarta.near', why: 'not shipped' });
  assert.equal(body.live, false);
  assert.equal(body.toll, 'toll.nearcarta.near');
  assert.match(body.why, /not shipped/);
  assert.match(body.why, /does not control it/);
  // Both chains still report the path and the predecessor, so a reader can see what would be signed.
  assert.equal(body.rows.length, 2);
  assert.equal(body.rows[0].path, derivationRequest('alice.near', 'eth').path);
  const on = await derivedFor('alice.near', view, { ready: true, toll: 'toll.nearcarta.near', why: 'sign_effect is exported' });
  assert.equal(on.live, true);
  assert.match(on.why, /sign_effect/);
});

test('signerShipped reads the exports and treats an unreadable account as not shipped', async () => {
  const fake = exports => async () => {
    // A minimal wasm with just an export section is built by house-recover.js's parser;
    // here we stub the parser input by returning a real wasm byte string.
    const { wasmExports } = await import('../../../scripts/house-recover.js');
    return { code_base64: Buffer.from(exports).toString('base64'), __parse: wasmExports };
  };
  const none = await signerShipped(async () => { throw new Error('rpc down'); }, 'toll.nearcarta.near');
  assert.equal(none.ready, false);
  assert.match(none.why, /rpc down/);
  const missing = await signerShipped(async () => ({ code_base64: '' }), 'toll.nearcarta.near');
  assert.equal(missing.ready, false);
  const noToll = await signerShipped(async () => ({}), '');
  assert.equal(noToll.ready, false);
});
