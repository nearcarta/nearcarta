// Chronicle tray: Timeline, Statement, Verify. One gold action. No entry fee.
import { downloadCsv, exportCsv, queryFeed, verifyEntry } from '../chronicle-feed.js';
import { csvTotals } from '../chronicle-feed.js';
import { presentAmount } from '../chronicle-amount.js';
import { iconFor } from '../chronicle-icons.js';
import { accountRows } from '../chronicle-loop.js';
import { runChronicleCommand } from '../chronicle-commands.js';
import { anchorPlan, anchorProof, bundleDigest, canonicalManifest, parseAnchorEvents, sha256Hex, teeNowText, verifyBundle, verifyNearAi, writeStatement } from '../chronicle-audit.js';
import { totalsLine, totalsOf } from '../../../shared/chronicle/receipts.js';
import { reconstructRules } from '../../../shared/chronicle/rules.js';
import { liveTee } from '../tee-view.js';
import { armChronicleDock, chronicleDockLog, ensureChronicleDock, installChronicleDock } from './chronicle-dock.js';
import { ensureChronicleStyle } from './chronicle-style.js';

const ROW_PAGE = 6;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const api = () => (globalThis.NEARCARTA_API || '').replace(/\/$/, '');
const q$ = (root, sel) => root.querySelector(sel);
const ACCOUNT_MARK = `<svg viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="16" fill="#2a2218" stroke="#f5d08a" stroke-width="1.5"/><circle cx="18" cy="14" r="4" fill="#f5d08a"/><path d="M10 26c1.2-4 4-6 8-6s6.8 2 8 6" fill="none" stroke="#f5d08a" stroke-width="1.8" stroke-linecap="round"/></svg>`;
const LEDGER_MARK = `<svg viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="16" fill="#2a2218" stroke="#f5d08a" stroke-width="1.5"/><rect x="11" y="9" width="14" height="18" rx="2" fill="none" stroke="#f5d08a" stroke-width="1.5"/><path d="M14 14h8M14 18h8M14 22h5" stroke="#f5d08a" stroke-width="1.4" stroke-linecap="round"/></svg>`;

function decisionText(decision) {
  if (decision === 'denied') return 'Refused';
  if (decision === 'failed') return 'Failed on chain';
  return 'Allowed';
}

function rowClass(decision) {
  if (decision === 'denied') return 'no';
  if (decision === 'failed') return 'fail';
  return 'ok';
}

function ctaOf(state) {
  if (state.tab === 'verify') return 'Check this bundle';
  if (state.tab === 'statement') return state.statement ? 'Anchor' : 'Write statement';
  return 'Show timeline';
}

function coverageItems(state) {
  const items = [];
  for (const s of state.liveSources || []) {
    if (s.gap) items.push(s.gap);
    else if (s.rows) items.push(`${s.source}: ${s.rows}`);
    else items.push(`${s.source}: none`);
  }
  return items;
}

function shortHash(h) {
  const s = String(h || '');
  if (s.length < 12) return s;
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

const saltBytes = () => {
  const bytes = new Uint8Array(8);
  globalThis.crypto?.getRandomValues?.(bytes);
  return [...bytes].map(n => n.toString(16).padStart(2, '0')).join('');
};

// One shared read per page for answers that do not depend on the typed account.
// Two mounts of the tray (the city room and the console) must not each call /api/ledger.
const sharedCache = new Map(); // key -> { at, body }
const sharedInflight = new Map(); // key -> Promise
export const SHARED_TTL_MS = 60_000;
export function _resetShared() { sharedCache.clear(); sharedInflight.clear(); }
export async function sharedJson(url, key = url, { now = Date.now(), ttl = SHARED_TTL_MS, fetchImpl = null } = {}) {
  const hit = sharedCache.get(key);
  if (hit && now - hit.at < ttl) return hit.body;
  if (sharedInflight.has(key)) return sharedInflight.get(key);
  const doFetch = fetchImpl || ((u) => fetch(u));
  const p = doFetch(url)
    .then(r => (r && r.ok === false ? null : r.json()))
    .catch(() => null)
    .then(body => {
      if (body) sharedCache.set(key, { at: now, body });
      return body;
    })
    .finally(() => sharedInflight.delete(key));
  sharedInflight.set(key, p);
  return p;
}

function rowHtml(x) {
  const href = x.url || (x.h ? `https://nearblocks.io/txns/${x.h}` : '');
  const amount = presentAmount(x.amount);
  return `<li class="${rowClass(x.decision)}" data-hash="${esc(x.h || '')}">
      <span class="c-mark">${iconFor(x.shop, x.decision)}</span>
      <span class="c-rowline">${href ? `<a class="c-tx" href="${esc(href)}" target="_blank" rel="noopener" title="${esc(x.h || '')}">${esc(shortHash(x.h))}</a>` : ''}<span class="c-shop">${esc(x.shop || '')}</span><span class="c-dec">${decisionText(x.decision)}${amount ? ' · ' + esc(amount) : ''}</span></span>
      <button type="button" class="c-v" data-hash="${esc(x.h || '')}" data-signer="${esc(x.signer || '')}">Verify</button>
    </li>`;
}

function countText(state) {
  const loaded = state.rowTotal || 0;
  const shown = Math.min(state.shown || ROW_PAGE, loaded);
  if (!state.account) return 'Type an account, then press Show timeline.';
  if (!loaded) return 'No rows for this account.';
  if (shown < loaded) return `Showing ${shown} of ${loaded}.`;
  if (state.nextCursor || state.ftCursor) return `${loaded} rows. More on the index.`;
  return `${loaded} rows.`;
}

export function chronicleMarkup(state) {
  const tab = state.tab || 'timeline';
  const rows = state.viewRows || [];
  const loaded = state.rowTotal || rows.length;
  const moreRows = loaded > rows.length || state.nextCursor || state.ftCursor;
  const tabBtn = (id, label) => `<button type="button" class="chronicle-tab${tab === id ? ' on' : ''}" data-ctab="${id}" role="tab" aria-selected="${tab === id ? 'true' : 'false'}">${label}</button>`;
  const list = rows.map(rowHtml).join('');
  const cta = ctaOf(state);
  const emptyText = state.account ? 'No rows for this account.' : 'Type an account. No history is assumed.';
  const cover = coverageItems(state).map(t => `<li>${esc(t)}</li>`).join('');
  const verifyHtml = `${esc(state.verify || 'Nothing is signed from this tray.')}${state.verifyUrl ? ` <a data-testid="chronicle-link" href="${esc(state.verifyUrl)}">View transaction</a>` : ''}`;
  const attest = /TEE quote/.test(state.verify || '') || /TEE quote/.test(state.bundleText || '');
  const opt = (value, label, cur) => `<option value="${value}"${cur === value ? ' selected' : ''}>${label}</option>`;
  return `<div class="chronicle-card" data-testid="chronicle-card">
    <div class="chronicle-tabs" role="tablist" aria-label="Chronicle">
      ${tabBtn('timeline', 'Timeline')}
      ${tabBtn('statement', 'Statement')}
      ${tabBtn('verify', 'Verify')}
    </div>
    <div class="c-scroll" data-testid="chronicle-scroll">
      <div class="chronicle-pane" data-pane="timeline"${tab === 'timeline' ? '' : ' hidden'}>
        <div class="c-filters">
          <label class="chronicle-field">Account <input id="c-account" data-testid="chronicle-account" value="${esc(state.accountDraft ?? state.account ?? '')}" autocomplete="off" spellcheck="false" placeholder="name.near"></label>
          <label class="chronicle-field">Words <input id="c-q" data-testid="chronicle-search" value="${esc(state.cq || '')}" autocomplete="off"></label>
          <label class="chronicle-field">Period <select id="c-span" data-testid="chronicle-period">${opt('all', 'All', state.span || 'all')}${opt('today', 'Today', state.span || 'all')}${opt('7d', '7 days', state.span || 'all')}</select></label>
          <label class="chronicle-field">Shop <select id="c-shop" data-testid="chronicle-shop">${opt('', 'All', state.shop || '')}${['toll', 'ferry', 'guard', 'payouts', 'house', 'board'].map(s => opt(s, s, state.shop || '')).join('')}</select></label>
          <label class="chronicle-field">Chain <select id="c-chain" data-testid="chronicle-chain">${opt('', 'All', state.chain || '')}${opt('NEAR', 'NEAR', state.chain || '')}${opt('NEAR Intents', 'NEAR Intents', state.chain || '')}</select></label>
          <label class="chronicle-field">Decision <select id="c-d" data-testid="chronicle-filter">${opt('', 'All', state.cd || '')}${opt('allowed', 'Allowed', state.cd || '')}${opt('denied', 'Refused', state.cd || '')}${opt('failed', 'Failed on chain', state.cd || '')}</select></label>
        </div>
        <ol class="feed" data-testid="chronicle-page"${rows.length ? '' : ' hidden'}>${list}</ol>
        <p class="c-empty-line" data-testid="chronicle-empty"${rows.length ? ' hidden' : ''}>${esc(emptyText)}</p>
        <button type="button" class="chronicle-quiet" id="c-more" data-testid="chronicle-more"${moreRows ? '' : ' hidden'}>Show more</button>
      </div>
      <div class="chronicle-pane" data-pane="statement"${tab === 'statement' ? '' : ' hidden'}>
        <label class="chronicle-field">Statement <textarea id="c-statement" data-testid="chronicle-statement" readonly>${esc(state.statement || '')}</textarea></label>
        <label class="chronicle-field">Digest <input id="c-digest-line" data-testid="chronicle-digest-line" value="${esc(state.digest || '')}" readonly autocomplete="off" spellcheck="false"></label>
        <label class="chronicle-field">Signature <input id="c-sig" data-testid="chronicle-signature" value="${esc(state.signature || '')}" autocomplete="off" spellcheck="false" placeholder="No signature yet"></label>
        <label class="chronicle-field">Private note <input id="c-note" data-testid="chronicle-private" value="${esc(state.privateNote || '')}" autocomplete="off"></label>
        <label class="chronicle-check"><input id="c-consent" data-testid="chronicle-consent" type="checkbox"${state.consent ? ' checked' : ''}> Salt this note. Do not publish the raw hash.</label>
      </div>
      <div class="chronicle-pane" data-pane="verify"${tab === 'verify' ? '' : ' hidden'}>
        <p class="c-bundle" data-testid="chronicle-bundle">${esc(state.bundleText || 'Check this bundle, then Verify TEE now for the live quote.')}</p>
        <button type="button" class="chronicle-quiet" id="c-tee" data-testid="chronicle-tee">Verify TEE now</button>
        <label class="chronicle-field">Bundle <textarea id="c-manifest" data-testid="chronicle-manifest">${esc(state.manifestText || '')}</textarea></label>
        <label class="chronicle-field">Digest <input id="c-digest" data-testid="chronicle-digest" value="${esc(state.digest || '')}" autocomplete="off" spellcheck="false"></label>
        <label class="chronicle-field">Signature <input id="c-vsig" data-testid="chronicle-verify-signature" value="${esc(state.signature || '')}" autocomplete="off" spellcheck="false"></label>
      </div>
    </div>
    <button type="button" class="chronicle-gold" id="c-go" data-testid="chronicle-go">${cta}</button>
    <p class="c-status${attest ? ' c-attest' : ''}" id="c-out" data-testid="chronicle-verify">${verifyHtml}</p>
    <div class="c-meta">
      <span class="c-flow" data-testid="chronicle-flow" aria-label="Account to ledger">
        <span class="c-mark-lg" title="Account">${ACCOUNT_MARK}</span>
        <span class="c-arrow" aria-hidden="true">→</span>
        <span class="c-mark-lg" title="Ledger">${LEDGER_MARK}</span>
      </span>
      <details class="c-sources" data-testid="chronicle-sources">
        <summary>Sources</summary>
        <p class="c-health" data-testid="chronicle-health">${esc(state.health || '')}</p>
        <ul class="c-cover-list" data-testid="chronicle-coverage">${cover}</ul>
        <p class="c-totals" data-testid="chronicle-totals">${esc(state.totals ? totalsLine(state.totals) : '')}</p>
        <p class="c-rules" data-testid="chronicle-rules">${esc(state.rules?.version ? `Rules version ${state.rules.version} (${state.rules.versions.length} readable).` : (state.rules?.why || ''))}</p>
      </details>
      <button type="button" class="chronicle-quiet" id="c-csv" data-testid="chronicle-export"${state.exportCount ? '' : ' disabled'}>Export CSV</button>
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
    const n = Math.max(ROW_PAGE, Number(state.shown) || ROW_PAGE);
    state.shown = n;
    state.rowTotal = all.length;
    state.viewRows = all.slice(0, n);
    // Totals are computed from the same rows the list and CSV use, so the three always agree.
    state.totals = totalsOf(all);
    return all;
  }

  function rememberFields() {
    const account = root.isConnected ? q$(root, '#c-account') : null;
    if (account && doc.activeElement === account) state.accountDraft = account.value;
    const words = root.isConnected ? q$(root, '#c-q') : null;
    if (words && doc.activeElement === words) state.cq = words.value;
  }

  const paint = () => {
    rememberFields();
    prepareRows();
    state.exportCount = matchingRows().length;
    if (!root.isConnected && hooks.repaint) { hooks.repaint(); return; }
    root.innerHTML = chronicleMarkup(state);
    bind();
  };

  const showOut = () => {
    const live = root.isConnected ? q$(root, '#c-out') : null;
    const html = `${esc(state.verify || 'Nothing is signed from this tray.')}${state.verifyUrl ? ` <a data-testid="chronicle-link" href="${esc(state.verifyUrl)}">View transaction</a>` : ''}`;
    if (live) {
      live.innerHTML = html;
      live.classList.toggle('c-attest', /TEE quote/.test(state.verify || ''));
    }
    const health = root.isConnected ? q$(root, '[data-testid=chronicle-health]') : null;
    if (health) health.textContent = state.health || '';
    const cover = root.isConnected ? q$(root, '[data-testid=chronicle-coverage]') : null;
    if (cover) cover.innerHTML = coverageItems(state).map(t => `<li>${esc(t)}</li>`).join('');
    const seal = root.isConnected ? q$(root, '#c-seal') : null;
    if (seal) {
      seal.hidden = !state.seal;
      seal.textContent = state.seal || '';
    }
    const go = root.isConnected ? q$(root, '#c-go') : null;
    if (go) go.textContent = ctaOf(state);
    const csv = root.isConnected ? q$(root, '#c-csv') : null;
    if (csv) csv.disabled = !matchingRows().length;
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

  async function drawList() {
    prepareRows();
    const ol = q$(root, '[data-testid=chronicle-page]');
    if (!ol) return paint();
    ol.innerHTML = (state.viewRows || []).map(rowHtml).join('');
    ol.hidden = !(state.viewRows || []).length;
    const empty = q$(root, '[data-testid=chronicle-empty]');
    if (empty) {
      empty.hidden = !ol.hidden;
      empty.textContent = state.account ? 'No rows for this account.' : 'Type an account. No history is assumed.';
    }
    const moreBtn = q$(root, '#c-more');
    const needMore = state.rowTotal > (state.viewRows || []).length || state.nextCursor || state.ftCursor;
    if (moreBtn) moreBtn.hidden = !needMore;
    if (/^(Showing \d+ of \d+\.|\d+ rows\.)/.test(state.verify || '')) state.verify = countText(state);
    showTotals();
    showOut();
  }

  // Totals and the rules line are part of the same answer as the list, so they are refreshed
  // with it instead of waiting for the next full paint.
  function showTotals() {
    const totals = root.isConnected ? q$(root, '[data-testid=chronicle-totals]') : null;
    if (totals) totals.textContent = state.totals ? totalsLine(state.totals) : '';
    const rules = root.isConnected ? q$(root, '[data-testid=chronicle-rules]') : null;
    if (rules) rules.textContent = state.rules?.version
      ? `Rules version ${state.rules.version} (${state.rules.versions.length} readable).`
      : (state.rules?.why || '');
  }

  async function readAccount(account, opts = {}) {
    const more = !!opts.more;
    const id = String(account || '').trim();
    const typed = root.isConnected ? q$(root, '#c-account') : null;
    const focused = !!(typed && doc.activeElement === typed);
    state.accountDraft = focused ? typed.value : id;
    const switching = id !== state.account;
    const mine = ++state.ticket;
    if (!id) {
      state.account = '';
      state.reading = false;
      state.auditRows = [];
      state.health = '';
      state.liveSources = [];
      state.nextCursor = '';
      state.ftCursor = '';
      state.shown = ROW_PAGE;
      state.bundleText = '';
      state.verify = 'Type an account, then press Show timeline.';
      state.verifyUrl = '';
      drawList();
      return;
    }
    const cursor = more && !switching ? (state.nextCursor || '') : '';
    const ftCursor = more && !switching ? (state.ftCursor || '') : '';
    if (!more || switching) {
      state.account = id;
      if (switching) {
        state.auditRows = [];
        state.health = '';
        state.liveSources = [];
        state.nextCursor = '';
        state.ftCursor = '';
        state.shown = ROW_PAGE;
        state.bundleText = '';
        state.verifyUrl = '';
      }
      state.verify = 'Reading this account…';
    } else state.verify = 'Reading older rows…';
    state.reading = true;
    showOut();
    const base = api();
    const get = async (path) => {
      const res = await fetch(`${base}${path}`);
      if (!res.ok) return null;
      return res.json();
    };
    const liveQuery = new URLSearchParams({ account: id });
    if (cursor) liveQuery.set('cursor', cursor);
    if (ftCursor) liveQuery.set('ftCursor', ftCursor);
    let board = null, ledger = null, mainnet = null, live = null;
    try {
      const livePromise = fetch(`${base}/api/chronicle/live?${liveQuery}`, { signal: AbortSignal.timeout(8000) }).catch(() => null);
      // The public ledger and the deployment record are the same answer for every account, so they
      // are read once per page and shared. A second account read (or Show more) must not re-ask them:
      // that fan-out is what the ledger/mainnet 429 reports were about.
      [board, ledger, mainnet] = await Promise.all([
        get('/api/chronicle?owner=' + encodeURIComponent(id)),
        sharedJson(`${base}/api/ledger`, 'ledger'),
        sharedJson(`${base}/api/mainnet`, 'mainnet'),
      ]);
      if (mine !== state.ticket) return;
      const liveRes = await livePromise;
      if (!liveRes || !liveRes.ok) live = { error: liveRes?.status === 429 ? 'The live timeline is rate limited. Try again in a minute.' : 'The live timeline did not answer.', rows: [], gaps: ['The live timeline did not answer.'] };
      else live = await liveRes.json();
    } catch {
      live = live || { error: 'The live timeline did not answer.', rows: [], gaps: ['The live timeline did not answer.'] };
    }
    if (mine !== state.ticket) return;
    state.reading = false;
    const audit = accountRows({ account: id, board, ledger, mainnet, live });
    if (more && !switching) {
      const seen = new Set((state.auditRows || []).map(r => r.h));
      const added = (audit.rows || []).filter(r => r.h && !seen.has(r.h));
      state.auditRows = (state.auditRows || []).concat(added);
      state.shown = Math.min(state.auditRows.length, (state.shown || ROW_PAGE) + ROW_PAGE);
      state.nextCursor = added.length ? (live?.nextCursor || '') : '';
      state.ftCursor = added.length ? (live?.ftCursor || '') : '';
    } else {
      state.auditRows = audit.rows;
      state.shown = ROW_PAGE;
      state.nextCursor = live?.nextCursor || '';
      state.ftCursor = live?.ftCursor || '';
    }
    state.coverage = audit.coverage;
    state.health = live?.health || '';
    state.liveSources = Array.isArray(live?.sources) ? live.sources : [];
    prepareRows();
    state.verify = countText(state);
    state.verifyUrl = '';
    const needMore = state.rowTotal > (state.viewRows || []).length || state.nextCursor || state.ftCursor;
    if (!q$(root, '#c-more') && needMore) paint();
    else drawList();
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

  // The rules version the statement is written against: rebuilt from the account's own
  // row-writing transactions, never assumed. Missing history is labelled, not filled in.
  async function rulesNow() {
    if (state.rules && state.rules.account === state.account && !state.rules.refresh) return state.rules;
    const out = { account: state.account, version: '', why: 'The rules were not read yet.', versions: [] };
    try {
      const res = await fetch(`${api()}/api/chronicle/anchors?account=${encodeURIComponent(state.account)}`, { signal: AbortSignal.timeout(9000) });
      if (res.ok) {
        const body = await res.json();
        const built = reconstructRules({
          row: body.snapshot ? { ...body.snapshot, owner: state.account } : null,
          writes: (body.ruleWrites || []).map(w => ({ ...w, rowAfter: null })),
          hashHex: sha256Hex,
          owner: state.account,
        });
        out.version = built.current?.version || '';
        out.versions = built.versions;
        out.why = built.why || (out.version ? '' : 'Historic rules: missing.');
        out.anchorCount = (body.anchors || []).length;
        out.gaps = body.gaps || [];
      } else out.why = 'The rule history did not answer. Historic rules: missing.';
    } catch { out.why = 'The rule history did not answer. Historic rules: missing.'; }
    state.rules = out;
    return out;
  }

  async function writeNow() {
    clearSeal();
    const rows = filteredAll();
    const period = periodOf();
    const totals = totalsOf(rows).totals;
    const rules = await rulesNow();
    const rulesArg = rules.version ? { version: rules.version } : null;
    const local = writeStatement({ account: state.account, period, rows, rules: rulesArg, totals });
    const bound = bundleDigest({ account: state.account, period, rows });
    state.verify = 'Asking NEAR AI…';
    showOut();
    let proof = null;
    try {
      const res = await fetch(`${api()}/api/chronicle/statement`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          account: state.account,
          period,
          digest: bound,
          totals,
          rules: rulesArg,
          rows: rows.slice(0, 40).map(r => ({ h: r.h, shop: r.shop, decision: r.decision, amount: r.amount || '' })),
        }),
        signal: AbortSignal.timeout(25000),
      });
      if (res.ok) proof = await res.json();
    } catch { proof = null; }
    if (!proof?.text) {
      proof = {
        mode: 'local-fallback',
        text: local.text,
        model: 'none',
        signature: '',
        digest: bound,
        status: local.status,
        attestation: { note: 'Local fallback. Not a NEAR AI signature. The statement route did not answer.' },
      };
    }
    const text = proof.text || local.text;
    state.statement = text;
    state.signature = proof.signature || '';
    state.publicKey = String(proof.signing_address || '').replace(/^ed25519:/i, '');
    state.proof = proof;
    const manifest = canonicalManifest({ account: state.account, period, rows, rules: rulesArg, statement: text, model: proof.model || 'none' });
    state.manifest = manifest;
    state.manifestText = manifest.text;
    state.digest = manifest.digest;
    state.totals = totalsOf(rows);
    state.verify = proof.status || local.status;
    state.verifyUrl = '';
    state.tab = 'statement';
    paint();
    return { status: state.verify };
  }

  async function anchorNow() {
    const note = q$(root, '#c-note')?.value ?? state.privateNote ?? '';
    const consent = q$(root, '#c-consent')?.checked ?? !!state.consent;
    state.privateNote = note;
    state.consent = !!consent;
    if (consent && note && !state.salt) state.salt = saltBytes();
    const plan = anchorPlan({ manifest: state.manifest, consent: !!consent, privateNote: note, salt: state.salt || '' });
    state.verifyUrl = '';
    if (!plan.ok) {
      state.verify = plan.reason;
      clearSeal();
      showOut();
      return { status: plan.reason, signed: false };
    }
    // The CTA and the AI both come here: one real board.anchor under the visitor's session key.
    const send = hooks.onAnchor;
    if (typeof send !== 'function') {
      state.verify = 'No session is attached, so the anchor was not sent. The bundle is still downloadable.';
      showOut();
      return { status: state.verify, signed: false };
    }
    state.verify = 'Anchoring on the board…';
    showOut();
    let sent = null;
    try { sent = await send(plan); }
    catch (e) { sent = { ok: false, reason: String(e?.message || e) }; }
    state.anchorPlan = plan;
    if (!sent?.ok) {
      const why = sent?.reason || 'refused';
      state.verify = `The board did not log the anchor: ${why}. Nothing was stored, and the bundle is still downloadable.`;
      state.verifyUrl = sent?.tx ? `https://nearblocks.io/txns/${sent.tx}` : '';
      clearSeal();
      showOut();
      return { status: state.verify, signed: false };
    }
    const events = parseAnchorEvents(sent.logs || []);
    const proof = anchorProof({ commitment: plan.commitment, owner: state.account, events });
    state.anchorEvents = events;
    state.verify = proof.ok
      ? `Anchored on the board. ${proof.why}`
      : 'The board accepted the call but this receipt did not carry the anchor event. Check the transaction.';
    state.verifyUrl = `https://nearblocks.io/txns/${sent.tx}`;
    const file = JSON.stringify({ manifest: state.manifest, plan: { method: plan.method, args: plan.args, commitment: plan.commitment }, tx: sent.tx, events }, null, 2);
    try {
      if (hooks.downloadJson) hooks.downloadJson(file, 'chronicle-anchor.json');
      else downloadCsv(file, 'chronicle-anchor.json');
    } catch { /* the download is a convenience, never the proof */ }
    if (proof.ok) clearSeal(); else setSeal(state.verify);
    showOut();
    return { status: state.verify, signed: true, tx: sent.tx };
  }

  async function checkBundle() {
    const manifestText = q$(root, '#c-manifest')?.value ?? state.manifestText ?? '';
    const statement = q$(root, '#c-statement')?.value || state.statement || '';
    const digest = q$(root, '#c-digest')?.value ?? state.digest ?? '';
    const signature = q$(root, '#c-vsig')?.value || q$(root, '#c-sig')?.value || state.signature || '';
    const proof = state.proof ? { ...state.proof, signature: signature || state.proof.signature || '' } : null;
    const verdict = proof
      ? await verifyNearAi({ manifestText, statement, digest, proof })
      : await verifyBundle({ manifestText, statement, digest, signature, publicKey: state.publicKey || '' });
    state.manifestText = manifestText;
    state.digest = digest;
    state.bundleChecked = verdict.why;
    state.bundleText = verdict.why;
    state.verify = verdict.ok ? 'Bundle checked.' : 'This bundle did not check.';
    state.verifyUrl = '';
    const box = root.isConnected ? q$(root, '[data-testid=chronicle-bundle]') : null;
    if (box) box.textContent = verdict.why;
    if (!verdict.ok) {
      state.seal = verdict.why;
      hooks.onSeal?.(verdict.why);
    } else clearSeal();
    showOut();
    return verdict;
  }

  async function verifyTeeNow() {
    if (state.teeBusy) return;
    state.teeBusy = true;
    state.bundleText = 'Checking the TEE…';
    const box = root.isConnected ? q$(root, '[data-testid=chronicle-bundle]') : null;
    if (box) box.textContent = state.bundleText;
    try {
      const body = await liveTee({ api: api(), model: state.proof?.model || '' });
      const extra = teeNowText(state.proof, body);
      state.bundleText = `${state.bundleChecked || ''} ${extra}`.trim();
      if (box) box.textContent = state.bundleText;
      state.verify = body?.ok ? 'TEE check passed.' : 'TEE check did not pass.';
    } catch {
      state.bundleText = `${state.bundleChecked || ''} TEE quote: the live check did not answer.`.trim();
      if (box) box.textContent = state.bundleText;
      state.verify = 'TEE check did not pass.';
    } finally {
      state.teeBusy = false;
      showOut();
    }
  }

  async function showMore() {
    const loaded = matchingRows().length;
    if ((state.shown || ROW_PAGE) < loaded) {
      state.shown = (state.shown || ROW_PAGE) + ROW_PAGE;
      prepareRows();
      state.verify = countText(state);
      drawList();
      return;
    }
    if (state.nextCursor || state.ftCursor) await readAccount(state.account, { more: true });
  }

  function exportRows() {
    clearSeal();
    const rows = filteredAll();
    if (!rows.length) {
      state.verify = 'Nothing to export.';
      state.verifyUrl = '';
      showOut();
      return;
    }
    const text = exportCsv(rows);
    if (hooks.downloadCsv) hooks.downloadCsv(text);
    else downloadCsv(text);
    const shops = [...new Set(rows.map(r => r.shop).filter(Boolean))].slice(0, 3).join(', ');
    state.verify = `Exported ${rows.length} rows: ${shops}.`;
    state.verifyUrl = '';
    showOut();
  }

  async function onGold() {
    if (state.goldBusy) return;
    state.goldBusy = true;
    try {
      if (state.tab === 'timeline') await readAccount(q$(root, '#c-account')?.value ?? state.accountDraft ?? state.account ?? '');
      else if (state.tab === 'verify') await checkBundle();
      else if (state.statement) await anchorNow();
      else await writeNow();
    } finally {
      state.goldBusy = false;
      showOut();
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
      onRead: (account) => readAccount(account),
      rowsOf: () => state.auditRows || [],
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
    if (account) account.oninput = (e) => { state.accountDraft = e.target.value; };
    const search = q$(root, '#c-q');
    if (search) search.oninput = (e) => { state.cq = e.target.value; clearSeal(); drawList(); };
    for (const [sel, key] of [['#c-d', 'cd'], ['#c-shop', 'shop'], ['#c-chain', 'chain'], ['#c-span', 'span']]) {
      const el = q$(root, sel);
      if (el) el.onchange = (e) => { state[key] = e.target.value; clearSeal(); drawList(); };
    }
    const csv = q$(root, '#c-csv');
    if (csv) csv.onclick = () => exportRows();
    const more = q$(root, '#c-more');
    if (more) more.onclick = () => showMore();
    const tee = q$(root, '#c-tee');
    if (tee) tee.onclick = () => verifyTeeNow();
    const go = q$(root, '#c-go');
    if (go) go.onclick = () => onGold();
    q$(root, '[data-testid=chronicle-page]')?.addEventListener('click', (e) => {
      const b = e.target.closest?.('.c-v');
      if (!b) return;
      const row = baseRows().find(r => r.h === b.dataset.hash) || { h: b.dataset.hash, signer: b.dataset.signer };
      verifyRow(row);
    });
    armChronicleDock((text) => runAgent(text));
    // The send path is installed once by installChronicleDock (a capturing click/keydown
    // listener). A second onclick here fired the same line twice, so an empty box ran a
    // second command and overwrote the first answer.
  }

  if (!state.sourceText) state.sourceText = 'Type an account, then press Show timeline.';
  if (!state.verify) state.verify = 'Nothing is signed from this tray.';
  if (!root.__chronicleKeys) {
    root.__chronicleKeys = true;
    const stopKeys = (e) => {
      const t = e.target;
      if (!t?.closest?.('input, textarea, select, .chronicle-card')) return;
      e.stopPropagation();
      if (e.type === 'keydown' && e.key === 'Enter' && t.id === 'c-account') {
        e.preventDefault();
        readAccount(t.value);
      }
    };
    root.addEventListener('keydown', stopKeys);
    root.addEventListener('keyup', stopKeys);
    root.addEventListener('keypress', stopKeys);
  }
  paint();
  return { paint, runAgent, readAccount };
}
