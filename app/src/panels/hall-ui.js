// Town Hall row editor. The city tray, /shops/hall/ and the console mount this.
// Sign sends set_rules / set_frozen / set_seal with deposit 0, then reads get_charter back.
// This file does not sign until the visitor presses Sign.

import { readSession, readSessionAccount, sessionPill, visitor } from '../../design/D8_shops/js/session.js';
import { roomError } from '../room-error.js';
import {
  BOARD, diffCharter, draftFrom, matchNote, nearOf, normalizeRow, readBack, rowOwner,
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

export function hallMarkup(row, person = null) {
  const cap = row ? String(nearOf(row.per_action_cap)) : '';
  const who = row?.owner || person?.accountId || '';
  const named = person?.displayName || who;
  const facts = who
    ? `Signed in as ${esc(named)}. Row for <code>${esc(who)}</code> on <code>${esc(BOARD)}</code>.${cap ? ` Cap ${esc(cap)} NEAR.` : ''}`
    : 'Sign in, then open your row. This page does not open a preview account.';
  return `<form id="row-form" data-testid="hall-form">
    <p data-testid="hall-facts">${facts}</p>
    <p data-testid="hall-read">${who ? `Row for <code>${esc(who)}</code> on <code>${esc(BOARD)}</code>. Cap ${esc(cap)} NEAR.` : ''}</p>
    <label>Max per payment (NEAR) <input id="cap" data-testid="hall-cap" inputmode="decimal" value="${esc(cap)}"></label>
    <label><input id="frozen" data-testid="hall-frozen" type="checkbox" ${row?.frozen ? 'checked' : ''}> Freeze the row. The agent key cannot undo this.</label>
    <label><input id="sealed" data-testid="hall-seal" type="checkbox" ${row?.sealed ? 'checked' : ''}> Store a seal. The rule text stays off the row.</label>
    <p class="muted" id="bond">Deposit 0. The calls are set_rules, set_frozen and set_seal on your own row.</p>
    <button class="primary" id="apply" data-testid="hall-apply" type="submit">Sign</button>
    <div id="result" data-testid="result" aria-live="polite"></div>
    <div id="list" data-testid="hall-diff"></div>
  </form>`;
}

export async function mountHall(root, hooks = {}) {
  if (!root) return;
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
  };

  async function readRow(id) {
    const body = await fetch(apiBase() + '/api/board/row/' + encodeURIComponent(id)).then(r => r.json());
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
    result.innerHTML = '<p>Waiting for your wallet… Deposit 0.</p>';
    try {
      const sign = hooks.sign || (async (calls) => {
        const m = await import('/shops/hall/hall.bundle.js');
        return m.signCalls(calls);
      });
      const sent = await sign(note.calls);
      const again = await readRow(before.owner);
      const shown = again || readBack(draft);
      before = shown;
      paint(shown);
      root.querySelector('#result').innerHTML = `<p class="ok" data-testid="hall-readback">Read back. Cap is ${esc(nearOf(shown.per_action_cap))} NEAR.${sent?.hash ? ` Tx ${esc(String(sent.hash).slice(0, 10))}.` : ''}</p>`;
    } catch (e) {
      const box = root.querySelector('#result');
      if (box) box.innerHTML = `<p data-testid="room-boundary" role="alert">${esc(roomError(e))}</p>`;
    }
  }

  paint(null);
  if (!choice.owner) return;
  const facts = root.querySelector('[data-testid=hall-facts]');
  if (facts) facts.textContent = 'Reading your row…';
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
