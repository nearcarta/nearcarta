// Mist Bank city tray. Send / Seal / Attestation. The TEE button still calls GET /api/ai/tee.
import { PROOF_HREF, TEE_PLAN, TEE_TIMEOUT_MS, liveTee, teeTimeoutWhy, teeView } from '../tee-view.js';
import { visitor } from '../../design/D8_shops/js/session.js';
import { shortId } from './hall-ui.js';
import { parseBankAgent } from './bank-agent.js';
import { armBankDock, dispatchBankDock, installBankDock } from './bank-dock.js';
import { roomError } from '../room-error.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const api = () => (globalThis.NEARCARTA_API || '').replace(/\/$/, '');
const q$ = (root, sel) => root.querySelector(sel);

const ICON = {
  send: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16v12H4z"/><path d="M4 7l8 6 8-6"/></svg>',
  seal: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7"/><path d="M12 9v3l2 2"/></svg>',
  attest: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/><path d="M9 12l2 2 4-4"/></svg>',
};

function ensureBankCss(doc) {
  const d = doc || globalThis.document;
  if (!d || d.getElementById('bank-css')) return;
  const link = d.createElement('link');
  link.id = 'bank-css';
  link.rel = 'stylesheet';
  link.href = '/panels/bank.css';
  d.head?.appendChild(link);
}

export function ensureBankDock(doc) {
  const d = doc || globalThis.document;
  if (!d) return null;
  let dock = d.getElementById('bank-agent-dock');
  if (dock) { dock.hidden = false; return dock; }
  dock = d.createElement('div');
  dock.id = 'bank-agent-dock';
  dock.setAttribute('data-testid', 'bank-agent-dock');
  dock.innerHTML = `<div id="bank-agent-pop" class="bank-agent-pop" data-testid="bank-agent" hidden>
      <p id="bank-agent-log" class="bank-agent-log" data-testid="bank-agent-log" hidden></p>
      <div class="bank-agent-row">
        <input id="bank-agent" data-testid="bank-agent-input" placeholder="Send 0.001 NEAR privately" autocomplete="off" aria-label="Ask the AI Agent">
        <button type="button" class="bank-agent-send" id="bank-agent-go" data-testid="bank-agent-go" aria-label="Send">➤</button>
      </div>
    </div>
    <button type="button" class="bank-agent-char" data-testid="bank-agent-toggle" aria-expanded="false" aria-controls="bank-agent-pop" title="AI Agent">
      <img class="bank-agent-avatar" src="/setup/chars/robotexpressive.webp" width="72" height="72" alt="" decoding="async">
      <span class="bank-agent-name">AI Agent</span>
    </button>`;
  (d.getElementById('shopUI') || d.body).appendChild(dock);
  const toggle = dock.querySelector('[data-testid=bank-agent-toggle]');
  const pop = dock.querySelector('#bank-agent-pop');
  toggle?.addEventListener('click', () => {
    const open = pop.hasAttribute('hidden');
    pop.toggleAttribute('hidden', !open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  return dock;
}

export function hideBankDock(doc) {
  const d = doc || globalThis.document;
  const dock = d?.getElementById?.('bank-agent-dock');
  if (dock) dock.hidden = true;
}

function teeSlot() {
  const steps = TEE_PLAN.map(([id, label]) => `<li data-testid="tee-step" data-step="${esc(id)}" data-ok=""><b>${esc(label)}</b> <span class="tee-why">Waiting</span></li>`).join('');
  const recorded = `<p class="note tee-recorded" data-testid="tee-recorded">The file <a href="${PROOF_HREF}">tee-public.json</a> is a recorded attestation from Oct 28. The button is the live check.</p>`;
  const proof = `<a data-testid="tee-proof" href="${PROOF_HREF}">Proof file</a>`;
  return `<div class="tee-slot" data-testid="tee-slot"><button type="button" class="primary bank-cta" id="m-tee" data-testid="tee-verify">Verify the TEE now</button><ol class="tee-steps" data-testid="tee-steps">${steps}</ol><p data-testid="tee-live" class="tee-line"></p><p data-testid="tee-result" class="tee-line"></p><p data-testid="tee-fail" class="tee-line"></p>${recorded}${proof}</div>`;
}

function paintTee(slot, body) {
  if (!slot) return;
  const view = teeView(body);
  const live = slot.querySelector('[data-testid=tee-live]');
  const result = slot.querySelector('[data-testid=tee-result]');
  const fail = slot.querySelector('[data-testid=tee-fail]');
  if (live) live.textContent = view.ok ? 'Live check passed' : 'Live check did not pass';
  if (result) result.textContent = view.label || '';
  if (fail) fail.textContent = view.ok ? '' : (view.failed || '');
  const byId = new Map((view.steps || []).map(s => [String(s.id), s]));
  const requestOnly = view.steps.length === 1 && String(view.steps[0].id) === 'request';
  slot.querySelectorAll('[data-testid=tee-step]').forEach(li => {
    const id = li.dataset.step;
    const why = li.querySelector('.tee-why');
    const s = byId.get(id);
    if (requestOnly && id !== 'request') {
      li.dataset.ok = '';
      if (why) why.textContent = 'Not run';
      return;
    }
    if (!s) {
      if (id === 'request' && view.steps.length) {
        li.dataset.ok = '1';
        if (why) why.textContent = 'pass';
      }
      return;
    }
    li.dataset.ok = s.ok ? '1' : '0';
    if (why) why.textContent = s.ok ? 'pass' : (s.why || 'did not pass');
  });
}

export function bankMarkup(state = {}) {
  const tab = state.tab || 'send';
  const notes = state.notes?.length ? state.notes : [0.001, 0.002, 0.005];
  const note = notes.includes(+state.amt) ? +state.amt : notes[0];
  const payees = state.payees || [];
  const to = state.to || payees[0] || '';
  const tabBtn = (id, label, icon) => `<button type="button" role="tab" class="bank-tab${tab === id ? ' on' : ''}" data-tab="${id}" aria-selected="${tab === id ? 'true' : 'false'}" data-testid="bank-tab-${id}">${icon}<span>${label}</span></button>`;
  const tabs = `<div class="bank-tabs" role="tablist" data-testid="bank-tabs">${tabBtn('send', 'Send', ICON.send)}${tabBtn('seal', 'Seal', ICON.seal)}${tabBtn('attest', 'Attestation', ICON.attest)}</div>`;
  const session = state.signedIn ? `<p data-testid="bank-session">Signed in as ${esc(state.displayName || state.accountId)}.</p>` : '';
  const cap = state.capNear != null && state.capNear !== '' ? `<p class="bank-seal-line" data-testid="bank-cap">Cap ${esc(state.capNear)} NEAR.</p>` : '';
  const payeeBox = payees.length
    ? payees.map(a => `<label class="payee"><input type="radio" name="mto" value="${esc(a)}" ${a === to ? 'checked' : ''}><span class="payee-id" title="${esc(a)}">${esc(shortId(a))}</span></label>`).join('')
    : '<p>Sign in to choose a payee.</p>';
  const local = state.localNote ? `<p class="bank-refuse" data-testid="bank-local">${esc(state.localNote)}</p>` : '';
  const send = `<div class="bank-pane" data-pane="send" data-testid="bank-send" ${tab === 'send' ? '' : 'hidden'}>
      <p class="note" data-testid="bank-net">This payment is a charter check on mainnet. ${state.proofHtml || ''}</p>
      ${session}
      ${cap}
      <div class="choice" data-testid="bank-amount"><p class="choice-label">Amount</p><div class="seg notes bank-notes" role="radiogroup" aria-label="Amount" data-testid="bank-notes">${notes.map(n => `<label class="beside"><input type="radio" name="note" value="${n}" ${n === note ? 'checked' : ''}><span>${n} NEAR</span></label>`).join('')}</div></div>
      <div class="choice" data-testid="bank-payee"><p class="choice-label">Payee</p><div class="seg to bank-payees" id="m-to" data-testid="bank-to">${payeeBox}</div></div>
      <button type="button" class="primary bank-cta" id="bank-send-go" data-testid="bank-send-go">Send privately</button>
      ${local}
    </div>`;
  const opened = state.opened
    ? `<p class="bank-seal-line" data-testid="bank-opened">${esc(String(state.commitment || '').slice(0, 10))}…</p>`
    : '';
  const seal = `<div class="bank-pane" data-pane="seal" data-testid="bank-seal" ${tab === 'seal' ? '' : 'hidden'}>
      <p class="bank-seal-line" data-testid="bank-hidden">Hidden until used</p>
      <p class="bank-seal-line">The tighter cap and the denied accounts stay off the public row until a send uses them. The session key cannot call set_seal.</p>
      <button type="button" class="primary bank-cta" id="bank-open" data-testid="bank-open">Open envelope</button>
      ${opened}
    </div>`;
  const confText = state.confidential === true
    ? 'Confidential quote is dry. Nothing was spent.'
    : (state.confidential === false ? 'Confidential quotes are off on this server.' : '');
  const conf = `<p class="bank-proof-line" data-testid="bank-confidential">${esc(confText)}</p>`;
  const attest = `<div class="bank-pane" data-pane="attest" data-testid="bank-attest" ${tab === 'attest' ? '' : 'hidden'}>
      <p class="bank-proof-line" data-testid="bank-retention">${esc(state.proofNote || 'Request and response bytes are not stored. The file keeps hashes and the attestation summary.')}</p>
      ${conf}
      <a class="bank-proof-line" data-testid="bank-proof-download" href="${esc(state.proofHref || PROOF_HREF)}">Attestation file</a>
    </div>`;
  return `<div class="bank-card" data-testid="bank-card">${tabs}<div class="card shop-card shop-stack">${send}${seal}${attest}${teeSlot()}</div></div>`;
}

export function mountBankRoom(root, hooks = {}) {
  ensureBankCss(root?.ownerDocument);
  const state = hooks.state || (hooks.state = {});
  const who = typeof hooks.visitor === 'function' ? hooks.visitor() : visitor();
  const notes = hooks.notes ? hooks.notes() : [0.001, 0.002, 0.005];
  const named = hooks.payees ? hooks.payees() : [];
  const payees = named.length ? named : (who.signedIn ? [who.accountId] : []);
  if (!state.tab) state.tab = 'send';
  const capNear = typeof hooks.capNear === 'function' ? hooks.capNear() : state.capNear;
  const view = {
    ...state,
    tab: state.tab,
    notes,
    amt: state.amt,
    to: state.to || (hooks.def ? hooks.def() : payees[0] || ''),
    payees,
    signedIn: !!who.signedIn,
    displayName: who.displayName,
    accountId: who.accountId,
    capNear,
    proofHtml: hooks.proof ? hooks.proof() : '',
    confidential: state.confidential,
    proofNote: state.proofNote || '',
    opened: !!state.opened,
    commitment: state.commitment || '',
    localNote: state.localNote || '',
  };
  root.innerHTML = bankMarkup(view);
  const doc = root.ownerDocument || globalThis.document;
  ensureBankDock(doc);
  const bind = () => {
    root.querySelectorAll('[data-tab]').forEach(btn => {
      btn.onclick = () => {
        state.tab = btn.dataset.tab || 'send';
        hooks.hideRefuse?.();
        paint();
      };
    });
    root.querySelectorAll('input[name=note]').forEach(r => {
      r.onchange = () => { state.amt = r.value; hooks.onNote?.(r.value); hooks.hideRefuse?.(); };
    });
    root.querySelectorAll('input[name=mto]').forEach(r => {
      r.onchange = () => { state.to = r.value; hooks.onTo?.(r.value); hooks.hideRefuse?.(); };
    });
    const send = q$(root, '#bank-send-go');
    if (send) send.onclick = () => runAgent(`Send ${state.amt || notes[0]} NEAR privately`);
    const open = q$(root, '#bank-open');
    if (open) open.onclick = () => runAgent('Verify the seal');
    const teeBtn = q$(root, '#m-tee');
    if (teeBtn) teeBtn.onclick = () => verifyTee(teeBtn);
    installBankDock(doc);
    armBankDock((text) => runAgent(text));
    const agentIn = doc.getElementById('bank-agent');
    if (agentIn) agentIn.onkeydown = (e) => { if (e.key === 'Enter' || e.code === 'Enter' || e.keyCode === 13) { e.preventDefault(); dispatchBankDock(doc); } };
    const agentGo = doc.getElementById('bank-agent-go');
    if (agentGo) agentGo.onclick = (e) => { e.preventDefault(); dispatchBankDock(doc); };
  };
  function paint() {
    if (hooks.repaint) hooks.repaint();
    else { mountBankRoom(root, hooks); }
  }
  async function verifyTee(btn) {
    if (!btn || btn.disabled) return;
    hooks.hideRefuse?.();
    btn.disabled = true;
    const slot = q$(root, '[data-testid=tee-slot]');
    const setAsk = (s) => {
      const why = slot?.querySelector('[data-step=request] .tee-why');
      if (why) why.textContent = `Asking NEAR AI · ${s}s`;
    };
    setAsk(0);
    let secs = 0;
    const clock = setInterval(() => { secs += 1; setAsk(secs); }, 1000);
    try {
      const run = hooks.tee ? hooks.tee() : liveTee({ api: api(), onTick: setAsk });
      state.tee = hooks.tee
        ? await Promise.race([
          run,
          new Promise(resolve => setTimeout(() => {
            const why = teeTimeoutWhy(TEE_TIMEOUT_MS);
            resolve({ ok: false, timeout: true, failure: `NEAR AI attestation: ${why}`, steps: [{ id: 'request', label: 'NEAR AI attestation', ok: false, why }] });
          }, TEE_TIMEOUT_MS)),
        ])
        : await run;
    } catch (e) {
      const why = roomError(e);
      state.tee = { ok: false, err: why, failure: `NEAR AI attestation: ${why}`, steps: [{ id: 'request', label: 'NEAR AI attestation', ok: false, why }] };
    } finally {
      clearInterval(clock);
    }
    paintTee(slot, state.tee);
    if (btn.isConnected) btn.disabled = false;
    return state.tee;
  }
  async function runAgent(text) {
    hooks.hideRefuse?.();
    const cap = typeof hooks.capNear === 'function' ? hooks.capNear() : null;
    const plan = parseBankAgent(text, { notes, capNear: cap });
    if (!plan.ok) {
      state.localNote = plan.hint;
      state.tab = 'send';
      if (hooks.repaint) hooks.repaint();
      else {
        root.innerHTML = bankMarkup({ ...view, ...state, notes, payees, signedIn: !!who.signedIn, displayName: who.displayName, accountId: who.accountId, localNote: plan.hint, tab: 'send' });
        bind();
      }
      return plan;
    }
    if (plan.action === 'tee') {
      state.tab = 'attest';
      const btn = q$(root, '#m-tee');
      await verifyTee(btn);
      return { ok: true, hint: plan.hint };
    }
    if (plan.action === 'file') {
      state.tab = 'attest';
      const file = hooks.onFile ? await hooks.onFile() : { ok: true, hint: plan.hint };
      state.proofNote = file?.note || state.proofNote;
      if (file?.href) state.proofHref = file.href;
      if (hooks.repaint) hooks.repaint();
      else {
        root.innerHTML = bankMarkup({ ...view, tab: 'attest', proofNote: state.proofNote || plan.hint, confidential: state.confidential, notes, payees, signedIn: !!who.signedIn, displayName: who.displayName, accountId: who.accountId });
        bind();
        if (state.tee) paintTee(q$(root, '[data-testid=tee-slot]'), state.tee);
      }
      return file?.ok === false ? file : { ok: true, hint: file?.hint || plan.hint };
    }
    if (plan.action === 'seal') {
      state.tab = 'seal';
      const opened = hooks.onSeal ? await hooks.onSeal() : null;
      if (opened && opened.ok === false) {
        state.localNote = opened.hint;
        return opened;
      }
      state.opened = true;
      state.commitment = opened?.commitment || state.commitment || '';
      state.localNote = '';
      if (hooks.repaint) hooks.repaint();
      else {
        root.innerHTML = bankMarkup({ ...view, tab: 'seal', opened: true, commitment: state.commitment, notes, payees, signedIn: !!who.signedIn, displayName: who.displayName, accountId: who.accountId });
        bind();
        if (state.tee) paintTee(q$(root, '[data-testid=tee-slot]'), state.tee);
      }
      return { ok: true, hint: opened?.hint || plan.hint };
    }
    let sent;
    try {
      sent = hooks.onSend ? await hooks.onSend({ amount: plan.amount }) : { ok: false, hint: 'Finish /setup in the city. Nothing was sent. No wallet opened.' };
    } catch (e) {
      sent = { ok: false, hint: roomError(e) };
    }
    state.localNote = sent?.ok ? '' : (sent?.hint || '');
    if (sent?.ok) state.tab = 'send';
    if (hooks.repaint && state.localNote) hooks.repaint();
    else if (!hooks.repaint && state.localNote) {
      root.innerHTML = bankMarkup({ ...view, ...state, notes, payees, signedIn: !!who.signedIn, displayName: who.displayName, accountId: who.accountId, localNote: state.localNote });
      bind();
    }
    return sent?.ok ? { ok: true, hint: sent.hint || plan.hint } : { ok: false, hint: sent?.hint || 'That line did not run.' };
  }
  hooks.runAgent = (text) => runAgent(text);
  bind();
  if (state.tee) paintTee(q$(root, '[data-testid=tee-slot]'), state.tee);
  if (state.confidential == null && !state.deskTried && globalThis.fetch) {
    state.deskTried = true;
    fetch(api() + '/api/health', { cache: 'no-store' }).then(r => r.json()).then(j => {
      state.confidential = !!j?.features?.confidentialQuotes;
      const line = root.querySelector('[data-testid=bank-confidential]');
      if (!line) return;
      line.textContent = state.confidential
        ? 'Confidential quote is dry. Nothing was spent.'
        : 'Confidential quotes are off on this server.';
    }).catch(() => {
      state.confidential = false;
      const line = root.querySelector('[data-testid=bank-confidential]');
      if (line) line.textContent = 'Confidential quotes are off on this server.';
    });
  }
}
