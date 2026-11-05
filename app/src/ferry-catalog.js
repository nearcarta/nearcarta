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
    amountIn: from.amount ?? q.amountIn ?? null,
    amountOut: to.amount ?? q.amountOut ?? null,
    symbolIn: from.symbol || q.symbolIn || '',
    symbolOut: to.symbol || q.symbolOut || '',
    chainIn: from.chain || q.chainIn || '',
    chainOut: to.chain || q.chainOut || '',
    usd: q.usd ?? q.amountInUsd ?? from.usd ?? from.amountUsd ?? to.usd ?? to.amountUsd ?? null,
    eta: q.eta_s ?? q.eta ?? null,
    fee: q.cost_bps_signed ?? q.fee ?? q.checks?.echo?.protocolFeeBps ?? null,
    privacy: q.privacy || 'public',
    dry: q.dry === true || q.checks?.dry === true,
  };
}

/** One comparable line: input token and amount, output token and amount, USD, fee, ETA. */
export function quoteLine(q) {
  const view = quoteView(q);
  if (!view) return null;
  const from = q.from || {};
  const to = q.to || {};
  const inn = [from.amount ?? view.amountIn, from.symbol || view.symbolIn, (from.chain || view.chainIn) ? `on ${from.chain || view.chainIn}` : ''].filter(Boolean).join(' ');
  const out = [to.amount ?? view.amountOut, to.symbol || view.symbolOut, (to.chain || view.chainOut) ? `on ${to.chain || view.chainOut}` : ''].filter(Boolean).join(' ');
  const usdNum = Number(view.usd);
  const usd = view.usd != null && view.usd !== '' ? `about $${Number.isFinite(usdNum) ? usdNum.toFixed(2) : view.usd}` : 'USD not quoted';
  const fee = view.fee != null && view.fee !== '' ? `fee ${view.fee} bps` : 'fee not quoted';
  const eta = view.eta != null && view.eta !== '' ? `about ${view.eta}s` : 'ETA not quoted';
  return {
    ...view,
    amountIn: from.amount ?? view.amountIn ?? null,
    symbolIn: from.symbol || view.symbolIn || '',
    chainIn: from.chain || view.chainIn || '',
    chainOut: to.chain || view.chainOut || '',
    text: `${inn} → ${out} · ${usd} · ${fee} · ${eta}`,
  };
}

export function compareRows(quotes) {
  return (Array.isArray(quotes) ? quotes : []).map(quoteLine).filter(Boolean);
}

/** The quote with the largest amount out is the best rate. Ties keep the first. */
export function pickBest(quotes) {
  const views = compareRows(quotes);
  let best = -1;
  let top = -Infinity;
  views.forEach((v, i) => {
    const n = Number(v.amountOut);
    if (Number.isFinite(n) && n > top) { top = n; best = i; }
  });
  return views.map((v, i) => ({ ...v, best: i === best && best >= 0 }));
}

export const STATUS_WORDS = {
  PENDING_DEPOSIT: 'Waiting for the deposit.',
  KNOWN_DEPOSIT_TX: 'The deposit transaction is seen.',
  PROCESSING: 'The swap is in progress.',
  SUCCESS: 'The swap finished.',
  REFUNDED: 'Refunded to the refund address.',
  FAILED: 'The swap failed. Nothing else is sent from this page.',
  INCOMPLETE_DEPOSIT: 'The deposit was short. Send the rest to the same address, or wait for the refund.',
};

const REFUND = new Set(['REFUNDED', 'INCOMPLETE_DEPOSIT']);
const DONE = new Set(['SUCCESS', 'REFUNDED', 'FAILED']);

export function statusView(body) {
  const status = String(body?.status || '');
  return {
    status,
    help: body?.help || STATUS_WORDS[status] || '',
    words: STATUS_WORDS[status] || '',
    terminal: DONE.has(status),
    refund: REFUND.has(status),
    tx: body?.tx || '',
    explorer: body?.tx ? `https://nearblocks.io/txns/${body.tx}` : '',
  };
}
