// Live tests against NEAR testnet, 1Click (dry quotes, mainnet routing, nothing spent) and NEAR AI Cloud.
import { proveTee } from '../../src/tee.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { DEP, has } from '../../src/config.js';
import * as ferry from '../../src/ferry.js';
import * as guard from '../../src/guardhouse.js';
import * as shops from '../../src/shops.js';
import * as ai from '../../src/ai.js';
import { accessKeys, viewAccount } from '../../src/near.js';

const UA = 'u1naczqa5m5nefpyqnhs8h3dw8un8z8us45xwgfh4ees95mayyru9snc33dkfk2dc27r5syu4uveyyd5dt8wwad89kpc3f8cah055lm0ex';
const REFUND = '0x561E8eF0FEcB621469dA30250dC6CdCD1E47A66e';
const proof = JSON.parse(readFileSync(new URL('../../../judges/proofs/guardhouse-demo.json', import.meta.url)));

test('every deployed contract account exists on testnet', async () => {
  for (const a of [DEP.guardhouse.oath, DEP.townhall.oath, DEP.townhall.dao, DEP.arena.contract, DEP.toll.oath]) {
    const v = await viewAccount(a);
    assert.notEqual(v.code_hash, '11111111111111111111111111111111', `${a} has code`);
  }
});

test('guardhouse oath: pinned code hash, no full-access key, agent key is propose-only', async () => {
  const v = await viewAccount(DEP.guardhouse.oath);
  assert.equal(v.code_hash, DEP.guardhouse.code_hash);
  const s = await guard.snapshot();
  assert.equal(s.keys.fullAccess, 0);
  assert.deepEqual(s.keys.functionCall.map(k => k.methods), [['propose']]);
  assert.equal(s.state.agent_key, s.keys.functionCall[0].public_key);
});

test('guardhouse demo txs read back from chain with the recorded verdicts', async () => {
  for (const r of proof.runs) {
    const e = await guard.explain(r.hash);
    assert.equal(e.result.value.decision, r.decision);
    assert.equal(e.result.value.reason, r.reason);
  }
  assert.deepEqual(proof.runs.map(r => r.decision), ['allowed', 'denied']);
});

test('recorded proof txs in deployments resolve on chain', async () => {
  const g = DEP.guardhouse.proof_txs;
  const paid = await guard.explain(g.valid_receipt_paid);
  assert.equal(paid.result.value.decision, 'allowed');
  const frozen = await shops.explainAny(DEP.townhall.proof_txs.reward_after_freeze_refused, DEP.townhall.agent);
  assert.equal(frozen.result.ok, false);
  assert.match(frozen.result.error, /FROZEN/);
});

test('town hall: oath frozen by DAO, caps and deny list live', async () => {
  const t = await shops.townhall();
  assert.equal(t.oathState.frozen, true);
  assert.equal(t.caps_near.per_reward, 0.15);
  assert.ok(t.oathState.policy.deny.length >= 1);
  assert.ok(t.council[0].members.length >= 2);
});

test('arena and toll views', async () => {
  const a = await shops.arena();
  assert.match(a.season.commit_hex, /^[0-9a-f]{64}$/);
  assert.ok(a.guardian?.agent);
  const t = await shops.toll();
  assert.equal(t.policy.mpc, 'v1.signer-prod.testnet');
  assert.equal(t.policy.foreign_address, DEP.toll.foreign_address);
});

test('chronicle lists oath txs and decodes events from chain', async () => {
  const c = await shops.chronicle(DEP.guardhouse.oath, 4);
  assert.ok(c.count > 0);
  assert.ok(c.txs.some(t => t.events?.length));
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
