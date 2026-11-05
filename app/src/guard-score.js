// Plain words for one counterparty check. The API returns the signals. This only labels them.

export function explainCheck(check) {
  const s = check?.signals || {};
  const reasons = Array.isArray(check?.reasons) ? check.reasons : [];
  const code = id => reasons.find(r => r.code === id);
  const hours = s.age_ms == null ? null : Math.max(1, Math.round(Number(s.age_ms) / 3600_000));
  const lines = [
    {
      id: 'age',
      title: 'Account age',
      level: hours == null ? 'unknown' : (code('new_account') ? 'warn' : 'info'),
      text: hours == null ? 'The index did not return a first-seen time.' : `First seen ${hours} h ago.`,
    },
    {
      id: 'code',
      title: 'Code hash',
      level: code('code_changed') ? 'warn' : 'info',
      text: s.code_changed_ms != null
        ? `Contract code changed ${Math.max(1, Math.round(s.code_changed_ms / 3600_000))} h ago.`
        : (s.code_hash ? `Code hash ${s.code_hash}. No recent change in the window.` : 'This account has no contract code hash.'),
    },
    {
      id: 'lookalike',
      title: 'Lookalike',
      level: s.lookalike_of ? 'block' : 'ok',
      text: s.lookalike_of ? `This name imitates ${s.lookalike_of}, which the charter allows.` : 'The name does not imitate an allowed payee.',
    },
    {
      id: 'denylist',
      title: 'Denylist',
      level: s.deny && !s.deny.evidence ? 'block' : (s.deny ? 'block' : 'ok'),
      text: s.deny?.reason || 'Not on the deny list.',
    },
    {
      id: 'refusals',
      title: 'Recorded refusals',
      level: s.deny?.evidence?.length ? 'block' : 'ok',
      text: s.deny?.evidence?.length
        ? `A mainnet refusal is already recorded: ${s.deny.evidence[0]}.`
        : 'No recorded mainnet refusal for this account.',
      tx: s.deny?.evidence?.[0] || '',
    },
  ];
  return { account: check?.account || s.account || '', verdict: check?.verdict || 'warn', lines };
}
