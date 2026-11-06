// Guardhouse mix tray: Check / Trick / Freeze. The city door mounts this.
// Icons are the shipped 3D set under /design/D2_game/d7/assets/3dicons/192/.
// A check reads GET /api/guardhouse/check (board row when the visitor is the charter).

import { explainCheck } from '../guard-score.js';
import { roomError } from '../room-error.js';
import {
  POISON_PAYEE, TRICK_NEAR, checkUrl, lampsFor, runGuardAction, runGuardAgent, trickAmountYocto,
} from './guard-agent.js';
import { armGuardDock, dispatchGuardDock, ensureGuardDock, installGuardDock } from './guard-dock.js';

const ICON = '/design/D2_game/d7/assets/3dicons/192/';

export function guardIcon(name, size = 28) {
  return `<img class="guard-ico" src="${ICON}${name}-premium.webp" alt="" width="${size}" height="${size}" decoding="async">`;
}

function scoreBlock(score, esc) {
  if (!score) return '<div data-testid="guard-score"></div>';
  const items = (score.lines || []).map(l => {
    const flag = l.level === 'warn' || l.level === 'block' || l.level === 'unknown';
    const tx = l.tx ? ` <a class="guard-tx" href="https://nearblocks.io/txns/${esc(l.tx)}" target="_blank" rel="noopener">${esc(String(l.tx).slice(0, 8))}…</a>` : '';
    return `<li data-signal="${esc(l.id)}"${flag ? ' data-testid="guard-reason"' : ''}><b>${esc(l.title)}</b> ${esc(l.text)}${tx}</li>`;
  }).join('');
  return `<div data-testid="guard-score"><p data-testid="guard-verdict">${esc(score.summary || score.verdict || '')}</p><ul>${items}</ul></div>`;
}

function attestedLine(att, esc) {
  if (!att) return '<p class="guard-note" data-testid="guard-attested">Reading the attested check…</p>';
  if (att.enabled && Array.isArray(att.runs) && att.runs.length) {
    const links = att.runs.map(r => r?.attestation
      ? `<a href="${esc(r.attestation)}" target="_blank" rel="noopener">${esc(r.label || 'attestation')}</a>`
      : '').filter(Boolean).join(' ');
    return `<p class="guard-note" data-testid="guard-attested">Attested check is on. ${links}</p>`;
  }
  return '<p class="guard-note" data-testid="guard-attested">Attested check is off. The charter still decides on chain.</p>';
}

export function guardMarkup(state = {}, attacks = [], esc = s => String(s ?? '')) {
  const tab = state.tab || 'check';
  const tabBtn = (id, icon, label) => `<button type="button" role="tab" class="guard-tab${tab === id ? ' on' : ''}" data-tab="${id}" aria-selected="${tab === id ? 'true' : 'false'}" data-testid="guard-tab-${id}">${guardIcon(icon, 22)}<span>${label}</span></button>`;
  const tabs = `<div class="guard-tabs" role="tablist" data-testid="guard-tabs">${tabBtn('check', 'shield', 'Check')}${tabBtn('trick', 'file-text', 'Trick')}${tabBtn('freeze', 'lock', 'Freeze')}</div>`;
  const deny = state.denyError
    ? '<p class="guard-note" data-testid="guard-denylist">The deny list did not answer.</p>'
    : (state.denyCount == null ? '<p class="guard-note" data-testid="guard-denylist">Reading the deny list…</p>'
      : `<p class="guard-note" data-testid="guard-denylist">${esc(String(state.denyCount))} on the live deny list.</p>`);
  const lamps = (state.lamps || []).map(l => `<li data-lamp="${esc(l.id)}" data-level="${esc(l.level)}">${guardIcon(l.level === 'block' ? 'thumb-down' : l.level === 'warn' ? 'flash' : 'tick', 16)}<span>${esc(l.label)}</span></li>`).join('');
  const lampRow = lamps ? `<ul class="guard-lamps" data-testid="guard-lamps">${lamps}</ul>` : '';
  const check = `<div class="guard-pane" data-pane="check" data-testid="guard-pane-check" ${tab === 'check' ? '' : 'hidden'}>
      <label class="field guard-field">Account <input id="g-acct" data-testid="guard-account" value="${esc(state.acct || '')}" autocomplete="off"></label>
      <p class="example-row"><button type="button" class="example" data-testid="guard-example">Example: shop-moved-pay-here.near</button></p>
      <button type="button" class="primary guard-cta" id="g-check" data-testid="guard-check">Check this account</button>
      ${tab === 'check' ? scoreBlock(state.score, esc) : ''}
      ${lampRow}
      ${deny}
      ${attestedLine(state.attested, esc)}
    </div>`;
  const pick = (attacks || []).map(a => `<label class="guard-pick"><input type="radio" name="atk" value="${esc(a.id)}" ${a.id === (state.atk || attacks[0]?.id) ? 'checked' : ''}>${guardIcon('file-text', 18)}<span>${esc(a.name)}</span></label>`).join('');
  const pending = state.pending;
  const trickBtn = pending === 'confirm'
    ? '<button type="button" class="primary guard-cta" id="g-confirm" data-testid="guard-confirm">I checked. Ask the charter</button>'
    : pending === 'knock'
      ? '<button type="button" class="primary guard-cta" id="g-knock" data-testid="guard-knock">Let it knock anyway</button>'
      : `<button type="button" class="primary guard-cta" id="g-trick" data-testid="guard-trick">Try poisoned invoice · ${TRICK_NEAR} NEAR</button>`;
  const trick = `<div class="guard-pane" data-pane="trick" data-testid="guard-pane-trick" ${tab === 'trick' ? '' : 'hidden'}>
      <p class="guard-note" data-testid="guard-poison">Hidden line asks for ${TRICK_NEAR} NEAR to ${esc(POISON_PAYEE)}. The charter is asked only after this check.</p>
      <div class="guard-picks" role="radiogroup" aria-label="Tricks">${pick}</div>
      ${trickBtn}
      ${tab === 'trick' ? scoreBlock(state.score, esc) : ''}
    </div>`;
  const rowLine = state.rowKnown
    ? (state.frozen ? 'Your row is frozen. A propose while frozen is refused.' : 'Your row is live.')
    : 'Finish /setup to read your row.';
  const freezeBtn = state.needsApproval
    ? `<button type="button" class="primary guard-cta" id="g-approve" data-testid="guard-approve">${state.frozen ? 'Approve unfreeze' : 'Approve freeze'}</button>`
    : `<button type="button" class="primary guard-cta" id="g-freeze" data-testid="guard-freeze">${state.frozen ? 'Unfreeze my row' : 'Freeze my row'}</button>`;
  const freeze = `<div class="guard-pane" data-pane="freeze" data-testid="guard-pane-freeze" ${tab === 'freeze' ? '' : 'hidden'}>
      <p class="guard-note" data-testid="guard-frozen">${esc(rowLine)}</p>
      <p class="guard-note">The session key calls propose and propose_call. It cannot attach NEAR. set_frozen is gas only, deposit 0. If the key does not list set_frozen, one approval is required.</p>
      ${freezeBtn}
    </div>`;
  return `<div class="shop-stack guard-card" data-testid="guard-card">${tabs}${check}${trick}${freeze}</div>`;
}

export function mountGuardTray(root, hooks = {}, deps = {}) {
  const esc = deps.esc || (s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const holdButton = deps.holdButton;
  const api = deps.api || (() => (globalThis.NEARCARTA_API || '').replace(/\/$/, ''));
  const q$ = deps.q$ || ((node, sel) => node.querySelector(sel));
  const state = hooks.state || (hooks.state = {});
  if (!state.tab) state.tab = 'check';
  const attacks = () => (hooks.attacks ? hooks.attacks() : []);
  const doc = root?.ownerDocument || (typeof document !== 'undefined' ? document : null);

  const syncRow = () => {
    if (typeof hooks.row === 'function') state.rowKnown = !!hooks.row();
    if (typeof hooks.frozen === 'function' && state.rowKnown) state.frozen = !!hooks.frozen();
    const sized = trickAmountYocto(hooks.minYocto?.() ?? null, hooks.capYocto?.() ?? null);
    state.capOk = sized.ok;
  };

  const paint = () => {
    if (hooks.repaint) hooks.repaint();
    else localPaint();
  };

  function agentLog(text, reveal) {
    state.agentHint = text || '';
    const el = doc?.getElementById('g-agent-log');
    if (el) {
      el.hidden = !text;
      el.textContent = text || '';
    }
    if (!reveal || !text) return;
    const pop = doc?.getElementById('guard-agent-pop');
    const toggle = doc?.querySelector('[data-testid=guard-agent-toggle]');
    if (!pop) return;
    pop.hidden = false;
    toggle?.setAttribute('aria-expanded', 'true');
  }

  function scene(result) {
    if (result?.lamps) state.lamps = result.lamps;
    hooks.onScene?.(result);
  }

  async function loadCheck(acct) {
    if (typeof hooks.check === 'function') return hooks.check(acct);
    const res = await fetch(api() + checkUrl(acct, hooks.charter?.() || ''));
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || 'The check did not answer.');
    return body;
  }

  const ctx = () => ({
    state,
    check: loadCheck,
    trickPlan: hooks.trickPlan,
    trickSend: hooks.trickSend,
    freeze: hooks.freeze,
    capYocto: hooks.capYocto?.() ?? null,
    minYocto: hooks.minYocto?.() ?? null,
  });

  async function runAgent(text) {
    scene({ clear: true, seal: false });
    const result = await runGuardAgent({ text, ...ctx() });
    if (result?.ok) state.agentText = '';
    agentLog(result?.hint || (result?.ok ? '' : 'That line did not run.'), true);
    scene(result);
    if (!result?.loaded) paint();
    return result;
  }

  async function runPlan(plan) {
    scene({ clear: true, seal: false });
    const result = await runGuardAction(plan, ctx());
    agentLog(result?.hint || '');
    scene(result);
    paint();
    return result;
  }

  const localPaint = () => {
    syncRow();
    root.innerHTML = guardMarkup(state, attacks(), esc);
    bind();
  };

  const bind = () => {
    if (doc) {
      ensureGuardDock(doc);
      installGuardDock(doc);
      armGuardDock((text) => runAgent(text));
    }
    root.querySelectorAll('[data-tab]').forEach(btn => {
      btn.onclick = () => {
        state.tab = btn.dataset.tab || 'check';
        scene({ clear: true, seal: false });
        localPaint();
      };
    });
    const input = q$(root, '#g-acct');
    if (input) input.addEventListener('input', () => { state.acct = input.value; });
    const example = q$(root, '[data-testid=guard-example]');
    if (example) example.onclick = () => {
      state.acct = POISON_PAYEE;
      if (input) input.value = state.acct;
    };
    root.querySelectorAll('input[name=atk]').forEach(i => {
      i.onchange = () => { state.atk = i.value; };
    });
    const checkBtn = q$(root, '#g-check');
    if (checkBtn) checkBtn.onclick = async () => {
      const acct = (q$(root, '#g-acct')?.value || '').trim();
      state.acct = acct;
      state.holding = true;
      if (holdButton) holdButton(checkBtn, 'Checking this account.');
      scene({ clear: true, seal: false });
      try {
        const raw = await loadCheck(acct);
        state.score = explainCheck(raw);
        state.chk = raw;
        state.lamps = lampsFor(raw);
        state.pending = null;
        const blocked = state.score.verdict === 'block' || state.score.verdict === 'warn';
        scene({ seal: blocked, lamps: state.lamps, hint: state.score.summary, cinema: false, propose: false });
        agentLog(state.score.summary);
      } catch (e) {
        state.score = explainCheck({ account: acct, verdict: 'warn', reasons: [{ code: 'account_missing', text: roomError(e) }], signals: {} });
        agentLog(state.score.summary);
      } finally {
        state.holding = false;
        if (hooks.repaint) hooks.repaint();
        else localPaint();
      }
    };
    const trick = q$(root, '#g-trick');
    if (trick) trick.onclick = () => runPlan({ ok: true, action: 'trick', id: state.atk || 'poisoned-invoice' });
    const confirm = q$(root, '#g-confirm');
    if (confirm) confirm.onclick = () => runPlan({ ok: true, action: 'confirm' });
    const knock = q$(root, '#g-knock');
    if (knock) knock.onclick = () => runPlan({ ok: true, action: 'knock' });
    const freeze = q$(root, '#g-freeze');
    if (freeze) freeze.onclick = () => runPlan({ ok: true, action: 'freeze', frozen: !state.frozen, approve: false });
    const approve = q$(root, '#g-approve');
    if (approve) approve.onclick = () => runPlan({ ok: true, action: 'freeze', frozen: !state.frozen, approve: true });
    const agentIn = q$(root, '#g-agent') || doc?.getElementById('g-agent');
    if (agentIn) {
      agentIn.oninput = (e) => { state.agentText = e.target.value; };
      agentIn.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); dispatchGuardDock(doc); } };
    }
    const agentGo = q$(root, '#g-agent-go') || doc?.getElementById('g-agent-go');
    if (agentGo) agentGo.onclick = (e) => { e.preventDefault(); dispatchGuardDock(doc); };
  };

  async function loadLive() {
    if (state.liveTried) return;
    state.liveTried = true;
    try {
      const deny = await fetch(api() + '/api/guardhouse/denylist').then(r => r.json());
      state.denyCount = Array.isArray(deny?.entries) ? deny.entries.length : null;
      if (state.denyCount == null) state.denyError = true;
    } catch { state.denyError = true; }
    try {
      const att = await fetch(api() + '/api/guardhouse/attested').then(r => r.json());
      state.attested = att && typeof att === 'object' ? att : { enabled: false };
    } catch { state.attested = { enabled: false, error: true }; }
    if (state.holding) return;
    if (root?.isConnected !== false) paint();
  }

  hooks.runAgent = (text) => runAgent(text);
  hooks.localPaint = localPaint;
  localPaint();
  loadLive();
}
