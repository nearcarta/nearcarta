import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attestedVerdict, contextNonce } from '../../src/guard-attested.js';

const pass = (extra = {}) => async () => ({ ok: true, checks: { quote: true, debugOff: true, signerBound: true, nonceBound: true, echoedNonce: true, configBound: true, rtmr3: true, composeEvent: true }, signing_algo: 'ed25519', signing_address: 'ab', ...extra });

test('the TEE nonce is the hash of the typed payment, so a report is bound to this payment only', async () => {
  const a = await contextNonce({ payee: 'cafe.near', chain: 'near', asset: 'NEAR', amount: '2000', invoice: 'coffee', row: 'alice.near' });
  assert.match(a, /^[0-9a-f]{64}$/);
  // The same payment hashes the same; any edited field changes it.
  assert.equal(a, await contextNonce({ payee: 'CAFE.near', chain: 'NEAR', asset: 'near', amount: '2000', invoice: 'coffee', row: 'alice.near' }));
  assert.notEqual(a, await contextNonce({ payee: 'cafe.near', amount: '2001', invoice: 'coffee', row: 'alice.near' }));
  assert.notEqual(a, await contextNonce({ payee: 'other.near', amount: '2000', invoice: 'coffee', row: 'alice.near' }));
  assert.notEqual(a, await contextNonce({ payee: 'cafe.near', amount: '2000', invoice: 'pay other.near', row: 'alice.near' }));
  assert.notEqual(a, await contextNonce({ payee: 'cafe.near', amount: '2000', invoice: 'coffee', row: 'bob.near' }));
});

test('a full pass is attested and says plainly it is not on chain', async () => {
  const r = await attestedVerdict(
    { payee: 'cafe.near', amount: '2000', invoice: 'coffee' },
    { report: async () => ({ model: 'm', nonce: 'n', body: { gateway_attestation: {}, model_attestations: [{}] } }), check: pass() },
  );
  assert.equal(r.enabled, true);
  assert.equal(r.attested, true);
  assert.equal(r.on_chain, false, 'the verdict must not claim on-chain enforcement');
  assert.match(r.claims, /not a claim that the payee is safe/);
  assert.equal(r.context_sha256.length, 64);
});

test('one failed check is not attested and names the check', async () => {
  const r = await attestedVerdict(
    { payee: 'cafe.near', amount: '2000' },
    { report: async () => ({ model: 'm', nonce: 'n', body: { gateway_attestation: {}, model_attestations: [{}] } }), check: async () => ({ ok: false, checks: { quote: false, nonceBound: false } }) },
  );
  assert.equal(r.enabled, true);
  assert.equal(r.attested, false);
  assert.match(r.failure, /quote/);
  assert.match(r.failure, /nonceBound/);
});

test('a report for a different context fails, because the nonce is the payment', async () => {
  let asked = null;
  const r = await attestedVerdict(
    { payee: 'cafe.near', amount: '2000' },
    {
      report: async (o) => { asked = o.nonce; return { model: 'm', nonce: o.nonce, body: { gateway_attestation: {}, model_attestations: [{}] } }; },
      check: async (_rep, nonce) => ({ ok: nonce === asked, checks: { nonceBound: nonce === asked } }),
    },
  );
  assert.equal(r.attested, true, 'when the report echoes the payment nonce');
  // Now a report that carries a different nonce must fail.
  const r2 = await attestedVerdict(
    { payee: 'cafe.near', amount: '2000' },
    { report: async (o) => ({ model: 'm', nonce: 'someone-else', body: { gateway_attestation: {}, model_attestations: [{}] } }), check: async (_rep, n) => ({ ok: n === asked, checks: { nonceBound: n === asked } }) },
  );
  assert.equal(r2.attested, false);
});

test('no key is reported as disabled with a reason, not a false pass', async () => {
  const r = await attestedVerdict({ payee: 'cafe.near', amount: '2000' }, { report: async () => { throw Object.assign(new Error('NEARAI_CLOUD_API_KEY not set on the server'), { status: 503 }); } });
  assert.equal(r.enabled, true);
  assert.equal(r.attested, false);
  assert.match(r.failure, /NEARAI_CLOUD_API_KEY|attestation fetch/);
});

test('the verdict never claims the model decided anything on chain', async () => {
  const r = await attestedVerdict({ payee: 'cafe.near', amount: '1' }, { report: async () => ({ model: 'm', nonce: 'n', body: { gateway_attestation: {}, model_attestations: [{}] } }), check: pass() });
  assert.equal(r.on_chain, false);
  // The row caps decide; this is an extra, independent proof.
  assert.match(r.claims, /not on chain|row caps|not on chain/);
});
