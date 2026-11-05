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
      ? 'Live check passed. The button asks NEAR AI now. The file tee-public.json is the recorded Oct 28 result.'
      : 'Live check did not pass. The button asks NEAR AI now. The file tee-public.json is the recorded Oct 28 result.',
  };
}
