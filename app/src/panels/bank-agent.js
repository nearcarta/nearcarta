// In-shop lines for Mist Bank. The same actions as the tray buttons.
export const BANK_HINT = 'Try: Send 0.001 NEAR privately · Verify the TEE · Show the attestation file.';

const NOTES = [0.001, 0.002, 0.005];

export function parseBankAgent(text, { notes = NOTES, capNear = null } = {}) {
  const t = String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!t) return { ok: false, hint: BANK_HINT };
  if (t === 'verify the tee' || t === 'verify tee now' || t === 'verify tee') {
    return { ok: true, action: 'tee', hint: 'Checking the live attestation. No NEAR moves.' };
  }
  if (t === 'verify the seal' || t === 'verify seal') {
    return { ok: true, action: 'seal', hint: 'The sealed rule stays hidden until it is used.' };
  }
  if (t === 'show the attestation file' || t === 'show attestation file' || t === 'show attestation' || t === 'show the proof file') {
    return { ok: true, action: 'file', hint: 'The attestation file is ready.' };
  }
  const m = t.match(/^send\s+(\d+(?:\.\d+)?)\s*near\b/);
  if (!m) return { ok: false, hint: BANK_HINT };
  const amount = Number(m[1]);
  const allowed = (notes || NOTES).map(Number);
  if (capNear != null && Number.isFinite(Number(capNear)) && amount > Number(capNear) + 1e-12) {
    return { ok: false, hint: `That note is over your cap of ${capNear} NEAR. Nothing was sent.` };
  }
  if (!allowed.some(n => Math.abs(n - amount) < 1e-9)) {
    return { ok: false, hint: `Pick one of the set amounts: ${allowed.join(', ')} NEAR. Nothing was sent.` };
  }
  return { ok: true, action: 'send', amount, hint: `Sending ${amount} NEAR privately under your cap. No wallet.` };
}
