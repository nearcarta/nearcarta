// Chronicle agent dock. Click, Enter, and ArrowRight send. Typing does not.
// Re-arm the runner after every Chronicle paint.

let runner = null;
let busy = false;
let inflight = null;

export const DOCK_NOT_READY = 'The agent is not ready. Open Chronicle and press Send again.';

export function armChronicleDock(fn) {
  runner = typeof fn === 'function' ? fn : null;
}

export function chronicleDockLog(doc, text) {
  const el = doc?.getElementById?.('c-agent-log');
  if (!el) return false;
  const msg = text || '';
  el.hidden = !msg;
  el.textContent = msg;
  return true;
}

export function installChronicleDock(doc) {
  if (!doc || typeof doc.addEventListener !== 'function' || doc.__nearcartaChronicleDock) return;
  doc.__nearcartaChronicleDock = true;
  const onEvent = (e) => {
    const t = e.target;
    if (!t || typeof t.closest !== 'function') return;
    const click = e.type === 'click' && t.closest('#c-agent-go');
    const key = e.type === 'keydown' && (e.key === 'Enter' || e.key === 'ArrowRight') && t.closest('#c-agent');
    if (!click && !key) return;
    if (key) e.preventDefault();
    dispatchChronicleDock(doc);
  };
  doc.addEventListener('click', onEvent, true);
  doc.addEventListener('keydown', onEvent, true);
}

export function dispatchChronicleDock(doc) {
  if (!doc) return Promise.resolve({ ok: false, hint: DOCK_NOT_READY });
  if (busy) return inflight;
  busy = true;
  inflight = runDock(doc).finally(() => { busy = false; });
  return inflight;
}

export function lastChronicleDockSend() { return inflight; }

export function ensureChronicleDock(doc, active = true) {
  if (!doc?.getElementById || !doc.createElement) return null;
  let d = doc.getElementById('chronicle-agent-dock');
  if (!d) {
    d = doc.createElement('div');
    d.id = 'chronicle-agent-dock';
    d.setAttribute('data-testid', 'chronicle-agent-dock');
    d.innerHTML = `<div id="chronicle-agent-pop" class="chronicle-agent-pop" data-testid="chronicle-agent" hidden>
      <p id="c-agent-log" class="chronicle-agent-log" data-testid="chronicle-agent-log" hidden></p>
      <div class="chronicle-agent-row">
        <input id="c-agent" data-testid="chronicle-agent-input" placeholder="Show refused payments" autocomplete="off" aria-label="Ask the shop commands">
        <button type="button" class="chronicle-agent-send" id="c-agent-go" data-testid="chronicle-agent-go" aria-label="Send">➤</button>
      </div>
    </div>
    <button type="button" class="chronicle-agent-char" data-testid="chronicle-agent-toggle" aria-expanded="false" aria-controls="chronicle-agent-pop" title="Shop commands">
      <span class="chronicle-agent-badge" aria-hidden="true">⋯</span>
      <img class="chronicle-agent-avatar" src="/setup/chars/robotexpressive.webp" width="72" height="72" alt="" decoding="async">
      <span class="chronicle-agent-name">Commands</span>
    </button>`;
    (doc.getElementById('shopUI') || doc.body).appendChild(d);
    const stopKeys = (e) => e.stopPropagation();
    d.addEventListener('keydown', stopKeys);
    d.addEventListener('keyup', stopKeys);
    const toggle = d.querySelector('[data-testid=chronicle-agent-toggle]');
    const pop = d.querySelector('#chronicle-agent-pop');
    toggle?.addEventListener('click', () => {
      const open = pop.hasAttribute('hidden');
      pop.toggleAttribute('hidden', !open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) pop.querySelector('#c-agent')?.focus();
    });
  }
  d.hidden = !active;
  return d;
}

async function runDock(doc) {
  const input = doc.getElementById?.('c-agent');
  const text = String(input?.value || '').trim();
  try {
    if (typeof runner !== 'function') {
      chronicleDockLog(doc, DOCK_NOT_READY);
      return { ok: false, hint: DOCK_NOT_READY };
    }
    chronicleDockLog(doc, 'Reading the ledger…');
    const result = await runner(text);
    if (text && input) input.value = '';
    const hint = result?.hint || (result?.ok ? '' : 'That line did not run.');
    chronicleDockLog(doc, hint);
    return result || { ok: false, hint };
  } catch (e) {
    const hint = e?.message || 'The agent could not send that line.';
    if (text && input) input.value = '';
    chronicleDockLog(doc, hint);
    return { ok: false, hint };
  }
}
