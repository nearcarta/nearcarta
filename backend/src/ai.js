// NEAR AI Cloud: one private (TEE) completion, then proof that it came from an attested enclave.
//  1. POST /v1/chat/completions (Bearer key, server-side only)
//  2. GET  /v1/signature/{id}   -> {text, signature, signing_address, signing_algo}
//  3. check text == model:sha256(request bytes):sha256(response bytes) when provider_tee
//  4. GET  /v1/attestation/report with a fresh nonce -> the signing_address must be in model_attestations
//  5. ed25519-verify the signature over text with that address (hex public key)
import { createHash, randomBytes } from 'node:crypto';
import nacl from 'tweetnacl';
import { cfg, secret } from './config.js';
import { proveTee } from './tee.js';

const sha = b => createHash('sha256').update(b).digest('hex');
const hex = h => Uint8Array.from(Buffer.from(h.replace(/^0x/, ''), 'hex'));

function auth() {
  const k = secret.nearAi();
  if (!k) throw Object.assign(new Error('NEARAI_CLOUD_API_KEY not set on the server'), { status: 503 });
  return { Authorization: `Bearer ${k}` };
}

export async function complete(messages, { model = cfg.nearAiModel, maxTokens = 64, extra = {} } = {}) {
  const reqBody = JSON.stringify({ model, messages, max_tokens: maxTokens, temperature: 0, stream: false, ...extra });
  const r = await fetch(`${cfg.nearAi}/v1/chat/completions`, {
    method: 'POST', headers: { ...auth(), 'content-type': 'application/json' }, body: reqBody,
  });
  const respText = await r.text();
  if (!r.ok) throw Object.assign(new Error(`near ai http ${r.status}`), { status: 502 });
  const j = JSON.parse(respText);
  return { id: j.id, model: j.model || model, reqModel: model, content: j.choices?.[0]?.message?.content ?? '', usage: j.usage,
    reqSha: sha(reqBody), respSha: sha(respText), reqBody };  // raw response (incl. any reasoning_content) is hashed, never kept
}

export async function signature(id, model, { tries = 6 } = {}) {
  for (let i = 0; i < tries; i++) {
    const r = await fetch(`${cfg.nearAi}/v1/signature/${encodeURIComponent(id)}?model=${encodeURIComponent(model)}&signing_algo=ed25519`, { headers: auth() });
    if (r.status === 404) { await new Promise(s => setTimeout(s, 700 * (i + 1))); continue; }
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error_code) return { available: false, http: r.status, error_code: j.error_code || null };
    return { available: true, ...j };
  }
  return { available: false, http: 404 };
}

export async function attestation(model, nonce = randomBytes(32).toString('hex')) {
  const u = `${cfg.nearAi}/v1/attestation/report?model=${encodeURIComponent(model)}&provider=near&signing_algo=ed25519&nonce=${nonce}&include_tls_fingerprint=false`;
  const r = await fetch(u, { headers: { ...auth(), 'x-no-aliasing': 'true' } });
  if (!r.ok) throw Object.assign(new Error(`attestation http ${r.status}`), { status: 502 });
  const j = await r.json();
  const signers = (j.model_attestations || []).map(a => a.signing_address).filter(Boolean);
  return { nonce, signers, gateway: !!j.gateway_attestation, count: signers.length };
}

export function verifySigned(sig) {
  try {
    const pub = hex(sig.signing_address);
    return pub.length === 32 && nacl.sign.detached.verify(new TextEncoder().encode(sig.text), hex(sig.signature), pub);
  } catch { return false; }
}

export function verifyLink({ id, model, sig }) {
  const receipt = { completionId: id, model, signatureKind: sig.signature_kind, signingAlgo: sig.signing_algo,
    signingAddress: sig.signing_address, signedText: sig.text, signature: sig.signature };
  return `https://cloud.near.ai/verify?model=${encodeURIComponent(model)}#receipt=${Buffer.from(JSON.stringify(receipt)).toString('base64url')}`;
}

/**
 * Check one completion's signature against a verified ed25519 TEE preflight (docs.near.ai):
 * provider_tee text must be exactly <model>:<sha256(request)>:<sha256(response)>; a gateway signature
 * signs <sha256(request)>:<sha256(response)> and only proves the gateway. The signer must match exactly
 * one verified report with the same algorithm, and the ed25519 signature must verify.
 */
export function checkSigned(c, sig, pre) {
  const textMatches = sig.signature_kind === 'provider_tee'
    ? sig.text === `${c.reqModel || c.model}:${c.reqSha}:${c.respSha}`
    : sig.signature_kind === 'gateway' && sig.text === `${c.reqSha}:${c.respSha}`;
  const pool = sig.signature_kind === 'gateway' ? [pre.gateway] : (pre.models || []);
  const matches = pool.filter(r => r?.ok && r.signing_algo === sig.signing_algo && r.signing_address?.toLowerCase() === sig.signing_address?.toLowerCase());
  const signerAttested = matches.length === 1;
  const ed25519 = sig.signing_algo === 'ed25519' && verifySigned(sig);
  return { checks: { textMatches, signerAttested, ed25519, modelInTee: sig.signature_kind === 'provider_tee' }, verified: textMatches && signerAttested && ed25519 };
}

// Full proof run, used by /api/ai/prove (behind AI_PROVE_ENABLED) and the integration test.
// Deployment-first, per docs.near.ai: verify the TEE evidence BEFORE sending the completion,
// then require the response signer to match exactly one verified model report.
export async function prove(prompt = 'Reply with one word: lamp', { preflight = proveTee } = {}) {
  const pre = await preflight({ signingAlgo: 'ed25519' });
  if (!pre.ok) return { verified: false, why: 'TEE preflight failed; completion not sent', preflight: pre };
  const c = await complete([{ role: 'user', content: prompt }]);
  const sig = await signature(c.id, c.model);
  const out = { id: c.id, model: c.model, content: c.content, usage: c.usage, reqSha: c.reqSha, respSha: c.respSha, signature: sig.available ? 'available' : 'unavailable' };
  if (!sig.available) return { ...out, verified: false, why: `signature ${sig.http}${sig.error_code ? ' ' + sig.error_code : ''}` };
  const v = checkSigned(c, sig, pre);
  return { ...out, signature_kind: sig.signature_kind, signing_address: sig.signing_address, signed_text: sig.text,
    sig: sig.signature, checks: { teePreflight: pre.ok, ...v.checks },
    verified: v.verified, verifyUrl: verifyLink({ id: c.id, model: c.model, sig }) };
}
