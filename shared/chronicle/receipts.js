// Cross-shop receipts and totals for one account.
//
// One row per real transaction hash, whatever shop produced it, plus the cross-chain legs the
// shops record (a Ferry swap has a near leg and an intents leg; a Toll pass has a NEAR leg and a
// foreign leg that the MPC signs). A row is only counted when it has a hash; a dry quote is not a
// payment and is labelled as such rather than summed.
//
// Nothing here invents an amount. The categories are the same three the CSV has always used:
// delivered (allowed), refunded (a return), attempted (refused or failed on chain).

/** Trim trailing zeros from a decimal string. */
const trimFrac = t => String(t || '').replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');

/** NEAR's own decimals, then each known token's own decimals. */
const TOKEN_DECIMALS = { NEAR: 24, wNEAR: 24, USDC: 6, USDT: 6, DAI: 18, ZEC: 8, GP: 0, cheems: 18 };

export function tokenDecimals(symbol, given) {
  const n = Number(given);
  if (Number.isFinite(n) && n >= 0 && n <= 30) return n;
  return TOKEN_DECIMALS[String(symbol || '').trim()] ?? null;
}

/**
 * A yocto-style amount, already formatted (the tray passes presentAmount output through).
 * Kept here as a copy rather than an import: this file is served to the browser from
 * /shared/, and app/src is not on that path.
 */
export function presentAmount(amount) {
  const s = String(amount || '').trim();
  const m = s.match(/^(-?(?:\d+\.\d+[eE][+-]?\d+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?))\s+([A-Za-z][A-Za-z0-9.]*)\s*$/);
  if (!m) return s;
  const num = m[1];
  const symbol = m[2];
  if (!/e/i.test(num) && !/^-?\d{16,}$/.test(num)) return s;
  if (symbol.toUpperCase() !== 'NEAR') return s;
  const d = decimalOf(num, 24);
  return d ? `${trimFrac(d)} ${symbol}` : s;
}

/** Smallest units to a trimmed decimal, keeping 8 significant digits so tiny token amounts survive. */
export function decimalOf(raw, decimals) {
  const dec = Number(decimals);
  if (!Number.isInteger(dec) || dec < 0 || dec > 36) return '';
  let v;
  try { v = BigInt(String(raw ?? '').trim()); } catch { return ''; }
  if (v === 0n) return '';
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const scale = 10n ** BigInt(dec);
  const whole = abs / scale;
  const fracFull = (abs % scale).toString().padStart(dec, '0');
  // Keep 8 significant digits of the fraction, not 8 places: 0.000000000001 keeps its 1.
  let frac = fracFull.replace(/0+$/, '');
  const lead = fracFull.length - fracFull.replace(/^0+/, '').length;
  if (frac.length > lead + 8) frac = frac.slice(0, lead + 8);
  const text = frac ? `${whole}.${frac}` : String(whole);
  return (neg ? '-' : '') + text;
}

/**
 * One amount for the totals, in the token's own units.
 * `raw` is smallest units (yocto for NEAR). A string that is already decimal is passed through.
 */
export function amountOf(row) {
  const raw = row?.raw ?? row?.amountRaw ?? '';
  const sym = String(row?.symbol || row?.asset || '').trim();
  if (raw !== '' && raw != null) {
    const d = tokenDecimals(sym, row?.decimals);
    if (d != null) {
      // 297 at 6 decimals is 0.000297, not 297. presentAmount only rescues a NEAR string.
      const text = decimalOf(raw, d);
      const asText = text ? `${text} ${sym}`.trim() : presentAmount(`${String(raw)} ${sym}`.trim());
      const n = Number(text || 'NaN');
      return { text: asText, symbol: sym, value: Number.isFinite(n) ? n : null, decimals: d };
    }
  }
  const shown = presentAmount(row?.amount || '');
  const n = Number(String(shown).replace(/[^0-9.-]/g, ''));
  return { text: shown, symbol: sym || (shown.split(' ').pop() || ''), value: Number.isFinite(n) ? n : null, decimals: null };
}

/** The same three categories the CSV and the statement use. */
export function categoryOf(row) {
  const blob = `${row?.reason || ''} ${row?.label || ''} ${row?.note || ''}`.toLowerCase();
  if (blob.includes('refund') || blob.includes('refunded')) return 'refunded';
  if (row?.decision === 'denied' || row?.decision === 'refused' || row?.decision === 'failed') return 'attempted';
  if (row?.decision === 'allowed') return 'delivered';
  return 'attempted';
}

/** Cross-chain legs a row carries: the near leg, the intents leg, the foreign leg. */
export function legsOf(row) {
  const out = [];
  if (row?.h) out.push({ chain: row.chain || 'NEAR', kind: 'near', tx: row.h });
  for (const leg of row?.legs || []) {
    if (!leg?.tx) continue;
    out.push({ chain: String(leg.chain || ''), kind: String(leg.kind || 'leg'), tx: String(leg.tx), foreign: leg.chain && leg.chain !== 'NEAR' });
  }
  if (row?.foreign?.tx) out.push({ chain: String(row.foreign.chain || 'foreign'), kind: 'foreign', tx: String(row.foreign.tx), foreign: true });
  return out;
}

/**
 * Fold rows into one receipt list. A hash appears once; the first row that carries it wins, so
 * the same payment reported by two shops is not counted twice.
 */
export function receiptsOf(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows || []) {
    const tx = String(row?.h || row?.tx || '');
    if (!tx) continue;
    if (seen.has(tx)) continue;
    seen.add(tx);
    const amount = amountOf(row);
    out.push({
      shop: String(row.shop || ''),
      decision: String(row.decision || ''),
      category: categoryOf(row),
      reason: String(row.reason || row.label || ''),
      tx,
      url: row.url || `https://nearblocks.io/txns/${tx}`,
      at: String(row.at || ''),
      amount: amount.text,
      symbol: amount.symbol,
      value: amount.value,
      chain: String(row.chain || 'NEAR'),
      legs: legsOf(row),
      dry: row.dry === true,
    });
  }
  return out;
}

/**
 * Totals per shop and per token. A dry quote is counted as neither delivered nor attempted:
 * nothing moved. A cross-chain row counts once, on its near leg, and its foreign leg is listed.
 */
export function totalsOf(rows) {
  const receipts = receiptsOf(rows);
  const shops = {};
  const tokens = {};
  const chain = {};
  const totals = { delivered: 0, refunded: 0, attempted: 0, dry: 0, receipts: receipts.length };
  for (const r of receipts) {
    if (r.dry) { totals.dry += 1; continue; }
    totals[r.category] = (totals[r.category] || 0) + 1;
    const s = shops[r.shop] || (shops[r.shop] = { delivered: 0, refunded: 0, attempted: 0, receipts: 0 });
    s[r.category] = (s[r.category] || 0) + 1;
    s.receipts += 1;
    const t = tokens[r.symbol || '?'] || (tokens[r.symbol || '?'] = { delivered: 0, attempted: 0, refunded: 0, value: 0, known: 0 });
    t[r.category] = (t[r.category] || 0) + 1;
    if (r.value != null) { t.value += r.value; t.known += 1; }
    for (const leg of r.legs) chain[leg.chain] = (chain[leg.chain] || 0) + 1;
  }
  // Round the per-token sums so a long list of dust does not print a float artefact.
  for (const t of Object.values(tokens)) t.value = Math.round(t.value * 1e8) / 1e8;
  return { totals, shops, tokens, chain, receipts };
}

/** One sentence for the tray: what the totals mean, in the same words the CSV uses. */
export function totalsLine(t) {
  const x = t?.totals || t || {};
  const shopNames = Object.keys(t?.shops || {}).sort();
  const parts = [`Delivered ${x.delivered || 0}.`, `Refunded ${x.refunded || 0}.`, `Attempted ${x.attempted || 0}.`];
  if (x.dry) parts.push(`${x.dry} dry quote${x.dry === 1 ? '' : 's'} not counted.`);
  if (shopNames.length) parts.push(`Shops: ${shopNames.join(', ')}.`);
  return parts.join(' ');
}
