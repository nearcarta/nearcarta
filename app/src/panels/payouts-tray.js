// Payouts tray. Same card as the Ferry: tabs, icon flow, labelled fields, one gold button.
// The gold button and the agent call the same functions. Nothing here signs.
import { API_PATH, txUrl } from '../../../shared/net/net.js';
import { PAY_ASSETS, PAY_CHAINS, addPayoutRow, formatNear, parseCsv, prepareRows, receiptsFor, splitAssets } from '../../design/D8_shops/js/payouts.js';
import { downloadCsv } from '../chronicle-feed.js';
import { payoutFlow } from './payout-marks.js';
import { qrSvg } from './qr-svg.js';
import {
  accountantCsv, agentCommand, agentInvoiceReply, classifyPayroll, csvReconcile, invoiceDoneLine, invoiceStatusLine, memoFromWords, nearFromYocto, payrollFeeUsd,
  payrollKey, payrollQuote, relativeInvoiceDates, rowsForCommand, sponsorshipPlan,
} from './payouts-plan.js';
import { armPayoutsDock, ensurePayoutsDock } from './payouts-dock.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const api = () => (globalThis.NEARCARTA_API || '').replace(/\/$/, '');
const q$ = (root, sel) => root.querySelector(sel);
function expiryIso(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toISOString();
}

const CHAINS = PAY_CHAINS;
const ASSETS = PAY_ASSETS;
const chainName = id => (PAY_CHAINS.find(([k]) => k === String(id || '').toLowerCase()) || [id, id])[1];

function fixtureOf() {
  try {
    const q = new URLSearchParams(globalThis.location?.search || '').get('payoutFixture');
    return ['empty', 'error', 'refused', 'held', 'paid'].includes(q) ? q : '';
  } catch { return ''; }
}

export function mountPayouts(root, hooks) {
  const state = hooks.state || (hooks.state = {});
  if (!state.rows) state.rows = [];
  if (!state.tab) state.tab = 'invoice';
  if (!state.settled) state.settled = {};
  if (!state.quotes) state.quotes = {};
  if (state.invoiceUsd == null) state.invoiceUsd = '';
  if (state.due == null || state.expiry == null) {
    const rel = relativeInvoiceDates();
    if (state.due == null) state.due = rel.due;
    if (state.expiry == null) state.expiry = rel.expiry;
  }
  if (!state.invoices) state.invoices = [];
  const fix = fixtureOf();
  if (fix && !state.fixtureApplied) {
    state.fixtureApplied = true;
    state.tab = fix === 'empty' || fix === 'error' ? 'invoice' : 'payroll';
    state.fixture = fix;
    state.line = 'Fixture. Not a live payment.';
    if (fix === 'error') state.line2 = 'The invoice was not created.';
    if (fix === 'refused') {
      state.rows = [{ to: 'cafe.near', amt: '1', asset: 'NEAR', chain: 'near' }];
      state.line2 = 'Refused before any deposit.';
      state.seal = state.line2;
    }
    if (fix === 'held') {
      state.rows = [{ to: '0x' + 'ab'.repeat(20), amt: '0.15', asset: 'USDC', chain: 'base' }];
      state.line2 = 'Held. The foreign amount is not checked on the live board.';
    }
    if (fix === 'paid') state.line2 = 'Labelled sample. Paid only after 1Click SUCCESS.';
    if (fix === 'refused' || fix === 'held' || fix === 'paid') {
      state.payLine = state.line;
      state.payLine2 = state.line2;
    }
  }
  const liveCap = () => {
    const fromHook = hooks.capNear ? hooks.capNear() : null;
    if (fromHook != null && fromHook !== '') return Number(fromHook);
    return state.capNear == null ? null : Number(state.capNear);
  };
  const clearSeal = () => { if (state.fixture) return; state.seal = ''; hooks.hideRefuse?.(); };
  const showSeal = (text) => { state.seal = text || ''; if (text) hooks.showRefuse?.(text); else hooks.hideRefuse?.(); };
  const accountId = () => (hooks.account ? hooks.account() : '') || '';
  function visitorId() {
    const acct = String(accountId() || '').trim();
    if (acct) return acct;
    try {
      const k = 'nearcarta-payout-visitor';
      let id = globalThis.localStorage?.getItem(k) || '';
      if (!id) {
        id = 'guest-' + (globalThis.crypto?.randomUUID?.() || Math.random().toString(16).slice(2));
        globalThis.localStorage?.setItem(k, id);
      }
      return id;
    } catch { return ''; }
  }
  const lines = (a = state.line, b = state.line2) => `<div class="payout-status" data-testid="payout-status"><p class="ferry-rate" data-testid="payout-line">${esc(a || '')}</p><p class="payout-calm" data-testid="payout-line-2">${esc(b || '')}</p></div>`;
  /**
   * The bounded storage sponsorship, when the receive account cannot hold USDC yet.
   * The deposit is the contract's own minimum and is paid from this visitor's own session cap,
   * through the same board propose_call as every other payment. It is never the shop's money.
   */
  function sponsorCard() {
    const sp = state.sponsor;
    if (!sp || !state.invoice || state.tab !== 'invoice') return '';
    if (sp.registered === true && !state.sponsorDone) return '';
    if (sp.call && !state.sponsorDone) {
      return `<div class="payout-result" data-testid="payout-sponsor">
        <p class="payout-calm">${esc(sp.text || '')}</p>
        <button type="button" id="p-sponsor" data-testid="payout-sponsor-go">Register ${esc(sp.account)} for USDC</button>
      </div>`;
    }
    if (sp.reason === 'already_registered' || sp.registered === true) return '';
    if (sp.reason || state.sponsorDone) {
      const text = state.sponsorNote || (state.sponsorDone ? `Registered ${sp.account} for USDC. ${formatNear(sp.depositNear)} NEAR came from your session cap.` : '');
      return text ? `<div class="payout-result" data-testid="payout-sponsor"><p class="payout-calm">${esc(text)}</p></div>` : '';
    }
    return '';
  }

  async function sponsorNow() {
    const sp = state.sponsor;
    if (!sp?.call) return { ok: false, hint: 'Nothing to register.' };
    if (typeof hooks.onSponsor !== 'function') {
      state.sponsorNote = 'Open the city to register this account. Nothing was sent.';
      render();
      return { ok: false, hint: state.sponsorNote };
    }
    state.sponsorNote = 'Registering. A wallet may open once.';
    render();
    const out = await hooks.onSponsor({ account: sp.account, depositNear: sp.depositNear, call: sp.call }, { capNear: liveCap() });
    if (out?.ok && out.tx) {
      state.sponsorDone = true;
      state.sponsorNote = `Registered ${sp.account} for USDC. ${formatNear(sp.depositNear)} NEAR came from your session cap.`;
      state.sponsorUrl = txUrl(out.tx);
      lookUpRegistration(sp.account);
    } else if (/method_not_allowlisted/i.test(String(out?.reason || ''))) {
      state.sponsorNote = 'Your row does not allow storage_deposit yet. Open /setup and press Update my rules once. Nothing was sent.';
    } else {
      state.sponsorNote = out?.reason === 'over_per_action_cap'
        ? 'That storage is above your /setup cap. Nothing was sent.'
        : (out?.reason ? `Not registered: ${String(out.reason).slice(0, 120)}. Nothing was sent.` : 'Not registered. Nothing was sent.');
    }
    render();
    return out || { ok: false, hint: state.sponsorNote };
  }

  function resultCard() {
    const inv = state.invoice;
    const url = state.payUrl;
    if (!inv || !url || state.tab !== 'invoice') return '';
    let qr = '';
    try { qr = qrSvg(url); } catch { qr = ''; }
    return `<div class="payout-result" data-testid="payout-result">
      <p class="payout-facts">${esc(inv.id)} · ${esc(inv.usd)} USDC · ${esc(inv.receive)}${state.expiry ? ` · expires ${esc(String(state.expiry).replace('T', ' '))}` : ''}</p>
      <p class="payout-link"><a href="${esc(url)}" data-testid="payout-link">${esc(url)}</a></p>
      <button type="button" id="p-copy" data-testid="payout-copy">Copy link</button>
      <div class="payout-qr" data-testid="payout-qr">${qr}</div>
      <p class="payout-calm">Creating an invoice signs nothing.</p>
      <!-- The invoice lives in this host's file, and a new host starts empty. Anchoring its
           digest on the board writes an event with no trie bytes, so the commitment survives a
           restart and a payer can check that the link was not edited. Opt-in, because it is a
           transaction. -->
      <div class="payout-anchor">
        <button type="button" id="p-anchor" data-testid="payout-anchor"${state.anchored || state.anchorBlocked ? ' disabled' : ''}>${state.anchored ? 'Anchored on chain' : (state.anchorBlocked ? 'Anchoring waits for the board upgrade' : 'Anchor this invoice on chain')}</button>
        <p class="payout-calm" data-testid="payout-anchor-note">${state.anchorBlocked
          ? esc(state.anchorBlocked)
          : state.anchored
          ? `Anchored. tx ${esc(String(state.anchored).slice(0, 10))}… Anyone can read the commitment back from the board.`
          : 'This host keeps the invoice in a file, so a new host starts empty. Anchoring writes its digest on chain: the link then has a public record that does not depend on this server.'}</p>
      </div>
    </div>`;
  }

  async function loadCap() {
    if (state.capLoaded || liveCap() != null || state.fixture) return;
    const id = accountId();
    if (!id) return;
    state.capLoaded = true;
    try {
      const body = await fetch(api() + API_PATH + '/board/row/' + encodeURIComponent(id) + '?fresh=1').then(r => r.json());
      const y = body?.row?.per_action_cap;
      if (y != null && y !== '') state.capNear = nearFromYocto(y);
      const per = Number(body?.row?.max_actions_per_day);
      if (Number.isFinite(per) && per > 0) state.maxActions = per;
    } catch { /* the cap line stays unread */ }
    if (root.isConnected && state.tab === 'payroll') render();
  }

  function capSentence() {
    const cap = liveCap();
    if (cap == null || !Number.isFinite(cap)) {
      return accountId()
        ? 'Your board cap is unread. Open /setup, then come back — a NEAR payroll waits on that cap.'
        : 'Sign in to set your spend limit. Invoice links still work without signing in.';
    }
    return `Your board cap: ${formatNear(cap)} NEAR per payment (from /setup).`;
  }

  function receiptHtml(list) {
    return (list || []).map(r => {
      // The reason the board gave, when there is one. A row that just says "refused" tells the
      // visitor nothing about what to change.
      const tail = r.payoutText || (r.status === 'refused' && r.reason ? `refused: ${r.reason}` : r.status) || (r.tx ? 'sent' : 'not sent');
      const chain = r.chain && r.chain !== 'near' ? ` on ${esc(chainName(r.chain))}` : '';
      const fee = r.feeUsd === '' || r.feeUsd == null ? '' : ` · fee about ${esc(r.feeUsd)} USD`;
      const near = r.chain !== 'near' && r.near ? ` · ${esc(formatNear(r.near))} NEAR deposit` : '';
      const link = r.url ? ` <a href="${esc(r.url)}">Receipt</a>` : '';
      return `<li data-testid="payout-receipt">${esc(r.to)} ${esc(r.amount)} ${esc(r.asset)}${chain}${near}${fee} · ${esc(tail)}${link}</li>`;
    }).join('');
  }

  /** One receipt row per planned row, carrying the chain, the fee the route quoted and the refund address. */
  function rowsFromPlan(plan) {
    const refundTo = accountId() || '';
    return plan.rows.map((r, i) => {
      const fee = r.quote ? payrollFeeUsd({ inUsd: r.quote.nearUsd, outUsd: r.quote.outUsd }) : '';
      const status = r.send ? 'not sent' : r.action === 'refused' ? 'refused'
        : r.action === 'quote' ? 'needs a quote' : r.action === 'held' || r.action === 'hold' ? 'held' : 'not sent';
      return {
        n: i + 1,
        to: r.to,
        amount: r.amt,
        asset: r.asset,
        chain: r.chain,
        source: 'near',
        destination: r.to,
        feeUsd: fee == null ? '' : fee,
        refund: r.chain === 'near' ? '' : refundTo,
        near: r.near ?? (r.chain === 'near' ? r.amt : ''),
        status,
        tx: '',
        quote: r.quote || null,
      };
    });
  }

  /** A row's price belongs to its payee, amount, asset and chain, so editing it drops every cached quote. */
  const dropQuote = () => { state.quotes = {}; };

  /** Price every foreign row through the dry 1Click quote. A row stays out of the send list until it has one. */
  async function priceForeign(rows) {
    const parts = splitAssets(rows);
    const out = {};
    for (const r of parts.usdc) {
      const key = payrollKey(r);
      if (state.quotes[key] && state.quotes[key].ok) { out[key] = state.quotes[key]; continue; }
      try {
        const body = await fetch(api() + API_PATH + '/payouts/payroll/quote', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ to: r.to, amt: String(r.amt), asset: r.asset, chain: r.chain }),
        }).then(x => x.json());
        if (body?.ok && body.quote) {
          out[key] = payrollQuote(r, { quote: { amountInFormatted: body.quote.near, amountOutFormatted: body.quote.out, amountOutUsd: body.quote.outUsd, timeEstimate: body.quote.minutes, deadline: body.quote.deadline }, correlationId: body.quote.correlationId });
          out[key].nearUsd = body.quote.nearUsd;
        } else {
          out[key] = { key, ok: false, reason: body?.reason || 'quote_refused', error: body?.error || '' };
        }
      } catch { out[key] = { key, ok: false, reason: 'quote_unread' }; }
    }
    state.quotes = { ...state.quotes, ...out };
    return state.quotes;
  }

  /**
   * Review the rows. A foreign row is priced first (dry 1Click quote), because its NEAR cost is what
   * the visitor's cap has to hold. Nothing is sent: this only builds the receipt list and the plan.
   */
  async function prepareNow() {
    if (state.fixture) return { ok: false, hint: 'Fixture. Not a live payment.' };
    clearSeal();
    const parsed = parseCsv(state.csv || q$(root, '#p-csv')?.value || '');
    const use = parsed.length ? parsed : state.rows;
    const prep = prepareRows(use);
    if (prep.blocked) {
      state.receipts = [];
      state.usdcNote = '';
      state.dropNote = prep.note;
      render();
      return { ok: true, hint: prep.note || 'A row needs a payee. Nothing was prepared.' };
    }
    if (parsed.length) state.rows = prep.rows;
    state.reviewed = true;
    state.payLine = 'Pricing the foreign rows. Nothing is sent.';
    state.payLine2 = '';
    render();
    const quotes = await priceForeign(prep.rows);
    const plan = classifyPayroll(prep.rows, { capNear: liveCap(), quotes });
    state.plan = plan;
    state.receipts = rowsFromPlan(plan);
    state.usdcNote = plan.needsQuote.length ? 'A foreign row needs a quote before it can be paid.' : '';
    state.dropNote = prep.note || '';
    // A review says how many rows are ready and how many the visitor's own limits refuse. It never
    // turns one refused row into "all refused", and never calls a reviewed row sent.
    const ready = plan.send.length, refused = plan.refused.length;
    const parts = [];
    if (ready) parts.push(`${ready} ${ready === 1 ? 'row is' : 'rows are'} ready.`);
    if (refused) parts.push(`${refused} ${refused === 1 ? 'row is' : 'rows are'} refused before any deposit.`);
    state.payLine = parts.length ? parts.join(' ') : 'Reviewed. Nothing was sent.';
    state.payLine2 = state.usdcNote || '';
    render();
    return { ok: true, hint: 'Prepared. Nothing was sent.' };
  }

  /** The row's own NEAR cost: a NEAR row pays its amount, a foreign row pays the wNEAR its quote names. */
  const costOf = r => (r.chain === 'near' ? Number(r.amt) : Number(r.quote?.near));

  /** What a session needs for one foreign row after the quote returns a deposit address. */
  async function payForeignRow(r, cap) {
    const body = await fetch(api() + API_PATH + '/payouts/payroll/checkout', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        owner: accountId(), to: r.to, amt: String(r.amt), asset: r.asset, chain: r.chain,
        near: Number(r.quote?.near), refundTo: accountId(), slippage: r.quote?.slippage || 100,
      }),
    }).then(x => x.json()).catch(() => null);
    if (!body?.ok || !body.depositAddress) {
      return { ok: false, reason: body?.reason || 'quote_refused', error: body?.error || '', depositAddress: null };
    }
    return { ok: true, depositAddress: body.depositAddress, depositMemo: body.depositMemo || null, near: Number(body.near) };
  }

  async function payReviewed(list) {
    if (state.fixture) return { ok: false, hint: 'Fixture. Not a live payment.' };
    clearSeal();
    const prep = prepareRows(list);
    if (prep.blocked) {
      state.dropNote = prep.note;
      render();
      return { ok: false, hint: prep.note || 'A row needs a payee. Nothing was sent.' };
    }
    const cap = liveCap();
    const quotes = await priceForeign(prep.rows);
    const plan = classifyPayroll(prep.rows, { capNear: cap, quotes });
    state.plan = plan;
    const fresh = plan.send.filter(r => !state.settled[payrollKey(r)]);
    const replayed = plan.send.filter(r => state.settled[payrollKey(r)]);
    state.receipts = rowsFromPlan(plan);
    for (const r of replayed) {
      const hit = state.receipts.find(x => x.to === r.to && String(x.amount) === String(r.amt) && x.chain === r.chain);
      if (hit) { hit.status = 'sent'; hit.tx = state.settled[payrollKey(r)]; hit.url = txUrl(hit.tx); }
    }
    if (!fresh.length) {
      const hint = plan.refused.length ? 'Refused before any deposit. Nothing was sent.'
        : replayed.length ? 'Already sent. Not sent again.'
        : plan.needsQuote.length ? 'A foreign row needs a quote first. Nothing was sent.'
        : plan.held.length ? 'Held. Nothing was sent.'
        : 'Nothing was sent.';
      state.payLine = hint;
      state.payLine2 = '';
      if (plan.refused.length) showSeal(hint);
      state.usdcNote = plan.needsQuote.length ? 'A foreign row needs a quote before it can be paid.' : '';
      render();
      return { ok: replayed.length > 0 && !plan.refused.length, hint, replayed: replayed.length > 0 };
    }
    if (typeof hooks.onPay !== 'function') {
      state.payLine = 'Finish /setup in the city. Nothing was sent.';
      state.payLine2 = '';
      render();
      return { ok: false, hint: state.payLine };
    }
    // A NEAR row is one board propose. A foreign row is the same session, through the 1Click rail:
    // the board's propose_call deposits wNEAR to the deposit address the 1Click quote named.
    const nearRows = fresh.filter(r => r.chain === 'near');
    let nearSteps = [];
    let result = null;
    if (nearRows.length) {
      result = await hooks.onPay(nearRows.map(r => ({ to: r.to, amt: String(r.amt), asset: 'NEAR', chain: 'near' })), { capNear: cap });
      nearSteps = result?.o?.steps || [];
      nearRows.forEach((r, i) => {
        const step = nearSteps[i];
        const row = state.receipts.find(x => x.to === r.to && String(x.amount) === String(r.amt) && x.chain === 'near');
        if (!row) return;
        if (step?.decision === 'allowed' && step.tx) {
          row.status = 'sent'; row.tx = step.tx; row.url = txUrl(step.tx);
          state.settled[payrollKey(r)] = step.tx;
        } else if (step) { row.status = 'refused'; row.reason = step.reason || 'refused'; }
      });
    }
    const foreign = fresh.filter(r => r.chain !== 'near');
    let foreignPaid = 0, foreignSent = 0;
    for (const r of foreign) {
      const row = state.receipts.find(x => x.to === r.to && String(x.amount) === String(r.amt) && x.chain === r.chain);
      const opened = await payForeignRow(r, cap);
      if (!opened.ok) {
        if (row) { row.status = 'refused'; row.reason = opened.reason; row.error = opened.error; }
        continue;
      }
      let sent;
      try {
        sent = await hooks.onForeignPay?.({ ...r, depositAddress: opened.depositAddress, depositMemo: opened.depositMemo, near: opened.near }, { capNear: cap });
      } catch (e) { sent = { ok: false, reason: e?.message || 'the deposit did not go' }; }
      if (sent?.ok && sent.tx) {
        foreignSent += 1;
        if (row) {
          row.status = 'sent'; row.tx = sent.tx; row.url = txUrl(sent.tx);
          row.depositAddress = opened.depositAddress; row.payoutStatus = 'PENDING_DEPOSIT';
          row.payoutText = 'Waiting for the deposit.';
        }
        state.settled[payrollKey(r)] = sent.tx;
        // The rail pays on its own clock: watch the row until 1Click settles or the page closes.
        watchForeignRow(r, opened.depositAddress);
      } else if (row) {
        row.status = 'refused'; row.reason = sent?.reason || 'deposit_refused';
        row.depositAddress = opened.depositAddress;
        // The row's call list is written when the row is opened. An older row has no USDC storage pair
        // and no wrap.near calls, so the board refuses before any deposit. Say exactly that.
        if (/method_not_allowlisted/i.test(String(row.reason))) {
          row.status = 'refused';
          row.payoutText = 'Your row does not allow this call yet. Open /setup and press Update my rules once, then Pay again.';
        }
      }
    }
    const paidRows = state.receipts.filter(x => x.status === 'sent' || x.status === 'paid').length;
    const refusedRows = state.receipts.filter(x => x.status === 'refused').length;
    const leftRows = state.receipts.filter(x => x.status === 'not sent').length;
    const allRefused = refusedRows > 0 && paidRows === 0;
    const cinema = refusedRows === 0 && !plan.needsQuote.length && paidRows > 0 && (nearRows.length ? result?.ok === true : true);
    if (allRefused) showSeal('Refused before any deposit.');
    else if (cinema) { clearSeal(); hooks.onCinema?.({ paid: true, refused: false }); }
    else if (result?.seal) showSeal(result.seal);
    // A partial run says exactly what happened to each group: a refusal is never hidden behind a send,
    // and a sent row is never called paid before 1Click says so.
    const parts = [];
    if (paidRows) parts.push(`Sent ${paidRows} ${paidRows === 1 ? 'row' : 'rows'}.`);
    // The board's own reason, not just "refused": measured 2026-11-08 in the city, a payee that
    // was not on the row showed "refused" with an empty line and no reason anywhere.
    const why = [...new Set(state.receipts.filter(x => x.status === 'refused' && x.reason).map(x => String(x.reason)))].slice(0, 2);
    if (refusedRows) parts.push(`${refusedRows} ${refusedRows === 1 ? 'row was' : 'rows were'} refused before any deposit${why.length ? ` (${why.join(', ')})` : ''}.`);
    if (leftRows) parts.push(`${leftRows} ${leftRows === 1 ? 'row was' : 'rows were'} not sent.`);
    state.payLine = parts.length ? parts.join(' ') + (paidRows ? ' A foreign row is paid when 1Click says SUCCESS.' : '')
      : (result?.hint || 'Reviewed. Nothing was sent.');
    state.payLine2 = '';
    state.usdcNote = plan.needsQuote.length ? 'A foreign row needs a quote before it can be paid.' : '';
    render();
    return { ...(result || {}), ok: cinema, hint: state.payLine, paid: paidRows, refused: refusedRows, foreign: foreignSent };
  }

  /** Poll one foreign row's 1Click status and let the receipt say Paid only on SUCCESS. */
  function watchForeignRow(r, depositAddress) {
    if (!depositAddress) return;
    if (!state.watchers) state.watchers = {};
    const key = payrollKey(r);
    if (state.watchers[key]) return;
    const tick = async () => {
      if (!root.isConnected) { clearInterval(state.watchers[key]); delete state.watchers[key]; return; }
      let st;
      try { st = await fetch(api() + API_PATH + '/payouts/payroll/status?depositAddress=' + encodeURIComponent(depositAddress)).then(x => x.json()); }
      catch { return; }
      const row = (state.receipts || []).find(x => x.to === r.to && String(x.amount) === String(r.amt) && x.chain === r.chain);
      if (row) {
        row.payoutStatus = st?.status || row.payoutStatus;
        row.payoutText = st?.text || row.payoutText;
        if (st?.paid) row.status = 'paid';
        else if (st?.final) row.status = String(st.status || '').toLowerCase();
        else if (st?.status) row.status = 'sent';
        if (root.isConnected && state.tab === 'payroll') render();
      }
      if (st?.final) { clearInterval(state.watchers[key]); delete state.watchers[key]; }
    };
    state.watchers[key] = setInterval(tick, 6000);
    setTimeout(tick, 1200);
  }

  /** The bounded storage sponsorship for the invoice's receive account, when one is needed. */
  /**
   * What it would take to register this receive account for USDC. The route reports the contract's own
   * minimum and whether the account already holds USDC; the row's own cap decides the rest, here, from the
   * same numbers the payment uses. Nothing is sent by looking this up.
   */
  async function lookUpSponsor(account) {
    try {
      const body = await fetch(api() + API_PATH + '/payouts/sponsor?account=' + encodeURIComponent(account)).then(r => r.json());
      const plan = sponsorshipPlan({
        enabled: body?.enabled === true,
        account,
        minNear: body?.minNear,
        capNear: liveCap(),
        registered: body?.registered,
      });
      state.sponsor = {
        account,
        depositNear: plan.depositNear ?? body?.minNear ?? null,
        call: plan.call || null,
        reason: plan.ok ? '' : plan.reason,
        text: plan.text || '',
        registered: body?.registered,
      };
      if (root.isConnected) render();
    } catch { /* the registration line stays */ }
  }


  /**
   * Write the invoice's digest on the board. `anchor` logs an event and stores no trie bytes,
   * so this costs gas only and needs nothing from the row but a valid session key.
   *
   * Why: the invoice itself lives in a file on this host and a new host starts empty, which the
   * API already says out loud. An anchor gives the link a public commitment that survives a
   * restart and lets a payer check the terms were not edited after the fact. It does not make
   * the invoice durable by itself; the digest is what stays.
   */
  async function anchorInvoice() {
    const inv = state.invoice;
    if (!inv || !inv.id) return { ok: false, hint: 'Create an invoice first. Nothing was signed.' };
    if (state.fixture) return { ok: false, hint: 'Fixture. Not a live anchor.' };
    if (typeof hooks.onAnchor !== 'function') {
      state.payLine = 'Finish /setup in the city. Nothing was signed.';
      render();
      return { ok: false, hint: state.payLine };
    }
    const body = [inv.id, inv.usd, inv.receive, inv.memo || '', inv.due || '', inv.expiry || '', inv.destination || ''].join('|');
    state.payLine = 'Anchoring the invoice digest on the board…';
    render();
    let sent;
    try {
      sent = await hooks.onAnchor({ id: inv.id, body, digest: await digestHex(body) });
    } catch (e) {
      sent = { ok: false, hint: String(e?.message || 'The anchor did not go.').slice(0, 160) };
    }
    if (sent?.ok && sent.tx) {
      state.anchored = sent.tx;
      state.payLine = `Anchored. tx ${String(sent.tx).slice(0, 10)}… The board logs this commitment; it stores nothing.`;
    } else {
      state.payLine = sent?.hint || 'The anchor did not go. Nothing was signed.';
    }
    state.payLine2 = '';
    render();
    return { ...sent, ok: !!sent?.ok, hint: state.payLine };
  }

  /** sha256 hex of a UTF-8 string, for the commitment. */
  async function digestHex(text) {
    const bytes = new TextEncoder().encode(text);
    const buf = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function createLink() {
    if (state.fixture) return { ok: false, hint: 'Fixture. Not a live payment.' };
    clearSeal();
    const receive = String(state.receive || accountId() || '').trim();
    const usd = Number(state.invoiceUsd);
    if (!(usd > 0)) {
      state.line = 'Name the invoice amount, for example 0.15 USDC.';
      state.line2 = '';
      render();
      return { ok: false, hint: state.line };
    }
    if (!receive) {
      state.line = 'Type the receive account. Nothing was created.';
      state.line2 = '';
      render();
      return { ok: false, hint: state.line };
    }
    let j;
    try {
      const res = await fetch(api() + API_PATH + '/payouts/invoices', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ usd, receive, memo: state.memo || '', due: state.due || '', expiry: expiryIso(state.expiry), visitor: visitorId() }),
      });
      j = await res.json();
    } catch (e) {
      j = { ok: false, reason: e?.message || 'The invoice did not save.' };
    }
    if (!j?.ok) {
      state.line = j?.reason === 'missing_account' ? 'The invoice was not created.'
        : j?.reason === 'hosted_abuse_ceiling' ? 'Over the hosted abuse ceiling. No link was created.'
        : 'The invoice was not created. Nothing was sent.';
      state.line2 = j?.reason === 'missing_account' ? (j.text || 'That NEAR account does not exist.') : (j?.ceiling?.disclosed || '');
      render();
      return { ok: false, hint: state.line };
    }
    state.invoice = j.invoice;
    const origin = globalThis.location?.origin || '';
    state.payUrl = origin + (j.invoice?.href || '');
    state.line = 'Invoice created. Nothing was signed.';
    state.line2 = 'Checking USDC registration.';
    render();
    lookUpRegistration(receive);
    refreshList();
    lookUpSponsor(receive);
    return { ok: true, hint: invoiceDoneLine(j.invoice, origin) };
  }

  async function refreshList() {
    const visitor = visitorId();
    if (!visitor) { state.invoices = []; return; }
    try {
      const res = await fetch(api() + API_PATH + '/payouts/invoices?visitor=' + encodeURIComponent(visitor));
      const body = await res.json();
      const rows = Array.isArray(body?.invoices) ? body.invoices : [];
      const next = [];
      for (const inv of rows) {
        let listStatus = inv.listStatus || 'Unpaid';
        if (listStatus !== 'Expired') {
          try {
            const st = await fetch(api() + API_PATH + '/payouts/invoices/' + encodeURIComponent(inv.id) + '/status').then(r => r.json());
            if (st?.status === 'SUCCESS' || st?.delivered === true) listStatus = 'Paid';
            else if (st?.reason === 'expired') listStatus = 'Expired';
          } catch { /* the stored status stays */ }
        }
        next.push({ ...inv, listStatus });
      }
      state.invoices = next;
    } catch { /* the last list stays */ }
    if (root.isConnected && state.tab === 'invoices') render();
  }

  function watchInvoices() {
    if (state.tab !== 'invoices') {
      if (state.poll) { clearInterval(state.poll); state.poll = 0; }
      return;
    }
    if (state.poll) return;
    state.poll = setInterval(() => {
      if (root.isConnected && state.tab === 'invoices') refreshList();
    }, 8000);
  }

  async function lookUpRegistration(account) {
    try {
      const res = await fetch(api() + API_PATH + '/payouts/registration?account=' + encodeURIComponent(account));
      const body = await res.json();
      if (body?.reason === 'missing_account' || body?.claim === 'missing') {
        state.line2 = body.text || `${account} does not exist on NEAR.`;
      } else {
        state.line2 = body?.text || 'USDC registration is unknown. The invoice is still valid.';
      }
      if (root.isConnected) render();
    } catch {
      state.line2 = 'USDC registration is unknown. The invoice is still valid.';
      if (root.isConnected) render();
    }
  }

  function exportCsvNow() {
    clearSeal();
    const rows = state.receipts || [];
    const csv = accountantCsv(rows);
    const summary = csvReconcile(rows, { refund: accountId() || '' });
    state.csvOut = csv;
    state.csvSummary = summary;
    downloadCsv(`${csv}\n\n${summary}\n`, 'payouts.csv');
    state.tab = 'csv';
    state.csvNote = 'CSV ready. A row without a tx says not sent. The block under it reconciles the session.';
    state.line = '';
    state.line2 = '';
    render();
    return { ok: true, hint: state.csvNote };
  }

  async function commandFor(text) {
    try {
      const res = await fetch(api() + API_PATH + '/payouts/intent', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const body = await res.json();
      if (body && (body.kind || body.hint)) return body;
    } catch { /* the local parser is the fallback */ }
    return agentCommand(text);
  }

  async function runAgent(text) {
    if (state.fixture) return { ok: false, hint: 'Fixture. Not a live payment.' };
    clearSeal();
    const cmd = await commandFor(text);
    if (!cmd.ok) return cmd;
    if (cmd.kind === 'csv') return { clear: true, ...exportCsvNow() };
    if (cmd.kind === 'status') {
      const origin = globalThis.location?.origin || '';
      const hint = state.invoice ? agentInvoiceReply(state.invoice, origin) : capSentence();
      state.line = state.invoice ? invoiceStatusLine(state.invoice.status) : capSentence();
      state.line2 = state.invoice ? 'Creating an invoice signs nothing.' : '';
      render();
      return { ok: true, clear: true, hint };
    }
    if (cmd.kind === 'invoice') {
      state.tab = 'invoice';
      // render() copies the inputs into state first, so the parsed fields go in after that copy.
      // The memo is taken from the words again so an older API reply cannot keep the amount in it.
      const patch = { invoiceUsd: String(cmd.usd), memo: memoFromWords(text) };
      if (cmd.receive) patch.receive = cmd.receive;
      if (cmd.due) patch.due = cmd.due;
      render(patch);
      if (!state.receive) return { ok: false, hint: 'Name the receive account. Nothing was created.' };
      const made = await createLink();
      if (made.ok && state.invoice) made.hint = agentInvoiceReply(state.invoice, globalThis.location?.origin || '');
      return { clear: !!made.ok, ...made };
    }
    if (cmd.kind === 'pay') {
      const picked = rowsForCommand(state.rows, cmd);
      if (!picked.length) return { ok: false, hint: 'That payout is not on the list. Nothing was sent.' };
      state.tab = 'payroll';
      return { clear: true, ...(await payReviewed(picked)) };
    }
    return { ok: false, hint: cmd.hint };
  }

  if (!root.dataset.keys) {
    root.dataset.keys = '1';
    const stopKeys = (e) => {
      const t = e.target;
      if (!t?.closest || t.closest('#p-agent, #f-agent, #t-agent')) return;
      if (t.closest('input, textarea, select')) e.stopPropagation();
    };
    root.addEventListener('keydown', stopKeys);
    root.addEventListener('keyup', stopKeys);
  }
  const render = (patch) => {
    const mem = typeof document !== 'undefined' && document.activeElement && root.contains(document.activeElement)
      ? { id: document.activeElement.id, i: document.activeElement.dataset?.i || '', cls: document.activeElement.className || '', start: document.activeElement.selectionStart, end: document.activeElement.selectionEnd }
      : null;
    const take = (sel, key) => { const el = q$(root, sel); if (el) state[key] = el.value; };
    // A caller that already decided the fields (the agent) passes them in after the input copy.
    take('#p-usd', 'invoiceUsd');
    take('#p-receive', 'receive');
    take('#p-memo', 'memo');
    take('#p-due', 'due');
    take('#p-expiry', 'expiry');
    if (patch && typeof patch === 'object') Object.assign(state, patch);
    root.querySelectorAll('.p-to').forEach(el => { const row = state.rows[+el.dataset.i]; if (row) row.to = el.value; });
    root.querySelectorAll('.p-amt').forEach(el => { const row = state.rows[+el.dataset.i]; if (row) row.amt = el.value; });
    const tab = state.tab || 'invoice';
    const rowMax = Number(state.maxActions || 0);
    const full = rowMax > 0 && state.rows.length >= rowMax;
    const addNote = full ? `Your /setup allows ${rowMax} ${rowMax === 1 ? 'payment' : 'payments'} a day.` : '';
    const tabs = `<div class="ferry-tabs" role="tablist" data-testid="payouts-tabs">
      <button type="button" role="tab" class="ferry-tab${tab === 'invoice' ? ' on' : ''}" data-tab="invoice" aria-selected="${tab === 'invoice'}" data-testid="payouts-tab-invoice">Invoice</button>
      <button type="button" role="tab" class="ferry-tab${tab === 'payroll' ? ' on' : ''}" data-tab="payroll" aria-selected="${tab === 'payroll'}" data-testid="payouts-tab-payroll">Payroll</button>
      <button type="button" role="tab" class="ferry-tab${tab === 'csv' ? ' on' : ''}" data-tab="csv" aria-selected="${tab === 'csv'}" data-testid="payouts-tab-csv">CSV</button>
      <button type="button" role="tab" class="ferry-tab${tab === 'invoices' ? ' on' : ''}" data-tab="invoices" aria-selected="${tab === 'invoices'}" data-testid="payouts-tab-invoices">Invoices</button>
    </div>`;
    const invoice = `<div class="ferry-pane" data-pane="invoice" ${tab === 'invoice' ? '' : 'hidden'}>
      ${payoutFlow('invoice')}
      <label class="field ferry-field"><span>Amount (USDC)</span><input id="p-usd" data-testid="payout-invoice-usd" inputmode="decimal" placeholder="for example 0.15" value="${esc(state.invoiceUsd || '')}"></label>
      <label class="field ferry-field"><span>Receive account</span><input id="p-receive" data-testid="payout-receive" value="${esc(state.receive || '')}" autocomplete="off" placeholder="name.near"></label>
      <label class="field ferry-field"><span>Memo</span><input id="p-memo" data-testid="payout-memo" value="${esc(state.memo || '')}" maxlength="140" placeholder="what this is for"></label>
      <label class="field ferry-field"><span>Due</span><input id="p-due" data-testid="payout-due" type="date" value="${esc(state.due || '')}"></label>
      <label class="field ferry-field"><span>Expiry</span><input id="p-expiry" data-testid="payout-expiry" type="datetime-local" value="${esc(state.expiry || '')}"></label>
      <p class="ferry-rate" data-testid="payout-invoice-cap">${esc(capSentence())}</p>
      <button type="button" class="primary ferry-cta" id="p-create" data-testid="payout-create">Create invoice link</button>
      ${lines()}
      ${sponsorCard()}
      ${resultCard()}
    </div>`;
    const rowList = state.rows.map((r, i) => {
      const asset = String(r.asset || 'NEAR').toUpperCase();
      const chain = String(r.chain || (asset === 'USDC' ? 'base' : 'near')).toLowerCase();
      const chainOpts = CHAINS.map(([id, name]) => `<option value="${id}"${chain === id ? ' selected' : ''}>${name}</option>`).join('');
      const assetOpts = ASSETS.map(a => `<option${asset === a ? ' selected' : ''}>${a}</option>`).join('');
      return `<li class="payout-row">
        <label class="field ferry-field"><span>Receiver</span><input class="p-to" data-i="${i}" data-testid="payout-to" value="${esc(r.to || '')}" autocomplete="off"></label>
        <div class="payout-split">
          <label class="field ferry-field"><span>Chain</span><select class="p-chain" data-i="${i}" data-testid="payout-chain">${chainOpts}</select></label>
          <label class="field ferry-field"><span>Asset</span><select class="p-asset" data-i="${i}" data-testid="payout-asset">${assetOpts}</select></label>
          <label class="field ferry-field"><span>Amount ${esc(asset)}</span><input class="p-amt" data-i="${i}" data-testid="payout-amt" inputmode="decimal" placeholder="0.1" value="${esc(formatNear(r.amt))}"></label>
        </div>
      </li>`;
    }).join('');
    const nextGold = state.reviewed ? 'pay' : 'review';
    const payroll = `<div class="ferry-pane" data-pane="payroll" ${tab === 'payroll' ? '' : 'hidden'}>
      ${payoutFlow('payroll')}
      ${state.payLine ? lines(state.payLine, state.payLine2) : `<div class="payout-status" data-testid="payout-status"><p class="payout-calm" data-testid="payout-caps">${esc(capSentence())}</p><p class="payout-calm"></p></div>`}
      <ol class="plist" data-testid="payout-list">${rowList}</ol>
      <button type="button" id="p-add" data-testid="payout-add"${full ? ` disabled data-reason="${esc(addNote)}"` : ''}>Add a row</button>
      <p data-testid="payout-add-note">${esc(addNote)}</p>
      <label class="field ferry-field"><span>Paste rows</span><textarea id="p-csv" data-testid="payout-csv" rows="2" placeholder="account,amount,asset,chain">${esc(state.csv || '')}</textarea></label>
      <button type="button" id="p-prep" class="${nextGold === 'review' ? 'primary ferry-cta' : ''}" data-testid="payout-prepare">Review these rows</button>
      <button type="button" id="p-pay" class="${nextGold === 'pay' ? 'primary ferry-cta' : ''}" data-testid="payout-send">Pay reviewed rows</button>
      <p data-testid="payout-drop"${state.dropNote ? '' : ' hidden'}>${esc(state.dropNote || '')}</p>
      <ul data-testid="payout-receipts">${receiptHtml(state.receipts)}</ul>
      <p data-testid="payout-usdc"${state.usdcNote ? '' : ' hidden'}>${esc(state.usdcNote || '')}</p>
    </div>`;
    const csvPane = `<div class="ferry-pane" data-pane="csv" ${tab === 'csv' ? '' : 'hidden'}>
      <p class="ferry-picker-note">One row per payment: source, destination chain, asset, amount, the NEAR it cost, the fee in USD, where a refund goes, and the tx. A row with no tx says not sent.</p>
      <button type="button" class="primary ferry-cta" id="p-export" data-testid="payout-export">Export accountant CSV</button>
      <pre data-testid="payout-csv-out">${esc(state.csvOut || '')}</pre>
      ${state.csvSummary ? `<pre data-testid="payout-csv-reconcile">${esc(state.csvSummary)}</pre>` : ''}
      ${state.csvNote ? lines(state.csvNote, '') : ''}
    </div>`;
    const origin = globalThis.location?.origin || '';
    const invoiceRows = (state.invoices || []).map(inv => {
      const href = origin + (inv.href || '');
      return `<li class="payout-invoice-row" data-testid="payout-invoice-row">
        <span class="payout-invoice-status" data-testid="payout-invoice-status">${esc(inv.listStatus || 'Unpaid')}</span>
        <span>${esc(inv.usd)} USDC</span>
        <span>${esc(inv.receive)}</span>
        <a href="${esc(href)}" data-testid="payout-invoice-link">${esc(href)}</a>
      </li>`;
    }).join('');
    const invoicesPane = `<div class="ferry-pane" data-pane="invoices" ${tab === 'invoices' ? '' : 'hidden'}>
      <p class="ferry-picker-note">Invoices for this visitor. Unpaid, Paid, or Expired. The list checks again while this tab is open.</p>
      ${invoiceRows ? `<ul class="payout-invoices" data-testid="payout-invoices">${invoiceRows}</ul>` : '<p data-testid="payout-invoices-empty">No invoices for this visitor yet.</p>'}
    </div>`;
    root.innerHTML = `<div class="shop-stack ferry-card" data-testid="payouts-card">${tabs}${invoice}${payroll}${csvPane}${invoicesPane}</div>`;
    const bind = (id, key) => { const el = q$(root, id); if (el) el.oninput = (e) => { state[key] = e.target.value; clearSeal(); }; };
    bind('#p-usd', 'invoiceUsd');
    bind('#p-receive', 'receive');
    bind('#p-memo', 'memo');
    bind('#p-due', 'due');
    bind('#p-expiry', 'expiry');
    root.querySelectorAll('.p-to').forEach(el => { el.oninput = () => { state.rows[+el.dataset.i].to = el.value; state.reviewed = false; dropQuote(); clearSeal(); }; });
    root.querySelectorAll('.p-amt').forEach(el => { el.oninput = () => { state.rows[+el.dataset.i].amt = el.value; state.reviewed = false; dropQuote(); clearSeal(); }; });
    root.querySelectorAll('.p-chain').forEach(el => { el.onchange = () => { state.rows[+el.dataset.i].chain = el.value; state.reviewed = false; clearSeal(); render(); }; });
    root.querySelectorAll('.p-asset').forEach(el => { el.onchange = () => { state.rows[+el.dataset.i].asset = el.value; state.reviewed = false; clearSeal(); render(); }; });
    root.querySelectorAll('[data-tab]').forEach(btn => {
      btn.onclick = () => {
        clearSeal();
        const next = btn.dataset.tab || 'invoice';
        if (next !== state.tab) {
          state.line = '';
          state.line2 = '';
          state.payLine = '';
          state.payLine2 = '';
          state.csvNote = '';
        }
        state.tab = next;
        render();
        if (state.tab === 'invoices') refreshList();
      };
    });
    const add = q$(root, '#p-add');
    if (add) add.onclick = () => {
      clearSeal();
      const next = addPayoutRow(state.rows, state.maxActions || null);
      state.rows = next.rows;
      state.reviewed = false;
      render();
    };
    const csv = q$(root, '#p-csv');
    if (csv) csv.oninput = (e) => { state.csv = e.target.value; };
    const prep = q$(root, '#p-prep');
    if (prep) prep.onclick = () => prepareNow();
    const pay = q$(root, '#p-pay');
    if (pay) pay.onclick = () => payReviewed(state.rows);
    const create = q$(root, '#p-create');
    if (create) create.onclick = () => createLink();
    const anchor = q$(root, '#p-anchor');
    if (anchor) anchor.onclick = () => anchorInvoice();
    const copy = q$(root, '#p-copy');
    if (copy) copy.onclick = async () => {
      const url = state.payUrl || '';
      try { await navigator.clipboard.writeText(url); copy.textContent = 'Copied'; }
      catch {
        const area = document.createElement('textarea');
        area.value = url;
        root.appendChild(area);
        area.select();
        try { document.execCommand('copy'); copy.textContent = 'Copied'; } catch { copy.textContent = 'Select the link'; }
        area.remove();
      }
    };
    if (mem) {
      let el = mem.id ? root.querySelector('#' + CSS.escape(mem.id)) : null;
      if (!el && mem.i !== '' && mem.cls) {
        const cls = String(mem.cls).split(/\s+/).find(Boolean);
        if (cls) el = root.querySelector(`.${CSS.escape(cls)}[data-i="${mem.i}"]`);
      }
      if (el?.focus) {
        el.focus({ preventScroll: true });
        try { if (mem.start != null && el.setSelectionRange) el.setSelectionRange(mem.start, mem.end); } catch { /* date inputs have no caret */ }
      }
    }
    const sp = q$(root, '#p-sponsor');
    if (sp) sp.onclick = () => sponsorNow();
    const exp = q$(root, '#p-export');
    if (exp) exp.onclick = () => exportCsvNow();
    const doc = typeof document !== 'undefined' ? document : null;
    if (doc && hooks.dock !== false) {
      ensurePayoutsDock(doc);
      armPayoutsDock((text) => runAgent(text));
    }
    watchInvoices();
  };
  render();
  loadCap();
}
