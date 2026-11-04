// One receipt shape for every rail. Built from the mainnet deployment record and the
// model budget. No live RPC: the txs are the ones already recorded in shared/deployments/mainnet.json.
export const RECEIPT_KEYS = ['rail', 'network', 'what', 'to', 'amount', 'asset', 'decision', 'reason', 'decided_by', 'tx', 'url', 'checks'];

const nb = h => h ? `https://nearblocks.io/txns/${h}` : null;

export function receipt(row) {
  const c = row.checks || {};
  return {
    rail: row.rail,
    network: row.network,
    what: row.what,
    to: row.to ?? null,
    amount: row.amount == null ? null : String(row.amount),
    asset: row.asset ?? null,
    decision: row.decision,
    reason: row.reason ?? null,
    decided_by: row.decided_by,
    tx: row.tx ?? null,
    url: row.url ?? null,
    checks: {
      charter: c.charter ?? null,
      within_allowance: c.within_allowance ?? null,
      tee: c.tee ?? null,
    },
  };
}

function near(what, to, amount, decision, reason, tx, within) {
  return receipt({
    rail: 'near', network: 'mainnet', what, to, amount, asset: 'NEAR', decision, reason,
    decided_by: 'charter', tx, url: nb(tx),
    checks: { charter: true, within_allowance: within, tee: null },
  });
}

/** A checkout receipt. `tx` is the deposit address, or the chain tx once status reports one. */
export function intentsCheckout(row) {
  const tx = row.tx ?? null;
  const nearTx = typeof tx === 'string' && !tx.startsWith('0x') && tx.length >= 32 && tx.length <= 50;
  return receipt({
    rail: 'intents', network: 'mainnet',
    what: row.what || (row.decision === 'allowed' ? 'checkout deposit address' : 'checkout refused'),
    to: row.to ?? null,
    amount: row.amount == null ? null : String(row.amount),
    asset: row.asset || 'USD',
    decision: row.decision,
    reason: row.reason ?? null,
    decided_by: 'charter',
    tx, url: row.url ?? (nearTx ? nb(tx) : null),
    checks: { charter: true, within_allowance: row.decision === 'allowed', tee: null },
  });
}

export function mainnetReceipts(m, { budget = {}, jobTokens = 160, checkouts = [] } = {}) {
  if (!m?.charter) return [];
  const payee = m.charter.clause_pay?.receivers?.[0] || null;
  const rows = [
    near('agent paid 0.001 NEAR', payee, '0.001', 'allowed', null, m.charter.txs['agent_propose_allowed_0.001'], true),
    near('agent asked 0.003 NEAR, over the cap', payee, '0.003', 'refused', 'over_per_action_cap', m.charter.txs['agent_propose_over_cap_0.003'], false),
  ];
  const toll = m.toll;
  if (toll?.txs) {
    rows.push(receipt({
      rail: 'chain-signatures', network: 'mainnet', what: 'toll signed an allowlisted payout',
      to: toll.foreign_address || null, amount: null, asset: 'ETH', decision: 'allowed',
      reason: 'The toll contract asked the chain-signature signer. The NEAR tx is the receipt. The derived Base address was unfunded, so the foreign tx was not broadcast.',
      decided_by: 'charter', tx: toll.txs.owner_toll_pay_allowlisted, url: nb(toll.txs.owner_toll_pay_allowlisted),
      checks: { charter: true, within_allowance: true, tee: null },
    }));
    rows.push(receipt({
      rail: 'chain-signatures', network: 'mainnet', what: 'toll refused an address that is not allowlisted',
      to: null, amount: null, asset: 'ETH', decision: 'refused', reason: 'not_allowlisted',
      decided_by: 'charter', tx: toll.txs.owner_toll_pay_not_allowlisted, url: nb(toll.txs.owner_toll_pay_not_allowlisted),
      checks: { charter: true, within_allowance: false, tee: null },
    }));
  }
  const ex = m.extras || {};
  for (const [shop, allowed, refused, whatOk, whatNo] of [
    ['arena', 'arena_agent_pay_allowed_0.001', 'arena_agent_pay_refused_0.002', 'arena agent paid 0.001 NEAR', 'arena agent asked 0.002 NEAR, over the cap'],
    ['house', 'house_pay_allowed_0.001', 'house_pay_refused_0.002', 'house paid 0.001 NEAR', 'house asked 0.002 NEAR, over the cap'],
    ['townhall', 'townhall_reward_allowed_0.001', 'townhall_reward_refused_0.002', 'town hall paid a 0.001 NEAR reward', 'town hall refused a 0.002 NEAR reward'],
  ]) {
    const t = ex[shop]?.txs;
    if (!t) continue;
    rows.push(near(whatOk, null, '0.001', 'allowed', null, t[allowed], true));
    rows.push(near(whatNo, null, '0.002', 'refused', 'over_per_action_cap', t[refused], false));
  }
  rows.push(receipt({
    rail: 'intents', network: 'mainnet', what: '1Click quote', to: null, amount: null, asset: null,
    decision: 'dry', reason: '1Click has no testnet. A quote is dry: no deposit address is created and nothing is spent.',
    decided_by: 'quote guard', tx: null, url: null,
    checks: { charter: null, within_allowance: null, tee: null },
  }));
  for (const c of checkouts) rows.push(intentsCheckout(c));
  const limit = budget.limit_usd ?? null;
  rows.push(receipt({
    rail: 'near-ai', network: 'mainnet', what: 'model job', to: budget.model || null,
    amount: limit == null ? null : String(limit), asset: 'USD', decision: 'capped',
    reason: `Each job is at most ${jobTokens} tokens and is not sent once the day reaches ${limit ?? '?'} USD or ${budget.limit_calls ?? '?'} calls. That dollar cap is the operator's model budget. The NEAR the job can move is capped by the charter.`,
    decided_by: 'budget', tx: null, url: null,
    checks: { charter: null, within_allowance: true, tee: null },
  }));
  return rows;
}

export function receiptsBody(mainnet, budget = {}, { jobTokens = 160, checkouts = [] } = {}) {
  const receipts = mainnetReceipts(mainnet, { budget, jobTokens, checkouts });
  return {
    gate: 'The spend gate is the charter contract. The agent holds a function-call key for propose and propose_batch only. It cannot transfer, and it cannot change the rules.',
    shape: RECEIPT_KEYS,
    rails: {
      near: 'A propose on the charter. The receipt is the NEAR tx: allowed, or refused with a reason.',
      'chain-signatures': 'The toll contract asks the MPC signer. The receipt is the NEAR tx that requested the signature. An address off the list is refused before a signature.',
      intents: 'A dry 1Click quote has no deposit address and no tx. A checkout adds another intents receipt only after the charter allows the recipient: its tx is the deposit address, then the chain tx once the status says the swap settled. The amount is at most 0.20 USD.',
      'near-ai': 'A TEE model call. The call is capped per job and per day before it is sent. Any NEAR it asks to move is still judged by the charter.',
    },
    inference: {
      usd_today: budget.usd ?? 0,
      calls_today: budget.calls ?? 0,
      limit_usd: budget.limit_usd ?? null,
      limit_calls: budget.limit_calls ?? null,
      max_tokens: budget.max_tokens ?? jobTokens,
      model: budget.model || null,
    },
    receipts,
  };
}
