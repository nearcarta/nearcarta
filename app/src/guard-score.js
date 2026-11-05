// Plain words for one counterparty check. The API returns the signals. This only labels them.

const EMPTY_CODE = '11111111111111111111111111111111';

export function explainCheck(check) {
  const s = check?.signals || {};
  const reasons = Array.isArray(check?.reasons) ? check.reasons : [];
  const code = id => reasons.find(r => r.code === id);
  const codes = new Set(reasons.map(r => r.code));
  const hours = s.age_ms == null ? null : Math.max(1, Math.round(Number(s.age_ms) / 3600_000));
  const fetchFailed = codes.has('account_missing');
  const emptyHash = !s.code_hash || s.code_hash === EMPTY_CODE;
  const noContract = !fetchFailed && (emptyHash || codes.has('code_unknown') || (codes.has('unconfirmed') && emptyHash));
  const noFirst = !fetchFailed && (s.age_ms == null || codes.has('age_unknown'));
  const lines = [
    {
      id: 'age',
      title: 'First seen',
      level: noFirst || code('new_account') ? 'warn' : (hours == null ? 'unknown' : 'info'),
      text: noFirst || hours == null ? 'A first-seen time is not available.' : `First seen ${hours} h ago.`,
    },
    {
      id: 'code',
      title: 'Code hash',
      level: code('code_changed') || noContract ? 'warn' : 'info',
      text: s.code_changed_ms != null
        ? `Contract code changed ${Math.max(1, Math.round(s.code_changed_ms / 3600_000))} h ago.`
        : (noContract
          ? 'The code hash is empty, so this account has no contract.'
          : (s.code_hash ? `Code hash ${s.code_hash}. No recent change in the window.` : 'This account has no contract code hash.')),
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
  const covered = new Set(['age_unknown', 'code_unknown', 'unconfirmed', 'new_account', 'code_changed', 'denylisted']);
  for (const r of reasons) {
    if (!r?.code || covered.has(r.code)) continue;
    lines.push({ id: r.code, title: 'Check', level: r.level || 'warn', text: r.text || r.code });
  }
  const named = verdictLine(check);
  return { account: check?.account || s.account || '', verdict: named.verdict, summary: named.summary, causes: named.causes, lines };
}

const CAUSE_ORDER = [
  ['no contract (code hash empty)', codes => codes.has('unconfirmed') || codes.has('code_unknown')],
  ['first-seen unknown', codes => codes.has('age_unknown') || codes.has('unconfirmed')],
  ['first-seen recent', codes => codes.has('new_account')],
  ['code changed', codes => codes.has('code_changed')],
  ['on the deny list', codes => codes.has('denylisted')],
  ['lookalike name', codes => codes.has('lookalike')],
  ['no prior payment', codes => codes.has('no_history')],
  ['account missing', codes => codes.has('account_missing')],
  ['index did not answer', codes => codes.has('index_unknown')],
];

/** The verdict line names the checks that produced it. Allow stays one word. */
export function verdictLine(check) {
  const verdict = check?.verdict || 'warn';
  const word = verdict === 'block' ? 'Block' : verdict === 'allow' ? 'Allow' : 'Warn';
  const reasons = (Array.isArray(check?.reasons) ? check.reasons : []).filter(r => r && r.level === verdict);
  const codes = new Set(reasons.map(r => r.code));
  const causes = [];
  if (verdict !== 'allow') {
    for (const [label, hit] of CAUSE_ORDER) if (hit(codes) && !causes.includes(label)) causes.push(label);
    for (const r of reasons) {
      if (!r.code || CAUSE_ORDER.some(([, hit]) => hit(new Set([r.code])))) continue;
      const extra = r.text || r.code;
      if (extra && !causes.includes(extra)) causes.push(extra);
    }
  }
  const summary = causes.length ? `${word} because: ${causes.join('; ')}` : word;
  return { verdict, summary, causes };
}
