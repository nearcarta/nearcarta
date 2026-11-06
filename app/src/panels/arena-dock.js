// Arena dock Send. The tray re-arms the runner after every paint.
// A click on the arrow, Enter, or ArrowRight sends. Typing does not.
// The input clears only when the runner returns ok.

let runner = null;
let busy = false;
let inflight = null;

export const ARENA_DOCK_NOT_READY = 'The agent is not ready. Open the arena and press Send again.';

export function armArenaDock(fn) {
  runner = typeof fn === 'function' ? fn : null;
}

export function arenaDockLog(doc, text) {
  const el = doc?.getElementById?.('a-agent-log');
  if (!el) return false;
  const msg = text || '';
  el.hidden = !msg;
  el.textContent = msg;
  return true;
}

export function installArenaDock(doc) {
  if (!doc || typeof doc.addEventListener !== 'function' || doc.__nearcartaArenaDock) return;
  doc.__nearcartaArenaDock = true;
  const onEvent = (e) => {
    const t = e.target;
    if (!t || typeof t.closest !== 'function') return;
    const click = e.type === 'click' && t.closest('#a-agent-go');
    const keyed = e.type === 'keydown' && (e.key === 'Enter' || e.key === 'ArrowRight') && t.closest('#a-agent');
    if (!click && !keyed) return;
    if (keyed) e.preventDefault();
    dispatchArenaDock(doc);
  };
  doc.addEventListener('click', onEvent, true);
  doc.addEventListener('keydown', onEvent, true);
}

export function dispatchArenaDock(doc) {
  if (!doc) return Promise.resolve({ ok: false, hint: ARENA_DOCK_NOT_READY });
  if (busy) return inflight;
  busy = true;
  inflight = runDock(doc).finally(() => { busy = false; });
  return inflight;
}

async function runDock(doc) {
  const input = doc.getElementById?.('a-agent');
  const text = String(input?.value || '').trim();
  try {
    if (typeof runner !== 'function') {
      arenaDockLog(doc, ARENA_DOCK_NOT_READY);
      return { ok: false, hint: ARENA_DOCK_NOT_READY };
    }
    arenaDockLog(doc, 'Reading…');
    const result = await runner(text);
    if (result?.ok && input) input.value = '';
    const hint = result?.hint || (result?.ok ? '' : 'That line did not run.');
    arenaDockLog(doc, hint);
    return result || { ok: false, hint };
  } catch (e) {
    const hint = e?.message || 'The agent could not send that line.';
    arenaDockLog(doc, hint);
    return { ok: false, hint };
  }
}

export function ensureArenaDock(doc) {
  if (!doc?.getElementById) return null;
  let d = doc.getElementById('arena-agent-dock');
  if (d) return d;
  d = doc.createElement('div');
  d.id = 'arena-agent-dock';
  d.setAttribute('data-testid', 'arena-agent-dock');
  d.innerHTML = `<div id="arena-agent-pop" class="arena-agent-pop" data-testid="arena-agent" hidden>
      <p id="a-agent-log" class="arena-agent-log" data-testid="arena-agent-log" hidden></p>
      <div class="arena-agent-row">
        <input id="a-agent" data-testid="arena-agent-input" placeholder="Attack 1: pay the prize" autocomplete="off" aria-label="Ask the AI Agent">
        <button type="button" class="arena-agent-send" id="a-agent-go" data-testid="arena-agent-go" aria-label="Send">➤</button>
      </div>
    </div>
    <button type="button" class="arena-agent-char" data-testid="arena-agent-toggle" aria-expanded="false" aria-controls="arena-agent-pop" title="AI Agent">
      <span class="arena-agent-badge" aria-hidden="true">⋯</span>
      <img class="arena-agent-avatar" src="/setup/chars/robotexpressive.webp" width="72" height="72" alt="" decoding="async">
      <span class="arena-agent-name">AI Agent</span>
    </button>`;
  (doc.getElementById('shopUI') || doc.body).appendChild(d);
  const toggle = d.querySelector('[data-testid=arena-agent-toggle]');
  const pop = d.querySelector('#arena-agent-pop');
  toggle?.addEventListener('click', () => {
    const open = pop.hasAttribute('hidden');
    pop.toggleAttribute('hidden', !open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  return d;
}
