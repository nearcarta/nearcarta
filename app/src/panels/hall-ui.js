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
import { capIcon, counterMarkup, hirePane, jobsPane, lampIcon, noteMarkup, receiptMarkup, scrollIcon, sealMarkup } from './hall-panes.js';

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

function hallFrame({ tab, rowHtml, jobsHtml, hireHtml, seal, line }) {
  const on = name => (tab === name ? 'true' : 'false');
  const hide = name => (tab === name ? '' : ' hidden');
  return `<div class="hall-desk" data-testid="hall-desk">
    <div class="hall-tabs" role="tablist">
      <button type="button" class="hall-tab" role="tab" data-tab="row" aria-selected="${on('row')}" data-testid="hall-tab-row">${capIcon()}<span>My row</span></button>
      <button type="button" class="hall-tab" role="tab" data-tab="jobs" aria-selected="${on('jobs')}" data-testid="hall-tab-jobs">${scrollIcon()}<span>Jobs</span></button>
      <button type="button" class="hall-tab" role="tab" data-tab="hire" aria-selected="${on('hire')}" data-testid="hall-tab-hire">${lampIcon()}<span>Hire</span></button>
    </div>
    <div data-pane="row"${hide('row')}>${rowHtml}</div>
    <div data-pane="jobs"${hide('jobs')}>${jobsHtml}</div>
    <div data-pane="hire"${hide('hire')}>${hireHtml}</div>
    ${sealMarkup(seal)}
    ${noteMarkup(seal ? '' : line)}
  </div>`;
}

export async function mountHall(root, hooks = {}) {
  if (!root) return;
  let tab = 'row';
  let seal = '';
  let line = '';
  let speech = '';
  let pending = null;
  let lastReceipt = null;
  let jobs = { bounties: [], error: '', contract: 'townhall.nearcarta.near' };
  let market = { blocked: 'no_token', assignments: [], draft: null, agent: null };
  if (hooks.accountP && !readSessionAccount()) {
    try { await hooks.accountP; } catch { /* a saved session is not required to paint */ }
  }
  const choice = ownerNow();
  let before = null;
  const paint = (row) => {
    const person = visitor();
    root.innerHTML = hallFrame({
      tab,
      rowHtml: hallMarkup(row, person),
      jobsHtml: jobsPane(jobs),
      hireHtml: hirePane(market),
      seal,
      line,
    });
    const counter = root.querySelector('#hall-counter');
    if (counter) {
      counter.hidden = !speech;
      counter.innerHTML = counterMarkup(speech);
    }
    const slip = root.querySelector('#hall-receipt');
    if (slip) slip.innerHTML = receiptMarkup(lastReceipt);
    const who = root.querySelector('#who') || document.getElementById('who');
    if (who) {
      const saved = readSession();
      const id = row?.owner || choice.owner || '';
      const pill = id ? sessionPill({ accountId: id, displayName: saved.displayName, balanceNear: saved.balanceNear }) : '';
      who.innerHTML = id ? `<b data-testid="who" data-account="${esc(id)}">${esc(pill)}</b>` : '';
    }
    const connect = document.getElementById('connect');
    if (connect) connect.hidden = !!(row?.owner || choice.owner || person.signedIn);
    const form = root.querySelector('#row-form');
    if (form) form.onsubmit = (e) => { e.preventDefault(); onSign(); };
    const capEl = root.querySelector('#cap');
    if (capEl && row?.per_action_cap != null) capEl.value = String(nearOf(row.per_action_cap));
    const copy = root.querySelector('[data-testid=hall-copy]');
    if (copy) copy.onclick = async () => {
      const full = copy.dataset.copy || '';
      try {
        if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(full);
        else throw new Error('copy');
        copy.textContent = 'Copied';
      } catch {
        copy.textContent = 'Copy failed';
      }
    };
    root.querySelectorAll('[data-tab]').forEach(btn => {
      btn.onclick = () => { tab = btn.dataset.tab || 'row'; seal = ''; line = ''; paint(before); };
    });
    root.querySelectorAll('[data-cmd]').forEach(btn => {
      btn.onclick = () => run(btn.dataset.cmd || '');
    });
    const hireGo = root.querySelector('[data-testid=hall-hire-go]');
    if (hireGo) hireGo.onclick = () => {
      const brief = root.querySelector('#hall-brief')?.value || 'a lamp check';
      const near = root.querySelector('#hall-offer')?.value || '0.001';
      run(`hire an agent for ${brief} ${near} near`);
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

  async function run(text) {
    seal = '';
    const result = await runHallCommand(text, {
      row: async () => before,
      market: async () => {
        if (hooks.market) return hooks.market();
        try {
          const m = await fetch(apiBase() + '/api/hall/market', { cache: 'no-store' }).then(r => r.json());
          if (m && typeof m === 'object') market = m;
        } catch { market = { ...market, blocked: 'market_unread' }; }
        return market;
      },
      pay: hooks.pay,
      pending: () => pending,
      setPending: (p) => { pending = p; },
      clearPending: () => { pending = null; speech = ''; },
      clearSeal: () => { seal = ''; },
      signRules: async (calls) => {
        const sign = hooks.sign || (async (list) => {
          const m = await import('/shops/hall/hall.bundle.js');
          return m.signCalls(list);
        });
        return sign(calls);
      },
    });
    if (result?.speech) speech = result.speech;
    if (result?.seal) seal = result.hint || 'Refused';
    else seal = '';
    line = result?.speech ? '' : (result?.hint || '');
    if (result?.receipt) lastReceipt = result.receipt;
    if (result?.listing) {
      market = { ...market, blocked: result.listing.blocked, agent: result.listing.agent || market.agent, assignments: result.listing.assignments || market.assignments, draft: result.listing.draft || market.draft };
    }
    paint(before);
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
    line = '';
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
      const b = await fetch(base + '/api/hall/bounties', { cache: 'no-store' }).then(r => r.json());
      jobs = { bounties: Array.isArray(b?.bounties) ? b.bounties : [], error: b?.error || '', contract: b?.contract || jobs.contract };
    } catch {
      jobs = { ...jobs, error: 'The hall did not answer.' };
    }
    try {
      const m = hooks.market ? await hooks.market() : await fetch(base + '/api/hall/market', { cache: 'no-store' }).then(r => r.json());
      if (m && typeof m === 'object') market = m;
    } catch {
      market = { ...market, blocked: 'market_unread' };
    }
    if (tab !== 'row' && root.querySelector('[data-testid=hall-desk]')) paint(before);
  }
  loadLive();
  start();
}
