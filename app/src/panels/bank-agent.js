// Natural-language commands for the Mist Bank auditor. The same actions as the gold button.

export const BANK_HINT = 'Paste a statement or choose a file. You can also say Audit the cafe sample, Verify the TEE, or Show the proof log.';
export const NEED_STATEMENT = 'Paste a statement or choose a file. I will not use a sample unless you name one.';

function questionOf(t) {
  if (/subscription|recurring/.test(t)) return 'subscription';
  if (/duplicate|double charge|same day|\brepeat/.test(t)) return 'duplicate';
  if (/\blimit\b|\bcap\b/.test(t) && !/tighter limits|apply tighter/.test(t)) return 'limit';
  if (/\bwaste\b|biggest|overspend|charges look|my spending|my list|my statement|this statement/.test(t)) return 'waste';
  return '';
}

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
  const named = /\btravel\b/.test(t) ? 'travel' : /\bpayroll\b/.test(t) ? 'payroll' : (/\bcafe\b/.test(t) ? 'cafe' : '');
  const question = questionOf(t);
  const namedSample = named && /sample|cafe week|travel week|payroll/.test(t);
  if (namedSample && (/audit/.test(t) || question)) {
    return { ok: true, action: 'audit', sample: named, source: 'sample', question: question || 'audit' };
  }
  if (question) {
    if (!hasStatement && !review) return { ok: false, hint: NEED_STATEMENT };
    return { ok: true, action: 'audit', source: 'loaded', question };
  }
  if (/audit/.test(t)) {
    if (named) return { ok: true, action: 'audit', sample: named, source: 'sample', question: 'audit' };
    if (hasStatement || review) return { ok: true, action: 'audit', source: 'loaded', question: 'audit' };
    return { ok: false, hint: NEED_STATEMENT };
  }
  return { ok: false, hint: BANK_HINT };
}
