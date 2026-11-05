// Live reads of the deployed mainnet contracts, 1Click dry quotes, and NEAR AI Cloud. Nothing is signed.
import { proveTee } from '../../src/tee.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAINNET_DEP, has } from '../../src/config.js';
import * as ferry from '../../src/ferry.js';
import * as ai from '../../src/ai.js';
import { accessKeys, viewAccount } from '../../src/near.js';

const UA = 'u1naczqa5m5nefpyqnhs8h3dw8un8z8us45xwgfh4ees95mayyru9snc33dkfk2dc27r5syu4uveyyd5dt8wwad89kpc3f8cah055lm0ex';
const REFUND = '0x561E8eF0FEcB621469dA30250dC6CdCD1E47A66e';
const M = MAINNET_DEP;
const accounts = [M.charter?.contract, M.toll?.contract, M.board?.contract, M.extras?.arena?.contract, M.extras?.house?.contract, M.extras?.townhall?.contract].filter(Boolean);

test('every deployed contract account exists on mainnet', async () => {
  for (const a of accounts) {
    const v = await viewAccount(a);
    assert.ok(v.code_hash && v.code_hash !== '11111111111111111111111111111111', `${a} has code`);
  }
});

test('charter, toll, arena and house hold no full-access key', async () => {
  for (const a of [M.charter.contract, M.toll.contract, M.extras.arena.contract, M.extras.house.contract]) {
    const ks = (await accessKeys(a)).keys;
    assert.equal(ks.filter(k => k.access_key.permission === 'FullAccess').length, 0, `${a} has no full-access key`);
  }
});

test('ferry: public dry quote USDC(Base) -> ZEC to an Orchard-only UA is signed and echoes', async () => {
  const q = await ferry.quote({ from: { symbol: 'USDC', chain: 'base' }, to: { symbol: 'ZEC', chain: 'zec' }, amount: '2.5', refundTo: REFUND, recipient: UA });
  assert.equal(q.ok, true, JSON.stringify(q.checks || q.error));
  assert.equal(q.zcash.shielded, true);
  assert.equal(q.checks.dry, true);
});

test('ferry: confidential (basic) dry quote with the partner key', { skip: !has.oneClick() && 'no ONECLICK_PARTNER_KEY' }, async () => {
  const q = await ferry.quote({ from: { symbol: 'USDC', chain: 'base' }, to: { symbol: 'ZEC', chain: 'zec' }, amount: '2.5', refundTo: REFUND, recipient: UA, privacy: 'basic' });
  assert.equal(q.ok, true);
  assert.equal(q.echoed.confidentiality, 'basic');
});

test('NEAR AI Cloud attestation lists at least one model signer', { skip: !has.nearAi() && 'no NEARAI_CLOUD_API_KEY' }, async () => {
  const a = await ai.attestation(process.env.NEARAI_MODEL || 'z-ai/glm-5.3-flash');
  assert.ok(a.count >= 1);
  assert.match(a.signers[0], /^[0-9a-f]{64}$/);
});

test('NEAR AI TEE preflight: gateway + model quotes verify (dcap-qvl, nonce, signer, MRCONFIGID, RTMR3, NRAS)', { skip: !has.nearAi() && 'no NEARAI_CLOUD_API_KEY' }, async () => {
  const r = await proveTee({});
  assert.equal(r.gateway.ok, true, JSON.stringify(r.gateway.checks));
  assert.ok(r.models.length >= 1);
  for (const m of r.models) { assert.equal(m.ok, true, JSON.stringify(m.checks)); if (m.gpu?.present) assert.equal(m.gpu.ok, true); }
  assert.equal(r.ok, true);
});

test('mist bank public view is a mainnet note until a mainnet payout is recorded', async () => {
  const { mistbank } = await import('../../src/mistbank.js');
  const m = await mistbank({ fresh: true });
  assert.equal(m.network, 'mainnet');
  assert.equal(m.built, false);
  assert.match(m.note, /0\.005 NEAR/);
});
