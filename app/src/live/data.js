// Live data interface for the shop interiors (design/D8_shops). The interiors import
// D6_dashboards/src/data.js; the host rewrites that one URL to this module. It re-exports the
// design's own sample data and replaces the values we can read live. If the API is down, the
// design's values stay, each still tagged with its own src.
export * from '/live/data.static.js';
import * as S from '/live/data.static.js';

const API = (globalThis.NEARCARTA_API || '').replace(/\/$/, '');
async function j(path, body) {
  try {
    const r = await fetch(API + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

const DEP = await j('/api/deployments');
const [q, g, ch] = await Promise.all([
  j('/api/ferry/quote', { from: { symbol: 'USDC', chain: 'base' }, to: { symbol: 'wNEAR', chain: 'near' }, amount: '3', recipient: '561e8ef0fecb621469da30250dc6cdcd1e47a66e561e8ef0fecb621469da3025' /* placeholder implicit account: dry quote only, no deposit address exists */, refundTo: '0x561E8eF0FEcB621469dA30250dC6CdCD1E47A66e' }),
  j('/api/guardhouse'),
  DEP ? j(`/api/chronicle/${DEP.guardhouse.oath}?limit=12`) : null,
]);
const N = y => (y == null ? 0 : Number(BigInt(y) / 10n ** 20n) / 1e4);

export const QUOTE = q?.ok
  ? { from: { sym: q.from.symbol, chain: 'Base', amt: q.from.amount }, to: { sym: 'NEAR', chain: 'NEAR', amt: Number(q.to.amount).toFixed(3) },
      eta: `≈ ${q.eta_s} s`, fee: `${q.checks.echo.protocolFeeBps} bps (1Click) · signature ${q.checks.signature ? 'verified' : 'FAILED'}`, src: 'live' }
  : S.QUOTE;

export const CORE = g
  ? { ...S.CORE, oath: g.oath, owner: g.state.owner, dao: g.state.dao, policyVersion: g.state.policy_version, policyHash: g.state.policy_hash,
      freezeEpoch: g.state.freeze_epoch, agentKey: g.state.agent_key, codeHash: DEP?.guardhouse.code_hash ?? S.CORE.codeHash,
      receiver: DEP?.guardhouse.allowed_receiver ?? S.CORE.receiver, snapshot: 'live read ' + new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC', src: 'testnet' }
  : S.CORE;

export const CLAUSES = g
  ? Object.entries(g.clauses).map(([id, c]) => ({ id, kind: 'Native transfer', payees: c.receivers, cap: N(c.per_action_cap), budget: N(c.daily_budget),
      spent: N(g.usage[id]?.spent), reserved: N(g.usage[id]?.reserved), window: 'Any time',
      escalate: c.escalation_max ? { max: N(c.escalation_max), by: 'Owner or DAO', timeout: 'timelock' } : null, receipt: c.requires_receipt, src: 'testnet', tx: null }))
  : S.CLAUSES;

// Live actions, oldest first. Ids P1..Pn so the interiors can still pick P1.
const acts = (ch?.txs || []).filter(t => t.method === 'propose' && t.result?.ok).reverse().map((t, i) => {
  const e = t.events?.[0]?.data?.[0] || {};
  return { id: 'P' + (i + 1), time: (t.at || '').slice(11, 19) + ' UTC', what: `${e.clause_id || ''} ${N(e.amount)} NEAR → ${e.receiver || '?'}`, kind: 'action',
    decision: t.result.value.decision, reason: t.result.value.reason === 'ok' ? undefined : t.result.value.reason, amount: N(e.amount), clause: e.clause_id, tx: t.hash, src: 'testnet' };
});
export const CORE_TXS = acts.length ? acts : S.CORE_TXS;

// Mist Bank: a real Zcash testnet shielded payout, its NEAR testnet oath approval, the ledger
// disclosed with the payee viewing key, and live dry Confidential Intents quotes. null = keep SAMPLE.
const mb = await j('/api/mistbank');
export const BANK = mb?.built ? {
  src: 'testnet',
  street: { txid: mb.payout.txid, url: mb.payout.explorer, height: mb.street.height, confirmations: mb.street.confirmations, fee: mb.street.fee_zat,
    hidden: mb.street.amount_hidden === true, reasons: mb.street.reasons || [], pool: Object.entries(mb.street.value_balance_zat || {}).find(([, v]) => v !== '0')?.[0] || 'shielded' },
  oath: { tx: mb.oath.tx, ok: mb.oath.success && mb.oath.decision === 'allowed' && mb.oath.memo_on_chain, clause: mb.oath.clause_id },
  ledger: { taz: mb.ledger?.taz, binds: mb.binds === true, ufvk: mb.disclosure?.ufvk },
  desk: mb.desk?.available ? Object.entries(mb.desk.legs).map(([k, l]) => ({ leg: k, ok: l.ok, privacy: l.privacy, sig: l.signature, echo: l.echo?.ok, out: l.amountOut })) : [],
} : null;
