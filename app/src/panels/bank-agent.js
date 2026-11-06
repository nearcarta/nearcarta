// Natural-language commands for the Mist Bank auditor. The same actions as the gold button.

export const BANK_HINT = 'Try Audit the cafe sample, Verify the TEE, Show the proof log, or Apply tighter limits.';

export function parseBankAgent(text, { review } = {}) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return { ok: false, hint: BANK_HINT };
  if (/verify the tee|verify tee/.test(t)) return { ok: true, action: 'tee' };
  if (/attestation file|proof log|show the proof/.test(t)) return { ok: true, action: 'file' };
  if (/what was unusual|explain the anomal/.test(t)) return { ok: true, action: 'explain' };
  if (/loosen|raise the cap|reset spent|unfreeze|swap the key|wider payee/.test(t)) {
    return { ok: false, hint: 'A looser limit, a reset, or an unfreeze was refused. Nothing was signed.' };
  }
  if (/apply tighter|tighter limits/.test(t)) {
    if (!review) return { ok: false, hint: 'Audit a sample first. Nothing was signed.' };
    return { ok: true, action: 'apply' };
  }
  if (/audit/.test(t)) {
    const sample = /travel/.test(t) ? 'travel' : /payroll/.test(t) ? 'payroll' : 'cafe';
    return { ok: true, action: 'audit', sample };
  }
  return { ok: false, hint: BANK_HINT };
}
