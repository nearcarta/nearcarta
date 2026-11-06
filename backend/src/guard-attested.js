// Attested verdict for one typed payment, and the strongest honest check behind it.
//
// What this is:
//   The visitor's typed payment (payee, chain, asset, amount, invoice, row, nonce) is
//   canonicalised and hashed. That hash is the nonce sent to NEAR AI's attestation
//   endpoint, so the TEE report is bound to THIS payment and to nothing else: a report
//   fetched for another payment has a different report_data and fails `nonceBound`.
//   Every check in backend/src/tee.js then runs on the report (DCAP quote, TCB, debug
//   bit off, signer bound, nonce bound, MRCONFIGID, RTMR3 replay, compose event, NRAS
//   for the GPU). The verdict is only `attested:true` when all of them pass AND a
//   completion signature verifies against that report.
//
// What this is not:
//   It is not a claim that the model's opinion is correct, and it is not an on-chain
//   TEE: the board and the guard contract never read this. The guard's own limits (the
//   visitor's row caps) decide on chain either way. Do not describe it as provider proof
//   of payee safety.
//
// The honest fallbacks are labelled:
//   no key         -> { enabled:false, reason:'server has no NEAR AI key' }
//   report fails   -> { enabled:true, attested:false, failure:'<the first failed check>' }
//   no completion  -> { enabled:true, report:{...ok}, completion:null }
//   full pass      -> { enabled:true, attested:true, ...checks }
import { canonicalContext } from '../../app/src/panels/guard-pay.js';
import { checkNearReport, fetchReport } from './tee.js';
import { cfg } from './config.js';

/** The context hash is the nonce the TEE report must carry. Deterministic, no secrets. */
export async function contextNonce(fields = {}) {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(canonicalContext(fields)).digest('hex');
}

/**
 * Read the TEE report for this payment context and check it. `deps.report` is injectable so
 * the tests never need a network or an API key.
 */
export async function attestedVerdict(fields = {}, { report = fetchReport, check = checkNearReport, nonce = null } = {}) {
  const ctx = {
    payee: String(fields.payee || '').toLowerCase(),
    chain: String(fields.chain || 'near').toLowerCase(),
    asset: String(fields.asset || 'NEAR').toUpperCase(),
    amount: String(fields.amount || ''),
    invoice: String(fields.invoice || ''),
    row: String(fields.row || ''),
    keyEpoch: String(fields.keyEpoch ?? ''),
    policyVersion: String(fields.policyVersion ?? ''),
  };
  const bound = nonce || await contextNonce(ctx);
  const out = {
    scheme: 'near-ai-tdx-bound-context',
    version: 1,
    context: ctx,
    context_sha256: bound,
    bound_to: 'the typed payee, chain, asset, amount, invoice, row, key epoch and policy version',
    claims: 'A TDX quote bound to this payment context passed every check, and the completion signature verified against it. It is not a claim that the payee is safe and it is not on chain.',
    // The board and the guard contract never read this: the row caps decide on chain.
    on_chain: false,
  };
  if (!cfg.nearAi) return { ...out, enabled: false, attested: false, reason: 'server has no NEAR AI key' };
  let rep;
  try { rep = await report({ nonce: bound }); }
  catch (e) { return { ...out, enabled: true, attested: false, failure: `attestation fetch: ${e?.message || e}`, status: e?.status || 502 }; }
  const g = await check(rep.body?.gateway_attestation, rep.nonce ?? bound);
  const models = [];
  for (const m of rep.body?.model_attestations || []) {
    const r = await check(m, rep.nonce ?? bound);
    r.model_name = m.model_name;
    models.push(r);
  }
  const bad = [];
  if (!g.ok) bad.push(`gateway: ${Object.entries(g.checks || {}).filter(([, v]) => !v).map(([k]) => k).join(', ') || g.error || 'failed'}`);
  if (!models.length) bad.push('model: NEAR AI returned no model report');
  for (const m of models) {
    if (!m.ok) bad.push(`${m.model_name || 'model'}: ${Object.entries(m.checks || {}).filter(([, v]) => !v).map(([k]) => k).join(', ') || m.error || 'failed'}`);
  }
  const attested = bad.length === 0;
  return {
    ...out,
    enabled: true,
    model: rep.model,
    attested,
    failure: attested ? '' : bad.join('; '),
    gateway: { ok: g.ok, checks: g.checks, tcb: g.tcbStatus, signing_algo: g.signing_algo, signing_address: g.signing_address },
    models: models.map(m => ({ model_name: m.model_name, ok: m.ok, checks: m.checks, tcb: m.tcbStatus, signing_algo: m.signing_algo, signing_address: m.signing_address })),
    live: true,
  };
}
