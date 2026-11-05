import { reasonLabel } from '../../shared/net/reasons.js';
// Public ledger: every sale, payout, refusal and inference cost we can read, in one list.
// Pure buildLedger() so tests run without the chain; the route just feeds it the live reads.
const Y = 10n ** 24n;
const nearOf = y => { try { const b = BigInt(y); const f = (b % Y).toString().padStart(24, '0').slice(0, 6).replace(/0+$/, ''); return `${b / Y}${f ? '.' + f : ''}`; } catch { return null; } };
const ethOf = w => { try { const b = BigInt(w); const f = (b % 10n ** 18n).toString().padStart(18, '0').slice(0, 8).replace(/0+$/, ''); return `${b / 10n ** 18n}${f ? '.' + f : ''}`; } catch { return null; } };
const KIND = { pay: 'payout', tip: 'payout', ask: 'payout', arena: 'payout', toll: 'sale', house: 'payout', ferry: 'sale' };
const SHOP = { pay: 'Guardhouse', tip: 'Your House', ask: 'Charter office', arena: 'Vault Arena', toll: 'Toll Bridge', house: 'Your House', ferry: 'Ferry', guardhouse: 'Guardhouse' };

export function buildLedger({ chronicle, toll, gate, budget, now = new Date().toISOString() } = {}) {
  const rows = [];
  for (const t of chronicle?.txs || []) for (const e of t.events || []) {
    if (e.standard !== 'oath' || e.event !== 'action') continue;
    for (const d of e.data || []) {
      const ok = d.decision === 'allowed';
      rows.push({ at: t.at || null, shop: SHOP[d.shop] || 'Charter office', kind: ok ? (KIND[d.shop] || 'payout') : 'refusal', to: d.receiver || null,
        amount: ok ? nearOf(d.amount) : '0', asset: 'NEAR', note: ok ? null : reasonLabel(d.reason || d.decision), tx: t.hash, url: t.hash ? `https://nearblocks.io/txns/${t.hash}` : null });
    }
  }
  // Toll gate: each visit is a sale. The visitor's charter pays the gate fee in NEAR.
  const fee = gate?.policy?.gate?.fee;
  for (const r of gate?.recent || []) {
    rows.push({ at: r.at || r.visit?.at || null, shop: 'Toll Bridge', kind: 'sale', to: gate.policy?.gate?.payee || gate.gate || null, amount: nearOf(fee || '0'),
      asset: 'NEAR', note: `visit ${r.nonce} · Base ${r.status}`, tx: r.tx_hash || null, url: r.explorer || null });
  }
  if (budget) rows.push({ at: budget.day, shop: 'Model budget', kind: 'note', to: null, amount: String(budget.usd ?? 0), asset: 'USD',
    note: `Operator spend on the model today, ${budget.calls ?? 0} calls. Not a charter payment.`, tx: null, url: null });
  rows.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  const sum = (k, asset) => rows.filter(r => r.kind === k && r.asset === asset).reduce((s, r) => s + Number(r.amount || 0), 0);
  return {
    generated_at: now, network: 'recorded',
    totals: { payouts_near: +sum('payout', 'NEAR').toFixed(6), sales_near: +sum('sale', 'NEAR').toFixed(6),
      refusals: rows.filter(r => r.kind === 'refusal').length,
      gate_visits_total: gate?.policy?.next_nonce ?? null,
      gate_sales_near_total: fee && gate?.policy?.next_nonce != null ? Number(nearOf((BigInt(fee) * BigInt(gate.policy.next_nonce)).toString())) : null,
      inference_usd_today: +(budget?.usd ?? 0) },
    // A cached (stale-while-revalidate) feed is still complete; only a missing feed or a failed tx read is partial.
    partial: !!(chronicle?.busy || (chronicle?.txs || []).some(t => t.error)),
    partial_reason: chronicle?.busy ? 'feed busy' : (chronicle?.txs || []).some(t => t.error) ? 'tx read error' : null,
    cached: !!chronicle?.stale,
    unread: (chronicle?.txs || []).filter(t => t.error).map(t => ({ tx: t.hash, error: t.error })),
    rows,
  };
}
