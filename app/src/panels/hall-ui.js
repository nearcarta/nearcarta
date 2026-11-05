// Town Hall row editor. The city tray, /shops/hall/ and the console mount this.
// Sign sends set_rules / set_frozen / set_seal with deposit 0, then reads get_charter back.
// This file does not sign until the visitor presses Sign.

import { readSession, readSessionAccount, sessionPill, visitor } from '../../design/D8_shops/js/session.js';
import { roomError } from '../room-error.js';
import {
  BOARD, diffCharter, draftFrom, matchNote, nearOf, normalizeRow, readBack, readUntilChange, rowOwner, waitForFinal,
} from './hall.js';

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
  return `<span data-testid="hall-row-id" title="${esc(who)}">${esc(shortId(who))}</span><button type="button" class="copy-id" data-testid="hall-copy" data-copy="${esc(who)}">Copy</button>`;
}

export function hallMarkup(row, person = null) {
  const cap = row ? String(nearOf(row.per_action_cap)) : '';
  const who = row?.owner || person?.accountId || '';
  const named = person?.displayName || who;
  const facts = who
    ? `Signed in as ${esc(named)}.`
    : 'Sign in, then open your row. This page does not open a preview account.';
  const meta = row
    ? `<dl class="hall-meta" data-testid="hall-read"><div><dt>Row</dt><dd class="row-id">${rowLine(who)}</dd></div><div><dt>Board</dt><dd>${esc(BOARD)}</dd></div><div><dt>Cap</dt><dd>${esc(cap)} NEAR</dd></div></dl>`
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
  if (hooks.accountP && !readSessionAccount()) {
    try { await hooks.accountP; } catch { /* a saved session is not required to paint */ }
  }
  const choice = ownerNow();
  let before = null;
  const paint = (row) => {
    const person = visitor();
    root.innerHTML = hallMarkup(row, person);
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
    form.onsubmit = (e) => { e.preventDefault(); onSign(); };
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
  };

  async function readRow(id, { fresh = false } = {}) {
    const q = fresh ? `?fresh=1&t=${Date.now()}` : '';
    const body = await fetch(apiBase() + '/api/board/row/' + encodeURIComponent(id) + q, { cache: 'no-store' }).then(r => r.json());
    return normalizeRow(body) || (body?.row ? normalizeRow(body.row) : null);
  }

  async function onSign() {
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

  if (!choice.owner) { paint(null); return; }
  root.innerHTML = hallSkeleton();
  try {
    before = await readRow(choice.owner);
    paint(before);
    if (!before) {
      const person = visitor();
      const named = person.displayName || choice.owner;
      root.querySelector('[data-testid=hall-facts]').innerHTML = `Signed in as ${esc(named)}. <span data-testid="hall-missing">No row for <code>${esc(choice.owner)}</code> on <code>${esc(BOARD)}</code>.</span>`;
    }
  } catch {
    paint(null);
    const facts2 = root.querySelector('[data-testid=hall-facts]');
    const person = visitor();
    if (facts2) facts2.textContent = person.signedIn
      ? `Signed in as ${person.displayName || person.accountId}. The row could not be read. Nothing was signed.`
      : 'The row could not be read. Nothing was signed.';
  }
}
