// Town Hall row editor. The city tray, /shops/hall/ and the console mount this.
// Sign sends set_rules / set_frozen / set_seal with deposit 0, then reads get_charter back.
// This file does not sign until the visitor presses Sign.

import { readSession, readSessionAccount, sessionPill, visitor } from '../../design/D8_shops/js/session.js';
import { roomError } from '../room-error.js';
import {
  BOARD, ROW_WAIT_MS, diffCharter, draftFrom, matchNote, nearOf, normalizeRow, readUntilChange, rowOwner, waitForFinal, withRowWait,
} from './hall.js';
import { runHallCommand } from './hall-actions.js';
import { armHallDock, ensureHallDock, installHallDock } from './hall-dock.js';
import { jobTray } from './hall-panes.js';
import { createLedger, statusLines } from '../../../shared/hall/job.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const apiBase = () => (globalThis.NEARCARTA_API || '').replace(/\/$/, '');

function ownerNow() {
  const params = new URLSearchParams(globalThis.location?.search || '');
  if (params.has('preview') && globalThis.history?.replaceState) {
    params.delete('preview');
    const q = params.toString();
    history.replaceState(null, '', location.pathname + (q ? `?${q}` : '') + location.hash);
  }
  return rowOwner({ owner: params.get('owner') || '', session: readSessionAccount() || '' });
}

export function hallSkeleton() {
  return `<div class="hall-skel" data-testid="hall-skel" aria-busy="true" aria-label="Reading your row"><span></span><span></span><span></span></div>`;
}

/** A long row id reads as 8e2027…61c8. Shorter account names stay whole. */
export function shortId(id) {
  const s = String(id || '');
  if (s.length <= 32) return s;
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

function rowLine(who) {
  if (!who) return '';
  return `<span data-testid="hall-row-id" title="${esc(who)}">${esc(shortId(who))}</span><span class="hall-id-full" data-testid="hall-row-full">${esc(who)}</span><button type="button" class="primary copy-id" data-testid="hall-copy" data-copy="${esc(who)}">Copy</button>`;
}

export function charterSetupCta({ accountId = '', displayName = '', note = 'This account has no charter row.' } = {}) {
  const named = displayName || accountId;
  const facts = named ? `<p data-testid="hall-facts">Signed in as ${esc(named)}.</p>` : '';
  const id = accountId
    ? `<dl class="hall-meta" data-testid="hall-read"><div><dt>Row</dt><dd class="row-id">${rowLine(accountId)}</dd></div></dl>`
    : '';
  return `<div class="card charter-cta" data-testid="charter-cta" role="status">${facts}<p>${esc(note)}</p>${id}<p><a class="primary" data-testid="charter-setup" href="/setup/#rules">Rules and Sign</a></p></div>`;
}

export function hallMarkup(row, person = null) {
  if (!row && person?.accountId) return charterSetupCta({ accountId: person.accountId, displayName: person.displayName || '' });
  const cap = row ? String(nearOf(row.per_action_cap)) : '';
  const who = row?.owner || person?.accountId || '';
  const named = person?.displayName || who;
  const facts = who
    ? `Signed in as ${esc(named)}.`
    : 'Sign in, then open your row. This page does not open a preview account.';
  const details = row
    ? `<div><dt>Board</dt><dd>${esc(BOARD)}</dd></div><div><dt>Cap</dt><dd>${esc(cap)} NEAR</dd></div>`
    : '';
  const meta = who
    ? `<dl class="hall-meta" data-testid="hall-read"><div><dt>Row</dt><dd class="row-id">${rowLine(who)}</dd></div>${details}</dl>`
    : '<p data-testid="hall-read"></p>';
  return `<form id="row-form" data-testid="hall-form">
    <p data-testid="hall-facts">${facts}</p>
    ${meta}
    <label class="field">Max per payment (NEAR) <input id="cap" data-testid="hall-cap" inputmode="decimal" value="${esc(cap)}"></label>
    <label class="check"><input id="frozen" data-testid="hall-frozen" type="checkbox" ${row?.frozen ? 'checked' : ''}> <span>Freeze the row. The agent key cannot undo this.</span></label>
    <label class="check"><input id="sealed" data-testid="hall-seal" type="checkbox" ${row?.sealed ? 'checked' : ''}> <span>Store a seal. The rule text stays off the row.</span></label>
    <p class="muted" id="bond">Deposit 0. The calls are set_rules, set_frozen and set_seal on your own row.</p>
    <button class="primary" id="apply" data-testid="hall-apply" type="submit">Sign</button>
    <div id="result" data-testid="result" aria-live="polite"></div>
    <div id="list" data-testid="hall-diff"></div>
  </form>`;
}

export async function mountHall(root, hooks = {}) {
  if (!root) return;
  let tab = 'post';
  let seal = '';
  let lines = [];
  let posted = null;
  const ledger = createLedger();
  const form = {
    task: '', budget: '', deadline: '24', parts: '2',
    workerA: '', workerB: '', quotePart: '1', quoteWorker: '', quoteNear: '', deliverable: '',
  };
  let market = { blocked: 'no_token', assignments: [], draft: null, agent: null };
  if (hooks.accountP && !readSessionAccount()) {
    try { await hooks.accountP; } catch { /* a saved session is not required to paint */ }
  }
  const choice = ownerNow();
  let before = null;
  const readForm = () => {
    const take = (id, key) => {
      const el = root.querySelector('#' + id);
      if (el) form[key] = el.value;
    };
    take('hall-task', 'task');
    take('hall-budget', 'budget');
    take('hall-deadline', 'deadline');
    take('hall-parts', 'parts');
    take('hall-worker-a', 'workerA');
    take('hall-worker-b', 'workerB');
    take('hall-quote-part', 'quotePart');
    take('hall-quote-worker', 'quoteWorker');
    take('hall-quote-near', 'quoteNear');
    take('hall-deliverable', 'deliverable');
  };
  const paint = () => {
    const person = visitor();
    root.innerHTML = jobTray({ tab, form, job: posted, market, seal, lines });
    const who = root.querySelector('#who') || document.getElementById('who');
    if (who) {
      const saved = readSession();
      const id = before?.owner || choice.owner || '';
      const pill = id ? sessionPill({ accountId: id, displayName: saved.displayName, balanceNear: saved.balanceNear }) : '';
      who.innerHTML = id ? `<b data-testid="who" data-account="${esc(id)}">${esc(pill)}</b>` : '';
    }
    const connect = document.getElementById('connect');
    if (connect) connect.hidden = !!(before?.owner || choice.owner || person.signedIn);
    root.querySelectorAll('[data-tab]').forEach(btn => {
      btn.onclick = () => { readForm(); tab = btn.dataset.tab || 'post'; seal = ''; paint(); };
    });
    root.querySelectorAll('[data-cmd]').forEach(btn => {
      btn.onclick = () => { readForm(); run(btn.dataset.cmd || ''); };
    });
    const cta = root.querySelector('[data-testid=hall-cta]');
    if (cta) cta.onclick = () => {
      readForm();
      if (cta.dataset.action === 'post' && (!form.task.trim() || !form.budget.trim())) {
        lines = ['Name the task and the budget. Nothing was signed.'];
        seal = '';
        paint();
        return;
      }
      run(ctaText(cta));
    };
    const doc = typeof document !== 'undefined' ? document : null;
    if (doc && doc.getElementById) {
      ensureHallDock(doc);
      installHallDock(doc);
      armHallDock(text => run(text));
      const dock = doc.getElementById('hall-agent-dock');
      if (dock) dock.hidden = false;
    }
    hooks.runAgent = text => run(text);
    if (hooks.state) hooks.state.hallRun = text => run(text);
  };
  function ctaText(cta) {
    const action = cta.dataset.action;
    const part = cta.dataset.part || form.quotePart || '1';
    if (action === 'post') return `post ${form.task} for ${form.budget} near`;
    if (action === 'quote') return `quote part ${form.quotePart || part} from ${form.quoteWorker} at ${form.quoteNear}`;
    if (action === 'accept') return `accept part ${part}`;
    if (action === 'pass') return `pass part ${part}`;
    if (action === 'refund') return 'refund';
    return '';
  }

  async function run(text) {
    seal = '';
    const result = await runHallCommand(text, {
      row: async () => before,
      form: () => form,
      ledger,
      job: () => posted,
      nowMs: hooks.nowMs,
      market: async () => {
        if (hooks.market) return hooks.market();
        try {
          const m = await fetch(apiBase() + '/api/hall/market', { cache: 'no-store' }).then(r => r.json());
          if (m && typeof m === 'object') market = m;
        } catch { market = { ...market, blocked: 'market_unread' }; }
        return market;
      },
      clearSeal: () => { seal = ''; },
      signRules: async (calls) => {
        const sign = hooks.sign || (async (list) => {
          const m = await import('/shops/hall/hall.bundle.js');
          return m.signCalls(list);
        });
        return sign(calls);
      },
    });
    if (result?.job) posted = result.job;
    if (result?.seal) seal = result.hint || 'Refused';
    else seal = '';
    const hint = result?.hint || '';
    const escrow = posted ? statusLines(posted)[0] : '';
    lines = [hint, escrow].filter(Boolean).slice(0, 2);
    if (result?.listing) {
      market = { ...market, blocked: result.listing.blocked, agent: result.listing.agent || market.agent, assignments: result.listing.assignments || market.assignments, draft: result.listing.draft || market.draft };
    }
    if (result?.job && tab === 'post' && result.ok && !result.duplicate) tab = 'agents';
    paint();
    if (result?.cinema && result.tx) hooks.onPaid?.(result);
    else if (result?.seal) hooks.onRefuse?.(result.hint);
    else hooks.onClear?.();
    return result;
  }

  async function readRow(id, { fresh = false } = {}) {
    const q = fresh ? `?fresh=1&t=${Date.now()}` : '';
    const body = await fetch(apiBase() + '/api/board/row/' + encodeURIComponent(id) + q, { cache: 'no-store' }).then(r => r.json());
    return normalizeRow(body) || (body?.row ? normalizeRow(body.row) : null);
  }

  async function onSign() {
    seal = '';
    hooks.onClear?.();
    const sealEl = root.querySelector('[data-testid=hall-refused]');
    if (sealEl) { sealEl.hidden = true; sealEl.replaceChildren(); }
    const result = root.querySelector('#result');
    const list = root.querySelector('#list');
    if (!before) {
      result.innerHTML = '<p data-testid="hall-norow">No row is loaded. Sign in to open your own row.</p>';
      return;
    }
    const cap = root.querySelector('#cap');
    const frozen = root.querySelector('#frozen');
    const sealed = root.querySelector('#sealed');
    let draft;
    try {
      draft = draftFrom(before, { capNear: cap.value, frozen: frozen.checked, sealed: sealed.checked, commitment: sealed.checked ? 'seal' : '' });
    } catch (e) {
      result.textContent = roomError(e);
      return;
    }
    const note = matchNote(before, draft);
    const diffs = diffCharter(before, draft);
    list.innerHTML = `<ul data-testid="diff-lines">${diffs.map(d => `<li data-field="${esc(d.field)}"><b>${esc(d.field)}</b></li>`).join('') || '<li>No field changed.</li>'}</ul>`;
    if (!note.calls.length) {
      result.innerHTML = `<p data-testid="hall-match">${esc(note.text)}</p>`;
      return;
    }
    result.innerHTML = '<p data-testid="hall-pending">Waiting for your wallet… Deposit 0.</p>';
    try {
      const sign = hooks.sign || (async (calls) => {
        const m = await import('/shops/hall/hall.bundle.js');
        return m.signCalls(calls);
      });
      const sent = await sign(note.calls);
      const box = () => root.querySelector('#result');
      if (sent?.hash) {
        if (box()) box().innerHTML = '<p data-testid="hall-pending">Waiting until the transaction is final…</p>';
        await waitForFinal(() => fetch(apiBase() + '/api/tx-status/' + encodeURIComponent(sent.hash) + '?sender=' + encodeURIComponent(sent.signer || before.owner), { cache: 'no-store' }).then(r => r.json()).catch(() => ({ final: false, pass: false })));
      }
      if (box()) box().innerHTML = '<p data-testid="hall-pending">Reading the row again…</p>';
      const outcome = await readUntilChange({
        before,
        draft,
        read: () => readRow(before.owner, { fresh: true }),
      });
      const shown = outcome.changed && outcome.row ? outcome.row : before;
      before = shown;
      paint(shown);
      const line = root.querySelector('#result');
      if (!line) return;
      if (outcome.changed && outcome.row) {
        line.innerHTML = `<p class="ok" data-testid="hall-readback">Read back. Cap is ${esc(nearOf(shown.per_action_cap))} NEAR.${sent?.hash ? ` Tx ${esc(String(sent.hash).slice(0, 10))}.` : ''}</p>`;
      } else {
        line.innerHTML = `<p data-testid="hall-readback">The chain still shows the previous cap. Nothing else was sent.</p>`;
      }
    } catch (e) {
      const box = root.querySelector('#result');
      if (box) box.innerHTML = `<p data-testid="room-boundary" role="alert">${esc(roomError(e))}</p>`;
    }
  }

  let gen = 0;
  async function start() {
    if (!choice.owner) { paint(null); return; }
    const mine = ++gen;
    root.innerHTML = hallSkeleton();
    let gaveUp = false;
    const loadRow = async () => {
      const row = await readRow(choice.owner);
      if (row || gaveUp) return row;
      return readRow(choice.owner, { fresh: true });
    };
    const job = loadRow();
    try {
      const row = await withRowWait(() => job, ROW_WAIT_MS);
      if (mine !== gen) return;
      before = row;
      paint(row);
    } catch (e) {
      if (mine !== gen) return;
      gaveUp = true;
      const why = e?.code === 'row-wait'
        ? e.message
        : `The row could not be read. ${roomError(e)} Nothing was signed.`;
      root.innerHTML = `<div class="card charter-cta" data-testid="hall-row-reason" role="alert"><p>${esc(why)}</p><p><button type="button" class="primary" data-testid="hall-retry">Try again</button></p></div>`;
      const retry = root.querySelector('[data-testid=hall-retry]');
      if (retry) retry.onclick = () => start();
      job.then(row => {
        if (mine !== gen) return;
        if (!root.querySelector('[data-testid=hall-row-reason]')) return;
        before = row;
        paint(row);
      }).catch(() => {});
    }
  }
  async function loadLive() {
    const base = apiBase();
    try {
      const m = hooks.market ? await hooks.market() : await fetch(base + '/api/hall/market', { cache: 'no-store' }).then(r => r.json());
      if (m && typeof m === 'object') market = m;
    } catch {
      market = { ...market, blocked: 'market_unread' };
    }
    if (root.querySelector('[data-testid=hall-desk]')) paint();
  }
  loadLive();
  start();
}
