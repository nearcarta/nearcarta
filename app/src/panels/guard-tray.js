// Guardhouse tray: Check / Pay safely / Blocks. One gold button.
// The city door mounts this. Icons are the shipped token set (web3icons / token svgs).

import { bindTokenFallbacks, tokenStack } from './token-badge.js';
import { checkUrl, runGuardAction, runGuardAgent } from './guard-agent.js';
import { armGuardDock, dispatchGuardDock, ensureGuardDock, installGuardDock } from './guard-dock.js';

function statusBlock(state, esc) {
  const score = state.score;
  // The attested line says what was actually checked. `attested:true` only when a TDX report
  // bound to THIS payment passed every check (backend/src/guard-attested.js); a failure names it.
  const att = state.attested;
  const attLine = att
    ? (att.attested === true
      ? 'TEE: a TDX report bound to this payment passed every check.'
      : att.enabled === false
        ? `TEE: off on the server (${att.reason || 'no key'}). The row cap still decides on chain.`
        : `TEE: not attested (${String(att.failure || 'a check failed').slice(0, 120)}). The row cap still decides on chain.`)
    : '';
  if (!score) {
    const bits = [];
    if (state.denyCount != null) bits.push(`${state.denyCount} on the live deny list.`);
    bits.push(attLine || 'Server-side: age, code hash, lookalike, deny list. The row cap is on chain.');
    if (state.notice) bits.push(state.notice);
    return `<p class="guard-status" data-testid="guard-attested">${esc(bits.join(' '))}</p>`;
  }
  const flagged = (score.lines || []).filter(l => l.level === 'warn' || l.level === 'block' || l.level === 'unknown');
  const reasons = flagged.map(l => `<span data-testid="guard-reason">${esc(l.text)}</span>`).join(' · ');
  const titles = (score.lines || []).map(l => l.title);
  const bits = [];
  if (titles.includes('Lookalike')) bits.push('Lookalike');
  if (titles.includes('Recorded refusals')) bits.push('Recorded refusals');
  const link = (score.lines || []).find(l => l.tx);
  const href = link?.tx ? ` <a class="guard-tx" href="https://nearblocks.io/txns/${esc(link.tx)}">Recorded refusal</a>` : '';
  // A real send shows its receipt here, as one labelled link, never a bare hash.
  const sent = state.liveTx
    ? ` <a class="guard-tx" data-testid="guard-live-tx" href="https://nearblocks.io/txns/${esc(state.liveTx)}" target="_blank" rel="noopener">${esc(state.liveLabel || 'payment')} receipt ↗</a>`
    : '';
  const extra = state.notice ? ` ${esc(state.notice)}` : '';
  return `<p class="guard-status" data-testid="guard-verdict">${esc(score.summary || '')}</p><p class="guard-status" data-testid="guard-score">${bits.join(' · ')}${reasons ? ' ' + reasons : ''}${href}${sent}${extra}</p>`;
}

function gold(id, testid, label) {
  return `<button type="button" class="primary guard-cta" id="${id}" data-testid="${testid}">${label}</button>`;
}

export function guardMarkup(state = {}, _attacks = [], esc = s => String(s ?? '')) {
  const tab = state.tab || 'check';
  const tabBtn = (id, label) => `<button type="button" role="tab" class="guard-tab${tab === id ? ' on' : ''}" data-tab="${id}" aria-selected="${tab === id ? 'true' : 'false'}" data-testid="guard-tab-${id}">${label}</button>`;
  const tabs = `<div class="guard-tabs" role="tablist" data-testid="guard-tabs">${tabBtn('check', 'Check')}${tabBtn('pay', 'Pay safely')}${tabBtn('blocks', 'Blocks')}</div>`;
  const asset = state.asset || 'NEAR';
  const chain = state.chain || 'near';
  const flow = `<div class="guard-flow" data-testid="guard-flow" aria-hidden="true">${tokenStack(asset, chain, { size: 48, chainSize: 16 })}<span class="guard-flow-arrow">→</span><span class="guard-payee-mark" aria-hidden="true">${esc((state.acct || 'payee').slice(0, 1).toUpperCase())}</span></div>`;
  const payee = `<label class="field guard-field">Payee <input id="g-acct" data-testid="guard-account" value="${esc(state.acct || '')}" autocomplete="off"></label>`;
  const chainField = `<label class="field guard-field">Chain <select id="g-chain" data-testid="guard-chain"><option value="near" ${chain === 'near' ? 'selected' : ''}>near</option><option value="base" ${chain === 'base' ? 'selected' : ''}>base</option></select></label>`;
  const assetField = `<label class="field guard-field">Asset <select id="g-asset" data-testid="guard-asset"><option value="NEAR" ${asset === 'NEAR' ? 'selected' : ''}>NEAR</option></select></label>`;
  const pair = `<div class="guard-split">${chainField}${assetField}</div>`;
  const amount = `<label class="field guard-field">Amount <input id="g-amt" data-testid="guard-amount" inputmode="decimal" value="${esc(state.amount || '')}" autocomplete="off"></label>`;
  const invoice = `<label class="field guard-field">Invoice <textarea id="g-invoice" data-testid="guard-invoice" rows="2">${esc(state.invoice || '')}</textarea></label>`;
  const status = statusBlock(state, esc);
  const check = `<div class="guard-pane" data-pane="check" data-testid="guard-pane-check" ${tab === 'check' ? '' : 'hidden'}>
      ${tab === 'check' ? flow : ''}
      ${tab === 'check' ? payee : ''}
      <p class="example-row"><button type="button" class="example" data-testid="guard-example">${esc(state.example || 'Example: a look-alike of your own account')}</button></p>
      ${tab === 'check' ? gold('g-check', 'guard-check', 'Check payee') : ''}
      ${tab === 'check' ? status : ''}
    </div>`;
  const held = state.pending === 'human' && state.holdId;  const payCta = held
    ? gold('g-confirm', 'guard-confirm', 'Confirm this payment')
    : gold('g-pay', 'guard-pay', 'Pay through guard');
  const cancel = held ? '<button type="button" class="guard-quiet" id="g-cancel" data-testid="guard-cancel">Cancel</button>' : '';
  const pay = `<div class="guard-pane" data-pane="pay" data-testid="guard-pane-pay" ${tab === 'pay' ? '' : 'hidden'}>
      ${tab === 'pay' ? `${flow}${payee}${pair}${amount}${invoice}<div class="guard-actions">${payCta}${cancel}</div>${status}` : ''}
    </div>`;
  const holds = state.book ? [...state.book.book.holds.values()] : [];
  const refunds = state.book ? [...state.book.book.refunds.values()] : [];
  const rows = [
    ...holds.map(h => `<li data-testid="guard-hold">Held · ${esc(h.payee)} · ${esc(h.amount)} ${esc(h.asset)}</li>`),
    ...refunds.map(r => `<li data-testid="guard-refund">Refunded · ${esc(r.payee)} · ${esc(r.amount)} ${esc(r.asset)} · ${esc(r.why)}</li>`),
  ];
  // The local ledger is empty after a reload, so a hold restored from storage would have no
  // row here and Cancel stayed hidden. Give it a row of its own, with the button beside it.
  if (held && !holds.some(h => String(h.id) === String(state.holdId))) {
    rows.unshift(`<li data-testid="guard-hold-restored">Held on chain · id ${esc(String(state.holdId))} · waiting for you
      <div class="guard-actions"><button type="button" class="guard-quiet" id="g-cancel-restored" data-testid="guard-cancel-restored">Cancel and refund</button></div></li>`);
  }
  const list = rows.length ? `<ul class="guard-blocks" data-testid="guard-blocks">${rows.join('')}</ul>` : '<p class="guard-status" data-testid="guard-blocks">No held payment.</p>';
  const rowLine = state.rowKnown
    ? (state.frozen ? 'Your row is frozen.' : 'Your row is live.')
    : 'Finish /setup to read your row.';
  const freeze = state.needsApproval
    ? gold('g-approve', 'guard-approve', 'Approve freeze')
    : gold('g-freeze', 'guard-freeze', 'Freeze my row');
  const blocks = `<div class="guard-pane" data-pane="blocks" data-testid="guard-pane-blocks" ${tab === 'blocks' ? '' : 'hidden'}>
      <p class="guard-status" data-testid="guard-frozen">${esc(rowLine)}</p>
      ${list}
      ${tab === 'blocks' ? freeze : ''}
    </div>`;
  return `<div class="shop-stack guard-card" data-testid="guard-card">${tabs}${check}${pay}${blocks}</div>`;
}

export function mountGuardTray(root, hooks = {}, deps = {}) {
  const esc = deps.esc || (s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const holdButton = deps.holdButton;
  const api = deps.api || (() => (globalThis.NEARCARTA_API || '').replace(/\/$/, ''));
  const q$ = deps.q$ || ((node, sel) => node.querySelector(sel));
  const state = hooks.state || (hooks.state = {});
  if (!state.tab) state.tab = 'check';
  if (!state.chain) state.chain = 'near';
  if (!state.asset) state.asset = 'NEAR';
  // Recover a held payment from the last visit, so its Cancel button is still there. Without
  // this a reload orphaned the hold: it kept the row's NEAR and blocked close_charter with
  // ERR_IN_FLIGHT, with no control on screen to clear it.
  if (!state.holdId) {
    try {
      const saved = localStorage.getItem('nearcarta.guard.hold.' + (state.owner || state.row || ''));
      if (saved) { state.holdId = saved; state.pending = 'human'; }
    } catch { /* private mode */ }
  }
  // `state.owner` is filled by syncRow below, so also look under that key once it is known.
  const restoreHold = () => {
    if (state.holdId || !state.owner) return;
    try {
      const saved = localStorage.getItem('nearcarta.guard.hold.' + state.owner);
      if (saved) { state.holdId = saved; state.pending = 'human'; }
    } catch { /* private mode */ }
  };
  const doc = root?.ownerDocument || (typeof document !== 'undefined' ? document : null);

  const readForm = () => {
    const acct = q$(root, '#g-acct');
    const amt = q$(root, '#g-amt');
    const chain = q$(root, '#g-chain');
    const asset = q$(root, '#g-asset');
    const invoice = q$(root, '#g-invoice');
    if (acct) state.acct = acct.value;
    if (amt) state.amount = amt.value;
    if (chain) state.chain = chain.value;
    if (asset) state.asset = asset.value;
    if (invoice) state.invoice = invoice.value;
  };

  const syncRow = () => {
    if (typeof hooks.row === 'function') state.rowKnown = !!hooks.row();
    if (typeof hooks.frozen === 'function' && state.rowKnown) state.frozen = !!hooks.frozen();
    state.rowId = typeof hooks.charter === 'function' ? (hooks.charter() || '') : (state.rowId || '');
    if (typeof hooks.owner === 'function') state.owner = hooks.owner() || '';
    if (typeof hooks.board === 'function') state.board = hooks.board() || '';
    if (typeof hooks.nonce === 'function') state.nonce = hooks.nonce();
    if (typeof hooks.guard === 'function') state.guard = hooks.guard() || '';
    if (typeof hooks.injected === 'function') {
      const t = hooks.injected() || '';
      // Show the derived name, not a fixed one. With no session the button explains itself.
      state.example = t ? `Example: ${t}` : 'Example: a look-alike of your own account';
    }
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
    state.notice = result?.hint && result?.action !== 'check' ? result.hint : state.notice;
    // Only a real tx gets a link. A prepared or refused step never shows a receipt.
    const tx = result?.tx || result?.live?.tx || null;
    if (tx) {
      state.liveTx = tx;
      state.liveLabel = result?.action === 'confirm' ? 'release' : result?.action === 'cancel' ? 'refund'
        : result?.action === 'expire' ? 'expire' : (result?.live?.hold ? 'held' : 'payment');
    } else if (result?.action === 'pay' || result?.action === 'cancel') {
      state.liveTx = null;
    }
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
    freeze: hooks.freeze,
    capYocto: hooks.capYocto?.() ?? null,
    // The one live executor, shared with the gold CTA below.
    sendPay: hooks.sendPay,
    sendConfirm: hooks.sendConfirm,
    sendCancel: hooks.sendCancel,
  });

  async function runAgent(text) {
    scene({ clear: true, seal: false });
    readForm();
    const result = await runGuardAgent({ text, ...ctx() });
    if (result?.ok) state.agentText = '';
    agentLog(result?.hint || (result?.ok ? '' : 'That line did not run.'), true);
    scene(result);
    paint();
    return result;
  }

  async function runPlan(plan) {
    scene({ clear: true, seal: false });
    readForm();
    const fields = {
      payee: (state.acct || '').trim(), chain: state.chain || 'near', asset: state.asset || 'NEAR',
      amount: state.amount || '', invoice: state.invoice || '', row: state.owner || '',
    };
    // A new check invalidates the old attested verdict: it was bound to the old context.
    if (plan.action === 'check' && fields.payee && fields.amount) loadAttested(fields);
    else if (plan.action === 'check') { state.attested = null; }
    const result = await runGuardAction(plan, ctx());
    state.notice = result?.hint || '';
    scene(result);
    paint();
    return result;
  }

  const localPaint = () => {
    syncRow();
    restoreHold();
    root.innerHTML = guardMarkup(state, [], esc);
    bind();
    bindTokenFallbacks(root);
    const tray = root.closest('#tray');
    // The scrollable region is now the inner wrapper, not #tray itself: reset that one so a
    // new tab opens at its top instead of inheriting the previous tab's scroll offset.
    const scroller = tray?.querySelector('.t-scroll') || tray;
    if (scroller) scroller.scrollTop = 0;
  };

  const bind = () => {
    if (doc) {
      ensureGuardDock(doc);
      installGuardDock(doc);
      armGuardDock((text) => runAgent(text));
    }
    root.querySelectorAll('[data-tab]').forEach(btn => {
      btn.onclick = () => {
        readForm();
        state.tab = btn.dataset.tab || 'check';
        scene({ clear: true, seal: false });
        localPaint();
      };
    });
    const example = q$(root, '[data-testid=guard-example]');
    if (example) example.onclick = () => {
      // The example is derived from this visitor, never a fixed payee. No session means no
      // example name: the tray says so instead of inventing a destination.
      const target = typeof hooks.injected === 'function' ? (hooks.injected() || '') : '';
      if (!target) { state.notice = 'Finish /setup. The example is a look-alike of your own account.'; localPaint(); return; }
      state.acct = target;
      const input = q$(root, '#g-acct');
      if (input) input.value = state.acct;
      localPaint();
    };
    const checkBtn = q$(root, '#g-check');
    if (checkBtn) checkBtn.onclick = async () => {
      readForm();
      state.holding = true;
      if (holdButton) holdButton(checkBtn, 'Checking this account.');
      try { await runPlan({ ok: true, action: 'check', account: (state.acct || '').trim() }); }
      finally { state.holding = false; }
    };
    const pay = q$(root, '#g-pay');
    // readForm() first, like every other handler here. Without it a payee typed on the Pay
    // tab was never read into state, so Pay through guard refused with the generic "name a
    // payee" hint while the fields on screen were filled.
    if (pay) pay.onclick = () => { readForm(); return runPlan({ ok: true, action: 'pay' }); };
    const confirm = q$(root, '#g-confirm');
    if (confirm) confirm.onclick = () => runPlan({ ok: true, action: 'confirm', actor: 'human' });
    const cancel = q$(root, '#g-cancel');
    if (cancel) cancel.onclick = () => runPlan({ ok: true, action: 'cancel' });
    const cancelRestored = q$(root, '#g-cancel-restored');
    if (cancelRestored) cancelRestored.onclick = () => runPlan({ ok: true, action: 'cancel' });
    const freeze = q$(root, '#g-freeze');
    if (freeze) freeze.onclick = () => runPlan({ ok: true, action: 'freeze', frozen: true, approve: false });
    const approve = q$(root, '#g-approve');
    if (approve) approve.onclick = () => runPlan({ ok: true, action: 'freeze', frozen: true, approve: true });
    const agentIn = doc?.getElementById('g-agent');
    if (agentIn) {
      agentIn.oninput = (e) => { state.agentText = e.target.value; };
      agentIn.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); dispatchGuardDock(doc); } };
    }
    const agentGo = doc?.getElementById('g-agent-go');
    if (agentGo) agentGo.onclick = (e) => { e.preventDefault(); dispatchGuardDock(doc); };
  };

  async function loadLive() {
    if (state.liveTried) return;
    state.liveTried = true;
    try {
      const deny = await fetch(api() + '/api/guardhouse/denylist').then(r => r.json());
      state.denyCount = Array.isArray(deny?.entries) ? deny.entries.length : null;
    } catch { state.denyCount = null; }
    if (state.holding) return;
    if (root?.isConnected !== false) paint();
  }

  /**
   * Ask for the TEE verdict on THIS payment. The context is the typed payee, chain, asset,
   * amount, invoice and row, so the report is bound to this payment; an edited field is a
   * different nonce and cannot reuse it. Called after a check, and after a field edit it is
   * stale (cleared) rather than shown against the new values.
   */
  async function loadAttested(fields) {
    state.attested = { pending: true, enabled: true };
    if (root?.isConnected !== false) paint();
    try {
      const qs = new URLSearchParams({
        payee: fields.payee || '', chain: fields.chain || 'near', asset: fields.asset || 'NEAR',
        amount: fields.amount || '', invoice: fields.invoice || '', row: fields.row || '',
      });
      const att = await fetch(api() + '/api/guardhouse/attested?' + qs).then(r => r.json());
      state.attested = att && typeof att === 'object' ? att : { enabled: false };
    } catch { state.attested = { enabled: false, error: true, reason: 'the server did not answer' }; }
    if (root?.isConnected !== false) paint();
  }

  hooks.runAgent = (text) => runAgent(text);
  hooks.localPaint = localPaint;
  localPaint();
  loadLive();
}
