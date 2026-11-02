import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGuest, _reset } from '../../src/guest.js';
import { keyFrom } from '../../../shared/vault/tx.js';
const sponsor = { account: 'fund.testnet', key: keyFrom() }, pk = keyFrom().publicKey;
const rpc = (exists = false, fail = false) => async (m, p) => {
  if (m === 'query' && p.request_type === 'view_account') { if (exists) return {}; throw new Error('no'); }
  if (m === 'query') return { nonce: 5, block_hash: '11111111111111111111111111111111' };
  return fail ? { status: { Failure: {} } } : { status: { SuccessValue: '' } };
};
test('creates a guest through the testnet registrar', async () => { _reset();
  const r = await createGuest({ account_id: 'ncguest-abc123.testnet', public_key: pk }, { rpc: rpc(), sponsor, network: 'testnet' });
  assert.equal(r.account_id, 'ncguest-abc123.testnet'); assert.ok(r.tx); });
test('refuses bad names, mainnet, existing accounts, no sponsor', async () => { _reset();
  await assert.rejects(createGuest({ account_id: 'alice.testnet', public_key: pk }, { rpc: rpc(), sponsor, network: 'testnet' }), { status: 400 });
  await assert.rejects(createGuest({ account_id: 'ncguest-abc123.testnet', public_key: pk }, { rpc: rpc(), sponsor, network: 'mainnet' }), { status: 404 });
  await assert.rejects(createGuest({ account_id: 'ncguest-abc123.testnet', public_key: pk }, { rpc: rpc(true), sponsor, network: 'testnet' }), { status: 409 });
  await assert.rejects(createGuest({ account_id: 'ncguest-abc123.testnet', public_key: pk }, { rpc: rpc(), sponsor: null, network: 'testnet' }), { status: 503 }); });
test('daily cap', async () => { _reset(); process.env.GUEST_DAY_CAP = '1';
  await createGuest({ account_id: 'ncguest-aaaaaa.testnet', public_key: pk }, { rpc: rpc(), sponsor, network: 'testnet' });
  await assert.rejects(createGuest({ account_id: 'ncguest-bbbbbb.testnet', public_key: pk }, { rpc: rpc(), sponsor, network: 'testnet' }), { status: 429 });
  delete process.env.GUEST_DAY_CAP; });
