// Natural-language commands for the Mist Bank auditor. The same actions as the gold button.

export const BANK_HINT = 'Paste a statement or choose a file. You can also say Audit the cafe sample, Verify the TEE, or Show the proof log.';
export const NEED_STATEMENT = 'Paste a statement or choose a file. I will not use a sample unless you name one.';

export function parseBankAgent(text, { review, hasStatement } = {}) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return { ok: false, hint: BANK_HINT };
  if (/verify the tee|verify tee/.test(t)) return { ok: true, action: 'tee' };
  if (/attestation file|proof log|show the proof/.test(t)) return { ok: true, action: 'file' };
  if (/what was unusual|explain the anomal/.test(t)) return { ok: true, action: 'explain' };
  if (/loosen|raise the cap|reset spent|unfreeze|swap the key|wider payee/.test(t)) {
    return { ok: false, hint: 'A looser limit, a reset, or an unfreeze was refused. Nothing was signed.' };
  }
  if (/apply tighter|tighter limits/.test(t)) {
    if (!review) return { ok: false, hint: 'Audit a statement first. Nothing was signed.' };
    return { ok: true, action: 'apply' };
  }
  const named = /travel/.test(t) ? 'travel' : /payroll/.test(t) ? 'payroll' : (/cafe/.test(t) ? 'cafe' : '');
  const wantsWaste = /biggest waste|my spending|my statement|this statement|the file|uploaded|pasted/.test(t);
  const wantsAudit = /audit/.test(t) || wantsWaste;
  if (wantsAudit && named && /sample|cafe week|travel week|payroll/.test(t)) {
    return { ok: true, action: 'audit', sample: named, source: 'sample', question: wantsWaste ? 'waste' : 'audit' };
  }
  if (wantsWaste || (wantsAudit && /my |this statement|the file|uploaded|pasted/.test(t))) {
    if (!hasStatement && !review) return { ok: false, hint: NEED_STATEMENT };
    return { ok: true, action: 'audit', source: 'loaded', question: 'waste' };
  }
  if (/audit/.test(t)) {
    if (named) return { ok: true, action: 'audit', sample: named, source: 'sample', question: 'audit' };
    if (hasStatement || review) return { ok: true, action: 'audit', source: 'loaded', question: 'audit' };
    return { ok: false, hint: NEED_STATEMENT };
  }
  return { ok: false, hint: BANK_HINT };
}
