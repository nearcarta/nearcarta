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

const TX_HASH = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;

export function tollPendingLine(text) {
  const lower = String(text || '').toLowerCase();
  const pay = /\b(pay|pass|cross)\b/.test(lower) || /\bthe toll\b/.test(lower) || /\bpay toll\b/.test(lower) || /\bpass the bridge\b/.test(lower);
  return pay ? 'Asking the charter under your cap…' : 'Reading…';
}

export function tollDockLog(doc, text, extra = {}) {
  const el = doc?.getElementById?.('t-agent-log');
  if (!el) return false;
  const msg = String(text || '');
  const tx = String(extra.tx || '');
  const href = TX_HASH.test(tx) ? 'https://nearblocks.io/txns/' + tx : '';
  el.hidden = !msg && !href;
  const docu = typeof document !== 'undefined' ? document : null;
  if (href && docu?.createElement && typeof el.replaceChildren === 'function') {
    el.replaceChildren();
    if (msg) el.append(docu.createTextNode(msg + ' '));
    const a = docu.createElement('a');
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener';
    a.dataset.testid = 'toll-agent-tx';
    a.textContent = 'View the pass';
    el.append(a);
    return true;
  }
  el.textContent = msg + (href ? ' ' + href : '');
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
    // Mark the event: the shop shell also binds onclick/onkeydown on the same controls, and a
    // fast answer resolves before that handler runs, so it used to send again with the cleared
    // input and overwrite the real answer with the "Try:" hint.
    e.__nearcartaDockSent = true;
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
    tollDockLog(doc, tollPendingLine(text));
    const result = await runner(text);
    if (result?.ok && input) input.value = '';
    const hint = result?.hint || (result?.ok ? '' : 'That line did not run.');
    const tx = result?.ok ? (result.tx || result.o?.tx || '') : '';
    tollDockLog(doc, hint, { tx });
    return result || { ok: false, hint };
  } catch (e) {
    const hint = e?.message || 'The agent could not send that line.';
    tollDockLog(doc, hint);
    return { ok: false, hint };
  }
}
