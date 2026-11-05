// Turn live API payloads into the fields the shop rooms read.
// Missing nested fields stay on the static sample. A partial payload must not throw.

const N = y => {
  if (y == null || y === '') return 0;
  try { return Number(BigInt(y) / 10n ** 20n) / 1e4; } catch { return 0; }
};

const ghOf = dep => (dep && typeof dep === 'object' && dep.guardhouse && typeof dep.guardhouse === 'object') ? dep.guardhouse : null;

export function shapeCore(dep, guard, sample) {
  const st = guard && typeof guard.state === 'object' && guard.state ? guard.state : null;
  if (!st) return sample;
  const gh = ghOf(dep);
  return {
    ...sample,
    oath: guard.oath || sample.oath,
    owner: st.owner ?? sample.owner,
    dao: st.dao ?? sample.dao,
    policyVersion: st.policy_version ?? sample.policyVersion,
    policyHash: st.policy_hash ?? sample.policyHash,
    freezeEpoch: st.freeze_epoch ?? sample.freezeEpoch,
    frozen: st.frozen === true,
    agentKey: st.agent_key ?? sample.agentKey,
    codeHash: gh?.code_hash || sample.codeHash,
    receiver: gh?.allowed_receiver || sample.receiver,
    snapshot: 'live read ' + new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
    src: 'mainnet',
  };
}

export function shapeClauses(guard, sample) {
  const clauses = guard && guard.clauses && typeof guard.clauses === 'object' ? guard.clauses : null;
  if (!clauses) return sample;
  const usage = guard.usage && typeof guard.usage === 'object' ? guard.usage : {};
  return Object.entries(clauses).map(([id, c]) => ({
    id,
    kind: 'Native transfer',
    payees: Array.isArray(c?.receivers) ? c.receivers : [],
    cap: N(c?.per_action_cap),
    budget: N(c?.daily_budget),
    spent: N(usage[id]?.spent),
    reserved: N(usage[id]?.reserved),
    window: 'Any time',
    escalate: c?.escalation_max ? { max: N(c.escalation_max), by: 'Owner', timeout: 'timelock' } : null,
    receipt: !!c?.requires_receipt,
    src: 'mainnet',
    tx: null,
  }));
}

export function shapeActions(chronicle, sample) {
  const txs = Array.isArray(chronicle?.txs) ? chronicle.txs : [];
  const acts = txs.filter(t => t && t.method === 'propose' && t.result?.ok && t.result?.value).reverse().map((t, i) => {
    const e = t.events?.[0]?.data?.[0] || {};
    const value = t.result.value;
    return {
      id: 'P' + (i + 1),
      time: (t.at || '').slice(11, 19) + ' UTC',
      what: `${e.clause_id || ''} ${N(e.amount)} NEAR → ${e.receiver || '?'}`,
      kind: 'action',
      decision: value.decision,
      reason: value.reason === 'ok' ? undefined : value.reason,
      amount: N(e.amount),
      clause: e.clause_id,
      tx: t.hash,
      src: 'mainnet',
    };
  });
  return acts.length ? acts : sample;
}

export function shapeBank(mb) {
  if (!mb?.built || !mb.payout || !mb.street || !mb.oath) return null;
  const legs = mb.desk?.available && mb.desk.legs && typeof mb.desk.legs === 'object' ? mb.desk.legs : null;
  return {
    src: 'mainnet',
    street: {
      txid: mb.payout.txid, url: mb.payout.explorer, height: mb.street.height, confirmations: mb.street.confirmations, fee: mb.street.fee_zat,
      hidden: mb.street.amount_hidden === true, reasons: mb.street.reasons || [],
      pool: Object.entries(mb.street.value_balance_zat || {}).find(([, v]) => v !== '0')?.[0] || 'shielded',
    },
    oath: { tx: mb.oath.tx, ok: mb.oath.success && mb.oath.decision === 'allowed' && mb.oath.memo_on_chain, clause: mb.oath.clause_id },
    commitment: { value: mb.commitment?.value, scheme: mb.commitment?.scheme },
    binding: { capsAmount: mb.binding?.charter_caps_zec_amount === true, timing: mb.binding?.timing },
    auditor: { verify: mb.auditor?.verify },
    desk: legs ? Object.entries(legs).map(([k, l]) => ({ leg: k, ok: l?.ok, privacy: l?.privacy, sig: l?.signature, echo: l?.echo?.ok, out: l?.amountOut })) : [],
  };
}
