// Public ledger: every sale, payout, refusal and inference cost we can read, in one list.
// Pure buildLedger() so tests run without the chain; the route just feeds it the live reads.
const Y = 10n ** 24n;
const nearOf = y => { try { const b = BigInt(y); const f = (b % Y).toString().padStart(24, '0').slice(0, 6).replace(/0+$/, ''); return `${b / Y}${f ? '.' + f : ''}`; } catch { return null; } };
const ethOf = w => { try { const b = BigInt(w); const f = (b % 10n ** 18n).toString().padStart(18, '0').slice(0, 8).replace(/0+$/, ''); return `${b / 10n ** 18n}${f ? '.' + f : ''}`; } catch { return null; } };
const KIND = { pay: 'payout', tip: 'payout', ask: 'payout', arena: 'payout', toll: 'sale', house: 'payout', ferry: 'sale' };

export function buildLedger({ chronicle, toll, budget, now = new Date().toISOString() } = {}) {
  const rows = [];
  for (const t of chronicle?.txs || []) for (const e of t.events || []) {
    if (e.standard !== 'oath' || e.event !== 'action') continue;
    for (const d of e.data || []) {
      const ok = d.decision === 'allowed';
      rows.push({ at: t.at || null, shop: d.shop || 'charter', kind: ok ? (KIND[d.shop] || 'payout') : 'refusal', to: d.receiver || null,
        amount: ok ? nearOf(d.amount) : '0', asset: 'NEAR (testnet)', note: ok ? null : (d.reason || d.decision), tx: t.hash, url: t.url || null });
    }
  }
  for (const r of toll?.recent || []) {
    rows.push({ at: r.at || null, shop: 'toll', kind: r.status === 'confirmed' ? 'payout' : 'pending', to: r.to || null, amount: ethOf(r.value),
      asset: 'ETH (Base Sepolia)', note: `nonce ${r.nonce}`, tx: r.tx_hash || null, url: r.tx_hash ? `https://sepolia.basescan.org/tx/${r.tx_hash}` : null });
  }
  if (budget) rows.push({ at: budget.day, shop: 'agent', kind: 'inference', to: 'NEAR AI Cloud', amount: String(budget.usd ?? 0), asset: 'USD',
    note: `${budget.calls ?? 0} calls today, model ${budget.model || '?'}`, tx: null, url: null });
  rows.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  const sum = (k, asset) => rows.filter(r => r.kind === k && r.asset === asset).reduce((s, r) => s + Number(r.amount || 0), 0);
  return {
    generated_at: now, network: 'testnet',
    totals: { payouts_near: +sum('payout', 'NEAR (testnet)').toFixed(6), sales_near: +sum('sale', 'NEAR (testnet)').toFixed(6),
      payouts_base_eth: +sum('payout', 'ETH (Base Sepolia)').toFixed(8), refusals: rows.filter(r => r.kind === 'refusal').length,
      inference_usd_today: +(budget?.usd ?? 0) },
    // A cached (stale-while-revalidate) feed is still complete; only a missing feed or a failed tx read is partial.
    partial: !!(chronicle?.busy || (chronicle?.txs || []).some(t => t.error)),
    partial_reason: chronicle?.busy ? 'feed busy' : (chronicle?.txs || []).some(t => t.error) ? 'tx read error' : null,
    cached: !!chronicle?.stale,
    unread: (chronicle?.txs || []).filter(t => t.error).map(t => ({ tx: t.hash, error: t.error })),
    rows,
  };
}
