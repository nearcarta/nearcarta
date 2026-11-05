// A transaction status from NEAR RPC. Success is the only pass. A missing body is a fail.

export function txVerdict(body) {
  if (!body || body.error) return { pass: false, why: body?.error || 'no status' };
  if (body.pass === true) return { pass: true, why: body.why || 'success' };
  if (body.pass === false) return { pass: false, why: body.why || 'failed' };
  const status = body.status && typeof body.status === 'object' ? body.status : null;
  if (status?.SuccessValue != null || status?.SuccessReceiptId != null) return { pass: true, why: 'success' };
  if (status?.Failure) return { pass: false, why: 'failure' };
  return { pass: false, why: 'unknown' };
}
