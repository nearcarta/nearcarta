// The Arena round verdict text, exactly as contracts/arena_v2 rebuilds it in
// `verdict_text`. The attested model signs these bytes; the contract verifies them with
// env::ed25519_verify against the key the owner pinned. One source for the backend, the
// browser and the tests, so the string cannot drift between them.
//
//   nearcarta.arena.verdict.v1|network|contract|attempt|player|guardian|
//   prompt_hash|oath_hash|persona_hash|response_hash|pay_to|pay_amount|model
//
// Every field is either snapshotted on the attempt or named in the envelope. A different
// player, round, prompt, oath, persona, response, payee, amount or model is a different
// verdict, so a signature cannot be moved between rounds.
// contracts/arena_v2/src/lib.rs `verdict_text`. docs.near.ai/cloud/verification.

export const VERDICT_PREFIX = 'nearcarta.arena.verdict.v1';
export const VERDICT_NETWORK = 'mainnet';

/**
 * The exact bytes the model signs. `pay_to` is the empty string when the verdict names no
 * payee (an in-oath win with nothing to pay), matching the contract's `unwrap_or_default`.
 */
export function verdictText({
  contract, attemptId, player, guardianId, promptHash, oathHash, personaHash,
  responseHash, payTo = '', payAmount = '0', model,
}) {
  return [
    VERDICT_PREFIX,
    VERDICT_NETWORK,
    String(contract || ''),
    String(attemptId ?? ''),
    String(player || ''),
    String(guardianId ?? ''),
    String(promptHash || ''),
    String(oathHash || ''),
    String(personaHash || ''),
    String(responseHash || ''),
    String(payTo || ''),
    String(payAmount ?? '0'),
    String(model || ''),
  ].join('|');
}

/** The text for an attempt record plus the model's answer. */
export function verdictFor(attempt, { contract, responseHash, payTo = '', payAmount = '0', model }) {
  const a = attempt || {};
  return verdictText({
    contract,
    attemptId: a.id ?? a.attempt_id,
    player: a.player,
    guardianId: a.guardian_id,
    promptHash: a.prompt_hash,
    oathHash: a.oath_hash,
    personaHash: a.persona_hash,
    responseHash,
    payTo,
    payAmount,
    model,
  });
}

/**
 * True when a NEAR AI signature record covers this verdict. The check is structural:
 * text, algorithm and signature hex. The cryptographic check happens on chain, so a
 * caller can never mark a round settled by asserting a boolean here.
 */
export function verdictShape({ text, signature, signingAlgo = 'ed25519' }) {
  const problems = [];
  if (typeof text !== 'string' || !text.startsWith(VERDICT_PREFIX + '|')) problems.push('the signed text is not an Arena verdict');
  if (String(signingAlgo).toLowerCase() !== 'ed25519') problems.push(`the signature is ${signingAlgo || 'unnamed'}, not ed25519`);
  if (!/^[0-9a-f]{128}$/i.test(String(signature || ''))) problems.push('the signature is not 128 hex characters');
  return { ok: problems.length === 0, problems };
}
