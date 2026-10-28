// Offline checks of a recorded NEAR AI attestation report (gateway + model), with its recorded collateral.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkNearReport, replayRtmr3 } from '../../src/tee.js';

const F = JSON.parse(readFileSync(new URL('../fixtures/tee-report.json', import.meta.url)));
const at = { now: F.fetchedAt };
const clone = o => JSON.parse(JSON.stringify(o));
const run = (part, mutate = r => r, nonce = F.nonce) => {
  const r = mutate(clone(F[part].report));
  return checkNearReport(r, nonce, { ...at, collateral: F[part].collateral });
};
const flip = (hex, i) => hex.slice(0, i) + (hex[i] === '0' ? '1' : '0') + hex.slice(i + 1);

for (const part of ['gateway', 'model_report']) {
  test(`${part}: recorded report passes every check offline`, async () => {
    const r = await run(part);
    assert.equal(r.tcbStatus, 'UpToDate');
    assert.deepEqual(Object.values(r.checks).every(Boolean), true, JSON.stringify(r.checks));
    assert.equal(r.ok, true);
  });
}

test('a different client nonce is not bound by the quote (replay of an old report)', async () => {
  const r = await run('gateway', x => x, flip(F.nonce, 5));
  assert.equal(r.checks.quote, true);
  assert.equal(r.checks.nonceBound, false);
  assert.equal(r.checks.echoedNonce, false);
  assert.equal(r.ok, false);
});

test('a swapped signing_address is caught by the report-data binding', async () => {
  const r = await run('model_report', x => { x.signing_address = flip(x.signing_address, 7); return x; });
  assert.equal(r.checks.signerBound, false);
  assert.equal(r.ok, false);
});

test('an edited app_compose no longer matches MRCONFIGID', async () => {
  const r = await run('gateway', x => {
    const tcb = typeof x.info.tcb_info === 'string' ? JSON.parse(x.info.tcb_info) : x.info.tcb_info;
    tcb.app_compose = tcb.app_compose + ' ';
    x.info.tcb_info = typeof x.info.tcb_info === 'string' ? JSON.stringify(tcb) : tcb;
    return x;
  });
  assert.equal(r.checks.configBound, false);
  assert.equal(r.ok, false);
});

test('a forged event payload breaks the RTMR3 replay', async () => {
  const r = await run('gateway', x => {
    const log = typeof x.event_log === 'string' ? JSON.parse(x.event_log) : x.event_log;
    const e = log.find(e => e.imr === 3 && e.event === 'app-id');
    e.event_payload = flip(e.event_payload, 0); e.digest = '';
    x.event_log = typeof x.event_log === 'string' ? JSON.stringify(log) : log;
    return x;
  });
  assert.equal(r.checks.rtmr3, false);
  assert.equal(r.ok, false);
});

test('a forged event with its own recomputed-looking digest is rejected', () => {
  const log = clone(typeof F.gateway.report.event_log === 'string' ? JSON.parse(F.gateway.report.event_log) : F.gateway.report.event_log);
  const e = log.find(e => e.imr === 3 && e.digest && e.event === 'compose-hash');
  e.event_payload = flip(e.event_payload, 0);
  assert.throws(() => replayRtmr3(log), /digest mismatch/);
});

test('one flipped byte in the quote fails DCAP verification', async () => {
  const r = await run('gateway', x => { x.intel_quote = flip(x.intel_quote, 2000); return x; });
  assert.equal(r.checks.quote, false);
  assert.equal(r.ok, false);
});

test('collateral is time-bound: a far-future clock is refused', async () => {
  const r = await checkNearReport(clone(F.gateway.report), F.nonce, { collateral: F.gateway.collateral, now: F.fetchedAt + 400 * 86400 });
  assert.equal(r.checks.quote, false);
});

test('attestedModels lists only models whose report has a model attestation', async () => {
  const { attestedModels } = await import('../../src/tee.js');
  const fetchImpl = async () => new Response(JSON.stringify({ data: [{ id: 'tee/a' }, { id: 'proxied/b' }, { id: 'tee/empty' }] }));
  const report = async ({ model }) => {
    if (model === 'proxied/b') throw new Error('attestation http 503');
    return { body: { model_attestations: model === 'tee/a' ? [{ signing_address: '0x1' }] : [] } };
  };
  const r = await attestedModels({ fetchImpl, report, ttlMs: 0 });
  assert.deepEqual(r.attested, [{ id: 'tee/a', attestations: 1 }]);
  assert.equal(r.catalog, 3); assert.equal(r.left_out, 2);
});
