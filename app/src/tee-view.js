// Shape a TEE check for the Mist Bank button. The proof file is a recorded public summary.
// A failed check always names the step and the reason. The pass rule is unchanged.

import { API_PATH } from '../../shared/net/net.js';
export const PROOF_HREF = '/tee-public.json';
export const TEE_TIMEOUT_MS = 8000;
export const TEE_PLAN = [
  ['request', 'NEAR AI attestation'],
  ['quote', 'Intel TDX quote'],
  ['debug', 'Debug mode off'],
  ['nonce', 'Nonce in the quote'],
  ['signer', 'Signing key bound'],
  ['config', 'App config measured'],
  ['rtmr3', 'Event log replays RTMR3'],
  ['gpu', 'NVIDIA GPU attestation'],
];

export function teeTimeoutWhy(timeoutMs = TEE_TIMEOUT_MS) {
  const waited = timeoutMs >= 1000 ? `${Math.round(timeoutMs / 1000)} seconds` : `${timeoutMs} milliseconds`;
  return `The live check did not answer within ${waited}. A direct read of this route usually answers in about 2 seconds. Nothing was signed.`;
}

const hasDetail = body => !!(body?.steps?.length || body?.rows?.length || body?.gateway || body?.models?.length || body?.error || body?.err || body?.failure);

function step(id, label, ok, why) {
  return { id, label, ok: !!ok, why: ok ? '' : String(why || 'did not pass') };
}

export function teeSteps(body, nonce) {
  if (Array.isArray(body?.steps) && body.steps.length) {
    return body.steps.map(s => step(s.id || s.label, s.label || s.id, s.ok, s.why));
  }
  if (Array.isArray(body?.rows) && body.rows.length) {
    return body.rows.map(([label, ok, detail]) => step(label, label, ok, detail));
  }
  if (body?.err && !body?.gateway && !body?.models) {
    return [step('request', 'NEAR AI attestation', false, body.err)];
  }
  if (body?.error && !body?.gateway && !body?.models) {
    return [step('request', 'NEAR AI attestation', false, body.error)];
  }
  const g = body?.gateway || {};
  const models = Array.isArray(body?.models) ? body.models : [];
  const m = models[0] || {};
  const both = k => !!g.checks?.[k] && !!m.checks?.[k];
  const quoteOk = both('quote') && g.tcbStatus === 'UpToDate' && m.tcbStatus === 'UpToDate';
  const quoteWhy = g.error || m.error || body?.failure || `TCB ${g.tcbStatus || 'missing'} / ${m.tcbStatus || 'missing'}`;
  if (!models.length) {
    return [step('model', 'Model attestation', false, body?.failure || 'NEAR AI returned no model report')];
  }
  if (!quoteOk) return [step('quote', 'Intel TDX quote', false, quoteWhy)];
  const nonceOk = both('nonceBound') && both('echoedNonce') && (!nonce || body.nonce === nonce);
  const configOk = both('configBound') && both('composeEvent');
  const rtmrOk = both('rtmr3');
  const gpuOk = !!m.gpu?.ok;
  return [
    step('quote', 'Intel TDX quote', true, ''),
    step('debug', 'Debug mode off', both('debugOff'), 'TDX debug mode is on'),
    step('nonce', 'Nonce in the quote', nonceOk, nonce && body?.nonce && body.nonce !== nonce ? 'The reply nonce does not match the one this page sent' : 'The quote nonce does not match'),
    step('signer', 'Signing key bound', both('signerBound'), 'The signing address is not bound to the quote'),
    step('config', 'App config measured', configOk, String(g.error || m.error || '').startsWith('config') ? (g.error || m.error) : 'MRCONFIGID does not match the measured config'),
    step('rtmr3', 'Event log replays RTMR3', rtmrOk, String(g.error || m.error || '').startsWith('rtmr3') ? (g.error || m.error) : 'The event log does not match RTMR3'),
    step('gpu', 'NVIDIA GPU attestation', gpuOk, m.gpu?.why || (m.gpu ? 'The GPU verdict did not pass' : 'No GPU evidence')),
  ];
}

export function teeView(body, nonce) {
  const steps = hasDetail(body) ? teeSteps(body, nonce || body?.nonce) : [];
  const failed = steps.find(s => !s.ok);
  const ok = body?.ok === true && !failed;
  return {
    ok,
    label: ok ? 'attested' : 'failed',
    failed: failed ? `${failed.label}: ${failed.why || 'did not pass'}` : (ok ? '' : 'The check did not name a step.'),
    steps,
    proof: PROOF_HREF,
    model: body?.model || '',
  };
}

export function teeResult(body, proofHref = PROOF_HREF) {
  const view = teeView(body);
  return {
    ok: view.ok,
    label: view.label,
    proof: proofHref,
    model: body?.model || '',
    text: view.ok
      ? 'Live check passed. The button asks NEAR AI now. The file tee-public.json is the recorded Oct 28 result.'
      : `Live check did not pass. ${view.failed} The file tee-public.json is the recorded Oct 28 result.`,
  };
}

export async function liveTee({ fetchImpl = globalThis.fetch, api = '', nonce, model = '', timeoutMs = TEE_TIMEOUT_MS, onTick } = {}) {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const n = nonce || [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
  const base = String(api || '').replace(/\/$/, '');
  const modelQ = model ? `&model=${encodeURIComponent(model)}` : '';
  const ctrl = new AbortController();
  const started = Date.now();
  if (onTick) onTick(0);
  const tick = onTick ? setInterval(() => onTick(Math.round((Date.now() - started) / 1000)), 1000) : null;
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const fail = (why) => ({ ok: false, nonce: n, error: why, failure: `NEAR AI attestation: ${why}`, steps: [step('request', 'NEAR AI attestation', false, why)] });
  try {
    const res = await Promise.race([
      Promise.resolve(fetchImpl(`${base}${API_PATH}/ai/tee?nonce=${encodeURIComponent(n)}${modelQ}`, { signal: ctrl.signal })),
      new Promise((_, reject) => {
        ctrl.signal.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      }),
    ]);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const why = body.error || body.failure || `attestation http ${res.status}`;
      return fail(why);
    }
    const view = teeView(body, n);
    return { ...body, ok: view.ok, nonce: body.nonce || n, steps: view.steps, failure: view.ok ? '' : view.failed };
  } catch (e) {
    const why = ctrl.signal.aborted ? teeTimeoutWhy(timeoutMs) : (e?.message || 'The attestation request failed');
    return fail(why);
  } finally {
    clearTimeout(timer);
    if (tick) clearInterval(tick);
  }
}
