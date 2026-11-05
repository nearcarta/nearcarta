// NEAR AI Cloud TEE evidence check, following docs.near.ai/cloud/verification
// (reference/quote-nonce-signer, cloud-api/gateway-attestation, cloud-api/model-attestations).
// Fetching the report needs an API key but is non-billable. No completion is sent here.
//
// Per report (gateway_attestation and every model_attestations[] candidate):
//   1. intel_quote verified with dcap-qvl (Intel DCAP chain + TCB status)   -> quote
//   2. TDX debug bit off                                                     -> debugOff
//   3. report_data[0..32] = signing identity (zero-padded), [32..64] = our nonce -> signerBound, nonceBound
//   4. echoed request_nonce equals our nonce                                 -> echoedNonce
//   5. MRCONFIGID = 01 || sha256(app_compose) || 15 zero bytes               -> configBound
//   6. RTMR3 replayed from event_log equals the quote's RTMR3                -> rtmr3
//   6b. the RTMR3 compose-hash event equals sha256(app_compose)            -> composeEvent
//   7. (model, optional) NVIDIA NRAS verdict on nvidia_payload with our nonce -> gpu
import { createHash, randomBytes } from 'node:crypto';
import { getCollateral, verify, PHALA_PCCS_URL } from '@phala/dcap-qvl';
import { cfg, secret } from './config.js';

export const ACCEPTED_TCB = ['UpToDate'];
const NRAS = 'https://nras.attestation.nvidia.com/v3/attest/gpu';
const hexBytes = v => Buffer.from(String(v || '').replace(/^0x/i, ''), 'hex');
const parse = v => (typeof v === 'string' ? JSON.parse(v) : v);
const hash = (alg, ...parts) => { const h = createHash(alg); for (const p of parts) h.update(p); return h.digest(); };
const hx = b => Buffer.from(b).toString('hex');

export function replayRtmr3(eventLog) {
  let rtmr3 = Buffer.alloc(48);
  const events = [];
  for (const e of parse(eventLog)) {
    if (e.imr !== 3) continue;
    const t = Buffer.alloc(4); t.writeUInt32LE(e.event_type);
    const digest = hash('sha384', t, ':', Buffer.from(e.event, 'utf8'), ':', hexBytes(e.event_payload ?? ''));
    if (e.digest && !hexBytes(e.digest).equals(digest)) throw new Error(`digest mismatch for event ${e.event}`);
    rtmr3 = hash('sha384', rtmr3, digest);
    events.push(e.event);
  }
  return { rtmr3, events };
}

// Readable values from the replayed log (authenticated once rtmr3 matches).
function rtmr3Fields(eventLog) {
  const out = {};
  for (const e of parse(eventLog)) {
    if (e.imr !== 3) continue;
    if (['app-id', 'compose-hash', 'instance-id', 'os-image-hash', 'key-provider'].includes(e.event)) {
      const raw = hexBytes(e.event_payload ?? '');
      out[e.event] = e.event === 'key-provider' ? raw.toString('utf8').slice(0, 120) : hx(raw);
    }
  }
  return out;
}

export async function fetchReport({ model = cfg.nearAiModel, nonce = randomBytes(32).toString('hex'), signingAlgo = 'ecdsa' } = {}) {
  const k = secret.nearAi();
  if (!k) throw Object.assign(new Error('NEARAI_CLOUD_API_KEY not set on the server'), { status: 503 });
  const u = `${cfg.nearAi}/v1/attestation/report?` + new URLSearchParams({ model, provider: 'near', signing_algo: signingAlgo, nonce, include_tls_fingerprint: 'false' });
  const r = await fetch(u, { headers: { Authorization: `Bearer ${k}`, 'x-no-aliasing': 'true', accept: 'application/json' } });
  if (!r.ok) throw Object.assign(new Error(`attestation http ${r.status}`), { status: 502 });
  return { nonce, model, signingAlgo, fetchedAt: Math.floor(Date.now() / 1000), body: await r.json() };
}

// Checks one NEAR report. Never throws on a failed check: every check is reported.
// opts.collateral / opts.now allow an offline re-check of a recorded report.
export async function checkNearReport(report, nonceHex, { accepted = ACCEPTED_TCB, collateral, now, pccsUrl = PHALA_PCCS_URL } = {}) {
  const c = { quote: false, debugOff: false, signerBound: false, nonceBound: false, echoedNonce: false, configBound: false, rtmr3: false, composeEvent: false };
  const out = { ok: false, checks: c, signing_address: report.signing_address, signing_algo: report.signing_algo };
  let q;
  try {
    const raw = hexBytes(report.intel_quote);
    const col = collateral || await getCollateral(pccsUrl, raw);
    const v = verify(raw, col, now ?? Math.floor(Date.now() / 1000));
    out.tcbStatus = v.status; out.advisories = v.advisory_ids || [];
    if (v.report?.type !== 'td10' && v.report?.type !== 'td15') throw new Error(`expected a TDX quote, got ${v.report?.type}`);
    q = v.report.data;
    c.quote = accepted.includes(v.status);
  } catch (e) { out.error = `quote: ${e.message}`; return out; }

  c.debugOff = (q.tdAttributes[0] & 1) === 0;
  const id = hexBytes(report.signing_address);
  const idOk = { ecdsa: 20, ed25519: 32 }[report.signing_algo] === id.length;
  const rd = Buffer.from(q.reportData);
  c.signerBound = idOk && rd.subarray(0, 32).equals(Buffer.concat([id, Buffer.alloc(32 - id.length)]));
  c.nonceBound = rd.subarray(32, 64).equals(hexBytes(nonceHex));
  c.echoedNonce = String(report.request_nonce || '').toLowerCase() === nonceHex.toLowerCase();
  if (report.report_data && hexBytes(report.report_data).length) c.echoedNonce &&= hexBytes(report.report_data).equals(rd);

  try {
    const appCompose = parse(report.info.tcb_info).app_compose;
    out.composeHash = hx(hash('sha256', Buffer.from(appCompose, 'utf8')));
    c.configBound = Buffer.from(q.mrConfigId).equals(Buffer.concat([Buffer.from([1]), hexBytes(out.composeHash), Buffer.alloc(15)]));
  } catch (e) { out.error = `config: ${e.message}`; }
  try {
    const { rtmr3, events } = replayRtmr3(report.event_log);
    c.rtmr3 = rtmr3.equals(Buffer.from(q.rtMr3));
    out.rtmr3Events = events.length;
    if (c.rtmr3) out.measured = rtmr3Fields(report.event_log);
    // the RTMR3-authenticated compose-hash event must name the same configuration as MRCONFIGID
    c.composeEvent = c.rtmr3 && out.measured['compose-hash'] === out.composeHash;
  } catch (e) { out.error = `rtmr3: ${e.message}`; }

  out.mrTd = hx(q.mrTd); out.rtMr3 = hx(q.rtMr3);
  out.ok = Object.values(c).every(Boolean);
  return out;
}

// NVIDIA NRAS verdict for the GPU evidence of a model report (free public endpoint).
export async function checkGpu(report, nonceHex) {
  if (!report.nvidia_payload) return { present: false, ok: false };
  const payload = parse(report.nvidia_payload);
  if (String(payload.nonce || '').toLowerCase() !== nonceHex.toLowerCase()) return { present: true, ok: false, why: 'nonce mismatch' };
  const r = await fetch(NRAS, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  if (!r.ok) return { present: true, ok: false, why: `nras http ${r.status}` };
  const arr = await r.json();
  const jwt = Array.isArray(arr) && Array.isArray(arr[0]) && arr[0][0] === 'JWT' ? arr[0][1] : null;
  if (!jwt) return { present: true, ok: false, why: 'no JWT in NRAS reply' };
  const claims = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));
  return { present: true, ok: claims['x-nvidia-overall-att-result'] === true, gpus: (payload.evidence_list || []).length || undefined };
}

// The first failed check, in words. A passing report returns an empty string.
export function teeFailure(part) {
  if (!part) return 'missing';
  const gpuBad = part.gpu?.present && part.gpu.ok === false;
  if (part.ok && !gpuBad) return '';
  if (part.error) return part.error;
  const bad = Object.entries(part.checks || {}).filter(([, v]) => !v).map(([k]) => k);
  if (gpuBad) bad.push(part.gpu.why || 'gpu');
  return bad.join(', ') || 'did not pass';
}

// Full preflight: fresh nonce, gateway + every model candidate, optional GPU verdicts.
export async function proveTee({ model = cfg.nearAiModel, signingAlgo = 'ecdsa', gpu = true, nonce } = {}) {
  if (nonce !== undefined && !/^[0-9a-f]{64}$/i.test(nonce)) throw Object.assign(new Error('nonce must be 32 bytes as 64 hex chars'), { status: 400 });
  const rep = await fetchReport({ model, signingAlgo, ...(nonce ? { nonce: nonce.toLowerCase() } : {}) });
  const b = rep.body;
  const gateway = await checkNearReport(b.gateway_attestation, rep.nonce);
  const candidates = b.model_attestations || [];
  const models = [];
  for (const m of candidates) {
    const r = await checkNearReport(m, rep.nonce);
    r.model_name = m.model_name;
    if (gpu) { try { r.gpu = await checkGpu(m, rep.nonce); } catch (e) { r.gpu = { present: true, ok: false, why: e.message }; } }
    models.push(r);
  }
  const ok = gateway.ok && models.length > 0 && models.every(m => m.ok && (!gpu || !m.gpu?.present || m.gpu.ok));
  const bits = [];
  if (!gateway.ok) bits.push(`gateway: ${teeFailure(gateway)}`);
  if (!models.length) bits.push('model: NEAR AI returned no model report');
  for (const m of models) {
    const why = teeFailure(m);
    if (why) bits.push(`${m.model_name || 'model'}: ${why}`);
  }
  const failure = ok ? '' : (bits.join('; ') || 'did not pass');
  return { model, nonce: rep.nonce, signingAlgo, checkedAt: new Date(rep.fetchedAt * 1000).toISOString(), policy: { acceptedTcb: ACCEPTED_TCB, gpuRequired: gpu },
    gateway, models, ok, failure };
}

// Models that serve a TEE attestation report. The NEAR AI catalog (/v1/models) also lists models routed
// to outside providers; for those the report endpoint answers 503 and they are left out. Being listed
// means a report with at least one model_attestations[] entry was served; /api/ai/tee?model=… then
// runs the full check above on that report. Cached 10 minutes.
let attestedCache = { at: 0, list: null };
export async function attestedModels({ concurrency = 6, ttlMs = 10 * 60e3, fetchImpl = fetch, report = fetchReport } = {}) {
  if (attestedCache.list && Date.now() - attestedCache.at < ttlMs) return attestedCache.list;
  const r = await fetchImpl(`${cfg.nearAi}/v1/models`, { headers: { accept: 'application/json' } });
  if (!r.ok) throw Object.assign(new Error(`models http ${r.status}`), { status: 502 });
  const ids = ((await r.json()).data || []).map(m => m.id).filter(Boolean);
  const attested = []; let i = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (i < ids.length) {
      const id = ids[i++];
      try { const n = ((await report({ model: id })).body.model_attestations || []).length; if (n > 0) attested.push({ id, attestations: n }); } catch { /* no report: not attested */ }
    }
  }));
  attested.sort((a, b) => a.id.localeCompare(b.id));
  const list = { checkedAt: new Date().toISOString(), catalog: ids.length, attested, left_out: ids.length - attested.length,
    rule: 'listed only if /v1/attestation/report serves at least one model attestation' };
  attestedCache = { at: Date.now(), list };
  return list;
}

// ---- attestation result cache (5 minutes) ----
// /api/ai/tee is called by the Mist Bank twice per send (the "verify now" panel, then the send with the
// seal as nonce) and by the console. A repeated nonce, or a call with no nonce, gets the result already
// checked within the last 5 minutes, so it neither hits NEAR AI again nor counts against the route's
// rate limit. A new client nonce always needs a fresh quote (the nonce must be inside it), so that is a
// miss and stays rate limited. Failures are not cached. Concurrent identical calls share one fetch.
// The agent's preflight (agent.js) reads through this cache too, so it and the route share fetches.
export const TEE_TTL_MS = Number(process.env.TEE_CACHE_TTL_MS || 5 * 60e3);
const teeCache = new Map(); // key -> { at, p }
const teeKey = ({ model = cfg.nearAiModel, signingAlgo = 'ecdsa', gpu = true, nonce } = {}) =>
  [model, signingAlgo, gpu ? 'gpu' : 'nogpu', nonce ? String(nonce).toLowerCase() : '*'].join('|');
function teeGet(key, ttlMs, now) {
  const e = teeCache.get(key);
  if (!e) return null;
  if (now - e.at >= ttlMs) { teeCache.delete(key); return null; }
  return e;
}
// True when this call would be answered from the cache (used to skip the per-client limit).
export const teeCached = (opts = {}, { ttlMs = TEE_TTL_MS, now = Date.now() } = {}) => !!teeGet(teeKey(opts), ttlMs, now);
export async function cachedProveTee(opts = {}, { ttlMs = TEE_TTL_MS, run = proveTee, now = Date.now } = {}) {
  const key = teeKey(opts), t = now();
  let e = teeGet(key, ttlMs, t);
  if (!e) {
    if (teeCache.size > 500) for (const [k, v] of teeCache) if (t - v.at >= ttlMs || teeCache.size > 500) teeCache.delete(k);
    e = { at: t, p: Promise.resolve().then(() => run(opts)) };
    teeCache.set(key, e);
    e.p.then(r => { if (!r?.ok) teeCache.delete(key); }, () => teeCache.delete(key));
    const r = await e.p;
    return { ...r, cache: { hit: false, ttl_s: Math.round(ttlMs / 1000) } };
  }
  const r = await e.p;
  return { ...r, cache: { hit: true, age_s: Math.round((t - e.at) / 1000), ttl_s: Math.round(ttlMs / 1000) } };
}
export const _clearTeeCache = () => teeCache.clear();
