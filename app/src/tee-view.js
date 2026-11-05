// Shape a TEE check for the Mist Bank button. The proof file is a recorded public summary.

export const PROOF_HREF = '/tee-public.json';

export function teeResult(body, proofHref = PROOF_HREF) {
  const ok = body?.ok === true;
  return {
    ok,
    label: ok ? 'attested' : 'failed',
    proof: proofHref,
    model: body?.model || '',
    text: ok
      ? 'Attested. The private AI check passed. The proof file is the recorded result.'
      : 'Failed. The private AI check did not pass. The proof file is the last recorded result.',
  };
}
