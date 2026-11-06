// City dock for Mist Bank. The tray rebinds onclick on every paint; this listener stays.
// Re-arm the runner after every bank paint via armBankDock.

let runner = null;
let busy = false;
let inflight = null;

export const BANK_NOT_READY = 'The agent is not ready. Open Mist Bank and press Audit privately again.';

export function armBankDock(fn) {
  runner = typeof fn === 'function' ? fn : null;
}

export function bankDockLog(doc, text) {
  const el = doc?.getElementById?.('bank-agent-log');
  if (!el) return false;
  const msg = text || '';
  el.hidden = !msg;
  el.textContent = msg;
  return true;
}

export function installBankDock(doc) {
  if (!doc || typeof doc.addEventListener !== 'function' || doc.__nearcartaBankDock) return;
  doc.__nearcartaBankDock = true;
  const onEvent = (e) => {
    const t = e.target;
    if (!t || typeof t.closest !== 'function') return;
    const click = e.type === 'click' && t.closest('#bank-agent-go');
    const enter = e.type === 'keydown' && (e.key === 'Enter' || e.code === 'Enter' || e.keyCode === 13) && t.closest('#bank-agent');
    if (!click && !enter) return;
    if (enter) e.preventDefault();
    dispatchBankDock(doc);
  };
  doc.addEventListener('click', onEvent, true);
  doc.addEventListener('keydown', onEvent, true);
}

export function dispatchBankDock(doc) {
  if (!doc) return Promise.resolve({ ok: false, hint: BANK_NOT_READY });
  if (busy) return inflight;
  busy = true;
  inflight = runDock(doc).finally(() => { busy = false; });
  return inflight;
}

export function lastBankDockSend() { return inflight; }

async function runDock(doc) {
  const input = doc.getElementById?.('bank-agent');
  const text = String(input?.value || '').trim();
  try {
    if (typeof runner !== 'function') {
      bankDockLog(doc, BANK_NOT_READY);
      return { ok: false, hint: BANK_NOT_READY };
    }
    bankDockLog(doc, 'Reading…');
    const result = await runner(text);
    if (result?.ok && input) input.value = '';
    const hint = result?.hint || (result?.ok ? '' : 'That line did not run.');
    bankDockLog(doc, hint);
    return result || { ok: false, hint };
  } catch (e) {
    const hint = e?.message || 'The agent could not run that line.';
    bankDockLog(doc, hint);
    return { ok: false, hint };
  }
}
