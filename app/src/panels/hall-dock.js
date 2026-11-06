// Town Hall dock. Re-arm after every hall paint. A click or Enter with no runner still writes the log.
// The arrow button and Enter both send. Typing does not.

let runner = null;
let busy = false;
let inflight = null;

export const HALL_DOCK_NOT_READY = 'The agent is not ready. Open Town Hall and press Send again.';

export function armHallDock(fn) {
  runner = typeof fn === 'function' ? fn : null;
}

export function hallDockLog(doc, text) {
  const el = doc?.getElementById?.('h-agent-log');
  if (!el) return false;
  const msg = text || '';
  el.hidden = !msg;
  el.textContent = msg;
  return true;
}

export function installHallDock(doc) {
  if (!doc || typeof doc.addEventListener !== 'function' || doc.__nearcartaHallDock) return;
  doc.__nearcartaHallDock = true;
  const onEvent = (e) => {
    const t = e.target;
    if (!t || typeof t.closest !== 'function') return;
    const click = e.type === 'click' && t.closest('#h-agent-go');
    const enter = e.type === 'keydown' && (e.key === 'Enter' || e.code === 'Enter' || e.keyCode === 13) && t.closest('#h-agent');
    if (!click && !enter) return;
    if (enter) e.preventDefault();
    dispatchHallDock(doc);
  };
  doc.addEventListener('click', onEvent, true);
  doc.addEventListener('keydown', onEvent, true);
}

export function dispatchHallDock(doc) {
  if (!doc) return Promise.resolve({ ok: false, hint: HALL_DOCK_NOT_READY });
  if (busy) return inflight;
  busy = true;
  inflight = runDock(doc).finally(() => { busy = false; });
  return inflight;
}

export function lastHallDockSend() { return inflight; }

async function runDock(doc) {
  const input = doc.getElementById?.('h-agent');
  const text = String(input?.value || '').trim();
  try {
    if (typeof runner !== 'function') {
      hallDockLog(doc, HALL_DOCK_NOT_READY);
      return { ok: false, hint: HALL_DOCK_NOT_READY };
    }
    hallDockLog(doc, 'Reading…');
    const result = await runner(text);
    if (result?.ok && input) input.value = '';
    const hint = result?.hint || (result?.ok ? '' : 'That line did not run.');
    hallDockLog(doc, hint);
    return result || { ok: false, hint };
  } catch (e) {
    const hint = e?.message || 'The agent could not send that line.';
    hallDockLog(doc, hint);
    return { ok: false, hint };
  }
}

export function ensureHallDock(doc) {
  if (!doc || typeof doc.getElementById !== 'function' || typeof doc.createElement !== 'function') return null;
  let d = doc.getElementById('hall-agent-dock');
  if (d) return d;
  const host = doc.getElementById('shopUI') || doc.body;
  if (!host) return null;
  d = doc.createElement('div');
  d.id = 'hall-agent-dock';
  d.setAttribute('data-testid', 'hall-agent-dock');
  d.innerHTML = `<div id="hall-agent-pop" class="hall-agent-pop" data-testid="hall-agent" hidden>
      <p id="h-agent-log" class="hall-agent-log" data-testid="hall-agent-log" hidden></p>
      <div class="hall-agent-row">
        <input id="h-agent" data-testid="hall-agent-input" placeholder="Post a readme pass for 0.002 near" autocomplete="off" aria-label="Ask the AI Agent">
        <button type="button" class="hall-agent-send" id="h-agent-go" data-testid="hall-agent-go" aria-label="Send">➤</button>
      </div>
    </div>
    <button type="button" class="hall-agent-char" data-testid="hall-agent-toggle" aria-expanded="false" aria-controls="hall-agent-pop" title="AI Agent">
      <img class="hall-agent-avatar" src="/setup/chars/robotexpressive.webp" width="72" height="72" alt="" decoding="async">
      <span class="hall-agent-name">AI Agent</span>
    </button>`;
  host.appendChild(d);
  const toggle = d.querySelector('[data-testid=hall-agent-toggle]');
  const pop = d.querySelector('#hall-agent-pop');
  toggle?.addEventListener('click', () => {
    const open = pop.hasAttribute('hidden');
    pop.toggleAttribute('hidden', !open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) d.querySelector('#h-agent')?.focus();
  });
  installHallDock(doc);
  return d;
}
