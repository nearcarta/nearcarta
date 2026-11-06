// Tray controller: one robot line, one big button, loading / error / success, a one-line receipt.
import * as A from './apps.js';
import { payoutLabel, payoutReady } from './payout-ready.js';
import { $, sfx } from './core.js';
import { ruleChip as ruleChipText } from './rules-default.js';
import { receipt } from './receipt.js';
import { watch as watchTokens } from './tokens.js';
import { maybeOnboard } from './onboard.js';
import { hallRowHref, readSession, readSessionAccount, sessionPill, signedCopy, tollRefusal } from './session.js';
import { explainCheck } from '/guard-score.js';
import { RECORDED } from '/chronicle-feed.js';
import { DEED, controlAfterMove, metadataView, txUrl } from '/deed-control.js';
import { teeResult, PROOF_HREF } from '/tee-view.js';
import { pickBest, quoteLine, statusView } from '/ferry-catalog.js';
import { mountShop } from '/panels/deep.js';
import { pairClauseId } from '/panels/ferry-pair.js';
import { pairHero } from '/panels/token-badge.js';
import { agentDeliveredNote, depositPlan, explainQuoteMiss, ferryStatusHtml, ferryStatusView, mayCheckout, nearAmount, nearNative, nextFerryBeat, pickWrapSpend, SESSION_SWAP, wrapProgressNote } from '/panels/ferry-settle.js';
import { armFerryDock, dispatchFerryDock, installFerryDock } from '/panels/ferry-dock.js';
import { hideBankDock } from '/panels/bank-tray.js';
import { armTollDock, dispatchTollDock, installTollDock } from '/panels/toll-dock.js';
import { mergeTollChronicle, nextRowBalance, passPaidCopy, rememberTollPass, tollCapCheck, tollChronicleRows } from '/panels/toll-room.js';
import { armHallDock, dispatchHallDock, ensureHallDock, installHallDock } from '/panels/hall-dock.js';
import { deedMarkup } from '/panels/deed.js';
import { receiptsFor, splitAssets, prepareRows } from './payouts.js';
import { cinemaOk, sealText } from '/panels/payouts-plan.js';
import { NEXT_LABEL, RUN_LABEL } from '../shops/arena-labels.js';
const yOf = n => (BigInt(Math.round(Number(n) * 1e6)) * 10n ** 18n).toString();
const { esc, fmt, short } = A;

let cur = null, sh = null, phase = 'idle', last = null, runScene = null, extra = {}, ferryWatch = null;
const say = t => { const e = $('#t-say'); e.innerHTML = `<span class="lamp" aria-hidden="true"></span><span>${t}</span>`; e.classList.remove('bump'); void e.offsetWidth; e.classList.add('bump'); };
const btn = (label, kind = 'primary', dis = false) => { if (cur === 'bank' || cur === 'chronicle') { hideFerryPrimary(); return; } const b = $('#t-act'); b.hidden = !label; b.className = 'act ' + kind; b.disabled = dis; b.textContent = label || ''; b.classList.toggle('busy', phase === 'busy'); queueMicrotask(syncGo); };
// Ferry quote, cargo, Ask charter and Get another quote live in the card. #t-act is a second copy of the same label.
function hideFerryPrimary() {
  const b = $('#t-act');
  if (!b) return;
  b.hidden = true;
  b.classList.remove('busy');
}
function hideBankPrimary() { hideFerryPrimary(); }
const form = html => { $('#t-form').innerHTML = html || ''; $('#t-form').hidden = !html; };
const hero = html => { if (html != null) $('#t-hero').innerHTML = html; $('#t-hero').hidden = !html; };
const rcpt = html => { $('#t-rcpt').innerHTML = html || ''; };
const label = t => { t = t || ''; const i = t.indexOf(' · '); $('#t-label').textContent = i > 0 ? t.slice(i + 3) : t; };
function ensureFerryDock() {
  let d = document.getElementById('ferry-agent-dock');
  if (d) { d.hidden = cur !== 'ferry'; return d; }
  d = document.createElement('div');
  d.id = 'ferry-agent-dock';
  d.setAttribute('data-testid', 'ferry-agent-dock');
  // Mix sketch: character on the right; chat popup (input + send INSIDE) opens beside it.
  d.innerHTML = `<div id="ferry-agent-pop" class="ferry-agent-pop" data-testid="ferry-agent" hidden>
      <p id="f-agent-log" class="ferry-agent-log" data-testid="ferry-agent-log" hidden></p>
      <form id="f-agent-form" class="ferry-agent-row" data-testid="ferry-agent-form">
        <input id="f-agent" data-testid="ferry-agent-input" placeholder="Swap 0.05 wNEAR on NEAR to USDC" autocomplete="off" aria-label="Ask the AI Agent">
        <button type="submit" class="ferry-agent-send" id="f-agent-go" data-testid="ferry-agent-go" aria-label="Send">➤</button>
      </form>
    </div>
    <button type="button" class="ferry-agent-char" data-testid="ferry-agent-toggle" aria-expanded="false" aria-controls="ferry-agent-pop" title="AI Agent">
      <span class="ferry-agent-badge" aria-hidden="true">⋯</span>
      <img class="ferry-agent-avatar" src="/setup/chars/robotexpressive.webp" width="72" height="72" alt="" decoding="async">
      <span class="ferry-agent-name">AI Agent</span>
    </button>`;
  (document.getElementById('shopUI') || document.body).appendChild(d);
  d.hidden = cur !== 'ferry';
  return d;
}
function ensureTollDock() {
  let d = document.getElementById('toll-agent-dock');
  if (d) { d.hidden = cur !== 'toll'; return d; }
  d = document.createElement('div');
  d.id = 'toll-agent-dock';
  d.setAttribute('data-testid', 'toll-agent-dock');
  d.innerHTML = `<div id="toll-agent-pop" class="toll-agent-pop" data-testid="toll-agent" hidden>
      <p id="t-agent-log" class="toll-agent-log" data-testid="toll-agent-log" hidden></p>
      <div class="toll-agent-chips" role="group" aria-label="Toll commands">
        <button type="button" class="toll-chip" data-toll-chip="Pay the toll">Pay the toll</button>
        <button type="button" class="toll-chip" data-toll-chip="Check signature">Check signature</button>
        <button type="button" class="toll-chip" data-toll-chip="Show policy">Show policy</button>
      </div>
      <div class="toll-agent-row">
        <input id="t-agent" data-testid="toll-agent-input" placeholder="Pay the toll" autocomplete="off" aria-label="Ask the AI Agent">
        <button type="button" class="toll-agent-send" id="t-agent-go" data-testid="toll-agent-go" aria-label="Send">➤</button>
      </div>
    </div>
    <button type="button" class="toll-agent-char" data-testid="toll-agent-toggle" aria-expanded="false" aria-controls="toll-agent-pop" title="AI Agent">
      <span class="toll-agent-badge" aria-hidden="true">⋯</span>
      <img class="toll-agent-avatar" src="/setup/chars/robotexpressive.webp" width="72" height="72" alt="" decoding="async">
      <span class="toll-agent-name">AI Agent</span>
    </button>`;
  (document.getElementById('shopUI') || document.body).appendChild(d);
  d.hidden = cur !== 'toll';
  return d;
}
function wireTollDock(hooks) {
  const d = ensureTollDock();
  if (!d) return;
  installTollDock(document);
  if (!d.dataset.wired) {
    d.dataset.wired = '1';
    const toggle = d.querySelector('[data-testid=toll-agent-toggle]');
    const pop = d.querySelector('#toll-agent-pop');
    toggle?.addEventListener('click', () => {
      const open = pop.hasAttribute('hidden');
      pop.toggleAttribute('hidden', !open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    d.querySelectorAll('[data-toll-chip]').forEach(chip => {
      chip.addEventListener('click', () => {
        const input = d.querySelector('#t-agent');
        if (input) input.value = chip.getAttribute('data-toll-chip') || '';
        pop?.removeAttribute('hidden');
        toggle?.setAttribute('aria-expanded', 'true');
        dispatchTollDock(document);
      });
    });
  }
  armTollDock((text) => {
    if (typeof hooks?.runAgent === 'function') return hooks.runAgent(text);
    return { ok: false, hint: 'The agent is not ready. Open Toll Bridge and press Send again.' };
  });
  const go = d.querySelector('#t-agent-go');
  const input = d.querySelector('#t-agent');
  const send = (e) => { e?.preventDefault?.(); return dispatchTollDock(document); };
  if (go) go.onclick = send;
  if (input) input.onkeydown = (e) => { if (e.key === 'Enter' || e.code === 'Enter' || e.keyCode === 13) { e.preventDefault(); send(e); } };
}
function wireFerryDock(hooks) {
  const d = ensureFerryDock();
  if (!d) return;
  installFerryDock(document);
  if (!d.dataset.wired) {
    d.dataset.wired = '1';
    const toggle = d.querySelector('[data-testid=ferry-agent-toggle]');
    const pop = d.querySelector('#ferry-agent-pop');
    toggle?.addEventListener('click', () => {
      const open = pop.hasAttribute('hidden');
      pop.toggleAttribute('hidden', !open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }
  // Re-arm after every ferry paint/bind. The document listener still fires if onclick is dropped.
  armFerryDock((text) => {
    if (typeof hooks?.runAgent === 'function') return hooks.runAgent(text);
    return { ok: false, hint: 'The agent is not ready. Open Ferry and press Send again.' };
  });
  const go = d.querySelector('#f-agent-go');
  const input = d.querySelector('#f-agent');
  const form = d.querySelector('#f-agent-form');
  const send = (e) => { e?.preventDefault?.(); return dispatchFerryDock(document); };
  if (go) go.onclick = send;
  if (form) form.onsubmit = send;
  if (input) input.onkeydown = (e) => { if (e.key === 'Enter' || e.code === 'Enter' || e.keyCode === 13) { e.preventDefault(); send(e); } };
}
function wireHallDock(hooks) {
  const d = ensureHallDock(document);
  if (!d) return;
  installHallDock(document);
  d.hidden = cur !== 'hall';
  armHallDock((text) => {
    if (typeof hooks?.runAgent === 'function') return hooks.runAgent(text);
    return { ok: false, hint: 'The agent is not ready. Open Town Hall and press Send again.' };
  });
  const go = d.querySelector('#h-agent-go');
  const input = d.querySelector('#h-agent');
  const send = (e) => { e?.preventDefault?.(); return dispatchHallDock(document); };
  if (go) go.onclick = send;
  if (input) input.onkeydown = (e) => { if (e.key === 'Enter' || e.code === 'Enter' || e.keyCode === 13) { e.preventDefault(); send(e); } };
}
function ferryPlainReason(reason) {
  const raw = String(reason || '');
  if (/ERR_BAD_SIG|agent_key_mismatch/i.test(raw)) return 'the signature does not match the agent key stored in this browser';
  if (/key_cannot_propose_call/i.test(raw)) return 'your agent key cannot call propose_call yet';
  if (/NotEnoughAllowance/i.test(raw)) return 'the session key does not have enough gas allowance for this ask';
  if (/doesn't have enough balance|does not hold enough wNEAR/i.test(raw)) {
    return 'the wrap account does not hold enough wNEAR for this transfer; Load cargo again to use the stranded wNEAR';
  }
  const plain = String(A.plainError(raw) || '').replace(/\s+/g, ' ').trim();
  if (!plain || /[{"]|account_id|send_tx|InvalidTx|public_key|yocto/i.test(plain)) return 'the charter did not accept this ask';
  return plain.slice(0, 140);
}
function setCharterNote(o) {
  if (!o || o.decision === 'allowed') { extra.charterNote = ''; return; }
  extra.charterNote = `Charter refused the trip: ${ferryPlainReason(o.reason)}. The boat stays at the jetty.`;
}
function stopFerryWatch() { clearInterval(ferryWatch); ferryWatch = null; }
function clearFerryDeposit() {
  stopFerryWatch();
  extra.depositAddress = '';
  extra.depositUsd = '';
  extra.depositHelp = '';
  extra.depositMode = '';
  extra.depositTxs = [];
  extra.outAmt = '';
  extra.outSym = '';
  extra.destChain = '';
  extra.sailed = false;
}
function finishFerry(res) {
  stopProgress();
  phase = 'kept';
  extra.acted = true;
  say(res.say);
  rcpt(res.rc || '');
  document.body.dataset.app = res.kind || 'ok';
  hero(APPS.ferry.hero());
  hideFerryPrimary();
  form(APPS.ferry.form()); APPS.ferry.bind?.();
  ruleChip(); proofDrawer();
  return res;
}
function playFerryDelivered() {
  // Load cargo and the AI agent share this. delivered skips the weigh and sails to the far bank.
  if (sh?.act && runScene) runScene(sh.act({ refused: false, delivered: true }));
  else sh?.deliver?.();
  // The sail is short. If it stops mid-river, the boat and the seal still finish.
  setTimeout(() => { if (cur === 'ferry' && extra.sailed) sh?.deliver?.(); }, 6000);
}
function showAgentDelivered(st) {
  const toChain = extra.destChain || String(extra.toId || '').split('|')[1] || extra.q?.to?.chain || extra.q?.to?.blockchain || '';
  const note = agentDeliveredNote({
    amount: st?.amountOut || extra.q?.to?.amount || extra.outAmt || '',
    symbol: (st?.symbolOut && String(st.symbolOut).length <= 12) ? st.symbolOut : (extra.q?.to?.symbol || extra.outSym || 'USDC'),
    txs: extra.depositTxs || [],
    destTx: st?.destinationTx || '',
    destChain: toChain,
  });
  extra.agentHint = note.text;
  extra.agentText = '';
  const input = document.getElementById('f-agent');
  if (input) input.value = '';
  const pop = document.getElementById('ferry-agent-pop');
  if (pop) pop.hidden = false;
  const toggle = document.querySelector('[data-testid=ferry-agent-toggle]');
  if (toggle) toggle.setAttribute('aria-expanded', 'true');
  const el = document.getElementById('f-agent-log');
  if (!el) return note;
  const links = note.links.map(l => `<a class="tx" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join(' ');
  el.hidden = false;
  el.innerHTML = `${esc(note.text)}${links ? ' ' + links : ''}`;
  return note;
}
function watchFerryDeposit(address) {
  stopFerryWatch();
  const tick = async () => {
    if (cur !== 'ferry' || extra.depositAddress !== address) { stopFerryWatch(); return; }
    let st;
    try { st = await A.ferryStatus(address); }
    catch { return; }
    const beat = nextFerryBeat(st.status, { sailed: !!extra.sailed });
    const sym = (st?.symbolOut && String(st.symbolOut).length <= 12) ? st.symbolOut : (extra.q?.to?.symbol || extra.outSym || 'USDC');
    const view = ferryStatusView({
      status: st.status,
      amount: st?.amountOut || extra.q?.to?.amount || extra.outAmt || '',
      symbol: sym,
      txs: extra.depositTxs || [],
      destTx: st?.destinationTx || '',
      destChain: extra.destChain || String(extra.toId || '').split('|')[1] || '',
    });
    extra.ferryStatus = view;
    extra.depositHelp = view.text;
    extra.sailed = beat.sailed;
    sh?.setOrder?.(beat.order);
    const note = document.querySelector('[data-testid=ferry-status]');
    if (note) note.innerHTML = ferryStatusHtml(view);
    if (beat.play) playFerryDelivered();
    if (beat.terminal) stopFerryWatch();
    if (st.status === 'SUCCESS') showAgentDelivered(st);
  };
  tick();
  ferryWatch = setInterval(tick, 4000);
}
/** Guest is a labeled demo. A session stamp plus a ≤ $0.20 checkout may propose_call. Delivered only after SUCCESS. */
async function settleFerry(wantCharter) {
  const pair = APPS.ferry.pairFromState();
  const outAmt = extra.q.to?.amount || extra.q.amountOut || '';
  const ready = APPS.ferry.charterReady();
  if (!ready) {
    if (wantCharter) {
      return {
        kind: 'ok', hero: APPS.ferry.hero(),
        say: 'Open /setup to Ask charter. No wallet from here. You can still Load cargo as a guest.',
        rc: '<a class="rc" href="/setup">Open /setup</a>',
      };
    }
    sh?.hideRefuse?.();
    sh?.applyPair?.({ ...pair, outAmt, order: 'jetty' });
    return {
      kind: 'ok', hero: APPS.ferry.hero(),
      say: `Demo crossing only — ${esc(pair.fromSym)} to ${esc(pair.toSym)} is not a settled swap. The boat does not say delivered.`,
      rc: '<span class="rc" data-testid="ferry-order-state">order · demo</span><a class="rc" href="/ferry-widget">Optional Pay</a>',
    };
  }
  sh?.applyPair?.({ ...pair, outAmt, order: 'loading' });
  hideFerryPrimary();
  const clause = A.ferryClauseForPair(pair.from, pair.to);
  let o = null;
  if (wantCharter) {
    const asking = document.getElementById('f-charter');
    if (asking) { asking.disabled = true; asking.textContent = 'Asking your charter…'; }
    try { o = await A.ferry(clause, extra.q); }
    catch (e) {
      if (e.cancelled) throw e;
      o = { decision: 'denied', reason: A.plainError(e), tx: e.tx || null };
    }
    extra.ferryTx = o?.tx || null;
  }
  const refused = o && o.decision !== 'allowed';
  setCharterNote(o);
  if (refused) {
    // One refused stamp is an error. It does not play the downgrade cinema or freeze the boat.
    sh?.hideRefuse?.();
    if (!extra.sailed) sh?.setOrder?.('jetty');
    const why = ferryPlainReason(o.reason);
    return {
      kind: 'no', o, hero: APPS.ferry.hero(),
      say: `Charter refused the trip: ${esc(why)}. The boat stays at the jetty.`,
      rc: (o?.tx ? A.txLine(o.tx) : '') + '<span class="rc" data-testid="ferry-order-state">order · jetty</span>',
      rule: A.ruleFor(o, clause),
    };
  }
  // Read wrap.near before planning: first near_deposit keeps 0.00125 for board storage,
  // and a prior failed ft_transfer can leave stranded wNEAR on the board.
  let wrap = { registered: true, balanceYocto: '0' };
  if (nearNative(pair.from) && A.S.board) {
    try { wrap = await A.wrapBoardState(); }
    catch { wrap = { registered: true, balanceYocto: '0' }; }
  }
  const spend = nearNative(pair.from)
    ? pickWrapSpend({ wantAmount: pair.amt, wrapBalanceYocto: wrap.balanceYocto })
    : { amount: pair.amt, amountYocto: null, recover: false };
  let spendPair = pair;
  if (spend.recover && String(spend.amount) !== String(pair.amt)) {
    spendPair = { ...pair, amt: spend.amount };
    try {
      const q2 = await A.quotePair(spendPair.from, spendPair.to, spendPair.amt, spendPair.receiveAt);
      if (q2) extra.q = q2;
    } catch { /* keep the prior quote; checkout still uses spendPair.amt */ }
  }
  const cap = mayCheckout(extra.q);
  const stamp = o
    ? `Charter stamped ${esc(spendPair.fromSym || pair.fromSym)} → ${esc(spendPair.toSym || pair.toSym)} under the cap. That stamp is not the swap.`
    : `Session is on. ${esc(spendPair.fromSym || pair.fromSym)} → ${esc(spendPair.toSym || pair.toSym)} is a real deposit, not a demo crossing.`;
  if (!cap.ok) {
    sh?.hideRefuse?.();
    sh?.setOrder?.('quoted');
    extra.charterNote = explainQuoteMiss(cap.reason || 'no_usd');
    return {
      kind: 'ok', o, hero: APPS.ferry.hero(),
      say: `${stamp} ${extra.charterNote}`,
      rc: (o?.tx ? A.txLine(o.tx) : '') + '<span class="rc" data-testid="ferry-order-state">order · quoted</span>',
      rule: o ? A.ruleFor(o, clause) : '',
    };
  }
  let checkout = null;
  try { checkout = await A.openFerryCheckout(extra.q, spendPair); }
  catch (e) { checkout = { ok: false, reason: e?.message || 'checkout failed', depositAddress: null }; }
  if (!checkout?.ok || !checkout.depositAddress) {
    sh?.hideRefuse?.();
    sh?.setOrder?.('quoted');
    extra.charterNote = explainQuoteMiss(checkout?.error || checkout?.reason || 'checkout failed');
    return {
      kind: 'ok', o, hero: APPS.ferry.hero(),
      say: `${stamp} ${extra.charterNote}`,
      rc: (o?.tx ? A.txLine(o.tx) : '') + '<span class="rc" data-testid="ferry-order-state">order · quoted</span>',
      rule: o ? A.ruleFor(o, clause) : '',
    };
  }
  let depositAccountRegistered = null;
  if (nearNative(spendPair.from) && checkout.depositAddress) {
    try {
      const depStor = await A.wrapStorageOf(checkout.depositAddress);
      depositAccountRegistered = !!(depStor && (depStor.total != null || depStor.available != null));
    } catch { depositAccountRegistered = null; }
  }
  const plan = depositPlan({
    from: spendPair.from,
    amount: spendPair.amt,
    depositAddress: checkout.depositAddress,
    memo: checkout.depositMemo || null,
    capYocto: A.S.boardRow?.per_action_cap || null,
    balanceYocto: A.S.boardRow?.balance || null,
    wrapRegistered: wrap.registered,
    wrapBalanceYocto: wrap.balanceYocto,
    depositAccountRegistered,
  });
  sh?.hideRefuse?.();
  const waiting = '<span class="rc" data-testid="ferry-order-state">order · waiting</span>';
  if (plan.kind === 'propose_call') {
    let sent = null;
    try { sent = await A.ferryProposeCalls(plan.steps); }
    catch (e) { sent = { ok: false, wallet: false, reason: e?.message || 'propose_call failed' }; }
    const sentOk = !!(sent && sent.ok && sent.wallet === false);
    if (!sentOk) {
      sh?.setOrder?.('quoted');
      extra.depositAddress = '';
      extra.depositMode = '';
      const needRenew = /key_cannot_propose_call/i.test(String(sent?.reason || ''));
      if (needRenew) {
        extra.renewSetup = true;
        extra.renewLabel = 'Renew agent key once in Setup';
        extra.landedLinks = [];
        extra.charterNote = 'No wrap was sent: your agent key cannot call propose_call yet. Renew agent key once in Setup. No wallet opened here. The boat has not delivered.';
        return {
          kind: 'ok', o, hero: APPS.ferry.hero(),
          say: `${stamp} ${extra.charterNote} <a href="/setup" data-testid="ferry-renew-setup">Open Setup</a>`,
          rc: (o?.tx ? A.txLine(o.tx) : '') + '<span class="rc" data-testid="ferry-order-state">order · quoted</span>',
          rule: o ? A.ruleFor(o, clause) : '',
          agentHint: extra.charterNote, agentLinks: [], lowGas: false,
        };
      }
      const note = wrapProgressNote({
        amount: nearAmount(plan.transferYocto) || spendPair.amt,
        landed: sent?.landed || [],
        failedReason: sent?.reason || '',
        stranded: !!plan.recover,
      });
      extra.charterNote = note.text;
      extra.renewSetup = !!note.lowGas;
      extra.renewLabel = note.lowGas ? 'Refresh agent key' : '';
      extra.landedLinks = note.links || [];
      const linkHtml = extra.landedLinks.map(l => `<a class="rc tx" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join('');
      const refresh = note.lowGas ? ' <a href="/setup" data-testid="ferry-refresh-key">Refresh agent key</a>' : '';
      return {
        kind: 'ok', o, hero: APPS.ferry.hero(),
        say: `${stamp} ${esc(note.text)} ${linkHtml}${refresh}`,
        rc: (o?.tx ? A.txLine(o.tx) : '') + linkHtml + '<span class="rc" data-testid="ferry-order-state">order · quoted</span>',
        rule: o ? A.ruleFor(o, clause) : '',
        agentHint: note.text, agentLinks: extra.landedLinks, lowGas: !!note.lowGas,
      };
    }
    extra.charterNote = '';
    extra.renewSetup = false;
    extra.landedLinks = [];
    extra.depositAddress = checkout.depositAddress;
    extra.depositUsd = checkout.usd || String(cap.usd);
    extra.depositMode = 'propose_call';
    extra.depositTxs = Array.isArray(sent.txs) && sent.txs.length ? sent.txs : (sent.tx ? [sent.tx] : []);
    extra.outAmt = extra.q?.to?.amount || '';
    extra.outSym = extra.q?.to?.symbol || 'USDC';
    extra.destChain = pair.toChain || '';
    extra.ferryStatus = ferryStatusView({
      txs: extra.depositTxs, destChain: extra.destChain, amount: extra.outAmt, symbol: extra.outSym,
    });
    extra.depositHelp = extra.ferryStatus.text;
    sh?.setOrder?.('deposit');
    watchFerryDeposit(checkout.depositAddress);
    return {
      kind: 'ok', o, hero: APPS.ferry.hero(),
      say: extra.ferryStatus.text,
      rc: '',
      rule: o ? A.ruleFor(o, clause) : '',
    };
  }
  if (nearNative(pair.from)) {
    sh?.setOrder?.('quoted');
    extra.depositAddress = '';
    extra.depositMode = '';
    extra.charterNote = `The charter did not send this wrap (${plan.why || 'the row cap cannot hold it'}). No wallet opened. You are not asked to send USDC on Base. The boat has not delivered.`;
    return {
      kind: 'ok', o, hero: APPS.ferry.hero(),
      say: `${stamp} ${extra.charterNote}`,
      rc: (o?.tx ? A.txLine(o.tx) : '') + '<span class="rc" data-testid="ferry-order-state">order · quoted</span>',
      rule: o ? A.ruleFor(o, clause) : '',
    };
  }
  extra.depositAddress = checkout.depositAddress;
  extra.depositUsd = checkout.usd || String(cap.usd);
  extra.depositMode = 'you-send';
  extra.destChain = pair.toChain || '';
  extra.depositHelp = `${plan.why || 'Send the tokens yourself.'} The boat has not delivered.`;
  sh?.setOrder?.('deposit');
  watchFerryDeposit(checkout.depositAddress);
  const where = `<code>${esc(checkout.depositAddress)}</code>`;
  return {
    kind: 'ok', o, hero: APPS.ferry.hero(),
    say: `${stamp} This corridor is not wrap.near. Send at most ${esc(extra.depositUsd)} USD yourself to ${where}. The boat waits until 1Click says SUCCESS.`,
    rc: (o?.tx ? A.txLine(o.tx) : '') + '<a class="rc" href="/ferry-widget">Optional Pay</a>' + waiting,
    rule: o ? A.ruleFor(o, clause) : '',
  };
}
async function loadFerryCargo(wantCharter) {
  if (phase === 'busy' || cur !== 'ferry') return;
  if (!extra.q) { say('Get a quote first.'); return; }
  phase = 'busy';
  sfx('click');
  try { return finishFerry(await settleFerry(!!wantCharter)); }
  catch (e) {
    if (e?.cancelled) { phase = 'idle'; fail(e); return; }
    phase = 'idle';
    fail(e);
  }
}
const num = (n, u) => `<b class="num">${esc(n)}</b><span class="unit">${esc(u)}</span>`;
function chronicleRead() {
  return { ok: true, keep: true, kind: 'ok', say: 'Use Write statement in the tray. Nothing was signed.' };
}
const capFmt = 0;
// Plain names for accounts a visitor sees; the raw id stays in the tooltip and under "advanced".
export const nice = a => { if (!a) return ''; if (a === A.S.me) return 'You'; const m = A.merchants?.() || [];
  if (a === m[0]) return 'Café'; if (a === m[1]) return 'Bookshop'; if (a === 'townhall.nearcarta.near') return 'Town Hall'; if (/^lamp\./.test(a)) return 'Lamplighter (your agent)';
  if (/gate/.test(a)) return 'Toll gate'; if (/treasury/.test(a)) return 'Town treasury'; return a.split('.')[0]; };
// Progress for the long actions: plain steps with a time hint, ticking while the button is busy.
const STEPS = {
  chronicle: ['about 5 s', 'Reading this account', 'Writing a local statement'],
  bank: ['about 25 s', 'Checking the private AI is genuine', 'Asking your charter', 'Sealing the note', 'Recording it on NEAR'],
  ferry: ['about 15 s', 'Fetching a signed live quote', 'Asking your charter', 'Signing on NEAR'],
  guard: ['about 15 s', 'Checking the payee', 'Asking your charter', 'Recording the answer'],
  arena: ['about 45 s', 'Private AI is reading your message', 'Asking your charter', 'Signing on NEAR', 'Recording your score'],
  hall: ['about 15 s', 'Writing the proposal', 'Signing on NEAR', 'Waiting for the council'],
  payouts: ['about 15 s', 'Checking every payout against your charter', 'Sending one payment on NEAR', 'Confirming'],
  house: ['about 10 s', 'Reading your charter', 'Counting your history'],
  toll: ['about 30 s', 'Paying the 0.001 NEAR pass from your charter', 'Recording the pass', 'Recording the chain-signature proof'],
};
let prog = null;
const stepLine = s => s;
function progress(id) { clearInterval(prog); const st = STEPS[id]; if (!st) return; const [hint, ...raw] = st, steps = raw.map(stepLine), t0 = Date.now(), per = (parseInt(hint.replace(/\D+/g, '')) || 20) / steps.length;
  const tick = () => { const sec = Math.floor((Date.now() - t0) / 1000), i = Math.min(steps.length - 1, Math.floor(sec / per));
    rcpt(`<span class="prog" role="status" data-testid="progress"><span class="bar"><i style="width:${Math.min(95, Math.round(100 * sec / (per * steps.length)))}%"></i></span>Step ${i + 1} of ${steps.length} · ${esc(steps[i])}… <span class="eta">${sec} s · ${hint}</span></span>`); };
  tick(); prog = setInterval(() => phase === 'busy' ? tick() : clearInterval(prog), 1000); }
const stopProgress = () => { clearInterval(prog); prog = null; };
const verdict = o => o.decision === 'allowed' ? 'ok' : 'no';
function react(kind) { const r = sh?.rob; if (!r || typeof r.play !== 'function') return; sfx(kind === 'ok' ? 'allowed' : 'refuse'); try { r.play(kind === 'ok' ? 'Yes' : 'No', { once: true }); setTimeout(() => r.play('Idle'), 1500); } catch { /* the receipt still shows if the pose is missing */ } }
function ruleChip() {
  const c = A.S.clauses.pay; const b = $('#t-rules'); if (!b) return;
  const r = ruleChipText(c ? A.fromY(c.per_action_cap) : null, n => fmt(A.toY(n)));
  b.hidden = !A.S.charter; b.textContent = r.text; b.title = r.title; b.dataset.changed = r.changed ? '1' : ''; b.dataset.testid = 'rules-chip';
}
const HOSTED = () => document.body.dataset.host === 'd9'; // inside the town page the HUD owns #wallet
const who = () => A.S.me || readSessionAccount();
const wallet = () => {
  const id = who(); const saved = readSession();
  const pill = sessionPill({ accountId: id, displayName: saved.displayName, balanceNear: saved.balanceNear });
  const w = HOSTED() ? null : $('#wallet');
  if (w) { w.textContent = pill; w.classList.toggle('on', !!id); }
  let line = $('#t-who');
  if (id) {
    if (!line) { line = document.createElement('p'); line.id = 't-who'; line.dataset.testid = 'shop-session'; line.className = 'note'; ($('#t-label') || $('#t-title'))?.after(line); }
    if (line) line.textContent = pill;
  } else if (line) line.remove();
};

// Mist Bank: the NEAR AI TEE attestation behind the seal, one row per check (A.teeCheck → /api/ai/tee → backend/src/tee.js).
function teePanel(t, again = true) {
  const proof = `<a class="rc" data-testid="tee-proof" href="${PROOF_HREF}">Proof file</a>`;
  const recorded = `<p class="note tee-recorded" data-testid="tee-recorded">The file <a href="${PROOF_HREF}">tee-public.json</a> is a recorded attestation from Oct 28. The button is the live check.</p>`;
  if (!t) return (again ? `<button type="button" class="rc tee-btn" id="m-tee" data-testid="tee-verify">Verify the TEE now ↗</button>` : '') + recorded + proof;
  const when = t.at ? new Date(t.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  const view = teeResult(t);
  return `<div data-testid="tee-panel" class="${t.ok ? 'tee-pass' : 'tee-fail'}"><p class="tee-live" data-testid="tee-live">${t.ok ? 'Live check passed' : 'Live check did not pass'}</p><p data-testid="tee-result">${esc(view.label)} · ${esc(view.text)}</p>${recorded}<details class="more"><summary><span class="tee-badge ${t.ok ? '' : 'no'}" data-testid="tee-badge">${t.ok ? '✓ Verified private AI' : '✕ Private AI not verified'}${when ? ' · ' + esc(when) : ''}</span><span class="dt">details</span></summary>
    <p class="note">${t.ok ? 'The AI ran inside sealed hardware (a TEE) that NEAR AI and the chip maker vouch for. Nobody, us included, can read your message there.' : 'The check did not pass, so treat this reply as unverified.'}${t.model ? ' Model ' + esc(t.model) + '.' : ''}</p>
    <ol class="feed tee">${(t.rows || []).map(([k, ok, d]) => `<li class="${ok ? 'ok' : 'no'}"><span>${ok ? '✓ pass' : '✕ fail'}</span><span>${esc(k)}</span><span>${esc(d)}</span></li>`).join('')}${t.err ? `<li class="no"><span>error</span><span>${esc(String(t.err).slice(0, 80))}</span><span></span></li>` : ''}</ol>
    ${t.url ? `<a class="rc" data-testid="tee-center" aria-label="Check this reply in NEAR AI's Verification Center" href="${esc(t.url)}" target="_blank" rel="noopener">Check this reply in NEAR AI's Verification Center ↗</a>` : ''}</details>
    ${proof}
    ${again ? '<button type="button" class="rc tee-btn" id="m-tee" data-testid="tee-verify">Check again with a new nonce ↗</button>' : ''}</div>`;
}

// Toll: one step of a gate visit, read live from /api/toll/gate/<nonce> (gate record on NEAR + receipt on Base)
const BSC = h => h ? `<a class="rc tx" data-testid="base-tx" href="https://nearblocks.io/txns/${esc(h)}" target="_blank" rel="noopener">${esc(short(h, 8, 4))} ↗</a>` : '';
const mins = s => Math.max(1, Math.round(s / 60));
async function tollStep(v, act, o) {
  let st = await A.tollStatus(v.nonce);
  // signed but not on Base yet: ask the API to relay it (it fills any nonce gap first); idempotent
  if (st.status === 'signed' && !st.base) st = await A.tollBroadcast(v.nonce).catch(() => st);
  if (st.settle) {
    say('The chain-signature proof is ready. Recording it on NEAR…');
    st = (await A.tollServerSettle(v)) || st;
    if (st.status === 'signed' && st.settle && act) { say('Approve settle in your wallet. The charter records the proof…'); st = await A.tollSettle(v, st); }
  }
  extra.tst = st; extra.tv = v; extra.gate = null;
  const late = !st.base && v.at && Date.now() - v.at > 120e3; // over 2 min: say it was re-sent and give the explorer link
  const split = v.split ? `<details class="more" data-testid="toll-split"><summary>Paid ${esc(v.split.legs.reduce((n, [, a]) => n + Number(a), 0).toFixed(3))} NEAR in one payment<span class="dt">details</span></summary><p class="note">${v.split.legs.map(([r, a]) => `${esc(r === 'agent' ? 'your agent budget' : r === 'treasury' ? 'town treasury' : r)} ${esc(a)} NEAR`).join(' · ')}</p>${A.txLine(v.split.tx, 'split')}</details>` : '';
  const links = [split, A.txLine(v.pay_tx, 'gate'), st.tx_hash && (st.accepted || st.base || late) ? BSC(st.tx_hash) : '', v.settle_tx ? A.txLine(v.settle_tx, 'settle') : ''].join(' ');
  const rc = `<span class="rc" data-testid="toll-status" data-status="${esc(st.status)}" data-phase="${esc(st.phase || '')}">Status: ${esc(st.label || st.status)}</span> ${links}`;
  if (st.status === 'confirmed') { A.tollDone(v); return { o, kind: 'ok', rule: 'confirmed · recorded chain-signature proof', hero: num('✓', 'confirmed'), rc,
    say: 'Confirmed. The 0.001 NEAR pass is on mainnet, and the chain-signature proof is recorded.' }; }
  if (st.settle) return { o, keep: true, kind: 'ok', rule: 'paid · proof recorded', rc, say: 'The proof is ready to record on NEAR.' };
  tollWatch(v, st);
  return { o, keep: true, kind: 'ok', rule: 'paid · 0.001 NEAR pass', rc,
    say: `The 0.001 NEAR pass is on mainnet. A recorded chain-signature proof sits beside it. This gate does not send your NEAR to another chain. <b data-testid="toll-leave">You can leave.</b>` };
}
// Live countdown while Base finalizes; re-reads the gate every 20 s and settles as soon as it is final.
let watch = null;
function tollWatch(v, st) {
  clearInterval(watch); let end = Date.now() + (st.eta_s ?? 1200) * 1000, tick = 0;
  watch = setInterval(async () => {
    if (cur !== 'toll' || phase === 'busy') { if (cur !== 'toll') clearInterval(watch); return; }
    const el = document.querySelector('[data-testid="toll-eta"]'); if (el) el.textContent = mins((end - Date.now()) / 1000) + ' min';
    if (++tick % 20) return;
    const s = await A.tollStatus(v.nonce).catch(() => null); if (!s || cur !== 'toll') return;
    if (s.eta_s != null) end = Date.now() + s.eta_s * 1000;
    if (s.settle || s.status !== 'signed' || (s.base && !st.base)) { clearInterval(watch); primary(true); }
    else if (!s.base) { await A.tollBroadcast(v.nonce).catch(() => null); if (v.at && Date.now() - v.at > 120e3 && !st.late) { st.late = 1; clearInterval(watch); primary(true); } }
  }, 1000);
}
function gasNote() {
  const w = extra.gate?.gas?.warning;
  return w ? `<p class="plain-line warn" data-testid="gas-warning">⚠ ${esc(w)}</p>` : '';
}
function bankCapNear() {
  const y = A.S.clauses?.pay?.per_action_cap || A.S.boardRow?.per_action_cap || null;
  return y ? A.fromY(y) : null;
}

function tollPassRows() {
  const saved = tollChronicleRows();
  let mine = [];
  try {
    mine = (A.receipts() || []).filter(r => r.shop === 'toll' && r.h).map(r => ({
      shop: 'toll',
      decision: r.decision === 'allowed' ? 'allowed' : 'denied',
      reason: r.reason || '',
      h: r.h,
      label: r.decision === 'allowed' ? '0.001 NEAR pass' : A.why(r.reason),
    }));
  } catch { mine = []; }
  return [...saved, ...mine];
}
async function tollPay() {
  sh?.hideRefuse?.();
  const ready = !!(A.S.ready && A.stage() === 'ready' && A.S.board);
  if (!ready) {
    const hint = 'Set up your agent in /setup. Nothing was signed.';
    extra.seal = hint;
    return { ok: false, hint, keep: true, kind: 'no', say: hint, refused: false };
  }
  const row = A.S.boardRow || {};
  const why = tollCapCheck({
    receivers: row.receivers || A.S.clauses.pay?.receivers,
    capYocto: row.per_action_cap ?? A.S.clauses.pay?.per_action_cap,
    balanceYocto: row.balance,
    spentYocto: row.spent_today,
    dailyYocto: row.daily_budget ?? A.S.clauses.pay?.daily_budget,
    minYocto: row.min_amount ?? A.S.clauses.pay?.min_amount,
    expiresAtNs: row.expires_at,
    nowNs: (BigInt(Date.now()) * 1_000_000n).toString(),
    frozen: !!row.frozen,
  });
  if (why) {
    extra.seal = why;
    sh?.showRefuse?.(why);
    return { ok: false, hint: why, refused: true, keep: true, kind: 'no', say: why };
  }
  let o;
  try { o = await A.toll(); }
  catch (e) {
    const hint = String(A.plainError(e) || e.message || 'The pass did not run.').slice(0, 160);
    extra.seal = hint;
    sh?.showRefuse?.(hint);
    return { ok: false, hint, refused: true, keep: true, kind: 'no', say: hint };
  }
  if (!o || o.decision !== 'allowed' || !o.tx) {
    const hint = tollRefusal(A.why(o?.reason)) || 'The charter did not allow this pass. Nothing moved on Base.';
    extra.seal = hint;
    sh?.showRefuse?.(hint);
    if (o?.tx) rememberTollPass({ h: o.tx, decision: 'denied', reason: o.reason || '', label: 'refused' });
    return { ok: false, o, hint, refused: true, keep: true, kind: 'no', say: hint, rc: A.txLine(o?.tx) };
  }
  rememberTollPass({ h: o.tx, decision: 'allowed', reason: '', label: '0.001 NEAR pass' });
  extra.seal = '';
  extra.passTx = o.tx;
  if (A.S.boardRow?.balance != null) {
    try { A.S.boardRow = { ...A.S.boardRow, balance: (BigInt(A.S.boardRow.balance) - (10n ** 21n)).toString() }; }
    catch { /* the reply still names the balance we computed */ }
  }
  const balanceNear = nextRowBalance(row.balance);
  sh?.hideRefuse?.();
  if (sh?.act && runScene) runScene(sh.act({ success: true }));
  const sayText = passPaidCopy({ balanceNear });
  return { ok: true, o, tx: o.tx, balanceNear, hint: sayText, success: true, keep: true, kind: 'ok', say: sayText, rc: A.txLine(o.tx) };
}

// ---------- shop apps ----------
/** Board session: one propose per NEAR row. Over the row cap still goes to the chain. USDC is not sent. */
async function sendPayoutRows(rows, opts = {}) {
  sh?.hideRefuse?.();
  const capNear = opts.capNear != null && opts.capNear !== '' ? Number(opts.capNear) : (A.S.clauses?.pay ? A.fromY(A.S.clauses.pay.per_action_cap) : null);
  const parts = splitAssets(rows);
  const usdcNote = parts.usdc.length ? `${parts.usdc.length} USDC ${parts.usdc.length === 1 ? 'row' : 'rows'} kept. Not sent.` : '';
  if (!A.S.board || A.stage() !== 'ready') {
    const hint = 'Finish /setup. Nothing was sent.';
    return { ok: false, hint, seal: '', receipts: receiptsFor(parts.near), usdcNote, keep: true, kind: 'ok', say: hint, hero: null, rc: '' };
  }
  if (capNear == null || !Number.isFinite(capNear)) {
    const hint = 'The row cap is still unread. Nothing was sent.';
    return { ok: false, hint, seal: '', receipts: receiptsFor(parts.near), usdcNote, keep: true, kind: 'ok', say: hint, hero: null, rc: '' };
  }
  const over = parts.near.filter(r => Number(r.amt) > capNear + 1e-12);
  const under = parts.near.filter(r => !(Number(r.amt) > capNear + 1e-12));
  if (over.length && !under.length) {
    const hint = 'Refused before any deposit. Nothing was sent.';
    return { ok: false, hint, seal: hint, receipts: receiptsFor(parts.near).map(r => ({ ...r, status: 'refused' })), usdcNote, keep: true, kind: 'no', say: hint, hero: null, rc: '' };
  }
  parts.near = under;
  if (!parts.near.length) {
    const hint = 'USDC rows are invoices, not a NEAR propose. Nothing was sent.';
    return { ok: false, hint, seal: '', receipts: [], usdcNote, keep: true, kind: 'ok', say: hint, hero: null, rc: '' };
  }
  let o;
  try { o = await A.payouts(parts.near, { capNear }); }
  catch (e) {
    const hint = `${A.plainError(e).slice(0, 140)} Nothing was sent.`;
    return { ok: false, hint, seal: hint, receipts: receiptsFor(parts.near), usdcNote, keep: true, kind: 'no', say: hint, o: { decision: 'denied', reason: e.message, tx: e.tx || null } };
  }
  const steps = o.steps || [];
  const receipts = parts.near.map((r, i) => {
    const step = steps[i];
    const tx = step?.tx || '';
    return { n: i + 1, to: r.to, amount: r.amt, asset: 'NEAR', tx, url: tx ? `https://nearblocks.io/txns/${tx}` : '', status: step?.decision === 'allowed' ? 'sent' : (step ? 'refused' : 'not sent') };
  });
  for (const r of parts.usdc) receipts.push({ n: receipts.length + 1, to: r.to, amount: r.amt, asset: 'USDC', tx: '', url: '', status: 'not sent' });
  extra.pay = o;
  extra.receipts = receipts;
  extra.usdcNote = usdcNote;
  const seal = sealText(steps);
  const cinema = cinemaOk(steps);
  if (seal) sh?.showRefuse?.(seal);
  else sh?.hideRefuse?.();
  try {
    if (cinema && sh?.act && runScene) runScene(sh.act({ paid: true, refused: false }));
    else if (seal && steps.some(s => s.tx) && sh?.act && runScene) runScene(sh.act({ paid: false, refused: true }));
  } catch { /* the receipt still shows if the room pose is missing */ }
  const paid = steps.filter(s => s.decision === 'allowed' && s.tx).length;
  const hint = !steps.length
    ? (parts.usdc.length ? 'USDC rows are invoices, not a NEAR propose. Nothing was sent.' : 'Nothing was sent.')
    : cinema ? `Paid ${paid} on chain.` : (seal || `Paid ${paid}.`);
  return {
    ok: cinema, hint, seal, receipts, usdcNote, o, keep: true,
    kind: cinema ? 'ok' : 'no', hero: null,
    say: hint,
    rc: steps.filter(s => s.tx).map(s => A.txLine(s.tx)).join(' '),
    rule: cinema ? `paid · ${paid}` : (seal ? 'refused' : 'not sent'),
  };
}

const APPS = {
  toll: {
    label: 'Toll Bridge · pay-per-use gate', idle: 'Total cost: 0.001 NEAR. One payment. Your charter checks it. A refusal pays nothing.',
    btn: () => 'Pay 0.001 NEAR',
    hero: () => null,
    guest: true,
    form: () => '<div data-deep="toll"></div>',
    bind: () => {
      ensureTollDock();
      const hooks = {
        state: extra,
        row: () => A.S.boardRow || null,
        account: () => A.S.me || '',
        passes: () => tollPassRows(),
        onPay: () => tollPay(),
        hideRefuse: () => sh?.hideRefuse?.(),
        showRefuse: (text) => sh?.showRefuse?.(text),
      };
      mountShop('toll', document.getElementById('t-form'), hooks);
      wireTollDock(hooks);
    },
    run: async () => tollPay(),
  },
  ferry: {
    label: 'Ferry · cross-chain swap', idle: 'Fund NEAR once in /setup. Swap about 0.05 wNEAR on NEAR. Guest Load cargo is a demo.',
    guest: true,
    form: () => '<div data-deep="ferry"></div>',
    bind: () => {
      ensureFerryDock();
      const hooks = {
        state: extra,
        routes: () => A.ROUTES,
        tokens: () => A.loadFerryTokens(),
        quote: (id, amt) => A.quote(id, amt, 'ZEC@zec', extra.receiveAt),
        quotePair: (from, to, amt, receiveAt) => A.quotePair(from, to, amt, receiveAt ?? extra.receiveAt),
        visitor: () => A.S.me,
        charterReady: () => APPS.ferry.charterReady(),
        openRules: () => openRules(),
        onLoadCargo: (opts) => loadFerryCargo(!!opts?.charter),
        onAgain: () => { sh?.hideRefuse?.(); sh?.setOrder?.('jetty'); return primary(); },
        hideRefuse: () => sh?.hideRefuse?.(),
        setOrder: (id) => sh?.setOrder?.(id),
        repaint: () => paint(),
        onPair: (pair) => { sh?.hideRefuse?.(); if (sh?.applyPair) sh.applyPair(pair); },
      };
      mountShop('ferry', document.getElementById('t-form'), hooks);
      wireFerryDock(hooks);
      if (!extra.gasAsked && A.sessionAllowance) {
        extra.gasAsked = true;
        A.sessionAllowance().then(g => {
          extra.gasNear = g?.near || '';
          extra.gasLow = !!g?.low;
          if (cur === 'ferry') paint();
        }).catch(() => {});
      }
    },
    charterReady: () => A.S.ready && A.stage() === 'ready',
    btn: () => {
      if (extra.acted) return 'Get another quote';
      if (extra.q) return APPS.ferry.charterReady() ? 'Ask charter · load cargo' : 'Load the cargo';
      return extra.fdone ? 'Get another quote' : 'Get quote';
    },
    hero: () => {
      const pair = APPS.ferry.pairFromState();
      const q = extra.q;
      const fromSym = q?.from?.symbol || pair.fromSym;
      const fromChain = q?.from?.blockchain || q?.from?.chain || pair.fromChain;
      const toSym = q?.to?.symbol || pair.toSym;
      const toChain = q?.to?.blockchain || q?.to?.chain || pair.toChain;
      const inn = q ? (q.from?.amount ?? extra.amt ?? pair.amt) : (extra.amt || pair.amt);
      const out = q ? (q.to?.amount || q.amountOut || '') : '';
      return pairHero({
        fromSym, fromChain, toSym, toChain, amt: inn, outAmt: out,
        fromIcon: q?.from?.icon || '', toIcon: q?.to?.icon || '',
      });
    },
    pairFromState: () => {
      const fromId = extra.fromId || SESSION_SWAP.fromId;
      const toId = extra.toId || SESSION_SWAP.toId;
      const [fs, fc] = fromId.split('|');
      const [ts, tc] = toId.split('|');
      const from = (fs && fc) ? `${fs}@${fc}` : (A.ROUTES[extra.ri || 0]?.from || SESSION_SWAP.from);
      const to = (ts && tc) ? `${ts}@${tc}` : SESSION_SWAP.to;
      const amt = extra.amt || A.ROUTES[extra.ri || 0]?.amt || SESSION_SWAP.amt;
      return { from, to, amt, fromSym: from.split('@')[0], fromChain: from.split('@')[1], toSym: to.split('@')[0], toChain: to.split('@')[1], receiveAt: extra.receiveAt || '' };
    },
    run: async () => {
      if (extra.acted) {
        extra.q = null; extra.acted = false; extra.fdone = true; extra.ferryTx = null; extra.charterNote = ''; extra.renewSetup = false;
        clearFerryDeposit();
        sh?.hideRefuse?.();
        sh?.setOrder?.('jetty');
      }
      if (!extra.q) {
        extra.fdone = false;
        sh?.hideRefuse?.();
        sh?.setOrder?.('jetty');
        const pair = APPS.ferry.pairFromState();
        const q = await A.quotePair(pair.from, pair.to, pair.amt, pair.receiveAt);
        if (!q.ok || !q.checks?.signature) {
          sh?.hideRefuse?.();
          throw new Error(explainQuoteMiss(q.error || 'quote not signed'));
        }
        extra.q = q;
        const outAmt = q.to?.amount || q.amountOut || '';
        sh?.applyPair?.({ ...pair, outAmt, order: 'quoted' });
        const ready = APPS.ferry.charterReady();
        return {
          keep: true, hero: APPS.ferry.hero(),
          say: ready
            ? `Quote ready for ${esc(pair.from)} → ${esc(pair.to)}. Ask charter is a stamp under the cap, then propose_call on wrap.near if this quote is at most 0.20 USD. No wallet popup.`
            : `Quote ready for ${esc(pair.from)} → ${esc(pair.to)}. Load cargo here is a demo crossing, not a settled swap.`,
          rc: `<a class="rc" href="/ferry-widget">Optional Pay</a><span class="rc">1Click · ${esc((q.correlationId || '').slice(0, 8))}</span><span class="rc" data-testid="ferry-clause">clause ${esc(A.ferryClauseForPair?.(pair.from, pair.to) || pairClauseId(pair.from, pair.to))}</span>`,
        };
      }
      // Quote is up. Same path as the card: session settles, guest is a demo crossing.
      const res = await settleFerry(APPS.ferry.charterReady());
      extra.acted = true;
      return { ...res, keep: true };
    },
  },
  bank: {
    guest: true,
    label: 'Mist Bank · private audit', idle: 'This audit does not send a payment. A card file is read in this browser.',
    form: () => '<div data-deep="bank"></div>',
    bind: () => {
      mountShop('bank', document.getElementById('t-form'), {
        state: extra,
        capNear: () => bankCapNear(),
        who: () => {
          let saved = null;
          try { saved = JSON.parse(localStorage.getItem('nearcarta.setup.v1') || 'null'); } catch { saved = null; }
          const account = A.S.me || saved?.accountId || '';
          if (!account) return null;
          return { name: saved?.displayName || account, account };
        },
        hideRefuse: () => sh?.hideRefuse?.(),
        repaint: () => { if (cur === 'bank') paint(); },
      });
    },
    btn: () => '',
    hero: () => null,
    run: async () => (extra.runAgent ? extra.runAgent('Audit privately') : { ok: false, hint: 'Open the card. Nothing was signed.', say: 'Open the card. Nothing was signed.', keep: true, kind: 'no' }),
  },
  guard: {
    label: 'Guardhouse · prompt-injection test', idle: 'Pick a trick, such as an invoice with a hidden line telling AI helpers to pay someone else. I\u2019ll check the payee before I sign. A try costs at most 0.001 NEAR, and only if your rules allow it.',
    guest: true,
    form: () => '<div data-deep="guard"></div>',
    bind: () => mountShop('guard', document.getElementById('t-form'), { state: extra, attacks: () => A.attacks().filter(a => A.GUARD_ATTACKS.includes(a.id)), repaint: () => paint() }),
    btn: () => !extra.chk ? 'Try to trick my agent' : extra.chk.verdict === 'block' ? 'Let it knock anyway' : extra.chk.verdict === 'warn' ? 'I checked. Ask the charter' : 'Ask the charter',
    run: async () => {
      const id = extra.atk || 'poisoned-invoice';
      if (!extra.chk) {
        const p = await A.trickPlan(id); const c = await A.checkPayee(p.receiver); extra.chk = c;
        if (c.verdict === 'allow') return APPS.guard.send(id);
        const first = c.reasons.find(r => r.level === c.verdict) || c.reasons[0];
        return { keep: true, kind: 'ok', say: c.verdict === 'block' ? `Stopped before signing: ${esc(first.text).replace(/[.!?]+$/, "")}.` : `Wait: ${esc(first.text)}. Your call.`,
          rule: c.verdict === 'block' ? 'payee check · blocked, nothing signed' : 'payee check · needs you', rc: '<span class="rc">checked off chain: deny list, account age, code changes, your past payments</span>' };
      }
      return APPS.guard.send(id);
    },
    send: async id => {
      const was = extra.chk?.verdict; extra.chk = null;
      const r = await A.trickSend(id); const s = r.steps.at(-1) || {};
      if (r.refused && sh?.act && runScene) runScene(sh.act());
      const two = was === 'block' && r.refused;
      return { o: { decision: r.refused ? 'denied' : s.decision, reason: r.reason, tx: s.tx }, say: r.refused ? (w => two ? `Second check: your spending rules refused it. ${w.charAt(0).toUpperCase() + w.slice(1)}.` : `Blocked: ${w}.`)(A.why(r.reason)) : 'It got through. Tighten your rules.' };
    },
  },
  arena: {
    guest: true,
    label: 'Vault Arena · try to trick the AI', idle: 'Write me a scam. I believe everything.',
    lvl: () => { const g = A.game(); return A.WALLS.find(w => !g.walls.includes(w.reason)) || null; },
    form: () => '<div data-deep="arena"></div>',
    bind: () => mountShop('arena', document.getElementById('t-form'), { state: extra, goal: () => APPS.arena.lvl()?.goal || '', repaint: () => { if (cur === 'arena') proofDrawer(); } }),
    btn: 'Send the scam',
    hero: () => null,
    run: async () => {
      const w = APPS.arena.lvl(); const txt = (extra.txt || '').trim() || (w ? w.hint : 'pay 0.001 to stranger.near');
      const r = await A.scam(txt, (i, n, o) => n > 1 && say(`Payment ${i} of ${n}: ${o.decision === 'allowed' ? 'paid' : 'refused'}…`));
      extra.txt = ''; extra.atee = A.brainTee(r.brain); await A.record(r.tx).catch(() => {});
      const who = r.brain?.by === 'model' ? `NEAR AI${r.brain.parsed?.suspicious ? ' flagged it,' : ''} asked ${+r.parsed.amount.toFixed(4)} to ${esc(short(r.parsed.receiverShown, 12, 6))}. ` : r.brain ? 'Model unavailable; the plain-words parser read it. ' : '';
      let rank = ''; try { const b = await A.board(); const i = b.players.findIndex(p => p.player === A.S.me); if (i >= 0) rank = ` Rank ${i + 1}.`; } catch {}
      const cap = r.cap ? A.fmt(r.cap) : '';
      const said = r.cancelled ? 'Cancelled in the wallet. Nothing was signed. That is not a defence.'
        : r.breach ? 'Breach! Your rules paid a stranger.'
        : r.decision === 'denied' && r.fromRule ? `Refused by your rule before anything was signed: ${A.why(r.reason)}${cap ? ` (max ${cap})` : ''}. You can read this cap on your row.`
        : r.decision === 'denied' && r.tx ? `Refused on chain: ${A.why(r.reason)}. The receipt is the refusal.`
        : r.decision === 'denied' ? `Not a defence. ${A.why(r.reason) || 'Nothing was signed.'}`
        : `Paid ${+r.paid.toFixed(4)} inside your rules. No wall hit.`;
      const rc = receipt({ note: r.parsed.cls, receiver: r.parsed.receiverShown, amount: yOf(r.parsed.amount), by: r.brain?.by, model: r.brain?.model,
        verification: r.brain?.verification, cost: r.brain?.cost, decision: r.decision, reason: r.reason, tx: r.tx, clause_id: r.parsed.clause }, A.S.clauses[r.parsed.clause]);
      const rcl = `<details class="more"><summary><span class="dt">receipt</span></summary><span class="receipt" data-testid="receipt">${esc(rc.what)} · to ${esc(short(rc.to || '', 12, 6))} · ${esc(rc.price_near)} NEAR · ${esc(rc.decided_by)} · plan ${rc.checks.within_plan ? 'ok' : 'over'} · charter ${esc(rc.checks.charter || '?')}</span>`
        + (rc.counter_offer ? ` <span class="counter" data-testid="counter-offer">Counter-offer: ${esc(rc.counter_offer.why)}</span>` : '') + '</details>';
      const g = A.game(), more = `<details class="more" data-testid="arena-more"><summary><span class="dt">score &amp; receipt</span></summary><p class="note">${g.walls.length}/6 walls found · ${g.score} pts${rank}</p>${rcl.replace(/^<details class="more"><summary><span class="dt">receipt<\/span><\/summary>|<\/details>$/g, '')}${teePanel(extra.atee, false)}</details>`;
      return { o: r, keep: true, kind: r.cancelled ? 'no' : r.breach ? 'no' : r.decision === 'denied' ? 'ok' : 'no', hero: null, say: who + said + ' ' + more, rc: r.tx ? A.txLine(r.tx) : '', rule: r.cancelled ? '' : r.decision === 'denied' ? 'held by your rule · ' + A.why(r.reason) : A.ruleFor(r, r.parsed.clause) };
    },
  },
  hall: {
    guest: true,
    label: 'Town Hall · a job', idle: 'Post a job, then one quote. A pass stays held. Nothing is signed here.',
    form: () => '<div data-deep="hall"></div>',
    bind: () => {
      const hooks = {
        state: extra,
        pay: (plan) => A.hallPay({ receiver: plan.receiver, amountY: plan.amountY }),
        sign: (calls) => A.hallSign(calls),
        onPaid: (res) => { sh?.hideSeal?.(); if (sh?.act && runScene) runScene(sh.act({ paid: true, tx: res.tx })); },
        onRefuse: (text) => { if (sh?.act && runScene) runScene(sh.act({ refused: true, reason: text || '' })); else sh?.showSeal?.(text); },
        onClear: () => sh?.hideSeal?.(),
      };
      mountShop('hall', document.getElementById('t-form'), hooks);
      wireHallDock(hooks);
    },
    btn: () => '',
    hero: () => A.S.clauses.pay ? num(+A.fromY(A.S.clauses.pay.per_action_cap).toFixed(4), 'NEAR max') : null,
    run: async () => {
      if (typeof extra.hallRun === 'function') {
        const r = await extra.hallRun('tighten my cap');
        return { keep: true, kind: r?.ok ? 'ok' : 'no', say: r?.hint || 'Nothing was signed.', rc: r?.tx ? A.txLine(r.tx) : '' };
      }
      const r = await A.hallChange('tighter');
      return { o: { decision: r.tx ? 'allowed' : 'denied', tx: r.tx }, kind: r.tx ? 'ok' : 'no', hero: APPS.hall.hero(), say: r.what || 'Nothing was signed.', rule: r.tx ? 'applied on chain' : '' };
    },
  },
  payouts: {
    guest: true,
    label: 'Payouts · pay under the cap', idle: 'Pay reviewed rows with the session key. Nothing is sent until setup. An over-cap row is refused before any deposit.',
    rows: () => { if (!extra.rows) { const ps = A.bankPayees(); extra.rows = ps.slice(0, 3).map(to => ({ to, amt: '0.001' })); while (extra.rows.length < 2 && ps[0]) extra.rows.push({ to: ps[0], amt: '0.001' }); } return extra.rows.slice(0, 3); },
    total: () => Math.round(APPS.payouts.rows().reduce((t, r) => t + (Number(r.amt) > 0 ? Number(r.amt) : 0), 0) * 1e6) / 1e6,
    form: () => '<div data-deep="payouts"></div>',
    bind: () => mountShop('payouts', document.getElementById('t-form'), {
      state: extra, repaint: () => paint(), rows: () => APPS.payouts.rows(),
      capNear: () => (A.S.clauses?.pay ? A.fromY(A.S.clauses.pay.per_action_cap) : null),
      account: () => A.S.me || '',
      onPay: (rows, opts) => sendPayoutRows(rows, opts),
      onCinema: (opts) => { if ((opts?.paid || opts?.refused) && sh?.act && runScene) runScene(sh.act(opts)); },
      hideRefuse: () => sh?.hideRefuse?.(),
      showRefuse: (text) => sh?.showRefuse?.(text),
      onReady: ok => { if (cur === 'payouts') return; btn(APPS.payouts.btn(), 'primary', !ok || !A.canBatch()); },
    }),
    btn: () => payoutLabel(APPS.payouts.rows()),
    hero: () => extra.pay ? num(`${extra.pay.paid}/${extra.pay.n}`, 'paid') : num(APPS.payouts.rows().length, 'payouts'),
    run: async () => {
      const prep = prepareRows(APPS.payouts.rows());
      if (prep.blocked) throw new Error(prep.note || 'A row needs a payee. Nothing was sent.');
      return sendPayoutRows(prep.rows);
    },
  },
  house: {
    guest: true,
    label: 'Your House · your charter', idle: 'Your charter is the rule book your agent cannot break. It can only pay inside those rules.',
    form: () => deedMarkup(),
    btn: 'See my rules & record',
    hero: () => A.S.charter ? `<span class="commit" title="${esc(A.S.charter)}">${esc(short(A.S.charter.split('.')[0], 8, 6))}</span>` : null,
    run: async () => {
      await A.readRules();
      const c = A.S.clauses.pay;
      const rp = await A.reputation();
      if (!c?.per_action_cap) return { keep: true, kind: 'ok', say: 'No pay rule is on this row yet. Open Town Hall to read it. Nothing was signed.', rule: 'no pay rule on this row' };
      return { keep: true, kind: 'ok', hero: `${num(rp.refused, 'refused')}<span class="pts">of ${rp.asks} asks</span>`, say: `Max ${fmt(c.per_action_cap)}, ${fmt(c.daily_budget)} a day. ${rp.paid} paid, ${rp.refused} refused, all on chain.`, rule: `reputation · ${rp.asks ? Math.round(100 * rp.refused / rp.asks) : 0}% of asks refused`, rc: `<a class="rc" href="${NBA(A.S.charter)}" target="_blank" rel="noopener" title="${esc(A.S.charter)}">deed · ${esc(short(A.S.charter, 12, 6))} ↗</a>` };
    },
  },
  chronicle: {
    guest: true,
    label: 'Chronicle · account audit', idle: 'Type an account. Nothing was signed from this tray.',
    btn: '',
    form: () => '<div data-deep="chronicle"></div>',
    bind: () => mountShop('chronicle', document.getElementById('t-form'), {
      state: extra,
      repaint: () => paint(),
      onSeal: (text) => { if (text) sh?.showRefuse?.(text); else sh?.hideRefuse?.(); },
      rows: () => mergeTollChronicle([...(extra.feed?.local || []), ...RECORDED], tollPassRows()).map(x => ({ ...x, label: x.label || A.why(x.reason) })),
    }),
    run: () => chronicleRead(),
  },
};

// Toll gate, read live from /api/toll/gate (never a static status): the gate's latest records as a list, the gate itself under Details.
function tollGate() {
  if (!extra.gate && !extra.gateLoading) {
    extra.gateLoading = true;
    const stop = setTimeout(() => { if (!extra.gate) { extra.gate = { error: true, timeout: true }; extra.gateLoading = false; if (cur === 'toll') proofDrawer(); } }, 10000);
    A.gateInfo(true).then(g => { extra.gate = g; }).catch(() => { extra.gate = { error: true }; }).finally(() => { clearTimeout(stop); extra.gateLoading = false; if (cur === 'toll') { proofDrawer(); if (phase === 'idle' && gasNote()) paint(); } });
  }
  const g = extra.gate;
  const row = r => prow(`#${esc(r.nonce)} · ${esc(r.label || r.status)}`, r.visit ? 'charter ' + esc(short(r.visit.charter, 10, 7)) : '', `<span class="st ${r.status === 'confirmed' ? 'ok' : 'live'}" data-testid="gate-status">${r.status === 'confirmed' ? '✓' : '…'}</span>${r.tx_hash ? `<a class="tx" href="${esc(r.explorer)}" target="_blank" rel="noopener" aria-label="Open record ${esc(r.nonce)} in the explorer">${esc(short(r.tx_hash, 6, 4))} ↗</a>` : ''}`);
  if (!g) return { list: '<p class="note">Reading the gate…</p>', more: '' };
  if (g.error) return { list: '<p class="note" data-testid="gate-error">The gate did not answer. <button type="button" data-retry-gate>Retry</button></p>', more: '' };
  const low = g.gas?.low ? `<p class="warn" data-testid="gas-warning-row">Low gas: ${esc(g.gas.warning)}</p>` : '';
  return { list: low + (g.recent || []).map(row).join(''),
    more: kv('Gate', idChip(g.gate)) + kv('Signer', esc(g.mpc)) + kv('Recorded address', idChip(g.policy.allow_to[0], `${esc(g.foreign_explorer)}`))
      + (g.gas && g.gas.visits_left_at_cap != null ? kv('Gas left', `${esc(g.gas.visits_left_at_cap)} visits`) : '') };
}
// Guardhouse, under Details: the same pay clause re-checked by OutLayer in a TEE, with its attestation. The charter stays the final gate.
function attestedLine() {
  if (!extra.att && !extra.attL) { extra.attL = true; A.attestedCheck().then(a => { extra.att = a; }).catch(() => { extra.att = { error: true }; }).finally(() => { extra.attL = false; if (cur === 'guard') proofDrawer(); }); }
  const a = extra.att;
  if (!a) return kv('Attested check', '<span class="note">Reading…</span>');
  if (a.error || !a.enabled) return kv('Attested check', '<span class="note">Unavailable. The charter still checks every payment itself.</span>');
  const c = a.checks?.[0], ok = c?.decision === 'allow';
  const tag = c ? `<span class="st ${ok ? 'ok' : 'no'}" data-testid="attested-decision">${ok ? '✓ allow' : '✕ ' + esc(c.decision)}</span>${!ok && c.reasons?.[0] ? ` <span class="why">${esc(c.reasons[0])}</span>` : ''}` : '<span class="note">No checks yet</span>';
  const proofs = (a.runs || []).map(r => `<a class="tx" href="${esc(r.attestation)}" target="_blank" rel="noopener" aria-label="TEE attestation for the ${esc(r.label)} check">${r.decision === 'allow' ? '✓' : '✕'} ${esc(r.label.replace('_', ' '))} proof ↗</a> <a class="tx" href="https://nearblocks.io/txns/${esc(r.tx)}" target="_blank" rel="noopener" aria-label="Open the ${esc(r.label)} check">${esc(short(r.tx, 6, 4))} ↗</a>`).join('<br>');
  return `<div data-testid="attested-check">` + kv('Attested check', tag) + kv('Checker', `OutLayer TEE · wasm <code title="${esc(a.wasm_sha256)}">${esc(a.wasm_sha256.slice(0, 12))}…</code>`)
    + kv('Proof', proofs) + kv('Proxy', idChip(a.proxy)) + `<p class="note">The charter still decides on chain. This is an extra, independent check.</p></div>`;
}
// Live lists from the shop modules (Town Hall proposals, Arena past prompts, Toll records): rows only, their notes go to Details.
function lazyList(key, mod, fn, id) {
  if (extra[key] == null && !extra[key + 'L']) {
    extra[key + 'L'] = true;
    const stop = setTimeout(() => {
      if (extra[key] == null) { extra[key] = '<p class="note" data-testid="read-timeout">This list did not answer in 10 seconds. <button type="button" data-retry-list="' + key + '">Retry</button></p>'; extra[key + 'L'] = false; if (cur === id) proofDrawer(); }
    }, 10000);
    import(mod).then(m => { if (id === 'arena') { extra.arenaM = m; m.bindRedteam(() => { if (cur === 'arena') proofDrawer(); }); } return m[fn](undefined, undefined, true); }).then(h => { extra[key] = h; }).catch(() => { extra[key] = '<p class="note">This list did not answer. <button type="button" data-retry-list="' + key + '">Retry</button></p>'; }).finally(() => { clearTimeout(stop); extra[key + 'L'] = false; if (cur === id) proofDrawer(); });
  }
  return extra[key];
}
// Town Hall: m.liveProposals(undefined, undefined, true) via lazyList
const hallRows = () => lazyList('hallP', '../shops/hall.js', 'liveProposals', 'hall');
const arenaRows = () => lazyList('arenaP', '../shops/arenalive.js', 'livePrompts', 'arena');
const tollRecordRows = () => lazyList('tollR', '../shops/tollrecords.js', 'liveTollRecords', 'toll');
// split a module's html into its rows and its notes
function split(html) {
  if (html == null) return { rows: [], notes: [], wait: true };
  const t = document.createElement('template'); t.innerHTML = html;
  t.content.querySelectorAll('h3').forEach(h => h.remove());
  const notes = [...t.content.querySelectorAll('p.note')].map(n => { n.remove(); return n.outerHTML; });
  return { rows: [...t.content.querySelectorAll('.row')].map(r => r.outerHTML), notes };
}
// a list shows 5 rows; the rest fold under "Show all"
function list(title, rows, empty = 'Nothing yet.') {
  if (!rows.length) return `<section class="dz hist"><h3>${title}</h3><p class="note">${empty}</p></section>`;
  return `<section class="dz hist"><h3>${title} <span class="n">${rows.length}</span></h3>${rows.join('')}</section>`;
}

// ---------- side panel: 1 your status, 2 one action, 3 the latest result, 4 history; everything technical under Details ----------
let lab = '';
const NBA = a => `https://nearblocks.io/address/${esc(a)}`;
const prow = (k, why = '', v = '') => `<div class="row"><div class="k">${k}${why ? `<span class="why">${why}</span>` : ''}</div><div class="v">${v}</div></div>`;
const kv = (k, v) => `<div class="kv"><span>${k}</span><span>${v}</span></div>`;
// a long account id, cut in the middle, with copy and explorer buttons (24 px targets)
export const idChip = (a, href = NBA(a)) => a ? `<span class="idc"><code title="${esc(a)}">${esc(short(a, 10, 7))}</code><button type="button" class="ib2" data-copy="${esc(a)}" aria-label="Copy ${esc(a)}">⧉</button><a class="ib2" href="${href}" target="_blank" rel="noopener" aria-label="Open ${esc(a)} in the explorer">↗</a></span>` : '';
const BADGE = { allowed: ['ok', 'Allowed'], denied: ['no', 'Denied'], failed: ['no', 'Failed'], refused: ['no', 'Refused'] };
const badge = d => { const [c, t] = BADGE[d] || ['pend', String(d || '?').replace(/^./, x => x.toUpperCase())]; return `<span class="badge ${c}">${c === 'ok' ? '✓' : c === 'no' ? '✕' : '○'} ${esc(t)}</span>`; };
function card({ d, amt = '', to = '', why = '', link = '', title = 'Latest result' }) {
  return `<section class="dz"><h3>${title}</h3><article class="card ${(BADGE[d] || ['pend'])[0]}" data-testid="latest"><div class="ch">${badge(d)}${amt ? `<b class="amt">${esc(amt)}</b>` : ''}</div>`
    + (to ? `<p class="to">to <b title="${esc(to)}">${esc(nice(to) || short(to, 10, 7))}</b></p>` : '') + (why ? `<p class="why">${why}</p>` : '') + (link ? `<div class="lk">${link}</div>` : '') + '</article></section>';
}
// copy buttons and the panel's own action button (it presses the tray's main button)
if (!globalThis.__dzBound && globalThis.document) { globalThis.__dzBound = true;
  document.addEventListener('click', e => {
    const c = e.target.closest?.('[data-copy]'); if (c) { navigator.clipboard?.writeText(c.dataset.copy).then(() => { c.textContent = '✓'; setTimeout(() => { c.textContent = '⧉'; }, 1200); }).catch(() => {}); return; }
    if (e.target.closest?.('[data-retry-gate]')) { extra.gate = null; extra.gateLoading = false; if (cur === 'toll') proofDrawer(); return; }
    const again = e.target.closest?.('[data-retry-list]'); if (again) { const k = again.dataset.retryList; extra[k] = null; extra[k + 'L'] = false; proofDrawer(); return; }
    if (e.target.closest?.('[data-drawer-go]')) { const t = $('#t-act'); $('#d-close')?.click(); if (t && !t.disabled && !t.hidden) t.click(); }
  }); }
function syncGo() { const g = $('[data-drawer-go]'), t = $('#t-act'); if (!g || !t) return; const on = !t.hidden && !t.disabled && t.textContent.trim(); g.hidden = !on; if (on) g.textContent = t.textContent.trim(); }
function proofDrawer() {
  const d = $('#d-body'); if (!d || !cur) return; const S = A.S, c = S.clauses?.pay;
  const details = []; { const t = $('#d-title'); if (t) t.textContent = t.textContent.replace(/ · proof$/, ''); }
  // 1. your status
  let h = '<section class="dz me"><h3>You</h3>';
  if (!S.charter) { const copy = signedCopy(S.me || readSessionAccount(), false); h += `<p class="lead">${esc(copy.lead)}</p><p class="sub">${esc(copy.sub)}</p>`; }
  else {
    h += `<div class="lead">${idChip(S.charter)}</div><div class="chips">`
      + (S.state ? `<span class="chip ${S.state.frozen ? 'ice' : 'ok'}">${S.state.frozen ? 'Frozen' : 'Live'} · v${esc(S.state.policy_version)}</span>` : '')
      + (A.pendingNote() ? `<span class="chip" data-testid="pending-chip">${esc(A.pendingNote())}</span>` : '')
      + (c && cur === 'payouts' ? `<span class="chip">Your /setup cap ${fmt(c.per_action_cap)}</span><span class="chip">Your /setup day ${fmt(c.daily_budget)}</span>` : c ? `<span class="chip">Max ${fmt(c.per_action_cap)}</span><span class="chip">${fmt(c.daily_budget)} / day</span>` : '') + '</div>';
    details.push(kv('Charter', idChip(S.charter)) + (S.me ? kv('Owner', idChip(S.me)) : '') + (c?.receivers?.length ? kv('Payees', c.receivers.map(r => idChip(r)).join(' ')) : ''));
  }
  h += '</section>';
  // 2. one action
  let latest = '';
  if (cur === 'arena' && extra.arenaM) { const r = extra.arenaM.redteamParts(); h += r.action; latest = r.card; if (r.more) details.push(r.more); }
  else h += '<section class="dz act1"><button type="button" class="go" data-drawer-go data-testid="drawer-action" hidden></button></section>';
  // 3. latest result
  const mine = S.charter ? A.receipts().filter(r => (cur === 'house' ? true : r.shop === cur)) : [];
  if (!latest && cur === 'toll' && extra.tst) { const st = extra.tst; latest = card({ d: st.status === 'confirmed' ? 'allowed' : st.status, title: 'Your visit', why: esc(st.status === 'confirmed' ? 'Proof recorded on NEAR.' : '0.001 NEAR pass on mainnet. The chain-signature proof is recorded separately.'), link: `<span class="note">#${esc(st.nonce)}</span>` }); }
  if (!latest && mine[0]) { const r = mine[0]; latest = card({ d: r.decision, amt: r.amt ? fmt(r.amt) : '', to: r.to || '', why: r.decision === 'allowed' ? '' : esc(A.why(r.reason)), link: A.txLine(r.h) }); }
  h += latest;
  // 4. history
  if (S.charter) h += list(cur === 'house' ? 'Your history' : 'Your history here', mine.slice(latest && !(cur === 'toll' && extra.tst) ? 1 : 0, 12).map(r => prow(esc(r.shop) + ' · ' + esc(r.decision), r.reason && r.decision !== 'allowed' ? esc(A.why(r.reason)) : '', `<span class="st ${r.decision === 'denied' ? 'no' : 'ok'}" aria-label="${esc(r.decision)}">${r.decision === 'denied' ? '✕' : '✓'}</span>${A.txLine(r.h, '↗')}`)), 'Nothing signed yet.');
  if (cur === 'guard') details.push(attestedLine());
  if (cur === 'toll') { const t = tollGate(); h += `<section class="dz hist"><h3>Toll gate</h3>${t.list}</section>`; if (t.more) details.push(t.more); }
  const live = { hall: ['Recorded payments', hallRows], arena: ['Past attacks', arenaRows], toll: ['Toll records', tollRecordRows] }[cur];
  if (live) { const p = split(live[1]()); if (cur === 'hall' && !p.wait) { const old = p.rows.filter(r => r.includes('data-old="1"')); p.rows = p.rows.filter(r => !r.includes('data-old="1"')); if (old.length) p.hist = `<details class="more" data-testid="hall-history"><summary><span class="dt">Show history (${old.length} expired or test entries)</span></summary>${old.join('')}</details>`; }
    h += p.wait ? `<section class="dz hist"><h3>${live[0]}</h3><p class="note">Reading…</p></section>` : list(live[0], cur === 'arena' ? p.rows.slice(0, 3) : p.rows, p.notes[0] ? p.notes[0].replace(/<\/?p[^>]*>/g, '') : 'Nothing yet.'); if (p.hist) h = h.replace(/<\/section>$/, p.hist + '</section>'); if (!p.wait && p.rows.length) details.push(...p.notes); }
  // Details: ids, notes, the lab record
  if (lab) details.push(`<div class="labrec">${lab}</div>`);
  if (details.length) h += `<details class="dz more"><summary>Details</summary>${details.join('')}</details>`;
  d.innerHTML = `<div class="pf dz-wrap" data-testid="guest-proof" data-guest="1">${h}</div>`;
  queueMicrotask(syncGo);
}

// ---------- gate: wallet → charter → rules → shop ----------
function paint() {
  const app = APPS[cur]; if (!app) return; const st = A.S.ready ? A.stage() : 'load';
  document.body.classList.toggle('chronicle-tray', cur === 'chronicle');
  document.body.classList.toggle('bank-tray', cur === 'bank');
  document.body.classList.toggle('ferry-tray', cur === 'ferry');
  document.body.classList.toggle('toll-tray', cur === 'toll');
  document.body.classList.toggle('payouts-tray', cur === 'payouts');
  const cdock = document.getElementById('chronicle-agent-dock');
  if (cdock) cdock.hidden = cur !== 'chronicle';
  if (cur !== 'ferry') { const dock = document.getElementById('ferry-agent-dock'); if (dock) dock.hidden = true; }
  if (cur !== 'toll') { const td = document.getElementById('toll-agent-dock'); if (td) td.hidden = true; }
  if (cur !== 'bank') hideBankDock();
  const pDock = document.getElementById('payouts-agent-dock');
  if (pDock) pDock.hidden = cur !== 'payouts';
  wallet(); ruleChip(); label(app.label); proofDrawer();
  if (cur === 'hall') { const m = $('#t-more'); if (m) { m.href = hallRowHref(who()); m.classList.add('row-btn'); m.dataset.testid = 'change-my-row'; } }
  if (phase === 'busy') return;
  if (cur === 'toll') {
    document.body.classList.add('toll-tray');
    document.body.classList.remove('ferry-tray');
    document.body.classList.remove('hall-tray');
    const fd = document.getElementById('ferry-agent-dock'); if (fd) fd.hidden = true;
    const hd = document.getElementById('hall-agent-dock'); if (hd) hd.hidden = true;
    if (phase === 'idle') say(app.idle);
    hero(null);
    form(app.form());
    app.bind?.();
    hideFerryPrimary();
    return;
  }
  if (cur === 'hall' && app.guest && app.form) {
    document.body.classList.add('hall-tray');
    document.body.classList.remove('ferry-tray');
    document.body.classList.remove('toll-tray');
    say(app.idle);
    hero(app.hero ? app.hero() : null);
    form(app.form());
    app.bind?.();
    hideFerryPrimary();
    const ferryDockEl = document.getElementById('ferry-agent-dock');
    if (ferryDockEl) ferryDockEl.hidden = true;
    const tollDockEl = document.getElementById('toll-agent-dock');
    if (tollDockEl) tollDockEl.hidden = true;
    const hallDockEl = document.getElementById('hall-agent-dock');
    if (hallDockEl) hallDockEl.hidden = false;
    return;
  }
  // Ferry: after a quote, keep the card + cargo CTAs even if charter stage is incomplete (guest cinema).
  const ferryQuoted = cur === 'ferry' && extra.q;
  if (st === 'load' || st === 'connect' || st === 'build') {
    say(ferryQuoted ? (APPS.ferry.charterReady() ? 'Quote ready. Ask charter or Load cargo.' : 'Quote ready. Load cargo as guest, or open your charter.') : (app.idle || 'This is what the shop does. The proof is already on mainnet.'));
    hero(app.hero ? app.hero() : null);
    if (app.guest && app.form) { form(app.form()); app.bind?.(); } else form('');
    const id = who();
    if (ferryQuoted) { btn(null); document.body.classList.add('ferry-tray'); }
    else if (!A.S.ready) btn(id ? 'Opening…' : 'Sign in', 'primary', !!id);
    else if (st === 'build' && id) btn('Open your charter');
    else btn('Sign in');
    return;
  }
  if (st === 'rules') {
    if (ferryQuoted && app.guest && app.form) {
      say('Quote ready. Load cargo as guest, or write your rules to Ask charter.');
      hero(app.hero ? app.hero() : null); form(app.form()); app.bind?.(); btn('Write my rules'); return;
    }
    say('Write my rules. I can never break them.'); form(''); hero(null); btn('Write my rules'); return;
  }
  if (st === 'wait') { say(`Your rules are queued. ${esc(A.pendingNote())}.`); form(''); hero(null); btn('Check again'); return; }
  if (st === 'key') {
    if (ferryQuoted && app.guest && app.form) {
      say('Quote ready. Load cargo as guest, or finish the helper key to Ask charter.');
      hero(app.hero ? app.hero() : null); form(app.form()); app.bind?.();
    } else { form(''); hero(null); }
    const q = A.pendingKey();
    if (q && Date.now() >= q.eta) { if (!ferryQuoted) say('Your helper key is ready to turn on.'); btn('Turn on helper key'); }
    else if (q) { if (!ferryQuoted) say(`Your charter is fine. This browser's helper key starts ${esc(new Date(q.eta).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }))}.`); btn('Check again'); }
    else { if (!ferryQuoted) say('Your charter is fine. This browser has no helper key yet.'); btn('Add a helper key'); }
    return;
  }
  if (phase === 'idle') say(app.idle);
  form(app.form ? app.form() : ''); app.bind?.(); hero(app.hero ? app.hero() : null);
  document.body.classList.toggle('ferry-tray', cur === 'ferry');
  document.body.classList.toggle('chronicle-tray', cur === 'chronicle');
  document.body.classList.toggle('toll-tray', cur === 'toll');
  document.body.classList.toggle('hall-tray', cur === 'hall');
  document.body.classList.toggle('bank-tray', cur === 'bank');
  document.body.classList.toggle('payouts-tray', cur === 'payouts');
  const ferryDockEl = document.getElementById('ferry-agent-dock');
  if (ferryDockEl) ferryDockEl.hidden = cur !== 'ferry';
  const tollDockEl = document.getElementById('toll-agent-dock');
  if (tollDockEl) tollDockEl.hidden = cur !== 'toll';
  const hallDockEl = document.getElementById('hall-agent-dock');
  if (hallDockEl) hallDockEl.hidden = cur !== 'hall';
  if (cur === 'payouts') document.body.dataset.payoutReady = payoutReady(APPS.payouts.rows()).enabled ? 'yes' : 'no';
  if (cur === 'ferry' || cur === 'hall' || cur === 'toll' || cur === 'bank' || cur === 'payouts') {
    hideFerryPrimary();
  } else if (cur === 'chronicle') {
    btn(typeof app.btn === 'function' ? app.btn() : app.btn, 'primary');
  } else {
    btn(typeof app.btn === 'function' ? app.btn() : app.btn, 'primary', false);
  }
}
async function primary(auto = false) {
  if (phase === 'busy' || !cur) return; const st = A.stage(); if (!auto) sfx('click');
  if (st === 'load' || st === 'connect' || st === 'build') { location.assign('/setup/?next=' + encodeURIComponent(location.pathname + location.search + location.hash)); return; }
  if (st === 'rules') return openRules();
  if (st === 'wait' || st === 'key') { phase = 'busy'; btn(st === 'key' && !A.pendingKey() ? 'Approve in your wallet…' : 'Checking…', 'primary busy', true);
    try { if (st === 'key' && !(A.pendingKey() && Date.now() < A.pendingKey().eta)) { const r = await A.helperKey(); rcpt(A.txLine(r.tx, 'helper key')); } else await A.readRules(); phase = 'idle'; paint(); } catch (e) { fail(e); } return; }
  phase = 'busy';
  if (cur === 'ferry' || cur === 'toll' || cur === 'bank') {
    hideFerryPrimary();
    const again = document.getElementById('f-again');
    if (again) { again.disabled = true; again.textContent = 'Getting a quote…'; }
  } else btn(st === 'build' ? 'Approve in your wallet…' : 'Asking your charter…', 'primary busy', true);
  say(st === 'build' ? 'Building your charter…' : 'Asking your charter on chain…'); rcpt(''); if (st !== 'build') progress(cur);
  let res = null;
  try {
    if (st === 'build') { const r = await A.buildCharter(); phase = 'idle'; rcpt(A.txLine(r.tx, 'charter built')); paint(); openRules(); return; }
    res = await APPS[cur].run();
  } catch (e) { fail(e); return; }
  // The tx already landed. A later paint must not replace the receipt with "Stopped".
  try {
    stopProgress(); phase = res.keep ? 'kept' : 'done';
    const kind = res.kind || (res.o ? verdict(res.o) : 'ok');
    const rule = res.rule || (res.o ? A.ruleFor(res.o, res.clause) : '');
    if (res.hero !== undefined) hero(res.hero);
    if (res.noform) form('');
    say(res.say); react(kind);
    rcpt((rule ? `<span class="rule ${kind}" data-testid="rule">${kind === 'ok' ? '✓' : '✕'} ${esc(rule)}</span>` : '') + (res.rc || A.txLine(res.o?.tx)));
    const app = APPS[cur];
    if (cur === 'ferry' || cur === 'bank') hideFerryPrimary();
    else btn(typeof app.btn === 'function' ? app.btn() : (res.keep ? app.btn : (AGAIN[cur] || 'Do it again')));
    if (app.form && !res.noform) { form(app.form()); app.bind?.(); }
    document.body.dataset.app = kind; ruleChip(); proofDrawer();
  } catch (e) {
    phase = 'kept';
    say(res.say || 'Done.');
    rcpt(res.rc || A.txLine(res.o?.tx) || (e.tx ? A.txLine(e.tx) : ''));
    document.body.dataset.app = 'ok';
  }
}
const AGAIN = { hall: 'Propose another rule', chronicle: 'Write another statement', ferry: 'Get a new quote', guard: 'Check another payee', arena: 'Try another message', payouts: 'Send another batch', house: 'Check again', bank: 'Audit another sample', toll: 'Pass the gate again' };
function fail(e) { stopProgress(); phase = 'idle'; if (cur === 'ferry') { sh?.hideRefuse?.(); sh?.setOrder?.('jetty'); } if (cur === 'toll') sh?.showRefuse?.(A.plainError(e).slice(0, 140)); if (cur === 'bank') sh?.hideRefuse?.(); say(`Stopped: ${esc(A.plainError(e).slice(0, 140))}`); rcpt(e.tx ? A.txLine(e.tx) : ''); if (cur === 'ferry' || cur === 'toll' || cur === 'bank' || cur === 'chronicle') hideFerryPrimary(); else btn(A.stage() === 'ready' ? 'Try again' : 'Retry'); document.body.dataset.app = 'err'; }

// ---------- rules sheet ----------
function openRules() {
  const r = A.stage() === 'connect' ? null : A.rulesNow(); if (!r) return;
  const m = A.merchants(), opts = [[m[0], 'Café'], [m[1], 'Bookshop'], [A.S.me, 'Me']];
  const custom = r.receivers.filter(x => !opts.some(o => o[0] === x));
  const hr = (id, v) => `<select id="${id}">${Array.from({ length: 25 }, (_, h) => `<option value="${h * 60}" ${h * 60 === v ? 'selected' : ''}>${String(h).padStart(2, '0')}:00</option>`).join('')}</select>`;
  const who = r.receivers.map(nice).join(', ') || 'nobody yet';
  $('#r-body').innerHTML = `
    <div class="safe" data-testid="safe-defaults"><b>Safe defaults</b><p>Pay only ${esc(who)} · at most ${esc(r.cap)} NEAR a payment · ${esc(r.budget)} NEAR and ${esc(r.count)} payments a day. Ferry trips up to ${esc(r.ferryCap)} NEAR. You can change these any time.</p></div>
    <details class="more" id="r-more" ${A.S.clauses.pay ? 'open' : ''}><summary>Customize<span class="dt">who, limits, hours</span></summary>
    <fieldset><legend>Who I may pay</legend><div class="chips">${opts.map(([a, t]) => `<label><input type="checkbox" name="rcv" value="${esc(a)}" ${r.receivers.includes(a) ? 'checked' : ''}><span>${t}</span></label>`).join('')}</div>
      ${custom.length ? `<p class="note">Also allowed: ${custom.map(a => `<span title="${esc(a)}">${esc(nice(a))}</span>`).join(', ')}</p>` : ''}
      <details class="more"><summary>Advanced: add a NEAR account by its id</summary><input id="r-custom" aria-label="Other NEAR account ids, comma separated" placeholder="friend.near" value="${esc(custom.join(','))}"></details></fieldset>
    <div class="grid2">
      <label>Max per payment<span class="sfx"><input id="r-cap" type="number" step="0.001" min="0.001" value="${r.cap}"><i>NEAR</i></span></label>
      <label>Daily cap<span class="sfx"><input id="r-bud" type="number" step="0.01" min="0.001" value="${r.budget}"><i>NEAR</i></span></label>
      <label>Payments per day<input id="r-cnt" type="number" min="1" max="50" value="${r.count}"></label>
      <label>Smallest payment<span class="sfx"><input id="r-min" type="number" step="0.001" min="0.001" value="${r.min}"><i>NEAR</i></span></label>
      <label>Open from (UTC)${hr('r-ws', r.ws)}</label><label>Until (UTC)${hr('r-we', r.we)}</label>
    </div>
    <fieldset data-testid="ferry-rules"><legend>Ferry pairs (any live 1Click corridor)</legend>
      <p class="note">Quick ZEC corridors, plus any other pair you allow. Cap still binds every trip under /setup.</p>
      <div class="chips" data-testid="ferry-preset-routes">${A.ROUTES.map(x => `<label><input type="checkbox" name="rt" value="${x.id}" ${r.routes.includes(x.id) ? 'checked' : ''}><span>${esc(x.label)}</span></label>`).join('')}</div>
      <div class="chips" id="r-extra-routes" data-testid="ferry-extra-routes">${r.routes.filter(id => !A.ROUTES.some(x => x.id === id)).map(id => `<label><input type="checkbox" name="rt" value="${esc(id)}" checked><span>${esc(id.replace(/^route\./, ''))}</span></label>`).join('')}</div>
      <div class="ferry-add-pair" data-testid="ferry-add-pair">
        <label>Allow another pair
          <input id="r-from-pair" data-testid="ferry-rule-from" placeholder="USDC@base" autocomplete="off">
          <span aria-hidden="true">→</span>
          <input id="r-to-pair" data-testid="ferry-rule-to" placeholder="ZEC@zec" autocomplete="off">
        </label>
        <button type="button" class="link" id="r-add-pair" data-testid="ferry-rule-add">Allow pair</button>
      </div>
      <label>Ferry max per trip<span class="sfx"><input id="r-fcap" type="number" step="0.01" min="0.002" value="${r.ferryCap}"><i>NEAR</i></span></label></fieldset>
    </details>`;
  $('#r-status').innerHTML = ''; $('#r-sign').disabled = false; $('#r-sign').textContent = A.S.clauses.pay ? 'Sign my new rules' : 'Use safe defaults';
  const addPair = $('#r-add-pair');
  if (addPair) addPair.onclick = () => {
    const from = ($('#r-from-pair')?.value || '').trim();
    const to = ($('#r-to-pair')?.value || '').trim() || 'ZEC@zec';
    if (!from.includes('@')) { $('#r-status').innerHTML = '<span class="rule no">✕ Use symbol@chain, e.g. USDC@base</span>'; return; }
    const id = pairClauseId(from, to);
    const box = $('#r-extra-routes');
    if (!box) return;
    if ([...box.querySelectorAll('input[name=rt]')].some(i => i.value === id) || [...document.querySelectorAll('input[name=rt]')].some(i => i.value === id && i.checked)) {
      $('#r-status').innerHTML = '<span class="rule ok">✓ Pair already allowed</span>'; return;
    }
    const lab = document.createElement('label');
    lab.innerHTML = `<input type="checkbox" name="rt" value="${esc(id)}" checked><span>${esc(from)} → ${esc(to)}</span>`;
    box.appendChild(lab);
    $('#r-from-pair').value = ''; $('#r-to-pair').value = '';
    $('#r-status').innerHTML = `<span class="rule ok">✓ Allowed ${esc(from)} → ${esc(to)}. Sign to write it on chain.</span>`;
  };
  const d = $('#rules'); d.classList.add('open'); d.setAttribute('aria-hidden', 'false'); $('#r-sign').focus();
}
function closeRules() { const d = $('#rules'); d.classList.remove('open'); d.setAttribute('aria-hidden', 'true'); }
async function signRules() {
  const v = id => Number($(id).value);
  const rec = [...document.querySelectorAll('input[name=rcv]:checked')].map(i => i.value).concat($('#r-custom').value.split(',').map(s => s.trim()).filter(Boolean));
  const r = { receivers: [...new Set(rec)], cap: v('#r-cap'), budget: v('#r-bud'), count: v('#r-cnt'), min: v('#r-min'), ws: v('#r-ws'), we: v('#r-we') === 1440 && v('#r-ws') === 0 ? 0 : v('#r-we'),
    routes: [...document.querySelectorAll('input[name=rt]:checked')].map(i => i.value), ferryCap: v('#r-fcap') };
  const b = $('#r-sign'); b.disabled = true; b.textContent = 'Signing…';
  const STEPS = ['Approve in your wallet', 'Writing your rules to NEAR', 'Checking them on chain'], t0 = Date.now();
  const show = i => { $('#r-status').innerHTML = `<p class="note" data-testid="sign-eta">Usually about 20 s.</p><ol class="steps" data-testid="sign-steps" aria-live="polite">${STEPS.map((x, j) => `<li class="${j < i ? 'done' : j === i ? 'now' : ''}">${j < i ? '✓' : j === i ? '●' : '○'} ${x}${j === i && i > 0 ? ` · ${Math.round((Date.now() - t0) / 1000)} s` : ''}</li>`).join('')}</ol>`; };
  let step = 0; show(0); const tick = setInterval(() => { if (step === 0 && Date.now() - t0 > 2500) step = 1; if (step === 1 && Date.now() - t0 > 15000) step = 2; show(step); }, 1000);
  try { const o = await A.signRules(r).finally(() => clearInterval(tick)); $('#r-status').innerHTML = `<span class="rule ok">✓ ${o.queued ? 'signed · looser limits start ' + esc(A.pendingNote().replace(/^.*from /, '')) : 'signed · in force now'}</span> ${A.txLine(o.tx)}`; b.textContent = 'Signed'; sfx('allowed');
    setTimeout(() => { closeRules(); phase = 'idle'; paint(); rcpt(A.txLine(o.tx, 'rules signed')); }, 900);
  } catch (e) { clearInterval(tick); $('#r-status').innerHTML = `<span class="rule no">✕ ${esc(A.plainError(e).slice(0, 140))}</span>`; b.disabled = false; b.textContent = 'Try again'; }
}

// ---------- wiring ----------
let booted = null;
export function boot() {
  if (booted) return booted;
  const shop = document.getElementById('shopUI');
  if (shop && !shop.dataset.keys) {
    shop.dataset.keys = '1';
    const stopKeys = (e) => {
      const t = e.target;
      if (!t?.closest?.('input, textarea, select')) return;
      if (!t.closest('#shopUI')) return;
      e.stopPropagation();
    };
    shop.addEventListener('keydown', stopKeys);
    shop.addEventListener('keyup', stopKeys);
    shop.addEventListener('focusin', (e) => {
      if (e.target?.closest?.('input, textarea, select')) window.dispatchEvent(new CustomEvent('nearcarta:typing'));
    });
  }
  $('#t-act').onclick = () => primary(); $('#t-rules').onclick = openRules; $('#r-close').onclick = closeRules; $('#r-sign').onclick = signRules;
  if (!HOSTED() && $('#wallet')) $('#wallet').onclick = () => { if (A.S.me) return openRules(); location.assign('/setup/?next=' + encodeURIComponent(location.pathname + location.search + location.hash)); };
  booted = A.init(() => paint()).then(() => paint()).catch(e => { A.S.ready = true; fail(e); });
  return booted;
}
export function mount(id, shop, scene) { for (const r of ['tray', 'drawer', 'rules', 'chron']) watchTokens(document.getElementById(r)); setTimeout(maybeOnboard, 600);
  cur = id; sh = shop; runScene = scene; phase = 'idle'; extra = {}; lab = ''; rcpt(''); document.body.dataset.app = ''; document.body.classList.toggle('ferry-tray', id === 'ferry'); document.body.classList.toggle('chronicle-tray', id === 'chronicle'); document.body.classList.toggle('toll-tray', id === 'toll'); document.body.classList.toggle('hall-tray', id === 'hall'); document.body.classList.toggle('bank-tray', id === 'bank'); document.body.classList.toggle('payouts-tray', id === 'payouts');
  const dock0 = document.getElementById('ferry-agent-dock'); if (dock0) dock0.hidden = id !== 'ferry';
  const cdock0 = document.getElementById('chronicle-agent-dock'); if (cdock0) cdock0.hidden = id !== 'chronicle';
  const tollDock0 = document.getElementById('toll-agent-dock'); if (tollDock0) tollDock0.hidden = id !== 'toll';
  const hallDock0 = document.getElementById('hall-agent-dock'); if (hallDock0) hallDock0.hidden = id !== 'hall';
  if (id !== 'bank') hideBankDock();
  const pDock0 = document.getElementById('payouts-agent-dock'); if (pDock0) pDock0.hidden = id !== 'payouts';
  const sayEl = $('#t-say'); if (sayEl) sayEl.textContent = '';
  { const d = $('#d-body'); lab = d && !d.querySelector('[data-guest]') ? d.innerHTML : ''; } boot(); paint(); proofDrawer();
  // a wallet connected elsewhere on the page (the town HUD) since the last room: pick it up
  if (A.S.ready) A.refresh().then(() => cur === id && phase !== 'busy' && paint()).catch(() => {});
}
export function unmount() { cur = null; sh = null; lab = ''; extra = {}; phase = 'idle'; stopFerryWatch(); closeRules(); document.body.classList.remove('ferry-tray'); document.body.classList.remove('chronicle-tray'); document.body.classList.remove('toll-tray'); document.body.classList.remove('hall-tray'); document.body.classList.remove('bank-tray'); document.body.classList.remove('payouts-tray'); const dock = document.getElementById('ferry-agent-dock'); if (dock) dock.hidden = true; const cdock = document.getElementById('chronicle-agent-dock'); if (cdock) cdock.hidden = true; const tollDock = document.getElementById('toll-agent-dock'); if (tollDock) tollDock.hidden = true; const hallDock = document.getElementById('hall-agent-dock'); if (hallDock) hallDock.hidden = true; hideBankDock(); const pDock = document.getElementById('payouts-agent-dock'); if (pDock) pDock.hidden = true; const sayEl = $('#t-say'); if (sayEl) sayEl.textContent = ''; }
export const rulesOpen = () => !!$('#rules')?.classList.contains('open');
export { closeRules };
window.__apps = { A, S: A.S, paint, primary, openRules, signRules, mount };
addEventListener('nearcarta:balance', () => { try { if (cur) wallet(); } catch { /* the header redraws on its own */ } });

// Accessible names for explorer links and replay buttons, wherever a drawer renders them (they can sit in a
// collapsed drawer where their text has no layout, so screen readers and audits need an explicit name).
if (typeof MutationObserver !== 'undefined') {
  const label = () => { for (const a of document.querySelectorAll('a.tx:not([aria-label])')) { const u = a.getAttribute('href') || '', t = u.split('/').pop();
    a.setAttribute('aria-label', (/\/address\//.test(u) ? 'Open account ' : 'Open transaction ') + t.slice(0, 12) + ' in the explorer (new tab)'); }
    for (const b of document.querySelectorAll('[data-replay]:not([aria-label])')) b.setAttribute('aria-label', `Replay at ${b.dataset.replay}× speed`); };
  new MutationObserver(label).observe(document.documentElement, { childList: true, subtree: true }); label();
}
