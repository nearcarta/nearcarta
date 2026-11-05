// The Pay page's token list, quote comparison and status words.
// The page asks 1Click for the list. This module only shapes what came back.

export function normalizeToken(row) {
  if (!row || typeof row !== 'object') return null;
  const symbol = String(row.symbol || '').trim();
  const chain = String(row.blockchain || row.chain || '').trim();
  if (!symbol || !chain) return null;
  return {
    symbol,
    chain,
    id: `${symbol}|${chain}`,
    label: `${symbol} on ${chain}`,
    decimals: row.decimals ?? null,
    price: row.price ?? null,
  };
}

export function tokenChoices(rows) {
  const out = [];
  const seen = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    const t = normalizeToken(row);
    if (!t || seen.has(t.id)) continue;
    seen.add(t.id);
    out.push(t);
  }
  return out;
}

export function chainsOf(choices) {
  return [...new Set((choices || []).map(t => t.chain))].sort();
}

export function filterTokens(choices, { q = '', chain = '' } = {}) {
  const query = String(q || '').trim().toLowerCase();
  return (choices || []).filter(t => (!chain || t.chain === chain) && (!query || t.symbol.toLowerCase().includes(query) || t.chain.toLowerCase().includes(query) || t.label.toLowerCase().includes(query)));
}

export function quoteView(q) {
  if (!q) return null;
  const to = q.to || {};
  const from = q.from || {};
  return {
    amountOut: to.amount ?? q.amountOut ?? null,
    symbolOut: to.symbol || '',
    usd: q.usd ?? from.amountUsd ?? to.amountUsd ?? null,
    eta: q.eta_s ?? q.eta ?? null,
    fee: q.cost_bps_signed ?? q.fee ?? q.checks?.echo?.protocolFeeBps ?? null,
    privacy: q.privacy || 'public',
    dry: q.dry === true || q.checks?.dry === true,
  };
}

export function compareRows(quotes) {
  return (Array.isArray(quotes) ? quotes : []).map(quoteView).filter(Boolean);
}

const REFUND = new Set(['REFUNDED', 'INCOMPLETE_DEPOSIT']);
const DONE = new Set(['SUCCESS', 'REFUNDED', 'FAILED']);

export function statusView(body) {
  const status = String(body?.status || '');
  return {
    status,
    help: body?.help || '',
    terminal: DONE.has(status),
    refund: REFUND.has(status),
    tx: body?.tx || '',
    explorer: body?.tx ? `https://nearblocks.io/txns/${body.tx}` : '',
  };
}
