// A Chronicle statement signed by NEAR AI Cloud, or a labelled local fallback.
// The canonical bundle digest is written into the prompt. The key stays on the server.
import { createHash } from 'node:crypto';
import { complete, signature, checkSigned, verifyLink } from './ai.js';
import { proveTee } from './tee.js';
import { budget, budgetLeft, costUsd, MAX_TOKENS } from './agent.js';
import { cfg, secret } from './config.js';
import { bundleDigest, writeStatement } from '../../app/src/chronicle-audit.js';

const sha = (s) => createHash('sha256').update(s).digest('hex');

function fallback(input, digest, why) {
  const written = writeStatement(input);
  return {
    mode: 'local-fallback',
    text: written.text,
    model: 'none',
    signature: '',
    signing_address: '',
    signing_algo: '',
    signature_kind: '',
    signed_text: '',
    reqSha: '',
    respSha: '',
    requestBody: '',
    digest,
    serverVerified: false,
    verify_url: '',
    attestation: {
      verified: [],
      unverified: ['ed25519 signature', 'canonical digest binding', 'TEE quote (Intel DCAP, TCB, RTMR3)'],
      note: `Local fallback. Not a NEAR AI signature. ${why}`,
    },
    status: 'Nothing was signed. Local fallback. Not a NEAR AI signature.',
  };
}

function tidy(text, digest) {
  let out = String(text || '').replace(/\s+/g, ' ').trim();
  if (digest) out = out.split(digest).join(' ');
  out = out.replace(/canonical digest[:\s]*/ig, ' ').replace(/\s+/g, ' ').replace(/^[\s.:\-]+/, '').trim();
  if (!out || /^[0-9a-f]{8,}/i.test(out)) out = 'This statement covers the account and the rows in the bundle.';
  if (!/[.!?]$/.test(out)) out += '.';
  if (!/Historic rules/i.test(out)) out += ' Historic rules: missing.';
  return out.slice(0, 600);
}

export async function signStatement(input = {}, deps = {}) {
  const account = String(input.account || '').trim();
  const period = input.period || {};
  const rows = Array.isArray(input.rows) ? input.rows.slice(0, 40) : [];
  const digest = bundleDigest({ account, period, rows });
  const facts = writeStatement({ account, period, rows, rules: null, totals: input.totals || null });
  const prompt = [
    'You are Chronicle, a read-only account auditor. Do not invent a transaction, a payee, or an amount.',
    `Canonical bundle digest: ${digest}`,
    'Start with a sentence naming the account. Then one sentence on delivered, refunded, and attempted. Do not begin with the digest and do not print the digest.',
    facts.text,
  ].join('\n');
  const completeF = deps.complete || complete;
  const signatureF = deps.signature || signature;
  const preflight = deps.preflight || proveTee;
  if (!deps.complete) {
    if (!secret.nearAi()) return fallback({ account, period, rows, totals: input.totals }, digest, 'NEAR AI key is not set on this server.');
    const gate = budgetLeft(0.01);
    if (!gate.ok) return fallback({ account, period, rows, totals: input.totals }, digest, gate.why);
  }

  let pre;
  try { pre = await preflight({ signingAlgo: 'ed25519' }); }
  catch { return fallback({ account, period, rows, totals: input.totals }, digest, 'TEE preflight did not answer. The completion was not sent.'); }
  if (!pre?.ok) return fallback({ account, period, rows, totals: input.totals }, digest, 'TEE preflight failed. The completion was not sent.');

  const messages = [{ role: 'user', content: prompt }];
  let c;
  try { c = await completeF(messages, { model: cfg.nearAiModel, maxTokens: MAX_TOKENS, extra: { reasoning_effort: 'low' } }); }
  catch { return fallback({ account, period, rows, totals: input.totals }, digest, 'The model did not answer.'); }
  if (!deps.complete) {
    const usd = costUsd(c.usage, c.model || cfg.nearAiModel);
    budget.calls++;
    budget.usd += usd;
    budget.tokens_in += c.usage?.prompt_tokens || 0;
    budget.tokens_out += c.usage?.completion_tokens || 0;
  }
  const requestBody = String(c.reqBody || '');
  if (!requestBody || !requestBody.includes(digest) || /authorization|bearer /i.test(requestBody)) {
    return fallback({ account, period, rows, totals: input.totals }, digest, 'The request did not bind the canonical digest.');
  }
  const reqSha = sha(requestBody);
  if (c.reqSha && c.reqSha !== reqSha) return fallback({ account, period, rows, totals: input.totals }, digest, 'The request hash did not match the request body.');

  let sig;
  try { sig = await signatureF(c.id, c.reqModel || c.model); }
  catch { sig = { available: false }; }
  if (!sig?.available || !sig.signature || !sig.text) {
    return fallback({ account, period, rows, totals: input.totals }, digest, 'The model answered and no signature came back.');
  }
  const checked = checkSigned({ ...c, reqSha, reqModel: c.reqModel || c.model }, sig, pre);
  const text = tidy(c.content, digest);
  return {
    mode: 'near-ai',
    text,
    model: c.reqModel || c.model || cfg.nearAiModel,
    signature: sig.signature,
    signing_address: sig.signing_address || '',
    signing_algo: sig.signing_algo || '',
    signature_kind: sig.signature_kind || '',
    signed_text: sig.text,
    reqSha,
    respSha: c.respSha || '',
    requestBody,
    digest,
    serverVerified: !!checked.verified,
    serverChecks: checked.checks,
    verify_url: verifyLink({ id: c.id, model: c.reqModel || c.model, sig }),
    attestation: {
      verified: [
        checked.checks.ed25519 ? 'ed25519 signature over the signed text' : null,
        checked.checks.textMatches ? 'signed text matches the model and the two hashes' : null,
        checked.checks.signerAttested ? 'server matched the signer to one TEE preflight report' : null,
      ].filter(Boolean),
      unverified: ['TEE quote (Intel DCAP, TCB, RTMR3) in the browser', 'raw model response bytes in the browser'],
      note: 'The browser re-checks the ed25519 signature, the request hash, and the digest. It does not verify the Intel quote.',
    },
    status: 'NEAR AI signature returned. Nothing was signed on chain.',
  };
}
