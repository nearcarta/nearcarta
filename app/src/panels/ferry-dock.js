// City dock Send. The tray rebinds #f-agent-go onclick on every paint; this listener stays.
// A click or Enter with no runner still writes #f-agent-log. Typing does not send.
// Re-arm the runner after every ferry paint/bind via armFerryDock.
// Sources: app/design/D8_shops/js/shopui.js wireFerryDock; app/src/panels/deep.js runAgent.

let runner = null;
let busy = false;
let inflight = null;

export const DOCK_NOT_READY = 'The agent is not ready. Open Ferry and press Send again.';

export function armFerryDock(fn) {
  runner = typeof fn === 'function' ? fn : null;
}

export function ferryDockLog(doc, text) {
  const el = doc?.getElementById?.('f-agent-log');
  if (!el) return false;
  const msg = text || '';
  el.hidden = !msg;
  el.textContent = msg;
  return true;
}

export function dockEnter(e) {
  return !!(e && (e.key === 'Enter' || e.code === 'Enter' || e.code === 'NumpadEnter' || e.keyCode === 13));
}

/** One capture listener. Later onclick assignments cannot drop it. Enter submits the dock form. */
export function installFerryDock(doc) {
  if (!doc || typeof doc.addEventListener !== 'function' || doc.__nearcartaFerryDock) return;
  doc.__nearcartaFerryDock = true;
  const onEvent = (e) => {
    const t = e.target;
    if (!t || typeof t.closest !== 'function') return;
    const click = e.type === 'click' && t.closest('#f-agent-go');
    const enter = e.type === 'keydown' && dockEnter(e) && t.closest('#f-agent');
    const submit = e.type === 'submit' && t.closest('#f-agent-form');
    if (!click && !enter && !submit) return;
    if (enter || submit) e.preventDefault();
    // Mark the event: the shop shell also binds onclick/onkeydown on the same controls, and a
    // fast answer resolves before that handler runs, so it used to send again with the cleared
    // input and overwrite the real answer with the "Try:" hint.
    e.__nearcartaDockSent = true;
    dispatchFerryDock(doc);
  };
  doc.addEventListener('click', onEvent, true);
  doc.addEventListener('keydown', onEvent, true);
  doc.addEventListener('submit', onEvent, true);
}

export function dispatchFerryDock(doc) {
  if (!doc) return Promise.resolve({ ok: false, hint: DOCK_NOT_READY });
  if (busy) return inflight;
  busy = true;
  inflight = runDock(doc).finally(() => { busy = false; });
  return inflight;
}

export function lastFerryDockSend() { return inflight; }

async function runDock(doc) {
  const input = doc.getElementById?.('f-agent');
  const text = String(input?.value || '').trim();
  try {
    if (typeof runner !== 'function') {
      ferryDockLog(doc, DOCK_NOT_READY);
      return { ok: false, hint: DOCK_NOT_READY };
    }
    ferryDockLog(doc, 'Reading…');
    const result = await runner(text);
    if (result?.ok && input) input.value = '';
    const hint = result?.hint || (result?.ok ? '' : 'That line did not run.');
    ferryDockLog(doc, hint);
    return result || { ok: false, hint };
  } catch (e) {
    const hint = e?.message || 'The agent could not send that line.';
    ferryDockLog(doc, hint);
    return { ok: false, hint };
  }
}
