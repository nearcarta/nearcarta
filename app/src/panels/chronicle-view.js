// Chronicle tray: Feed, Export, Verify. The city room and /shops/chronicle/ both mount this.
import { RECORDED, downloadCsv, exportCsv, exportJson, queryFeed, verifyEntry } from '../chronicle-feed.js';
import { iconFor, ICONS } from '../chronicle-icons.js';
import { loadChronicleSources, mergeChronicle } from '../chronicle-loop.js';
import { runChronicleCommand } from '../chronicle-commands.js';
import { armChronicleDock, chronicleDockLog, dispatchChronicleDock, ensureChronicleDock, installChronicleDock } from './chronicle-dock.js';
import { ensureChronicleStyle } from './chronicle-style.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const api = () => (globalThis.NEARCARTA_API || '').replace(/\/$/, '');
const q$ = (root, sel) => root.querySelector(sel);

function shortHash(h) {
  const s = String(h || '');
  if (s.length < 12) return s;
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

export function chronicleMarkup(state, rows) {
  const tab = state.tab || 'feed';
  const q = queryFeed(rows, { q: state.cq || '', decision: state.cd || '', day: state.day || '', page: state.cp || 1 });
  const tabBtn = (id, label, icon) => `<button type="button" class="chronicle-tab${tab === id ? ' on' : ''}" data-ctab="${id}" role="tab" aria-selected="${tab === id ? 'true' : 'false'}">${icon}<span>${label}</span></button>`;
  const list = q.rows.map(x => {
    const denied = x.decision === 'denied';
    const href = x.url || (x.h ? `https://nearblocks.io/txns/${x.h}` : '');
    return `<li class="${denied ? 'no' : 'ok'}" data-hash="${esc(x.h || '')}">
      <span class="c-mark">${iconFor(x.shop, x.decision)}<span class="c-shop">${esc(x.shop)}</span></span>
      <span><span class="c-dec">${denied ? 'Refused' : 'Allowed'}${x.reason ? ' · ' + esc(x.reason) : ''}</span><br><span class="c-amt">${esc(x.amount || '')}</span>${href ? `<br><a class="c-tx" href="${esc(href)}" target="_blank" rel="noopener">${esc(shortHash(x.h))}</a>` : ''}</span>
      <button type="button" class="primary c-v" data-hash="${esc(x.h || '')}" data-signer="${esc(x.signer || '')}">Verify</button>
    </li>`;
  }).join('') || '<li>Nothing yet</li>';
  const verifyHtml = `${esc(state.verify || '')}${state.verifyUrl ? ` <a data-testid="chronicle-link" href="${esc(state.verifyUrl)}">explorer</a>` : ''}`;
  const seal = state.seal ? `<p id="c-seal" class="chronicle-seal" data-testid="chronicle-seal">${esc(state.seal)}</p>` : `<p id="c-seal" class="chronicle-seal" data-testid="chronicle-seal" hidden></p>`;
  return `<div class="chronicle-card" data-testid="chronicle-card">
    <div class="chronicle-main">
      <div class="chronicle-pane" data-pane="feed"${tab === 'feed' ? '' : ' hidden'}>
        <label class="chronicle-field">Search <input id="c-q" data-testid="chronicle-search" value="${esc(state.cq || '')}" autocomplete="off"></label>
        <label class="chronicle-field">Decision <select id="c-d" data-testid="chronicle-filter"><option value="">All</option><option value="allowed"${state.cd === 'allowed' ? ' selected' : ''}>Allowed</option><option value="denied"${state.cd === 'denied' ? ' selected' : ''}>Refused</option></select></label>
        <ol class="feed" data-testid="chronicle-page" data-total="${q.total}">${list}</ol>
        <p class="c-pages" data-testid="chronicle-pages">${q.page} / ${q.pages}</p>
      </div>
      <div class="chronicle-pane" data-pane="export"${tab === 'export' ? '' : ' hidden'}>
        <p class="chronicle-source">CSV and JSON use the rows on screen, including a today filter.</p>
        <pre class="chronicle-out" data-testid="chronicle-export-preview">${esc((state.preview || '').slice(0, 800))}</pre>
      </div>
      <div class="chronicle-pane" data-pane="verify"${tab === 'verify' ? '' : ' hidden'}>
        <label class="chronicle-field">Transaction <input id="c-hash" data-testid="chronicle-hash" value="${esc(state.hash || '')}" autocomplete="off" spellcheck="false"></label>
        <button type="button" class="primary" id="c-verify-go" data-testid="chronicle-verify-go">Check this hash</button>
      </div>
      <div class="chronicle-actions">
        <button type="button" class="primary" id="c-prev">Previous</button>
        <button type="button" class="primary" id="c-next">Next</button>
        <button type="button" class="primary" id="c-csv" data-testid="chronicle-export">Export</button>
        <button type="button" class="primary" id="c-json" data-testid="chronicle-export-json">Export JSON</button>
        <button type="button" class="primary" id="c-entry" data-testid="chronicle-entry">Add today’s entry · 0.001 NEAR</button>
      </div>
      ${seal}
      <p id="c-out" class="chronicle-out" data-testid="chronicle-verify">${verifyHtml}</p>
      <p class="chronicle-source" data-testid="chronicle-source">${esc(state.sourceText || 'Reading the ledger…')}</p>
    </div>
    <div class="chronicle-tabs" role="tablist" aria-label="Chronicle">
      ${tabBtn('feed', 'Feed', ICONS.feed)}
      ${tabBtn('export', 'Export', ICONS.export)}
      ${tabBtn('verify', 'Verify', ICONS.verify)}
    </div>
  </div>`;
}

export function mountChronicleTray(root, hooks = {}) {
  const doc = root?.ownerDocument || globalThis.document;
  const state = hooks.state || (hooks.state = {});
  if (!state.tab) state.tab = 'feed';
  ensureChronicleStyle(doc);
  if (doc?.body) doc.body.classList.add('chronicle-tray');
  ensureChronicleDock(doc, true);
  installChronicleDock(doc);

  const localRows = () => (hooks.rows ? hooks.rows() : []) || [];
  const currentRows = () => {
    const local = localRows();
    const base = state.merged?.rows || mergeChronicle({ recorded: RECORDED }).rows;
    const seen = new Set();
    const out = [];
    for (const r of [...local, ...base]) {
      const key = r?.h || `local:${r?.shop}:${r?.reason}:${r?.amount}`;
      if (!r || seen.has(key)) continue;
      seen.add(key);
      out.push(r);
    }
    return out;
  };

  const paint = () => {
    if (!root.isConnected && hooks.repaint) { hooks.repaint(); return; }
    root.innerHTML = chronicleMarkup(state, currentRows());
    bind();
  };
  const showOut = () => {
    const live = root.isConnected ? q$(root, '#c-out') : null;
    const html = `${esc(state.verify || '')}${state.verifyUrl ? ` <a data-testid="chronicle-link" href="${esc(state.verifyUrl)}">explorer</a>` : ''}`;
    if (live) live.innerHTML = html;
    const seal = root.isConnected ? q$(root, '#c-seal') : null;
    if (seal) {
      seal.hidden = !state.seal;
      seal.textContent = state.seal || '';
    }
  };
  const clearSeal = () => {
    state.seal = '';
    hooks.onSeal?.(null);
    showOut();
  };
  const setSeal = (text) => {
    state.seal = text || '';
    if (text) hooks.onSeal?.(text);
    else hooks.onSeal?.(null);
    showOut();
  };

  async function chainOf(row) {
    if (hooks.verify) return hooks.verify(row);
    const res = await fetch(`${api()}/api/tx-status/${encodeURIComponent(row.h)}?sender=${encodeURIComponent(row.signer || 'nearcarta.near')}`);
    return res.json();
  }
  async function verifyRow(row) {
    clearSeal();
    state.verify = 'Checking the chain…';
    state.verifyUrl = '';
    state.hash = row.h || state.hash || '';
    showOut();
    let chain = null;
    try { chain = await chainOf(row); }
    catch { chain = null; }
    const v = verifyEntry(row, chain);
    state.verify = chain ? v.text : (v.url ? v.text : 'The chain check did not answer.');
    state.verifyUrl = v.url || '';
    if (chain && v.ok === false) setSeal('Chain refused. This transaction did not succeed.');
    else clearSeal();
    showOut();
    return v;
  }
  function drawList() {
    const q = queryFeed(currentRows(), { q: state.cq || '', decision: state.cd || '', day: state.day || '', page: state.cp || 1 });
    const ol = q$(root, '[data-testid=chronicle-page]');
    if (!ol) return paint();
    ol.dataset.total = String(q.total);
    ol.innerHTML = q.rows.map(x => {
      const denied = x.decision === 'denied';
      const href = x.url || (x.h ? `https://nearblocks.io/txns/${x.h}` : '');
      return `<li class="${denied ? 'no' : 'ok'}" data-hash="${esc(x.h || '')}">
        <span class="c-mark">${iconFor(x.shop, x.decision)}<span class="c-shop">${esc(x.shop)}</span></span>
        <span><span class="c-dec">${denied ? 'Refused' : 'Allowed'}${x.reason ? ' · ' + esc(x.reason) : ''}</span><br><span class="c-amt">${esc(x.amount || '')}</span>${href ? `<br><a class="c-tx" href="${esc(href)}" target="_blank" rel="noopener">${esc(shortHash(x.h))}</a>` : ''}</span>
        <button type="button" class="primary c-v" data-hash="${esc(x.h || '')}" data-signer="${esc(x.signer || '')}">Verify</button>
      </li>`;
    }).join('') || '<li>Nothing yet</li>';
    const pages = q$(root, '[data-testid=chronicle-pages]');
    if (pages) pages.textContent = `${q.page} / ${q.pages}`;
  }

  function exportRows(asJson) {
    clearSeal();
    const rows = queryFeed(currentRows(), { q: state.cq || '', decision: state.cd || '', day: state.day || '', page: 1, pageSize: 500 }).rows;
    const text = asJson ? exportJson(rows) : exportCsv(rows);
    if (asJson) {
      const file = text;
      if (hooks.downloadJson) hooks.downloadJson(file);
      else downloadCsv(file, 'chronicle.json');
    } else if (hooks.downloadCsv) hooks.downloadCsv(text);
    else downloadCsv(text);
    state.verify = text;
    state.verifyUrl = '';
    state.preview = text;
    state.tab = 'export';
    paint();
  }

  async function runAgent(text) {
    clearSeal();
    const result = await runChronicleCommand({
      text,
      rows: currentRows(),
      state,
      verify: (row) => chainOf(row),
      downloadCsv: (body, name) => (hooks.downloadCsv ? hooks.downloadCsv(body, name) : downloadCsv(body, name)),
      downloadJson: (body, name) => downloadCsv(body, name || 'chronicle.json'),
      onEntry: hooks.onEntry,
    });
    if (result?.seal) setSeal(result.seal);
    else if (result?.clearSeal) clearSeal();
    chronicleDockLog(doc, result?.hint || '');
    if (result?.paint) paint();
    return result;
  }

  function bind() {
    root.querySelectorAll('[data-ctab]').forEach(btn => {
      btn.onclick = () => { state.tab = btn.dataset.ctab || 'feed'; clearSeal(); paint(); };
    });
    const search = q$(root, '#c-q');
    if (search) search.oninput = (e) => { state.cq = e.target.value; state.cp = 1; clearSeal(); drawList(); };
    const filter = q$(root, '#c-d');
    if (filter) filter.onchange = (e) => { state.cd = e.target.value; state.cp = 1; clearSeal(); drawList(); };
    const prev = q$(root, '#c-prev');
    if (prev) prev.onclick = () => { state.cp = Math.max(1, (state.cp || 1) - 1); clearSeal(); drawList(); };
    const next = q$(root, '#c-next');
    if (next) next.onclick = () => { state.cp = (state.cp || 1) + 1; clearSeal(); drawList(); };
    const csv = q$(root, '#c-csv');
    if (csv) csv.onclick = () => exportRows(false);
    const json = q$(root, '#c-json');
    if (json) json.onclick = () => exportRows(true);
    const entry = q$(root, '#c-entry');
    if (entry) entry.onclick = async () => {
      if (state.entryBusy) return;
      state.entryBusy = true;
      entry.disabled = true;
      clearSeal();
      try {
        const res = typeof hooks.onEntry === 'function'
          ? await hooks.onEntry()
          : { ok: false, hint: 'Open the city Chronicle after setup. Nothing was signed.', seal: 'Open the city Chronicle after setup. Nothing was signed.' };
        if (res?.seal) setSeal(res.seal);
        else clearSeal();
        if (res?.hint) chronicleDockLog(doc, res.hint);
        state.verify = res?.say || res?.hint || state.verify || '';
      } catch (e) {
        const hint = e?.message || 'The entry did not sign.';
        setSeal(hint);
        chronicleDockLog(doc, hint);
      } finally {
        state.entryBusy = false;
        paint();
      }
    };
    const hash = q$(root, '#c-hash');
    if (hash) hash.oninput = (e) => { state.hash = e.target.value; };
    const go = q$(root, '#c-verify-go');
    if (go) go.onclick = () => verifyRow({ h: (q$(root, '#c-hash')?.value || state.hash || '').trim(), signer: '' });
    q$(root, '[data-testid=chronicle-page]')?.addEventListener('click', (e) => {
      const b = e.target.closest?.('.c-v');
      if (!b) return;
      const row = currentRows().find(r => r.h === b.dataset.hash) || { h: b.dataset.hash, signer: b.dataset.signer };
      verifyRow(row);
    });
    armChronicleDock((text) => runAgent(text));
    const agentIn = doc?.getElementById?.('c-agent');
    const agentGo = doc?.getElementById?.('c-agent-go');
    if (agentIn) agentIn.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === 'ArrowRight') { e.preventDefault(); dispatchChronicleDock(doc); }
    };
    if (agentGo) agentGo.onclick = (e) => { e.preventDefault(); dispatchChronicleDock(doc); };
  }

  paint();
  if (!state.feedTried) {
    state.feedTried = true;
    const load = hooks.load || (async () => {
      const src = await loadChronicleSources(globalThis.fetch.bind(globalThis), api());
      return mergeChronicle({ ...src, local: localRows(), recorded: RECORDED });
    });
    Promise.resolve()
      .then(() => load())
      .then(merged => {
        state.merged = merged;
        state.sourceText = merged?.live ? 'Live ledger from the board, the toll, the ferry fill, payouts and guard refusals.' : 'Recorded proofs. The live feed did not answer.';
        paint();
      })
      .catch(() => {
        state.sourceText = 'Recorded proofs. The live feed did not answer.';
        if (root.isConnected) paint();
      });
  }
  return { paint, runAgent };
}
