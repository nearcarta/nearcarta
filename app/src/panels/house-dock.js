// House dock Send. Same shape as the Ferry dock, separate ids so the two shops do not share a runner.
// Enter and the arrow button both send. A miss writes the log. Typing does not send.

let runner = null;
let busy = false;
let inflight = null;

export const HOUSE_DOCK_NOT_READY = 'The agent is not ready. Open Your House and press Send again.';

export function armHouseDock(fn) {
  runner = typeof fn === 'function' ? fn : null;
}

export function houseDockLog(doc, text) {
  const el = doc?.getElementById?.('h-agent-log');
  if (!el) return false;
  const msg = text || '';
  el.hidden = !msg;
  el.textContent = msg;
  return true;
}

export function ensureHouseDock(doc) {
  if (!doc?.getElementById) return null;
  let d = doc.getElementById('house-agent-dock');
  if (d) return d;
  d = doc.createElement('div');
  d.id = 'house-agent-dock';
  d.setAttribute('data-testid', 'house-agent-dock');
  d.innerHTML = `<div id="house-agent-pop" class="house-agent-pop" data-testid="house-agent" hidden>
      <p id="h-agent-log" class="house-agent-log" data-testid="house-agent-log" hidden></p>
      <div class="house-agent-row">
        <input id="h-agent" data-testid="house-agent-input" placeholder="I'm alive, or send from the house" autocomplete="off" aria-label="Ask the AI Agent">
        <button type="button" class="house-agent-send" id="h-agent-go" data-testid="house-agent-go" aria-label="Send">➤</button>
      </div>
    </div>
    <button type="button" class="house-agent-char" data-testid="house-agent-toggle" aria-expanded="false" aria-controls="house-agent-pop" title="AI Agent">
      <img class="house-agent-avatar" src="/setup/chars/robotexpressive.webp" width="72" height="72" alt="" decoding="async">
      <span class="house-agent-name">AI Agent</span>
    </button>`;
  (doc.getElementById('shopUI') || doc.body).appendChild(d);
  const toggle = d.querySelector('[data-testid=house-agent-toggle]');
  const pop = d.querySelector('#house-agent-pop');
  toggle?.addEventListener('click', () => {
    const open = pop.hasAttribute('hidden');
    pop.toggleAttribute('hidden', !open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) d.querySelector('#h-agent')?.focus();
  });
  return d;
}

export function installHouseDock(doc) {
  if (!doc || typeof doc.addEventListener !== 'function' || doc.__nearcartaHouseDock) return;
  doc.__nearcartaHouseDock = true;
  const onEvent = (e) => {
    const t = e.target;
    if (!t || typeof t.closest !== 'function') return;
    const click = e.type === 'click' && t.closest('#h-agent-go');
    const enter = e.type === 'keydown' && (e.key === 'Enter' || e.key === 'ArrowRight') && t.closest('#h-agent');
    if (!click && !enter) return;
    if (enter) e.preventDefault();
    dispatchHouseDock(doc);
  };
  doc.addEventListener('click', onEvent, true);
  doc.addEventListener('keydown', onEvent, true);
}

export function dispatchHouseDock(doc) {
  if (!doc) return Promise.resolve({ ok: false, hint: HOUSE_DOCK_NOT_READY });
  if (busy) return inflight;
  busy = true;
  inflight = runDock(doc).finally(() => { busy = false; });
  return inflight;
}

async function runDock(doc) {
  const input = doc.getElementById?.('h-agent');
  const text = String(input?.value || '').trim();
  try {
    if (typeof runner !== 'function') {
      houseDockLog(doc, HOUSE_DOCK_NOT_READY);
      return { ok: false, hint: HOUSE_DOCK_NOT_READY };
    }
    houseDockLog(doc, 'Reading…');
    const result = await runner(text);
    if (result?.ok && input) input.value = '';
    const hint = result?.hint || (result?.ok ? '' : 'That line did not run.');
    houseDockLog(doc, hint);
    return result || { ok: false, hint };
  } catch (e) {
    const hint = e?.message || 'The agent could not send that line.';
    houseDockLog(doc, hint);
    return { ok: false, hint };
  }
}
