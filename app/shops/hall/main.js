// Town Hall: the visitor's own board row. set_rules, set_frozen, set_seal. Gas only.
// A preview stores the row in this browser and reads it back. This file does not sign.
import { BOARD, PREVIEW_ROW, callsFor, diffCharter, draftFrom, nearOf, readBack } from './row.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const KEY = 'nearcarta.hall.row.preview';
const preview = new URLSearchParams(location.search).has('preview');

function loadRow() {
  if (!preview) return null;
  try { return JSON.parse(sessionStorage.getItem(KEY) || '') || { ...PREVIEW_ROW }; }
  catch { return { ...PREVIEW_ROW, receivers: [...PREVIEW_ROW.receivers] }; }
}

function saveRow(row) {
  sessionStorage.setItem(KEY, JSON.stringify(row));
}

let before = loadRow();

function paint(row) {
  if (!row) {
    $('#facts').innerHTML = `<p>Sign in, then open your row on <code>${esc(BOARD)}</code>. This page reads <code>get_charter</code> and does not file a council proposal.</p>`;
    $('#list').textContent = 'No row loaded.';
    return;
  }
  $('#cap').value = String(nearOf(row.per_action_cap));
  $('#frozen').checked = !!row.frozen;
  $('#sealed').checked = !!row.sealed;
  $('#who').innerHTML = `<b data-testid="who">${esc(row.owner)}</b>`;
  $('#facts').innerHTML = `<p data-testid="hall-read">Row for <code>${esc(row.owner)}</code> on <code>${esc(BOARD)}</code>. Cap ${esc(nearOf(row.per_action_cap))} NEAR.</p>
    <p>Daily ${esc(nearOf(row.daily_budget))} NEAR. ${esc(row.max_actions_per_day)} payments a day.</p>
    <p>Frozen: ${row.frozen ? 'yes' : 'no'}. Sealed: ${row.sealed ? 'yes' : 'no'}.</p>
    <p class="muted">Receivers: ${(row.receivers || []).map(r => `<code>${esc(r)}</code>`).join(', ') || 'none'}.</p>`;
}

function paintDiff(from, to, calls) {
  const diffs = diffCharter(from, to);
  const lines = diffs.map(d => `<li data-field="${esc(d.field)}"><b>${esc(d.field)}</b> ${esc(typeof d.from === 'string' ? d.from : JSON.stringify(d.from))} → ${esc(typeof d.to === 'string' ? d.to : JSON.stringify(d.to))}</li>`).join('');
  const methods = calls.map(c => `<li><code>${esc(c.method)}</code> deposit ${esc(c.deposit)}</li>`).join('');
  $('#list').innerHTML = `<ul data-testid="diff-lines">${lines || '<li>No field changed.</li>'}</ul><p class="muted">Calls, not sent:</p><ul>${methods || '<li>None</li>'}</ul>`;
}

if (preview) {
  if (!before) before = { ...PREVIEW_ROW, receivers: [...PREVIEW_ROW.receivers] };
  saveRow(before);
  $('#preview-note').hidden = false;
  paint(before);
} else {
  paint(null);
  $('#apply').textContent = 'Prepare the calls';
}

$('#row-form').onsubmit = e => {
  e.preventDefault();
  const base = before || { ...PREVIEW_ROW, receivers: [...PREVIEW_ROW.receivers] };
  const draft = draftFrom(base, { capNear: $('#cap').value, frozen: $('#frozen').checked, sealed: $('#sealed').checked, commitment: $('#sealed').checked ? 'preview' : '' });
  const calls = callsFor(base, draft);
  const next = readBack(draft);
  paintDiff(base, next, calls);
  if (preview) {
    saveRow(next);
    before = next;
    paint(next);
    $('#result').innerHTML = `<p class="ok" data-testid="hall-readback">Read back. Cap is ${esc(nearOf(next.per_action_cap))} NEAR. Frozen ${next.frozen ? 'yes' : 'no'}. Nothing was signed.</p>`;
    return;
  }
  $('#result').innerHTML = `<p data-testid="hall-prepared">Prepared ${calls.length} call${calls.length === 1 ? '' : 's'} on <code>${esc(BOARD)}</code>. Deposit 0. This page does not sign.</p>`;
};
