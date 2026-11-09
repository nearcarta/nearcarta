// Guardhouse dock Send. Re-arm the runner after every paint.
// A click or Enter with no runner still writes the log. Typing does not send.
// Sources: app/src/panels/ferry-dock.js (same shape, guard ids).

let runner = null;
let busy = false;
let inflight = null;

export const DOCK_NOT_READY = 'The agent is not ready. Open the Guardhouse and press Send again.';

export function armGuardDock(fn) {
  runner = typeof fn === 'function' ? fn : null;
}

export function guardDockLog(doc, text) {
  const el = doc?.getElementById?.('g-agent-log');
  if (!el) return false;
  const msg = text || '';
  el.hidden = !msg;
  el.textContent = msg;
  return true;
}

export function installGuardDock(doc) {
  if (!doc || typeof doc.addEventListener !== 'function' || doc.__nearcartaGuardDock) return;
  doc.__nearcartaGuardDock = true;
  const onEvent = (e) => {
    const t = e.target;
    if (!t || typeof t.closest !== 'function') return;
    const click = e.type === 'click' && t.closest('#g-agent-go');
    const enter = e.type === 'keydown' && e.key === 'Enter' && t.closest('#g-agent');
    if (!click && !enter) return;
    if (enter) e.preventDefault();
    // Mark the event: the shop shell also binds onclick/onkeydown on the same controls, and a
    // fast answer resolves before that handler runs, so it used to send again with the cleared
    // input and overwrite the real answer with the "Try:" hint.
    e.__nearcartaDockSent = true;
    dispatchGuardDock(doc);
  };
  doc.addEventListener('click', onEvent, true);
  doc.addEventListener('keydown', onEvent, true);
}

export function dispatchGuardDock(doc) {
  if (!doc) return Promise.resolve({ ok: false, hint: DOCK_NOT_READY });
  if (busy) return inflight;
  busy = true;
  inflight = runDock(doc).finally(() => { busy = false; });
  return inflight;
}

export function lastGuardDockSend() { return inflight; }

export function ensureGuardCss(doc) {
  if (!doc?.getElementById || doc.getElementById('guard-tray-css')) return;
  const link = doc.createElement('link');
  link.id = 'guard-tray-css';
  link.rel = 'stylesheet';
  link.href = '/panels/guard.css';
  doc.head?.appendChild(link);
}

export function ensureGuardDock(doc) {
  if (!doc?.getElementById || !doc.createElement) return null;
  ensureGuardCss(doc);
  let d = doc.getElementById('guard-agent-dock');
  if (d) return d;
  d = doc.createElement('div');
  d.id = 'guard-agent-dock';
  d.setAttribute('data-testid', 'guard-agent-dock');
  d.innerHTML = `<div id="guard-agent-pop" class="guard-agent-pop" data-testid="guard-agent" hidden>
      <p id="g-agent-log" class="guard-agent-log" data-testid="guard-agent-log" hidden></p>
      <div class="guard-agent-row">
        <input id="g-agent" data-testid="guard-agent-input" placeholder="Check shop-moved-pay-here.near" autocomplete="off" aria-label="Ask the guard">
        <button type="button" class="guard-agent-send" id="g-agent-go" data-testid="guard-agent-go" aria-label="Send">➤</button>
      </div>
    </div>
    <button type="button" class="guard-agent-char" data-testid="guard-agent-toggle" aria-expanded="false" aria-controls="guard-agent-pop" title="AI Agent">
      <span class="guard-agent-badge" aria-hidden="true">⋯</span>
      <img class="guard-agent-avatar" src="/setup/chars/robotexpressive.webp" width="72" height="72" alt="" decoding="async">
      <span class="guard-agent-name">AI Agent</span>
    </button>`;
  const host = doc.getElementById('shopUI') || doc.body;
  host?.appendChild(d);
  if (!d.dataset.wired) {
    d.dataset.wired = '1';
    const toggle = d.querySelector('[data-testid=guard-agent-toggle]');
    const pop = d.querySelector('#guard-agent-pop');
    toggle?.addEventListener('click', () => {
      const open = pop.hasAttribute('hidden');
      pop.toggleAttribute('hidden', !open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }
  return d;
}

async function runDock(doc) {
  const input = doc.getElementById?.('g-agent');
  const text = String(input?.value || '').trim();
  try {
    if (typeof runner !== 'function') {
      guardDockLog(doc, DOCK_NOT_READY);
      return { ok: false, hint: DOCK_NOT_READY };
    }
    guardDockLog(doc, 'Reading…');
    const result = await runner(text);
    if (result?.ok && input) input.value = '';
    const hint = result?.hint || (result?.ok ? '' : 'That line did not run.');
    guardDockLog(doc, hint);
    return result || { ok: false, hint };
  } catch (e) {
    const hint = e?.message || 'The agent could not send that line.';
    guardDockLog(doc, hint);
    return { ok: false, hint };
  }
}
