// Chronicle tray: Timeline, Statement, Verify. One gold action. No entry fee.
import { downloadCsv, exportCsv, queryFeed, verifyEntry } from '../chronicle-feed.js';
import { csvTotals } from '../chronicle-feed.js';
import { iconFor } from '../chronicle-icons.js';
import { accountRows } from '../chronicle-loop.js';
import { runChronicleCommand } from '../chronicle-commands.js';
import { anchorPlan, canonicalManifest, verifyBundle, writeStatement } from '../chronicle-audit.js';
import { armChronicleDock, chronicleDockLog, dispatchChronicleDock, ensureChronicleDock, installChronicleDock } from './chronicle-dock.js';
import { ensureChronicleStyle } from './chronicle-style.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const api = () => (globalThis.NEARCARTA_API || '').replace(/\/$/, '');
const q$ = (root, sel) => root.querySelector(sel);
const NEAR_ICON = 'd7/assets/tokens/tokens/near.svg';
const USDC_ICON = 'd7/assets/tokens/tokens/usdc.svg';

function shortHash(h) {
  const s = String(h || '');
  if (s.length < 12) return s;
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

function saltBytes() {
  const bytes = new Uint8Array(16);
  globalThis.crypto?.getRandomValues?.(bytes);
  return [...bytes].map(n => n.toString(16).padStart(2, '0')).join('');
}

export function chronicleMarkup(state) {
  const tab = state.tab || 'timeline';
  const rows = state.viewRows || [];
  const tabBtn = (id, label) => `<button type="button" class="chronicle-tab${tab === id ? ' on' : ''}" data-ctab="${id}" role="tab" aria-selected="${tab === id ? 'true' : 'false'}">${label}</button>`;
  const list = rows.map(x => {
    const denied = x.decision === 'denied';
    const href = x.url || (x.h ? `https://nearblocks.io/txns/${x.h}` : '');
    const label = `${x.shop || 'row'} on NEAR`;
    return `<li class="${denied ? 'no' : 'ok'}" data-hash="${esc(x.h || '')}">
      <span class="c-mark">${iconFor(x.shop, x.decision)}</span>
      <span><span class="c-shop">${esc(x.shop || '')}</span><br><span class="c-dec">${denied ? 'Refused' : 'Allowed'}${x.amount ? ' · ' + esc(x.amount) : ''}</span>${href ? `<br><a class="c-tx" href="${esc(href)}" target="_blank" rel="noopener" title="${esc(x.h || '')}">${esc(label)} · ${esc(shortHash(x.h))}</a>` : ''}</span>
      <button type="button" class="c-v" data-hash="${esc(x.h || '')}" data-signer="${esc(x.signer || '')}">Verify</button>
    </li>`;
  }).join('') || `<li class="c-empty">${esc(state.account ? 'No rows for this account.' : 'Type an account. No history is assumed.')}</li>`;
  const cta = state.tab === 'verify' ? 'Check this bundle' : (state.tab === 'statement' && state.statement ? 'Anchor' : 'Write statement');
  const verifyHtml = `${esc(state.verify || 'Nothing is signed from this tray.')}${state.verifyUrl ? ` <a data-testid="chronicle-link" href="${esc(state.verifyUrl)}">View transaction</a>` : ''}`;
  const opt = (value, label, cur) => `<option value="${value}"${cur === value ? ' selected' : ''}>${label}</option>`;
  return `<div class="chronicle-card" data-testid="chronicle-card">
    <div class="chronicle-tabs" role="tablist" aria-label="Chronicle">
      ${tabBtn('timeline', 'Timeline')}
      ${tabBtn('statement', 'Statement')}
      ${tabBtn('verify', 'Verify')}
    </div>
    <div class="c-flow" data-testid="chronicle-flow">
      <img src="${NEAR_ICON}" alt="NEAR" width="36" height="36">
      <span class="c-arrow" aria-hidden="true">→</span>
      <img src="${USDC_ICON}" alt="USDC" width="36" height="36">
    </div>
    <div class="chronicle-pane" data-pane="timeline"${tab === 'timeline' ? '' : ' hidden'}>
      <div class="c-filters">
        <label class="chronicle-field wide">Account <input id="c-account" data-testid="chronicle-account" value="${esc(state.account || '')}" autocomplete="off" spellcheck="false" placeholder="name.near"></label>
        <label class="chronicle-field">Period <select id="c-span" data-testid="chronicle-period">${opt('all', 'All', state.span || 'all')}${opt('today', 'Today', state.span || 'all')}${opt('7d', '7 days', state.span || 'all')}</select></label>
        <label class="chronicle-field">Shop <select id="c-shop" data-testid="chronicle-shop">${opt('', 'All', state.shop || '')}${['toll', 'ferry', 'guard', 'payouts', 'house', 'board'].map(s => opt(s, s, state.shop || '')).join('')}</select></label>
        <label class="chronicle-field">Chain <select id="c-chain" data-testid="chronicle-chain">${opt('', 'All', state.chain || '')}${opt('NEAR', 'NEAR', state.chain || '')}${opt('NEAR Intents', 'NEAR Intents', state.chain || '')}</select></label>
        <label class="chronicle-field">Decision <select id="c-d" data-testid="chronicle-filter">${opt('', 'All', state.cd || '')}${opt('allowed', 'Allowed', state.cd || '')}${opt('denied', 'Refused', state.cd || '')}</select></label>
        <label class="chronicle-field wide">Words <input id="c-q" data-testid="chronicle-search" value="${esc(state.cq || '')}" autocomplete="off"></label>
        <ol class="feed wide" data-testid="chronicle-page">${list}</ol>
      </div>
    </div>
    <div class="chronicle-pane" data-pane="statement"${tab === 'statement' ? '' : ' hidden'}>
      <label class="chronicle-field">Statement <textarea id="c-statement" data-testid="chronicle-statement" readonly>${esc(state.statement || '')}</textarea></label>
      <label class="chronicle-field">Signature <input id="c-sig" data-testid="chronicle-signature" value="${esc(state.signature || '')}" autocomplete="off" spellcheck="false" placeholder="No signature yet"></label>
      <label class="chronicle-field">Private note <input id="c-note" data-testid="chronicle-private" value="${esc(state.privateNote || '')}" autocomplete="off"></label>
      <label class="chronicle-check"><input id="c-consent" data-testid="chronicle-consent" type="checkbox"${state.consent ? ' checked' : ''}> Salt this note. Do not publish the raw hash.</label>
    </div>
    <div class="chronicle-pane" data-pane="verify"${tab === 'verify' ? '' : ' hidden'}>
      <label class="chronicle-field">Bundle <textarea id="c-manifest" data-testid="chronicle-manifest">${esc(state.manifestText || '')}</textarea></label>
      <label class="chronicle-field">Digest <input id="c-digest" data-testid="chronicle-digest" value="${esc(state.digest || '')}" autocomplete="off" spellcheck="false"></label>
      <label class="chronicle-field">Signature <input id="c-vsig" data-testid="chronicle-verify-signature" value="${esc(state.signature || '')}" autocomplete="off" spellcheck="false"></label>
    </div>
    <button type="button" class="chronicle-gold" id="c-go" data-testid="chronicle-go">${cta}</button>
    <div class="c-lines">
      <p class="c-status" data-testid="chronicle-source">${esc(state.sourceText || 'Type an account. No history is assumed.')}</p>
      <div class="c-foot">
        <p class="c-status" id="c-out" data-testid="chronicle-verify">${verifyHtml}</p>
        <button type="button" class="chronicle-quiet" id="c-csv" data-testid="chronicle-export">Export CSV</button>
      </div>
    </div>
    <p id="c-seal" class="chronicle-seal" data-testid="chronicle-seal" hidden>${esc(state.seal || '')}</p>
  </div>`;
}

export function mountChronicleTray(root, hooks = {}) {
  const doc = root?.ownerDocument || globalThis.document;
  const state = hooks.state || (hooks.state = {});
  if (!state.tab) state.tab = 'timeline';
  if (!state.span) state.span = 'all';
  state.ticket = state.ticket || 0;
  ensureChronicleStyle(doc);
  if (doc?.body) doc.body.classList.add('chronicle-tray');
  ensureChronicleDock(doc, true);
  installChronicleDock(doc);

  const periodOf = () => {
    if (state.span === 'today') {
      const day = new Date().toISOString().slice(0, 10);
      return { from: day, to: day };
    }
    if (state.span === '7d') {
      const to = new Date();
      const from = new Date(to.getTime() - 7 * 864e5);
      return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
    }
    return { from: '', to: '' };
  };

  const baseRows = () => state.auditRows || [];

  function matchingRows() {
    let rows = baseRows();
    if (state.shop) rows = rows.filter(r => r.shop === state.shop);
    if (state.chain) rows = rows.filter(r => (r.chain || 'NEAR') === state.chain);
    let day = '';
    if (state.span === 'today') day = new Date().toISOString().slice(0, 10);
    else if (state.span === '7d') {
      const cut = Date.now() - 7 * 864e5;
      rows = rows.filter(r => {
        const t = Date.parse(r.at || '');
        return Number.isFinite(t) && t >= cut;
      });
    }
    state.day = day;
    return queryFeed(rows, { q: state.cq || '', decision: state.cd || '', day, page: 1, pageSize: 500 }).rows;
  }

  function prepareRows() {
    const all = matchingRows();
    state.viewRows = all.slice(0, 8);
    return all;
  }

  const paint = () => {
    prepareRows();
    if (!root.isConnected && hooks.repaint) { hooks.repaint(); return; }
    root.innerHTML = chronicleMarkup(state);
    bind();
  };

  const showOut = () => {
    const live = root.isConnected ? q$(root, '#c-out') : null;
    const html = `${esc(state.verify || 'Nothing is signed from this tray.')}${state.verifyUrl ? ` <a data-testid="chronicle-link" href="${esc(state.verifyUrl)}">View transaction</a>` : ''}`;
    if (live) live.innerHTML = html;
    const source = root.isConnected ? q$(root, '[data-testid=chronicle-source]') : null;
    if (source) source.textContent = state.sourceText || '';
    const seal = root.isConnected ? q$(root, '#c-seal') : null;
    if (seal) {
      seal.hidden = !state.seal;
      seal.textContent = state.seal || '';
    }
    const go = root.isConnected ? q$(root, '#c-go') : null;
    if (go) go.textContent = state.tab === 'verify' ? 'Check this bundle' : (state.tab === 'statement' && state.statement ? 'Anchor' : 'Write statement');
  };

  const clearSeal = () => {
    state.seal = '';
    hooks.onSeal?.(null);
    showOut();
  };
  const setSeal = (text) => {
    state.seal = text || '';
    if (text) {
      state.verify = text;
      hooks.onSeal?.(text);
    } else hooks.onSeal?.(null);
    showOut();
  };

  function drawList() {
    prepareRows();
    const ol = q$(root, '[data-testid=chronicle-page]');
    if (!ol) return paint();
    ol.innerHTML = (state.viewRows || []).map(x => {
      const denied = x.decision === 'denied';
      const href = x.url || (x.h ? `https://nearblocks.io/txns/${x.h}` : '');
      const label = `${x.shop || 'row'} on NEAR`;
      return `<li class="${denied ? 'no' : 'ok'}" data-hash="${esc(x.h || '')}">
        <span class="c-mark">${iconFor(x.shop, x.decision)}</span>
        <span><span class="c-shop">${esc(x.shop || '')}</span><br><span class="c-dec">${denied ? 'Refused' : 'Allowed'}${x.amount ? ' · ' + esc(x.amount) : ''}</span>${href ? `<br><a class="c-tx" href="${esc(href)}" target="_blank" rel="noopener" title="${esc(x.h || '')}">${esc(label)} · ${esc(shortHash(x.h))}</a>` : ''}</span>
        <button type="button" class="c-v" data-hash="${esc(x.h || '')}" data-signer="${esc(x.signer || '')}">Verify</button>
      </li>`;
    }).join('') || `<li class="c-empty">${esc(state.account ? 'No rows for this account.' : 'Type an account. No history is assumed.')}</li>`;
    showOut();
  }

  async function readAccount(account) {
    const id = String(account || '').trim();
    state.account = id;
    const mine = ++state.ticket;
    if (!id) {
      state.auditRows = [];
      state.sourceText = 'Type an account. No history is assumed.';
      drawList();
      return;
    }
    state.sourceText = 'Reading this account…';
    showOut();
    const base = api();
    const get = async (path) => {
      const res = await fetch(`${base}${path}`);
      if (!res.ok) return null;
      return res.json();
    };
    let board = null, ledger = null, mainnet = null, index = null;
    try {
      [board, ledger, mainnet] = await Promise.all([
        get('/api/chronicle?owner=' + encodeURIComponent(id)),
        get('/api/ledger'),
        get('/api/mainnet'),
      ]);
      const idxRes = await fetch(`${base}/api/chronicle/${encodeURIComponent(id)}`).catch(() => null);
      if (!idxRes) index = { error: 'The live index did not answer.' };
      else if (idxRes.status === 400) index = { skipped: 'Not a town charter, so the live index was not queried.' };
      else if (!idxRes.ok) index = { error: 'The live index did not answer.' };
      else index = await idxRes.json();
    } catch {
      index = index || { error: 'The live index did not answer.' };
    }
    if (mine !== state.ticket) return;
    const audit = accountRows({ account: id, board, ledger, mainnet, index });
    state.auditRows = audit.rows;
    state.coverage = audit.coverage;
    state.sourceText = audit.coverage.label;
    drawList();
  }

  async function chainOf(row) {
    if (hooks.verify) return hooks.verify(row);
    const res = await fetch(`${api()}/api/tx-status/${encodeURIComponent(row.h)}?sender=${encodeURIComponent(row.signer || '')}`);
    return res.json();
  }

  async function verifyRow(row) {
    clearSeal();
    state.verify = 'Checking the chain…';
    state.verifyUrl = '';
    state.hash = row.h || '';
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

  function filteredAll() {
    return matchingRows();
  }

  async function writeNow() {
    clearSeal();
    const rows = filteredAll();
    const period = periodOf();
    const totals = csvTotals(rows);
    const written = writeStatement({ account: state.account, period, rows, rules: null, totals });
    state.statement = written.text;
    state.signature = '';
    state.manifest = canonicalManifest({ account: state.account, period, rows, rules: null, statement: written.text, model: 'none' });
    state.manifestText = state.manifest.text;
    state.digest = state.manifest.digest;
    state.verify = written.status;
    state.verifyUrl = '';
    state.tab = 'statement';
    paint();
    return { status: written.status };
  }

  async function anchorNow() {
    const note = q$(root, '#c-note')?.value ?? state.privateNote ?? '';
    const consent = q$(root, '#c-consent')?.checked ?? !!state.consent;
    state.privateNote = note;
    state.consent = !!consent;
    if (consent && note && !state.salt) state.salt = saltBytes();
    const plan = anchorPlan({ manifest: state.manifest, consent: !!consent, privateNote: note, salt: state.salt || '' });
    state.verify = plan.reason;
    state.verifyUrl = '';
    if (plan.event) {
      const file = JSON.stringify({ manifest: state.manifest, event: plan.event, salt: consent ? (state.salt || '') : '', commitment: plan.commitment || '' }, null, 2);
      if (hooks.downloadJson) hooks.downloadJson(file, 'chronicle-statement.json');
      else downloadCsv(file, 'chronicle-statement.json');
    }
    clearSeal();
    showOut();
    return { status: plan.reason, signed: false };
  }

  async function checkBundle() {
    const manifestText = q$(root, '#c-manifest')?.value ?? state.manifestText ?? '';
    const statement = q$(root, '#c-statement')?.value || state.statement || '';
    const digest = q$(root, '#c-digest')?.value ?? state.digest ?? '';
    const signature = q$(root, '#c-vsig')?.value || q$(root, '#c-sig')?.value || state.signature || '';
    const verdict = await verifyBundle({ manifestText, statement, digest, signature, publicKey: state.publicKey || '' });
    state.manifestText = manifestText;
    state.digest = digest;
    state.verify = verdict.why;
    state.verifyUrl = '';
    if (!verdict.ok) setSeal(verdict.why);
    else clearSeal();
    showOut();
    return verdict;
  }

  function exportRows() {
    clearSeal();
    const rows = filteredAll();
    const text = exportCsv(rows);
    if (hooks.downloadCsv) hooks.downloadCsv(text);
    else downloadCsv(text);
    const shops = [...new Set(rows.map(r => r.shop).filter(Boolean))].slice(0, 3).join(', ');
    state.verify = rows.length ? `Exported ${rows.length} rows: ${shops}.` : 'Nothing to export.';
    state.verifyUrl = '';
    showOut();
  }

  async function onGold() {
    if (state.goldBusy) return;
    state.goldBusy = true;
    try {
      if (state.tab === 'verify') await checkBundle();
      else if (state.tab === 'statement' && state.statement) await anchorNow();
      else await writeNow();
    } finally {
      state.goldBusy = false;
    }
  }

  async function runAgent(text) {
    clearSeal();
    const result = await runChronicleCommand({
      text,
      rows: filteredAll(),
      state,
      verify: (row) => chainOf(row),
      downloadCsv: (body, name) => (hooks.downloadCsv ? hooks.downloadCsv(body, name) : downloadCsv(body, name)),
      downloadJson: (body, name) => (hooks.downloadJson ? hooks.downloadJson(body, name) : downloadCsv(body, name || 'chronicle.json')),
      onStatement: () => writeNow(),
      onAnchor: () => anchorNow(),
    });
    if (result?.seal) setSeal(result.seal);
    else if (result?.clearSeal) clearSeal();
    chronicleDockLog(doc, result?.hint || '');
    if (result?.paint && result.action !== 'statement') paint();
    return result;
  }

  function bind() {
    root.querySelectorAll('[data-ctab]').forEach(btn => {
      btn.onclick = () => {
        state.tab = btn.dataset.ctab || 'timeline';
        state.statement = q$(root, '#c-statement')?.value || state.statement || '';
        state.manifestText = q$(root, '#c-manifest')?.value ?? state.manifestText ?? '';
        state.privateNote = q$(root, '#c-note')?.value ?? state.privateNote ?? '';
        state.consent = q$(root, '#c-consent')?.checked ?? state.consent;
        clearSeal();
        paint();
      };
    });
    const account = q$(root, '#c-account');
    if (account) account.oninput = (e) => { readAccount(e.target.value); };
    const search = q$(root, '#c-q');
    if (search) search.oninput = (e) => { state.cq = e.target.value; clearSeal(); drawList(); };
    for (const [sel, key] of [['#c-d', 'cd'], ['#c-shop', 'shop'], ['#c-chain', 'chain'], ['#c-span', 'span']]) {
      const el = q$(root, sel);
      if (el) el.onchange = (e) => { state[key] = e.target.value; clearSeal(); drawList(); };
    }
    const csv = q$(root, '#c-csv');
    if (csv) csv.onclick = () => exportRows();
    const go = q$(root, '#c-go');
    if (go) go.onclick = () => onGold();
    q$(root, '[data-testid=chronicle-page]')?.addEventListener('click', (e) => {
      const b = e.target.closest?.('.c-v');
      if (!b) return;
      const row = baseRows().find(r => r.h === b.dataset.hash) || { h: b.dataset.hash, signer: b.dataset.signer };
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

  if (!state.sourceText) state.sourceText = 'Type an account. No history is assumed.';
  if (!state.verify) state.verify = 'Nothing is signed from this tray.';
  paint();
  return { paint, runAgent, readAccount };
}
