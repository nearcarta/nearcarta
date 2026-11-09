// One shop surface for the city tray, /shops/<name>/ and the console.
// Quote, check, search and prepare only. Nothing here signs a payment.

import { roomError } from '../room-error.js';
import { pickBest, quoteLine, tokenChoices, chainsOf, filterTokens } from '../ferry-catalog.js';
import { mountGuardTray } from './guard-tray.js';
import { mountTollRoom } from './toll-room.js';
import { PROOF_HREF, TEE_PLAN, TEE_TIMEOUT_MS, liveTee, teeTimeoutWhy, teeView } from '../tee-view.js';
import { mountArenaTray } from './arena/tray.js';
import { mountPayouts } from './payouts-tray.js';
import { visitor } from '../../design/D8_shops/js/session.js';
import { lookalike } from '../guard-lookalike.js';
import { houseCharterMarkup, mountHouseRoom } from './house-room.js';
import { boundaryHtml } from './boundary.js';
import { charterSetupCta, shortId } from './hall-ui.js';
import { parseRouteFrom, tokenStack, tokenBadge, bindTokenFallbacks, pickerListbox, bindPickerListbox } from './token-badge.js';
import { agentCargoPlan, chainLabel, receiveAsk, receiveConfirm } from './ferry-pair.js';
import { explainQuoteMiss, ferryStatusHtml, ferryStatusView, SESSION_SWAP, quoteRecipient, validateDestAddress, isNearAccountId } from './ferry-settle.js';
import { armFerryDock, dispatchFerryDock, installFerryDock } from './ferry-dock.js';
import { mountChronicleTray } from './chronicle-view.js';
import { mountBankRoom } from './bank-tray.js';

export { houseCharterMarkup };

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const api = () => (globalThis.NEARCARTA_API || '').replace(/\/$/, '');
const q$ = (root, sel) => root.querySelector(sel);

/** A disabled control stays readable and says why it is waiting. */
function holdButton(btn, reason) {
  if (!btn) return () => {};
  btn.disabled = true;
  btn.dataset.reason = reason;
  let note = btn.nextElementSibling?.dataset?.testid === 'control-reason' ? btn.nextElementSibling : null;
  if (!note) {
    note = document.createElement('p');
    note.dataset.testid = 'control-reason';
    note.className = 'control-reason';
    btn.after(note);
  }
  note.hidden = false;
  note.textContent = reason;
  btn.setAttribute('aria-describedby', 'control-reason');
  note.id = 'control-reason';
  return () => {
    if (!btn.isConnected) return;
    btn.disabled = false;
    delete btn.dataset.reason;
  };
}

export const DEFAULT_ROUTES = [
  { id: 'route.eth-eth.zec', from: 'ETH@eth', sym: 'ETH', chain: 'eth', chainLabel: 'Ethereum', label: 'ETH · Ethereum', amt: '0.002' },
  { id: 'route.usdc-base.zec', from: 'USDC@base', sym: 'USDC', chain: 'base', chainLabel: 'Base', label: 'USDC · Base', amt: '3' },
  { id: 'route.usdc-arb.zec', from: 'USDC@arb', sym: 'USDC', chain: 'arb', chainLabel: 'Arbitrum', label: 'USDC · Arbitrum', amt: '3' },
];

const SAMPLE = {
  refund: '0x561E8eF0FEcB621469dA30250dC6CdCD1E47A66e',
};
/** Origin-chain refund. A NEAR origin refunds to the visitor, never a treasury default. */
export function refundForChain(chain, visitor) {
  const c = String(chain || '').toLowerCase();
  if (c === 'near' || c === 'near protocol') return isNearAccountId(visitor) ? visitor : '';
  return SAMPLE.refund;
}

/** 1Click recipient. NEAR destinations use the visitor. Other chains use only the address they typed. */
function quotePayee(to, visitor, receiveAt) {
  return quoteRecipient(to, visitor, receiveAt);
}


/** Smart tray default: stables ~3, tiny for high-value, else 1. */
export function defaultAmtFor(sym) {
  const s = String(sym || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.startsWith('USDC') || s === 'USDT' || s === 'DAI' || s === 'USDCE') return '3';
  if (s === 'ETH' || s === 'WETH') return '0.002';
  if (s === 'BTC' || s === 'WBTC') return '0.00005';
  // 0.05 wNEAR is the session default. Whether it fits is the visitor's row cap, not a
  // product USD limit: depositPlan falls back to you-send when the row cannot hold it.
  if (s === 'NEAR' || s === 'WNEAR') return SESSION_SWAP.amt;
  return '1';
}

function routeMeta(r) {
  const parsed = parseRouteFrom(r.from);
  const sym = r.sym || parsed.sym;
  const chain = r.chain || parsed.chain;
  const chainLabel = r.chainLabel || ({ eth: 'Ethereum', base: 'Base', arb: 'Arbitrum', zec: 'Zcash' }[chain] || chain || '');
  return { sym, chain, chainLabel, label: r.label || `${sym} · ${chainLabel}` };
}

export function corridorCards(routes, lines = []) {
  const by = new Map(lines.map(l => [l.id, l]));
  const list = (routes || []).slice(0, Math.max(3, (routes || []).length));
  return `<div class="corridors" data-testid="ferry-corridors">${list.map(r => {
    const meta = routeMeta(r);
    const line = by.get(r.id);
    const usd = line ? (line.usdText || 'USD not quoted') : 'No quote yet';
    const best = line?.best ? ' data-best="1"' : '';
    const detail = line?.text || `${meta.sym} ${r.amt}`;
    return `<article class="corridor${line?.best ? ' best' : ''}" data-testid="ferry-corridor" data-route-id="${esc(r.id)}"${best}>
      <header class="corridor-head">${tokenStack(meta.sym, meta.chain, { size: 26, chainSize: 13 })}
        <div class="corridor-titles"><b>${esc(meta.sym)}</b><span class="corridor-chain">on ${esc(meta.chainLabel)}</span></div>
        <span class="corridor-arrow" aria-hidden="true">→</span>
        ${tokenStack('ZEC', 'zec', { size: 22, chainSize: 11 })}
      </header>
      <p class="corridor-usd" data-testid="ferry-usd">${esc(usd)}</p>
      <p class="corridor-line">${esc(detail)}</p>
      ${line?.best ? '<p class="corridor-best">Best rate</p>' : ''}
    </article>`;
  }).join('')}</div>`;
}

function usdOf(line) {
  // Two different empty states, deliberately: when no quote has been asked for, there is nothing to
  // report ("No quote yet"); when a quote DID return but carried no USD figure, saying so is real
  // information the visitor can act on ("USD not quoted"). Collapsing them loses that distinction.
  if (!line) return 'No quote yet';
  if (line.usd == null || line.usd === '') return 'USD not quoted';
  const n = Number(line.usd);
  return `about $${Number.isFinite(n) ? n.toFixed(2) : line.usd}`;
}

function tokenOpts(choices, { q = '', chain = '', selected = '' } = {}) {
  const list = filterTokens(choices || [], { q, chain });
  const opts = list.map(t => ({ value: t.id, label: t.label, symbol: t.symbol, chain: t.chain, icon: t.icon || '' }));
  // A fallback row only when the catalog itself is empty. A search that hides the
  // current id must not paint that id back into the closed button.
  if (!opts.length && selected && !(choices || []).length) {
    const [symbol, chainName] = String(selected).split('|');
    opts.push({ value: selected, label: `${symbol || ''} on ${chainName || ''}`.trim(), symbol: symbol || '', chain: chainName || '' });
  }
  return opts;
}

function chainOpts(choices) {
  return [{ value: '', label: 'All', kind: 'chain' }].concat(chainsOf(choices).map(c => ({ value: c, label: c, kind: 'chain' })));
}

export function ferryMarkup(state = {}, routes = DEFAULT_ROUTES) {
  const resolveRi = () => {
    if (state.ri != null && state.ri !== '') return Number(state.ri) || 0;
    if (state.fromId) {
      const [sym, chain] = String(state.fromId).split('|');
      const i = routes.findIndex(r => (r.sym || '').toUpperCase() === String(sym || '').toUpperCase() && (r.chain || '') === (chain || ''));
      return i >= 0 ? i : -1; // custom pair: no corridor chip pressed
    }
    const usdc = routes.findIndex(r => r.id === 'route.usdc-base.zec' || ((r.sym || '').toUpperCase() === 'USDC' && r.chain === 'base'));
    return usdc >= 0 ? usdc : 0;
  };
  const ri = resolveRi();
  const rt = (ri >= 0 && routes[ri]) || routes.find(r => r.id === 'route.usdc-base.zec') || routes[0];
  const meta = routeMeta(rt);
  const choices = state.choices || [];
  const nTok = choices.length;
  const tab = state.tab || 'swap';
  const defaultFromId = state.fromId || SESSION_SWAP.fromId;
  const defaultToId = state.toId || SESSION_SWAP.toId;
  const chainBox = pickerListbox({ id: 'f-chain', testid: 'ferry-chain-filter', options: chainOpts(choices), selected: state.chainFilter || '' });
  const fromBox = pickerListbox({ id: 'f-from', testid: 'ferry-from', options: tokenOpts(choices, { q: state.tq || '', chain: state.chainFilter || '', selected: defaultFromId }), selected: defaultFromId });
  const toBox = pickerListbox({ id: 'f-to', testid: 'ferry-to', options: tokenOpts(choices, { q: state.tq || '', chain: '', selected: defaultToId }), selected: defaultToId });
  const pickFrom = String(defaultFromId).split('|');
  const pickSym = pickFrom[0] || meta.sym;
  const pickChain = pickFrom[1] || meta.chain;
  const pickTo = defaultToId.split('|');
  const toSym = pickTo[0] || 'ZEC';
  const toChain = pickTo[1] || 'zec';
  const lines = state.lines || [];
  const quotes = (state.quotes || []).map(v => {
    const symIn = v.symbolIn || parseRouteFrom(v.from || '').sym || '';
    const chainIn = v.chainIn || parseRouteFrom(v.from || '').chain || '';
    const symOut = v.symbolOut || 'ZEC';
    const chainOut = v.chainOut || 'zec';
    const inn = tokenBadge(symIn, chainIn, { size: 18, chainSize: 10, cls: 'row-tok' });
    const out = tokenBadge(symOut, chainOut, { size: 18, chainSize: 10, cls: 'row-tok' });
    const amtIn = v.amountIn != null && v.amountIn !== '' ? `<span class="row-amt">${esc(v.amountIn)}</span>` : '';
    const amtOut = v.amountOut != null && v.amountOut !== '' ? `<span class="row-amt">${esc(v.amountOut)}</span>` : '';
    const usdNum = Number(v.usd);
    const usdTxt = v.usd != null && v.usd !== '' ? `about $${Number.isFinite(usdNum) ? usdNum.toFixed(2) : v.usd}` : '';
    const metaBits = [usdTxt, v.fee != null && v.fee !== '' ? `fee ${v.fee} bps` : '', v.eta != null && v.eta !== '' ? `about ${v.eta}s` : ''].filter(Boolean).join(' · ');
    const body = `${amtIn}${inn}<span class="row-arrow" aria-hidden="true">→</span>${amtOut}${out}${metaBits ? `<span class="row-meta">${esc(metaBits)}</span>` : ''}`;
    return `<p class="ferry-row" data-testid="ferry-row"${v.best ? ' data-best="1"' : ''}>${body}${v.best ? ' <span class="row-best">best rate</span>' : ''}</p>`;
  }).join('');
  const q = state.q;
  const rateLine = (() => {
    if (!q || state.sample) return '';
    const inn = q.from?.amount || state.amt || '';
    const out = q.to?.amount || q.amountOut || '';
    const fs = q.from?.symbol || pickSym;
    const ts = q.to?.symbol || toSym;
    if (!inn && !out) return '';
    return `<p class="ferry-rate" data-testid="ferry-rate">${esc(inn)} ${esc(fs)} → ${esc(out)} ${esc(ts)}</p>`;
  })();
  const errLine = state.quoteError
    ? `<p class="ferry-quote-err" data-testid="ferry-quote-error">${esc(state.quoteError)}</p>`
    // `sample` means an auto-quote ran and came back without a usable amount. On a page the
    // visitor has not touched, "The live quote did not return" reads as a failure they caused, so
    // the honest idle line says no quote exists and nothing was sent. `ferry-idle` is that line
    // under the id the M7 test reads.
    //
    // When no auto-quote ran, render nothing: section-m's unit test pins that the Swap pane drops
    // idle microcopy at all (it rejected the phrase "No deposit has been requested"), and the
    // corridors already carry their own "No quote yet" per row.
    : (state.sample ? '<p data-testid="ferry-idle">No quote yet. Nothing was sent.</p>' : '');
  const acted = !!state.acted;
  const showCargo = !!(state.q && !acted && !state.sample && !state.quoteError);
  const showAgain = acted && !state.sample;
  const charterReady = !!state.charterReady;
  const tabs = `<div class="ferry-tabs" role="tablist" data-testid="ferry-tabs">
      <button type="button" role="tab" class="ferry-tab${tab === 'swap' ? ' on' : ''}" data-tab="swap" aria-selected="${tab === 'swap' ? 'true' : 'false'}" data-testid="ferry-tab-swap">Swap</button>
      <button type="button" role="tab" class="ferry-tab${tab === 'routes' ? ' on' : ''}" data-tab="routes" aria-selected="${tab === 'routes' ? 'true' : 'false'}" data-testid="ferry-tab-routes">Routes</button>
      <button type="button" role="tab" class="ferry-tab${tab === 'rules' ? ' on' : ''}" data-tab="rules" aria-selected="${tab === 'rules' ? 'true' : 'false'}" data-testid="ferry-tab-rules">Rules</button>
    </div>`;
  const amtVal = (state.amt != null && state.amt !== '') ? state.amt : defaultAmtFor(pickSym);
  const flow = `<div class="ferry-flow" data-testid="ferry-flow" aria-hidden="true"><span class="ferry-dest" data-testid="ferry-dest" hidden></span>
      ${tokenStack(pickSym, pickChain, { size: 48, chainSize: 16 })}
      <span class="ferry-flow-arrow">→</span>
      ${tokenStack(toSym, toChain, { size: 48, chainSize: 16 })}
    </div>`;
  const deposit = state.depositAddress
    ? (state.depositMode === 'propose_call'
      ? `<p class="ferry-status" data-testid="ferry-status">${ferryStatusHtml(state.ferryStatus || ferryStatusView({ txs: state.depositTxs, destChain: state.destChain, amount: state.outAmt, symbol: state.outSym }))}</p>`
      : `<p class="ferry-deposit" data-testid="ferry-deposit">Send at most ${esc(state.depositUsd || '0.20')} USD yourself to <code data-testid="ferry-deposit-address">${esc(state.depositAddress)}</code>.</p><p data-testid="ferry-status">${esc(state.depositHelp || 'Waiting for the deposit. The boat has not delivered.')}</p>`)
    : '';
  const swap = `<div class="ferry-pane ferry-picker" data-pane="swap" data-testid="ferry-picker" ${tab === 'swap' ? '' : 'hidden'}>
      <div class="swap-card">
        <div class="swap-card-head"><span>From</span><span class="swap-bal" data-testid="ferry-balance-from">${esc(state.fromBal || '')}</span></div>
        <label class="field ferry-field swap-line"><span class="sr-only">You pay</span>${fromBox}
          <span class="amt-row"><input id="f-amt" type="number" min="0" step="any" value="${esc(amtVal)}" aria-label="Amount"><button type="button" class="swap-max" id="f-max" data-testid="ferry-max">Max</button><span id="f-sym" class="amt-sym">${esc(pickSym)}</span></span>
        </label>
      </div>
      <button type="button" class="swap-flip" id="f-flip" data-testid="ferry-flip" aria-label="Swap direction">⇅</button>
      <div class="swap-card">
        <div class="swap-card-head"><span>To</span><span class="swap-bal" data-testid="ferry-balance-to">${esc(state.toBal || '')}</span></div>
        <label class="field ferry-field swap-line"><span class="sr-only">You get</span>${toBox}
          <span class="amt-row"><span class="swap-est" data-testid="ferry-est">${esc(q && !state.sample ? '≈ ' + (q.to?.amount || q.amountOut || '') : '')}</span><span class="amt-sym">${esc(toSym)}</span></span>
        </label>
      </div>
      <div class="swap-chain-row">
        <label class="field ferry-field"><span>Chain</span>${chainBox}</label>
        <span class="swap-live" data-testid="ferry-live"><i aria-hidden="true"></i>Live</span>
      </div>
      ${q && !state.sample ? `<div class="swap-quote" data-testid="ferry-quote-card">
        <div class="swap-quote-head"><span>Swap quote</span><span class="swap-best" data-testid="ferry-best">Best route</span></div>
        ${rateLine}
      </div>` : ''}
      ${flow}
      <label class="field ferry-field"><span>Find a token</span><input id="f-find" data-testid="ferry-token-search" placeholder="ZEC, USDC, near" value="${esc(state.tq || '')}" autocomplete="off"></label>
      ${(() => {
        const foreign = String(toChain || '').toLowerCase() !== 'near';
        if (!foreign) return '';
        const receive = validateDestAddress(toChain, state.receiveAt);
        const bad = state.receiveAt && !receive.ok
          ? `<p class="ferry-quote-err" data-testid="ferry-receive-error">${esc(receive.reason)}</p>`
          : '';
        return `<label class="field ferry-field" data-testid="ferry-receive-field"><span>Receive at</span><input id="f-receive" data-testid="ferry-receive" placeholder="Address on ${esc(toChain || 'this chain')}" value="${esc(state.receiveAt || '')}" autocomplete="off" spellcheck="false"></label>${bad}`;
      })()}
      <button type="button" class="primary ferry-cta" id="f-quote" data-testid="ferry-quote" ${acted ? 'hidden' : ''}${String(toChain || '').toLowerCase() !== 'near' && !validateDestAddress(toChain, state.receiveAt).ok ? ' disabled' : ''}>Review swap</button>
      ${errLine}
      <div class="ferry-cargo-actions" data-testid="ferry-cargo-actions" ${showCargo ? '' : 'hidden'}>
        <button type="button" class="ferry-cta" id="f-cargo" data-testid="ferry-load-cargo"${String(toChain || '').toLowerCase() !== 'near' && !validateDestAddress(toChain, state.receiveAt).ok ? ' disabled' : ''}>Load cargo</button>
        <button type="button" class="ferry-cta ferry-cta-charter" id="f-charter" data-testid="ferry-ask-charter" ${charterReady ? '' : 'hidden'}${String(toChain || '').toLowerCase() !== 'near' && !validateDestAddress(toChain, state.receiveAt).ok ? ' disabled' : ''}>Ask charter · load cargo</button>
      </div>
      <button type="button" class="ferry-cta" id="f-again" data-testid="ferry-again" ${showAgain ? '' : 'hidden'}>Get another quote</button>
      ${deposit}
      ${state.charterNote ? `<p class="ferry-charter-note" data-testid="ferry-charter-note" role="status">${esc(state.charterNote)}${state.renewSetup ? ` <a href="/setup" data-testid="${/refresh/i.test(state.renewLabel || '') ? 'ferry-refresh-key' : 'ferry-renew-setup'}">${esc(state.renewLabel || 'Renew agent key once in Setup')}</a>` : ''}${(state.landedLinks || []).map(l => ` <a class="tx" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join('')}</p>` : ''}
    </div>`;
  const routesPane = `<div class="ferry-pane" data-pane="routes" ${tab === 'routes' ? '' : 'hidden'}>
      <p class="ferry-picker-note" data-testid="ferry-token-count" ${nTok ? '' : 'hidden'}>${nTok ? `${nTok} live tokens` : ''}</p>
      <p class="ferry-shortcuts-label">Quick ZEC corridors</p>
      <div class="route-row" role="group" aria-label="Quick ZEC corridors" data-testid="ferry-routes">${routes.map((r, i) => {
        const m = routeMeta(r);
        return `<button type="button" class="route-chip" data-route="${esc(r.id)}" aria-pressed="${i === ri ? 'true' : 'false'}" data-testid="ferry-route">
          ${tokenStack(m.sym, m.chain, { size: 24, chainSize: 12 })}
          <span class="route-copy"><b>${esc(m.sym)}</b><small>on ${esc(m.chainLabel)}${r.down ? ' · down' : ''}</small></span>
        </button>`;
      }).join('')}</div>
      ${corridorCards(routes, lines)}
      <details class="ferry-compare-more" data-testid="ferry-compare-wrap">
        <summary>Compare corridors</summary>
        <button type="button" class="primary ferry-cta" id="f-compare" data-testid="ferry-compare">Compare now</button>
        <div id="f-quotes" class="ferry-quotes" data-testid="ferry-quotes">${quotes}</div>
      </details>
    </div>`;
  const rulesPane = `<div class="ferry-pane" data-pane="rules" ${tab === 'rules' ? '' : 'hidden'}>
      <p class="ferry-kicker">Fund NEAR once in /setup. The session swap is about 0.05 wNEAR on NEAR to USDC on NEAR: the charter calls wrap.near and no wallet opens. A destination that is not NEAR needs the address that should receive the tokens. Ask charter is a stamp, not the swap. Guest Load cargo is a demo. Paying with USDC on Base is optional Pay — you send it, and a bridge minimum can refuse it.</p>
      <button type="button" class="primary ferry-cta" id="f-open-rules" data-testid="ferry-open-rules">Open /setup rules</button>
      ${state.gasNear ? `<p data-testid="ferry-gas">Session gas left: ${esc(state.gasNear)} NEAR.${state.gasLow ? ' Session gas is low.' : ''}${state.gasLow ? ' <a href="/setup" data-testid="ferry-refresh-key">Refresh agent key</a>' : ''}</p>` : ''}
      <p class="ferry-agent-hint">Cap still binds. Session key signs with no wallet popup when ready.</p>
    </div>`;
  return `<div class="shop-stack ferry-card" data-testid="ferry-card">${tabs}${swap}${routesPane}${rulesPane}</div>`;
}

async function quoteOne(route, amount, hooks, receiveAt) {
  if (hooks.quote) return hooks.quote(route.id, amount || route.amt);
  const visitor = hooks.visitor?.() || '';
  const recipient = quotePayee({ chain: 'zec' }, visitor, receiveAt);
  if (!recipient) return { ok: false, error: 'Enter the address on the destination chain that should receive the tokens.', dry: true };
  const res = await fetch(api() + '/api/ferry/quote', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ from: route.from, to: 'ZEC@zec', amount: String(amount || route.amt), recipient, refundTo: refundForChain(route.chain || parseRouteFrom(route.from).chain, visitor), privacy: 'basic' }),
  });
  return res.json();
}

function idToFrom(id) {
  const [sym, chain] = String(id || '').split('|');
  return sym && chain ? `${sym}@${chain}` : '';
}

function trayDestChain(state) {
  return String(state?.toId || '').split('|')[1]?.toLowerCase() || '';
}

/** In-shop agent. A parsed swap calls the same Load cargo hook as the button ({ charter: false }). No chain tx is built here. */
export async function runFerryAgent({ text, state = {}, charterReady = false, quotePair, onLoadCargo, onPair, onSeal, onNote } = {}) {
  const plan = agentCargoPlan(text, { charterReady });
  if (!plan.ok) return { ...plan, loaded: false };
  if (plan.parsed?.receiveAt) state.receiveAt = plan.parsed.receiveAt;
  if (!plan.parsed && plan.mode !== 'setup') {
    const chain = trayDestChain(state);
    if (chain && chain !== 'near' && !validateDestAddress(chain, state.receiveAt).ok) {
      return { ok: false, loaded: false, hint: receiveAsk(chain) };
    }
  }
  if (plan.parsed) {
    onSeal?.();
    state.fromId = plan.parsed.fromId;
    state.toId = plan.parsed.toId;
    if (plan.parsed.amt) { state.amt = plan.parsed.amt; state.amtEdited = true; }
    state.q = null;
    state.quoteError = '';
    state.charterNote = ''; state.renewSetup = false;
    state.sample = false;
    state.acted = false;
    let q;
    try { q = await quotePair(plan.parsed.from, plan.parsed.to, plan.parsed.amt || state.amt || SESSION_SWAP.amt, state.receiveAt || ''); }
    catch (e) { onSeal?.(); return { ok: false, loaded: false, hint: explainQuoteMiss(e?.message || 'quote failed') }; }
    const failed = !q || ((q.ok === false || q.error) && !(q.to?.amount || q.amountOut));
    if (failed) { onSeal?.(); return { ok: false, loaded: false, quoted: false, hint: explainQuoteMiss(q?.error || q?.refused) }; }
    state.q = q;
    state.quoted = true;
    const [fs, fc] = String(state.fromId || '').split('|');
    const [ts, tc] = String(state.toId || '').split('|');
    onPair?.({
      from: plan.parsed.from, to: plan.parsed.to, amt: state.amt,
      fromSym: fs, fromChain: fc, toSym: ts, toChain: tc,
      receiveAt: state.receiveAt || '',
      outAmt: q.to?.amount || q.amountOut || '', order: 'quoted',
    });
  } else if (!state.q && plan.mode !== 'setup') {
    return { ok: false, loaded: false, hint: 'Get a quote first. Try: Swap 0.05 wNEAR on NEAR to USDC' };
  }
  const where = receiveConfirm(trayDestChain(state) || String(plan.parsed?.to || '').split('@')[1], state.receiveAt);
  const whereBit = where ? ` ${where}` : '';
  if (plan.mode === 'quote') return { ok: true, loaded: false, quoted: true, mode: 'quote', hint: `Quote ready for ${plan.parsed.from} → ${plan.parsed.to}.${whereBit} Ask charter or Load cargo.` };
  if (plan.mode === 'setup') return { ok: true, loaded: false, mode: 'setup', hint: 'Open /setup to Ask charter. No wallet from here. You can still Load cargo as a guest.' };
  const sessionLoad = !!charterReady && plan.mode === 'guest';
  // A swap sentence is Load cargo. "Ask charter" with no pair is the only stamp.
  const stamp = plan.mode === 'charter' && !plan.parsed;
  if (where) onNote?.(where);
  const loaded = await onLoadCargo?.({ charter: stamp });
  if (loaded && (loaded.agentHint || loaded.lowGas)) {
    const prefix = where ? `${where} ` : '';
    return {
      ok: true, loaded: true, mode: plan.mode, charter: stamp,
      hint: `${prefix}${loaded.agentHint || ''}`.trim(),
      links: loaded.agentLinks || [],
      lowGas: !!loaded.lowGas,
    };
  }
  const hint = stamp
    ? `${where ? where + ' ' : ''}Asking the charter under your cap. No wallet.`
    : (plan.mode === 'charter' || sessionLoad)
      ? `${where ? where + ' ' : ''}Session is on. Load cargo asks for a deposit address, then propose_call on wrap.near. No wallet. You are not asked to send USDC on Base.`
      : 'Demo crossing. Not a settled swap. The boat does not say delivered.';
  return { ok: true, loaded: true, mode: plan.mode, charter: stamp, hint };
}

function mountFerry(root, hooks) {
  const routes = hooks.routes ? hooks.routes() : DEFAULT_ROUTES;
  const state = hooks.state || (hooks.state = {});
  if (!state.toId) state.toId = SESSION_SWAP.toId;
  if (!state.tab) state.tab = 'swap';
  // Session corridor: wNEAR@near → USDC@near at 0.05 (USD under 0.20, propose_call when the row cap holds it).
  if (!state.fromId) state.fromId = SESSION_SWAP.fromId;
  if (state.amt == null || state.amt === '') state.amt = SESSION_SWAP.amt;
  if (state.ri == null) {
    const i = routes.findIndex(r => (r.sym || '').toUpperCase() === 'USDC' && (r.chain || '') === 'base');
    state.ri = i >= 0 ? i : 1;
  }
  const syncReady = () => { state.charterReady = !!(hooks.charterReady && hooks.charterReady()); };
  const localPaint = () => {
    syncReady();
    root.innerHTML = ferryMarkup(state, routes);
    bind();
    bindTokenFallbacks(root);
  };
  const paint = () => {
    if (hooks.repaint) hooks.repaint();
    else localPaint();
  };
  const bind = () => {
    syncReady();
    root.querySelectorAll('[data-tab]').forEach(btn => {
      btn.onclick = () => { state.tab = btn.dataset.tab || 'swap'; localPaint(); };
    });
    root.querySelectorAll('[data-route]').forEach(btn => {
      btn.onclick = () => {
        state.ri = routes.findIndex(r => r.id === btn.dataset.route);
        const r = routes[state.ri];
        state.amt = r?.amt;
        state.fromId = r ? `${r.sym || parseRouteFrom(r.from).sym}|${r.chain || parseRouteFrom(r.from).chain}` : state.fromId;
        state.toId = 'ZEC|zec';
        state.q = null;
        state.quoteError = '';
        state.charterNote = ''; state.renewSetup = false;
        state.acted = false;
        state.sample = false;
        state.tab = 'swap';
        emitPair('jetty');
        paint();
      };
    });
    const emitPair = (order = 'jetty') => {
      if (typeof hooks.onPair !== 'function') return;
      const from = idToFrom(state.fromId);
      const to = idToFrom(state.toId);
      const [fs, fc] = String(state.fromId || '').split('|');
      const [ts, tc] = String(state.toId || '').split('|');
      hooks.onPair({ from, to, amt: state.amt, fromSym: fs, fromChain: fc, toSym: ts, toChain: tc, order });
    };
    const clearQuote = () => { state.q = null; state.quoteError = ''; state.charterNote = ''; state.renewSetup = false; state.acted = false; state.sample = false; };
    const onFrom = (value) => {
      state.fromEdited = true;
      state.fromId = value;
      if (!state.amtEdited) state.amt = defaultAmtFor((value || '').split('|')[0]);
      clearQuote();
      emitPair('jetty');
      localPaint();
    };
    const onTo = (value) => {
      state.toEdited = true;
      state.toId = value;
      clearQuote();
      emitPair('jetty');
      localPaint();
    };
    const swapBox = (sel, html) => {
      const el = q$(root, sel);
      if (!el) return null;
      const wrap = document.createElement('div');
      wrap.innerHTML = html;
      const next = wrap.firstElementChild;
      if (!next) return el;
      el.replaceWith(next);
      return next;
    };
    const refill = () => {
      const keepFrom = state.fromId || q$(root, '#f-from')?.dataset.value || '';
      const keepTo = state.toId || q$(root, '#f-to')?.dataset.value || '';
      const from = swapBox('#f-from', pickerListbox({
        id: 'f-from', testid: 'ferry-from',
        options: tokenOpts(state.choices || [], { q: state.tq || '', chain: state.chainFilter || '', selected: keepFrom }),
        selected: keepFrom,
      }));
      const to = swapBox('#f-to', pickerListbox({
        id: 'f-to', testid: 'ferry-to',
        options: tokenOpts(state.choices || [], { q: state.tq || '', chain: '', selected: keepTo }),
        selected: keepTo,
      }));
      const fromOptions = tokenOpts(state.choices || [], { q: state.tq || '', chain: state.chainFilter || '', selected: keepFrom });
      if (fromOptions.some(o => o.value === keepFrom)) state.fromId = keepFrom;
      else if (from?.dataset.value) state.fromId = from.dataset.value;
      const toOptions = tokenOpts(state.choices || [], { q: state.tq || '', chain: '', selected: keepTo });
      if (toOptions.some(o => o.value === keepTo)) state.toId = keepTo;
      else {
        const z = toOptions.find(o => String(o.value).startsWith('ZEC|'));
        state.toId = z ? z.value : (to?.dataset.value || keepTo);
      }
      if (from) bindPickerListbox(from, onFrom);
      if (to) bindPickerListbox(to, onTo);
      const note = q$(root, '[data-testid=ferry-token-count]');
      if (note && state.choices?.length) { note.hidden = false; note.textContent = `${state.choices.length} live`; }
      const sym = q$(root, '#f-sym');
      if (sym && state.fromId) sym.textContent = state.fromId.split('|')[0] || '';
      bindTokenFallbacks(root);
    };
    const chain = q$(root, '#f-chain');
    if (chain) bindPickerListbox(chain, (value) => { state.chainFilter = value; refill(); });
    const find = q$(root, '#f-find');
    if (find) find.oninput = (e) => { state.tq = e.target.value; refill(); };
    const from = q$(root, '#f-from');
    if (from) bindPickerListbox(from, onFrom);
    const to = q$(root, '#f-to');
    if (to) bindPickerListbox(to, onTo);
    const amt = q$(root, '#f-amt');
    if (amt) amt.oninput = (e) => { state.amt = e.target.value; state.amtEdited = true; state.q = null; state.quoteError = ''; state.charterNote = ''; state.renewSetup = false; state.acted = false; state.sample = false; };
    // The reference has a Max chip inside the From box. It fills the amount from the balance the
    // panel already reads; when no balance is known it says so instead of inventing a number.
    const maxBtn = q$(root, '#f-max');
    if (maxBtn) maxBtn.onclick = () => {
      const bal = String(state.fromBal || '').replace(/[^0-9.]/g, '');
      if (!bal) { state.charterNote = 'No balance read yet. Sign in and this fills itself.'; paint(); return; }
      state.amt = bal; state.amtEdited = true; state.q = null; state.quoteError = ''; state.acted = false; state.sample = false;
      paint();
    };
    // The circular swap-direction control between the two cards. Same as choosing the other side.
    const flip = q$(root, '#f-flip');
    if (flip) flip.onclick = () => {
      const a = state.fromId || '', b = state.toId || '';
      if (!a || !b) return;
      state.fromId = b; state.toId = a;
      state.q = null; state.quoteError = ''; state.acted = false; state.sample = false;
      paint();
    };
    const recv = q$(root, '#f-receive');
    if (recv) recv.oninput = (e) => {
      const pos = e.target.selectionStart;
      state.receiveAt = e.target.value;
      state.q = null;
      state.quoteError = '';
      state.charterNote = '';
      state.renewSetup = false;
      state.acted = false;
      state.sample = false;
      paint();
      const again = q$(root, '#f-receive');
      if (again) { again.focus(); try { again.setSelectionRange(pos, pos); } catch { /* number-less */ } }
    };
    const compare = q$(root, '#f-compare');
    if (compare) compare.onclick = () => runQuotes(compare);
    const one = q$(root, '#f-quote');
    if (one) one.onclick = () => runOne(one);
    const cargo = q$(root, '#f-cargo');
    if (cargo) cargo.onclick = () => hooks.onLoadCargo && hooks.onLoadCargo({ charter: false });
    const charter = q$(root, '#f-charter');
    if (charter) charter.onclick = () => hooks.onLoadCargo && hooks.onLoadCargo({ charter: true });
    const again = q$(root, '#f-again');
    if (again) again.onclick = () => hooks.onAgain && hooks.onAgain();
    const openRules = q$(root, '#f-open-rules');
    if (openRules) openRules.onclick = () => hooks.openRules && hooks.openRules();
    // Dock lives outside the tray. Re-arm on every bind so a later paint cannot leave Send as a no-op.
    const dockDoc = typeof document !== 'undefined' ? document : null;
    const agentIn = q$(root, '#f-agent') || dockDoc?.getElementById('f-agent');
    if (agentIn) {
      agentIn.oninput = (e) => { state.agentText = e.target.value; };
      agentIn.onkeydown = (e) => { if (e.key === 'Enter' || e.code === 'Enter' || e.keyCode === 13) { e.preventDefault(); dispatchFerryDock(dockDoc); } };
    }
    armFerryDock((text) => runAgent(text));
    if (dockDoc) installFerryDock(dockDoc);
    const agentGo = q$(root, '#f-agent-go') || dockDoc?.getElementById('f-agent-go');
    if (agentGo) agentGo.onclick = (e) => { e.preventDefault(); dispatchFerryDock(dockDoc); };
  };
  function agentLog(text, links) {
    state.agentHint = text || '';
    const el = document.getElementById('f-agent-log');
    if (!el) return;
    el.hidden = !text;
    const extraLinks = (links || []).map(l => `<a class="tx" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join(' ');
    if (extraLinks) el.innerHTML = `${esc(text || '')} ${extraLinks}`;
    else el.textContent = text || '';
  }
  function clearSeal() { hooks.hideRefuse?.(); hooks.setOrder?.('jetty'); }
  async function runAgent(text) {
    const line = String(typeof text === 'string' ? text : (state.agentText || '')).trim();
    state.agentText = line;
    clearSeal();
    const result = await runFerryAgent({
      text: line,
      state,
      charterReady: !!(hooks.charterReady && hooks.charterReady()),
      quotePair: (from, to, amt, receiveAt) => {
        if (hooks.quotePair) return hooks.quotePair(from, to, amt, receiveAt);
        const originChain = String(from).split('@')[1] || '';
        const visitor = hooks.visitor?.() || hooks.state?.me;
        const recipient = quotePayee(to, visitor, receiveAt);
        if (!recipient) return Promise.resolve({ ok: false, error: 'Enter the address on the destination chain that should receive the tokens.' });
        return fetch(api() + '/api/ferry/quote', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ from, to, amount: String(amt || SESSION_SWAP.amt), recipient, refundTo: refundForChain(originChain, visitor), privacy: 'basic' }),
        }).then(r => r.json());
      },
      onNote: (text) => agentLog(text),
      onPair: hooks.onPair,
      onLoadCargo: (opts) => hooks.onLoadCargo && hooks.onLoadCargo(opts),
      onSeal: clearSeal,
    });
    if (!result?.ok) clearSeal();
    if (result?.ok) state.agentText = '';
    agentLog(result?.hint || (result?.ok ? '' : 'That line did not run.'), result?.links);
    state.tab = 'swap';
    if (!result?.loaded) paint();
    return result;
  }
  async function ensureTokens() {
    if (state.choices?.length || state.tokensTried) return;
    state.tokensTried = true;
    try {
      const rows = hooks.tokens ? await hooks.tokens() : await fetch(api() + '/api/ferry/tokens').then(r => r.json());
      state.choices = tokenChoices(Array.isArray(rows) ? rows : rows?.tokens || []);
      const fromUntouched = !state.fromEdited && (!state.fromId || state.fromId === 'USDC|base' || state.fromId === SESSION_SWAP.fromId);
      if (fromUntouched) {
        const pref = state.choices.find(t => t.id === SESSION_SWAP.fromId)
          || state.choices.find(t => String(t.symbol).toUpperCase() === 'WNEAR' && t.chain === 'near');
        if (pref) {
          state.fromId = pref.id;
          if (!state.amtEdited) state.amt = SESSION_SWAP.amt;
        }
      } else if (!state.amtEdited && (state.amt == null || state.amt === '')) {
        state.amt = defaultAmtFor((state.fromId || '').split('|')[0]);
      }
      const toUntouched = !state.toEdited && (!state.toId || state.toId === 'ZEC|zec' || state.toId === SESSION_SWAP.toId);
      if (toUntouched) {
        const usdc = state.choices.find(t => t.id === SESSION_SWAP.toId);
        if (usdc) state.toId = usdc.id;
      }
      if (!state.choices.some(t => t.id === state.toId)) {
        const usdc = state.choices.find(t => t.id === SESSION_SWAP.toId);
        const z = usdc || state.choices.find(t => t.symbol === 'ZEC') || { id: SESSION_SWAP.toId };
        state.toId = z.id;
      }
    } catch {
      state.tokensError = true;
      state.choices = [];
    }
    paint();
  }
  async function runOne(btn) {
    hooks.hideRefuse?.();
    hooks.setOrder?.('jetty');
    const from = idToFrom(state.fromId) || routes[state.ri || 0]?.from;
    const to = idToFrom(state.toId) || SESSION_SWAP.to;
    if (!from) return;
    const toChain = String(to).split('@')[1] || '';
    if (toChain && toChain !== 'near' && !validateDestAddress(toChain, state.receiveAt).ok) {
      state.quoteError = 'Enter the address on the destination chain that should receive the tokens.';
      state.q = null;
      paint();
      return;
    }
    holdButton(btn, 'Asking for a live quote.');
    const originChain = from.split('@')[1] || '';
    let q;
    try {
      if (hooks.quotePair) q = await hooks.quotePair(from, to, state.amt || defaultAmtFor(from.split('@')[0]), state.receiveAt || '');
      else if (hooks.quote && from === routes[state.ri || 0]?.from && toChain === 'zec') q = await hooks.quote(routes[state.ri || 0].id, state.amt || routes[state.ri || 0].amt);
      else {
        const visitor = hooks.visitor?.() || state.me;
        const recipient = quotePayee(to, visitor, state.receiveAt);
        if (!recipient) {
          q = { ok: false, error: 'Enter the address on the destination chain that should receive the tokens.' };
        } else {
          const res = await fetch(api() + '/api/ferry/quote', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ from, to, amount: String(state.amt || defaultAmtFor(from.split('@')[0])), recipient, refundTo: refundForChain(originChain, visitor), privacy: 'basic' }),
          });
          q = await res.json();
        }
      }
    } catch (e) {
      q = { ok: false, error: e?.message || 'quote failed', from: { symbol: from.split('@')[0], chain: originChain, amount: state.amt }, to: { symbol: to.split('@')[0], chain: to.split('@')[1] }, dry: true };
    }
    const failed = q && (q.ok === false || q.error) && !(q.to?.amount || q.amountOut);
    state.quoteError = failed ? explainQuoteMiss(q.error || q.refused || '') : '';
    hooks.hideRefuse?.();
    const line = failed ? null : quoteLine(q);
    state.quotes = line ? pickBest([{ ...line, symbolIn: line.symbolIn || from.split('@')[0], chainIn: line.chainIn || from.split('@')[1], symbolOut: line.symbolOut || to.split('@')[0], chainOut: line.chainOut || to.split('@')[1] }]) : [];
    state.sample = !failed && !state.quotes.some(v => v.amountOut != null);
    state.fstatus = null;
    state.quoted = true;
    state.charterNote = ''; state.renewSetup = false;
    state.acted = false;
    state.q = failed ? null : q;
    state.tab = 'swap';
    if (!failed && hooks.onPair) {
      const [fs, fc] = String(state.fromId || from.replace('@', '|')).split('|');
      const [ts, tc] = String(state.toId || to.replace('@', '|')).split('|');
      hooks.onPair({
        from, to, amt: state.amt || defaultAmtFor(from.split('@')[0]),
        fromSym: fs || from.split('@')[0], fromChain: fc || from.split('@')[1],
        toSym: ts || to.split('@')[0], toChain: tc || to.split('@')[1],
        receiveAt: state.receiveAt || '',
        outAmt: q.to?.amount || q.amountOut || '',
        order: 'quoted',
      });
    }
    if (state.agentText) state.agentHint = failed
      ? state.quoteError
      : 'Quote ready. Ask charter or Load cargo.';
    paint();
  }
  async function runQuotes(btn) {
    holdButton(btn, 'Comparing routes. Waiting for the quotes.');
    const raw = [];
    for (const r of routes) {
      try { raw.push(await quoteOne(r, state.amtEdited ? state.amt : r.amt, hooks, state.receiveAt)); }
      catch { raw.push({ label: r.label, from: { amount: state.amt || r.amt, symbol: r.sym, chain: r.chain }, to: { symbol: 'ZEC', chain: 'zec' }, dry: true }); }
    }
    const lines = raw.map((q, i) => {
      const line = quoteLine(q) || { text: routes[i].label, usd: null };
      return { id: routes[i].id, text: line.text, usdText: usdOf(line), usd: line.usd, best: false };
    });
    const enriched = raw.map((q, i) => {
      const line = quoteLine(q);
      if (!line) return null;
      const r = routes[i] || {};
      const meta = routeMeta(r);
      return {
        ...line,
        symbolIn: line.symbolIn || meta.sym || r.sym || '',
        chainIn: line.chainIn || meta.chain || r.chain || '',
        symbolOut: line.symbolOut || 'ZEC',
        chainOut: line.chainOut || 'zec',
        amountIn: line.amountIn ?? (state.amtEdited ? state.amt : r.amt),
      };
    }).filter(Boolean);
    const ranked = pickBest(enriched);
    state.quotes = ranked;
    state.lines = lines.map(l => ({ ...l, best: ranked.find(v => v.text === l.text)?.best }));
    state.sample = !ranked.some(v => v.amountOut != null);
    state.fstatus = null;
    state.quoted = true;
    state.tab = 'routes';
    paint();
  }
  // Exposed for the dock listener. armFerryDock in bind() is the live registration.
  hooks.runAgent = (text) => runAgent(text);
  hooks.localPaint = localPaint;
  syncReady();
  localPaint();
  ensureTokens();
  if (hooks.auto && !state.quoted) runQuotes(q$(root, '#f-compare'));
}

function mountGuard(root, hooks) {
  if (root?.ownerDocument?.body) root.ownerDocument.body.classList.add('guard-tray');
  // The city tray derives the example from the visitor's own account. This route mounts the
  // same tray without the city's hooks, so without this the example button could never fill
  // the field: it asked for a session it was never given. Same rule, same source, no fixed name.
  // The tray publishes runAgent and trayCtx on the hooks object it is given, and the city dock
  // reads them back from the SAME object. A copy here hid both from the dock, so a typed
  // "Check cafe.near" reached runGuardAction with no check and answered "The check is not wired."
  const h = hooks || {};
  if (typeof h.injected !== 'function') {
    h.injected = () => {
      const me = visitor().accountId;
      return me ? lookalike(me) : '';
    };
  }
  return mountGuardTray(root, h, { esc, holdButton, api, q$ });
}

function mountToll(root, hooks) {
  return mountTollRoom(root, hooks || {}, { api: api() });
}

function mountChronicle(root, hooks) {
  return mountChronicleTray(root, hooks);
}

function mountArena(root, hooks) {
  document.body?.classList.add('arena-tray');
  // The live attack line keeps data-testid="arena-attack".
  const attackAttr = 'data-testid="arena-attack"';
  const boxAttr = 'class="attack-box" rows="6"';
  mountArenaTray(root, hooks, attackAttr, boxAttr);
  import('../../design/D8_shops/shops/arenalive.js').then(m => m.bindRedteam(() => mountArena(root, hooks))).catch(() => {});
}

function teeSlot(recorded, proof) {
  const steps = TEE_PLAN.map(([id, label]) => `<li data-testid="tee-step" data-step="${esc(id)}" data-ok=""><b>${esc(label)}</b> <span class="tee-why">Waiting</span></li>`).join('');
  return `<div class="tee-slot" data-testid="tee-slot"><button type="button" class="primary" id="m-tee" data-testid="tee-verify">Verify the TEE now</button><ol class="tee-steps" data-testid="tee-steps">${steps}</ol><p data-testid="tee-live" class="tee-line"></p><p data-testid="tee-result" class="tee-line"></p><p data-testid="tee-fail" class="tee-line"></p>${recorded}${proof}</div>`;
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

// Mist Bank tray, dock, and attestation live in bank-tray.js.
// data-testid="bank-session" is rendered there.
function mountBank(root, hooks) {
  return mountBankRoom(root, hooks);
}

function mountHouse(root, hooks = {}) {
  return mountHouseRoom(root, hooks);
}

const ALIAS = { guardhouse: 'guard', townhall: 'hall', mist: 'bank', mistbank: 'bank' };

export function mountShop(id, root, hooks = {}) {
  if (!root) return;
  const key = ALIAS[id] || id;
  const fn = {
    ferry: mountFerry,
    guard: mountGuard,
    toll: mountToll,
    chronicle: mountChronicle,
    arena: mountArena,
    payouts: mountPayouts,
    bank: mountBank,
    house: mountHouse,
    hall: (el, h) => import('./hall-ui.js').then(m => m.mountHall(el, h)).catch(e => { el.innerHTML = boundaryHtml(e); }),
  }[key];
  try {
    if (!fn) { root.innerHTML = boundaryHtml(new Error('This shop is not on the page.')); return; }
    return fn(root, hooks);
  } catch (e) {
    root.innerHTML = boundaryHtml(e);
  }
}
