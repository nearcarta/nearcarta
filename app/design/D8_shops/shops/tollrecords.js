// Toll records, read live from /api/toll: each Toll's latest signed transactions. A record the contract still
// marks "signed" is checked by the API against its foreign chain and shows as pending, settling or expired.
// Self-contained (no scene imports) so the unit tests and the 2D view can load it; same markup as _ui.js.
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const h3 = t => `<h3>${esc(t)}</h3>`, note = t => `<p class="note">${t}</p>`, proof = (...p) => `<div class="pf">${p.join('')}</div>`;

const ST = { confirmed: ['ok', '✓'], expired: ['ice', '⌛'], settling: ['pend', '…'], pending: ['pend', '…'], signed: ['pend', '…'] };
const EX = { Base: 'https://basescan.org', Arbitrum: 'https://arbiscan.io' };
// The two real mainnet toll.nearcarta.near payments (shared/deployments/mainnet.json), shown before the mainnet records.
const MN = [['4LKGpA5vBRAtd4JoTaG4BtBep2HWsXWQ6VBDsaaSVouz', 'ok', 'allowed', 'paid an allowlisted payee'], ['B9FFjcSA9djgn2cWotwZJdag2bHJDSJGNLMLtML6BWtR', 'no', 'refused', 'payee not on the allowlist']];
export const MAIN_ROWS = MN.map(([h, c, st, w]) => `<div class="row" data-testid="toll-record"><div class="k">mainnet · toll.nearcarta.near<span class="why">${w}</span></div><div class="v"><span class="st ${c}">${st}</span><a class="tx" href="https://nearblocks.io/txns/${h}" target="_blank" rel="noopener" title="Open on the NEAR mainnet explorer">${h.slice(0, 8)}… ↗</a></div></div>`).join('');
export function tollRecordRows(d, { hideExpired = false } = {}) {
  const tolls = [{ label: 'base', oath: d.oath, verify_chain: 'Base', recent: d.recent || [] }, ...(d.instances || [])];
  return tolls.flatMap(t => (t.recent || []).filter(r => !hideExpired || r.status !== 'expired').map(r => { const [c, ic] = ST[r.status] || ST.pending, chain = t.verify_chain || 'Base';
    const why = `mainnet · ${t.oath}${r.stale_reason ? ' · ' + r.stale_reason : ''}${r.chain_status && r.chain_status !== r.status ? ' · on NEAR still ' + r.chain_status : ''}`;
    const link = r.tx_hash ? `<a class="tx" href="${EX[chain] || EX.Base}/tx/${esc(r.tx_hash)}" target="_blank" rel="noopener">${esc(r.tx_hash.slice(0, 8))}… ↗</a>` : '';
    return `<div class="row" data-testid="toll-record"><div class="k">${esc(`${t.label} #${r.nonce}`)}<span class="why">${esc(why)}</span></div><div class="v"><span class="st ${c}"><span aria-hidden="true">${ic}</span>${esc(r.status)}</span>${link}</div></div>`; })).join('');
}
export async function liveTollRecords(fetchFn = globalThis.fetch, base = (globalThis.window?.NEARCARTA_API || '').replace(/\/$/, ''), bare = false) {
  try { const c = new AbortController(), t = setTimeout(() => c.abort(), 8000);
    const r = await fetchFn(base + '/api/toll', { signal: c.signal }).finally(() => clearTimeout(t)); if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json(), all = [{ recent: d.recent || [] }, ...(d.instances || [])].flatMap(t => t.recent || []), gone = all.filter(x => x.status === 'expired').length;
    const parts = [h3('Toll records · live read'), bare ? MAIN_ROWS : '', tollRecordRows(d, { hideExpired: bare }),
      bare && gone ? note(`${gone} expired mainnet record${gone > 1 ? 's' : ''} hidden: signed on NEAR, never landed on the foreign chain.`) : '', note('A record signed on NEAR but never seen on its foreign chain shows as expired once it can no longer land.')];
    return bare ? parts.join('') : proof(...parts); }
  catch { const n = note('The toll records could not be read just now.'); return bare ? n : proof(n); }
}
