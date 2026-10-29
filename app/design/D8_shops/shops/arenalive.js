// Vault Arena past prompts, read live from /api/arena/prompts: each prompt a player committed on chain,
// with the decision tx that refused, held or allowed it, and the reveal tx that proves the text.
// Self-contained (no scene imports) so the unit tests and the 2D view can load it; same markup as _ui.js.
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const h3 = t => `<h3>${esc(t)}</h3>`, note = t => `<p class="note">${t}</p>`, proof = (...p) => `<div class="pf">${p.join('')}</div>`;

const TX = h => h ? `<a class="tx" href="${esc(h.url)}" target="_blank" rel="noopener">${esc(h.tx.slice(0, 6))}… ↗</a>` : '';
const ST = { refused: ['no', '✕'], held: ['ice', '❄'], allowed: ['ok', '✓'] };
export function promptRows(ps = [], max = 31) {
  return ps.slice(0, max).map(p => { const [c, ic] = ST[p.outcome] || ST.refused;
    const k = p.prompt ? `“${p.prompt}”` : `#${p.id} · sealed (${p.sealed})`;
    const why = `#${p.id} · ${p.pattern || 'attempt'} · ${p.verdict}${p.settled ? ' · ' + p.settled : ''}`;
    return `<div class="row" data-testid="arena-prompt"><div class="k">${esc(k)}<span class="why">${esc(why)}</span></div><div class="v"><span class="st ${c}"><span aria-hidden="true">${ic}</span>${esc(p.outcome)}</span>${TX(p.decision)}${p.reveal ? ' <span class="why">reveal</span> ' + TX(p.reveal) : ''}</div></div>`; }).join('');
}
export async function livePrompts(fetchFn = globalThis.fetch, base = (globalThis.window?.NEARCARTA_API || '').replace(/\/$/, ''), bare = false) {
  try { const c = new AbortController(), t = setTimeout(() => c.abort(), 8000);
    const r = await fetchFn(base + '/api/arena/prompts', { signal: c.signal }).finally(() => clearTimeout(t)); if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    const parts = [h3(`Past prompts · live read · ${d.shown} of ${d.count} shown`), promptRows(d.prompts),
      note('Each prompt is shown only when its sha256 matches the commitment on chain. The first link is the decision tx; the second is the reveal.')];
    return bare ? parts.join('') : proof(...parts); }
  catch { const n = note('The past prompts could not be read just now.'); return bare ? n : proof(n); }
}
