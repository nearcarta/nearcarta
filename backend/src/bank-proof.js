// Mist Bank privacy proof.
// Hardware attestation: GET https://cloud-api.near.ai/v1/attestation/report is non-billable
// (docs.near.ai/api-reference/attestation/get-attestation-report).
// A reply signature is checked with the documented ed25519 steps
// (docs.near.ai/cloud/verification/reference/response-signature-verification)
// and does not send a completion.
// A completion is billable and runs only when AI_PROVE_ENABLED=1 and no receipt was posted
// (docs.near.ai/cloud/verification/cloud-api/response-signatures).
import { timingSafeEqual } from 'node:crypto';
import nacl from 'tweetnacl';
import { checkSigned, prove } from './ai.js';
import { cachedProveTee } from './tee.js';

export const NO_RETENTION = 'NEAR AI request and response bytes are not stored. They are hashed for the signature check. This file keeps the hashes, the signer, and the attestation summary.';

const hexToBytes = (value) => {
  const hex = String(value || '').replace(/^0x/i, '');
  if (!hex || hex.length % 2 || !/^[0-9a-f]+$/i.test(hex)) return new Uint8Array();
  return Uint8Array.from(Buffer.from(hex, 'hex'));
};

function sameBytes(left, right) {
  if (!left || !right || left.length !== right.length || !left.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Documented reply-signature check. Returns { ok } and does not throw on a bad signature.
 * ed25519 verifies UTF-8 `text` with `signing_address` as the 32-byte public key.
 */
export function verifyResponseSignature({ signature, expectedText, preflightSigner } = {}) {
  try {
    if (typeof signature?.text !== 'string' || signature.text !== expectedText) {
      return { ok: false, why: 'signature text does not match the exact request and response hashes' };
    }
    if (signature.signing_algo !== 'ed25519') return { ok: false, why: 'this check accepts ed25519' };
    const pub = hexToBytes(signature.signing_address);
    const sig = hexToBytes(signature.signature);
    if (pub.length !== 32 || sig.length !== 64) return { ok: false, why: 'bad key or signature length' };
    const math = nacl.sign.detached.verify(new TextEncoder().encode(signature.text), sig, pub);
    if (!math) return { ok: false, why: 'Ed25519 signature does not match signing_address' };
    const prePub = hexToBytes(preflightSigner?.signing_address || '');
    if (preflightSigner?.signing_algo !== 'ed25519' || !sameBytes(prePub, pub)) {
      return { ok: false, why: 'signature signer does not match verified preflight evidence' };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, why: e?.message || 'verify failed' };
  }
}

/** Downloadable summary. No quote bytes, no chat text. */
export function proofFile({ preflight = {}, signature = null, checks = null, completionSent = false } = {}) {
  const modelReport = (preflight.models || [])[0] || {};
  return {
    kind: 'mist-bank',
    mode: completionSent ? 'completion' : (signature ? 'envelope' : 'attestation'),
    model: preflight.model || null,
    nonce: preflight.nonce || null,
    checkedAt: preflight.checkedAt || null,
    signingAlgo: preflight.signingAlgo || signature?.signing_algo || null,
    hardwareOk: !!preflight.ok,
    tcbStatus: modelReport.tcbStatus || preflight.gateway?.tcbStatus || null,
    signingAddress: signature?.signing_address || modelReport.signing_address || null,
    signatureKind: signature?.signature_kind || null,
    checks: checks || null,
    completionSent: !!completionSent,
    retention: NO_RETENTION,
  };
}

async function defaultPreflight() {
  return cachedProveTee({ signingAlgo: 'ed25519' });
}

/**
 * Live proof. A posted receipt is verified locally against the preflight and does not call the model.
 * With no receipt, the hardware attestation is the proof. A completion runs only when `enabled` is true.
 */
export async function bankProve({ receipt = null, enabled, preflight = defaultPreflight, complete = prove } = {}) {
  const pre = await preflight({ signingAlgo: 'ed25519' });
  const flag = enabled != null ? !!enabled : process.env.AI_PROVE_ENABLED === '1';
  if (receipt && receipt.signature) {
    const model = receipt.model;
    const shaped = {
      reqModel: model,
      model,
      reqSha: receipt.reqSha,
      respSha: receipt.respSha,
    };
    const v = checkSigned(shaped, receipt.signature, pre);
    const proof = proofFile({ preflight: pre, signature: receipt.signature, checks: v.checks, completionSent: false });
    return {
      mode: 'envelope',
      completionSent: false,
      verified: !!v.verified,
      checks: v.checks,
      proof,
      retention: NO_RETENTION,
      why: v.verified
        ? 'Reply signature matches one verified model report.'
        : 'Reply signature did not verify. No completion was sent.',
    };
  }
  if (flag) {
    const out = await complete('Reply with one word: sealed');
    const proof = proofFile({
      preflight: pre,
      signature: out?.signing_address ? {
        signing_address: out.signing_address,
        signing_algo: 'ed25519',
        signature_kind: out.signature_kind || null,
      } : null,
      checks: out?.checks || null,
      completionSent: true,
    });
    const { content, ...rest } = out || {};
    return {
      mode: 'completion',
      completionSent: true,
      verified: !!out?.verified,
      checks: out?.checks || null,
      completion: rest,
      proof,
      retention: NO_RETENTION,
      why: out?.verified ? 'Completion signature verified.' : (out?.why || 'Completion was not verified.'),
    };
  }
  const proof = proofFile({ preflight: pre, completionSent: false });
  return {
    mode: 'attestation',
    completionSent: false,
    verified: !!pre?.ok,
    signature: null,
    checks: null,
    proof,
    retention: NO_RETENTION,
    why: pre?.ok
      ? 'No completion was sent. The hardware attestation is live. Open an envelope to check a reply signature.'
      : (pre?.failure || 'Hardware attestation did not pass. No completion was sent.'),
  };
}
