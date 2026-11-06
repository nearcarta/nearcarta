// Payouts dock Send. The tray rebinds the button on every paint; this listener stays.
// Enter and the arrow both send. A successful line clears the input. A miss leaves a hint.
// Re-arm the runner after every payouts paint via armPayoutsDock.

let runner = null;
let busy = false;
let inflight = null;

export const DOCK_NOT_READY = 'The agent is not ready. Open Payouts and press Send again.';
export const DOCK_MISS = 'Try: Pay these three, Send payout 1, Create invoice 0.15 USD on Base USDC, or Export accountant CSV.';

export function armPayoutsDock(fn) {
  runner = typeof fn === 'function' ? fn : null;
}

export function payoutsDockLog(doc, text) {
  const el = doc?.getElementById?.('p-agent-log');
  if (!el) return false;
  const msg = text || '';
  el.hidden = !msg;
  el.textContent = msg;
  return true;
}

export function installPayoutsDock(doc) {
  if (!doc || typeof doc.addEventListener !== 'function' || doc.__nearcartaPayoutsDock) return;
  doc.__nearcartaPayoutsDock = true;
  const onEvent = (e) => {
    const t = e.target;
    if (!t || typeof t.closest !== 'function') return;
    const click = e.type === 'click' && t.closest('#p-agent-go');
    const enter = e.type === 'keydown' && e.key === 'Enter' && t.closest('#p-agent');
    if (!click && !enter) return;
    if (enter) e.preventDefault();
    dispatchPayoutsDock(doc);
  };
  doc.addEventListener('click', onEvent, true);
  doc.addEventListener('keydown', onEvent, true);
}

export function dispatchPayoutsDock(doc) {
  if (!doc) return Promise.resolve({ ok: false, hint: DOCK_NOT_READY });
  if (busy) return inflight;
  busy = true;
  inflight = runDock(doc).finally(() => { busy = false; });
  return inflight;
}

export function lastPayoutsDockSend() { return inflight; }

export function payoutsDockHtml() {
  return `<div id="payouts-agent-dock" data-testid="payouts-agent-dock">
    <div id="payouts-agent-pop" class="payouts-agent-pop" data-testid="payouts-agent" hidden>
      <p id="p-agent-log" class="payouts-agent-log" data-testid="payouts-agent-log" hidden></p>
      <div class="payouts-agent-row">
        <input id="p-agent" data-testid="payouts-agent-input" placeholder="Pay these three" autocomplete="off" aria-label="Ask the AI Agent">
        <button type="button" class="payouts-agent-send" id="p-agent-go" data-testid="payouts-agent-go" aria-label="Send">➤</button>
      </div>
    </div>
    <button type="button" class="payouts-agent-char" data-testid="payouts-agent-toggle" aria-expanded="false" aria-controls="payouts-agent-pop" title="AI Agent">
      <span class="payouts-agent-badge" aria-hidden="true">⋯</span>
      <img class="payouts-agent-avatar" src="/setup/chars/robotexpressive.webp" width="72" height="72" alt="" decoding="async">
      <span class="payouts-agent-name">AI Agent</span>
    </button>
  </div>`;
}

export function ensurePayoutsDock(doc) {
  if (!doc?.getElementById) return null;
  let d = doc.getElementById('payouts-agent-dock');
  if (!d) {
    const host = doc.getElementById('shopUI') || doc.body;
    if (!host) return null;
    const wrap = doc.createElement('div');
    wrap.innerHTML = payoutsDockHtml();
    d = wrap.firstElementChild;
    host.appendChild(d);
  }
  d.hidden = false;
  if (!d.dataset.wired) {
    d.dataset.wired = '1';
    const toggle = d.querySelector('[data-testid=payouts-agent-toggle]');
    const pop = d.querySelector('#payouts-agent-pop');
    toggle?.addEventListener('click', () => {
      const open = pop.hasAttribute('hidden');
      pop.toggleAttribute('hidden', !open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) d.querySelector('#p-agent')?.focus();
    });
  }
  installPayoutsDock(doc);
  return d;
}

async function runDock(doc) {
  const input = doc.getElementById?.('p-agent');
  const text = String(input?.value || '').trim();
  try {
    if (typeof runner !== 'function') {
      payoutsDockLog(doc, DOCK_NOT_READY);
      return { ok: false, hint: DOCK_NOT_READY };
    }
    payoutsDockLog(doc, 'Reading…');
    const result = await runner(text);
    if ((result?.ok || result?.clear) && input) input.value = '';
    const hint = result?.hint || (result?.ok ? '' : DOCK_MISS);
    payoutsDockLog(doc, hint);
    return result || { ok: false, hint };
  } catch (e) {
    const hint = e?.message || 'The agent could not send that line.';
    payoutsDockLog(doc, hint);
    return { ok: false, hint };
  }
}
