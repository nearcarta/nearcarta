// Toll dock Send. The tray rebinds the button on every paint; this listener stays.
// A click or Enter with no runner still writes the log. Typing does not send.
// Re-arm the runner after every toll paint via armTollDock.
// Sources: app/design/D8_shops/js/shopui.js wireTollDock; app/src/panels/toll-room.js runAgent.

let runner = null;
let busy = false;
let inflight = null;

export const DOCK_NOT_READY = 'The agent is not ready. Open Toll Bridge and press Send again.';

export function armTollDock(fn) {
  runner = typeof fn === 'function' ? fn : null;
}

export function tollDockLog(doc, text) {
  const el = doc?.getElementById?.('t-agent-log');
  if (!el) return false;
  const msg = text || '';
  el.hidden = !msg;
  el.textContent = msg;
  return true;
}

/** One capture listener. Later onclick assignments cannot drop it. */
export function installTollDock(doc) {
  if (!doc || typeof doc.addEventListener !== 'function' || doc.__nearcartaTollDock) return;
  doc.__nearcartaTollDock = true;
  const onEvent = (e) => {
    const t = e.target;
    if (!t || typeof t.closest !== 'function') return;
    const click = e.type === 'click' && t.closest('#t-agent-go');
    const enter = e.type === 'keydown' && e.key === 'Enter' && t.closest('#t-agent');
    if (!click && !enter) return;
    if (enter) e.preventDefault();
    dispatchTollDock(doc);
  };
  doc.addEventListener('click', onEvent, true);
  doc.addEventListener('keydown', onEvent, true);
}

export function dispatchTollDock(doc) {
  if (!doc) return Promise.resolve({ ok: false, hint: DOCK_NOT_READY });
  if (busy) return inflight;
  busy = true;
  inflight = runDock(doc).finally(() => { busy = false; });
  return inflight;
}

export function lastTollDockSend() { return inflight; }

async function runDock(doc) {
  const input = doc.getElementById?.('t-agent');
  const text = String(input?.value || '').trim();
  try {
    if (typeof runner !== 'function') {
      tollDockLog(doc, DOCK_NOT_READY);
      return { ok: false, hint: DOCK_NOT_READY };
    }
    tollDockLog(doc, 'Reading…');
    const result = await runner(text);
    if (result?.ok && input) input.value = '';
    const hint = result?.hint || (result?.ok ? '' : 'That line did not run.');
    tollDockLog(doc, hint);
    return result || { ok: false, hint };
  } catch (e) {
    const hint = e?.message || 'The agent could not send that line.';
    tollDockLog(doc, hint);
    return { ok: false, hint };
  }
}
