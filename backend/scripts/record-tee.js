// Live NEAR AI TEE preflight (no completion, non-billable). Writes:
//   judges/proofs/tee-check.json          the live verdict per check
//   backend/test/fixtures/tee-report.json  the raw evidence + collateral, for the offline unit tests
// Needs NEARAI_CLOUD_API_KEY in env.
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { getCollateral, PHALA_PCCS_URL } from '@phala/dcap-qvl';
import { fetchReport, checkNearReport, checkGpu, proveTee } from '../src/tee.js';

const here = new URL('..', import.meta.url).pathname;
const rep = await fetchReport({});
const g = rep.body.gateway_attestation, m = rep.body.model_attestations[0];
const col = async r => getCollateral(PHALA_PCCS_URL, Buffer.from(r.intel_quote, 'hex'));
const strip = r => { const { nvidia_payload, ohttp_attestation, compose_manager_attestation, ohttp_key_config, ...rest } = r;
  return { ...rest, nvidia_payload_sha256: nvidia_payload ? createHash('sha256').update(nvidia_payload).digest('hex') : null }; };
const fixture = { source: 'GET https://cloud-api.near.ai/v1/attestation/report provider=near signing_algo=ecdsa', model: rep.model, nonce: rep.nonce, fetchedAt: rep.fetchedAt,
  gateway: { report: strip(g), collateral: await col(g) }, model_report: { report: strip(m), collateral: await col(m) } };
const offline = await checkNearReport(fixture.gateway.report, rep.nonce, { collateral: fixture.gateway.collateral, now: rep.fetchedAt });
if (!offline.ok) throw new Error('recorded gateway report does not verify offline: ' + JSON.stringify(offline.checks));
writeFileSync(here + 'test/fixtures/tee-report.json', JSON.stringify(fixture, null, 1));

const live = await proveTee({});
writeFileSync(here + '../judges/proofs/tee-check.json', JSON.stringify(live, null, 1) + '\n');
const line = r => `${r.ok ? 'PASS' : 'FAIL'} tcb=${r.tcbStatus} ` + Object.entries(r.checks).map(([k, v]) => `${k}=${v ? 1 : 0}`).join(' ');
console.log('gateway', line(live.gateway));
for (const x of live.models) console.log('model  ', x.model_name, line(x), 'gpu=', x.gpu?.ok, x.gpu?.gpus ?? '');
console.log(live.ok ? 'TEE preflight verified' : 'TEE preflight NOT verified');
process.exit(live.ok ? 0 : 1);
