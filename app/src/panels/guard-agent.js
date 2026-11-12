// Guardhouse commands. A check is a view. Pay uses the typed payee and amount.
// An invoice cannot replace that payee. Warn stays held until a person confirms.
// Block refunds once and does not forward. Freeze only tightens the row.
// https://docs.near.org/protocol/accounts-contracts/access-keys
// https://docs.near.ai/cloud/verification

import { explainCheck } from '../guard-score.js';
import {
  LIVE_ENFORCEMENT, bindVerdict, contextMatches, createLedger, nearToYocto,
} from './guard-pay.js';

export const GUARD_MISS = 'Try: Check cafe.near · Pay 0.002 NEAR on near to cafe.near · Freeze my row';
const ACCOUNT = /(?:^|[^a-z0-9._-])([a-z0-9](?:[a-z0-9._-]{0,61}[a-z0-9])?\.near|[a-f0-9]{64})(?![a-z0-9._-])/i;
const PAY = /^pay\s+(\d+(?:\.\d{1,6})?)\s+([a-z][a-z0-9]{0,11})\s+(?:on\s+([a-z][a-z0-9]{0,15})\s+)?to\s+([a-z0-9](?:[a-z0-9._-]{0,61}[a-z0-9])?\.near|[a-f0-9]{64})\b([\s\S]*)$/i;

export function parseGuardCommand(text) {
  const raw = String(text || '').trim();
  const s = raw.toLowerCase().replace(/[.!?]+$/g, '').replace(/\s+/g, ' ').trim();
  if (!s) return { ok: false, hint: GUARD_MISS };
  if (/\bi checked\b/.test(s) || /^(confirm|release|ask the charter)$/.test(s)) return { ok: true, action: 'confirm', actor: 'agent' };
  if (/^(cancel|refund)$/.test(s) || /\bcancel the hold\b/.test(s)) return { ok: true, action: 'cancel' };
  if (/\bunfreeze\b|\bthaw\b/.test(s)) return { ok: true, action: 'loosen' };
  if (/\bfreeze\b/.test(s)) return { ok: true, action: 'freeze', frozen: true };
  const pay = raw.match(PAY);
  if (pay) {
    return {
      ok: true, action: 'pay',
      amount: pay[1], asset: pay[2].toUpperCase(), chain: (pay[3] || 'near').toLowerCase(),
      account: pay[4].toLowerCase(), invoice: String(pay[5] || '').trim(),
    };
  }
  if (/poison|trick/.test(s) || /\binvoice\b/.test(s)) {
    return { ok: true, action: 'note', invoice: raw, hint: 'An invoice cannot change the payee. Nothing was signed.' };
  }
  const m = raw.match(ACCOUNT);
  if (/^check\b/.test(s) || m) {
    if (!m) return { ok: false, hint: 'Name an account. Try: Check cafe.near' };
    return { ok: true, action: 'check', account: m[1].toLowerCase() };
  }
  return { ok: false, hint: GUARD_MISS };
}

// The API path prefix, published by the page at boot (`/api` on mainnet, `/tapi` on testnet).
// A panel reads it from the global instead of importing shared/, because the city serves panels
// straight from app/src and a shared import there is a module the build never publishes.
const apiPath = () => String(globalThis.NEARCARTA_API_PATH || '/api');

export function checkUrl(account, charter) {
  const path = apiPath() + '/guardhouse/check/' + encodeURIComponent(account);
  if (!charter) return path;
  return path + '?charter=' + encodeURIComponent(charter);
}

/** Unknown cap does not block. A known cap must cover the ask. */
export function capHolds(capYocto, amountYocto) {
  if (capYocto == null || capYocto === '') return { ok: true, unknown: true };
  if (amountYocto == null) return { ok: false, unknown: false };
  try {
    return { ok: BigInt(capYocto) >= BigInt(amountYocto), unknown: false };
  } catch {
    return { ok: false, unknown: false };
  }
}

/**
 * methodNames null: the key was not read, so do not sign silently.
 * methodNames []: omitted list, every method on the receiver.
 * Otherwise set_frozen must be named. approve opens one wallet approval.
 * This shop only freezes. It does not unfreeze.
 */
export function freezePlan({ methodNames, hasRow = true, approve = false, frozen = true } = {}) {
  if (!frozen) return { ok: false, sign: false, wallet: false, hint: 'Unfreeze would loosen the row. This shop cannot do that. Nothing was signed.' };
  if (!hasRow) return { ok: false, sign: false, wallet: false, hint: 'No row on the board yet. Finish /setup. Nothing was signed.' };
  const names = Array.isArray(methodNames) ? methodNames : null;
  const allowed = !!names && (names.length === 0 || names.includes('set_frozen'));
  if (!allowed && !approve) {
    return {
      ok: false, sign: false, wallet: false, needsApproval: true,
      hint: 'This session key calls propose and propose_call. set_frozen needs one account approval. Deposit 0. Nothing was signed.',
    };
  }
  if (!allowed && approve) {
    return {
      ok: true, sign: true, wallet: true, deposit: '0', method: 'set_frozen', frozen: true,
      hint: 'One approval freezes the row. Deposit 0.',
    };
  }
  return {
    ok: true, sign: true, wallet: false, deposit: '0', method: 'set_frozen', frozen: true,
    hint: 'Freezing the row. Gas only. No wallet.',
  };
}

export function lampsFor(check) {
  const reasons = Array.isArray(check?.reasons) ? check.reasons : [];
  const by = {};
  for (const r of reasons) if (r?.code) by[r.code] = r.level || 'warn';
  const level = (...codes) => {
    for (const c of codes) if (by[c]) return by[c];
    return 'ok';
  };
  return [
    { id: 'denylist', level: level('denylisted'), label: 'Deny list' },
    { id: 'lookalike', level: level('lookalike'), label: 'Lookalike' },
    { id: 'age', level: level('new_account', 'age_unknown'), label: 'Age' },
    { id: 'code', level: level('code_changed', 'code_unknown', 'unconfirmed'), label: 'Code' },
    { id: 'list', level: level('no_history', 'account_missing'), label: 'List' },
  ];
}

function fieldsOf(state) {
  return {
    payee: state.acct || '',
    chain: state.chain || 'near',
    asset: state.asset || 'NEAR',
    amount: state.amount || '',
    invoice: state.invoice || '',
    row: state.rowId || '',
    keyEpoch: state.keyEpoch || '',
    policyVersion: state.policyVersion || '',
  };
}

function bookOf(state) {
  if (!state.book) state.book = createLedger();
  return state.book;
}

async function readCheck(check, account) {
  const raw = await check(account);
  return { raw, explained: explainCheck(raw), lamps: lampsFor(raw) };
}

function applyRead(state, read) {
  state.chk = read.raw;
  state.score = read.explained;
  state.bound = bindVerdict({ ...fieldsOf(state), check: read.raw });
  state.pending = state.bound.release === 'warn' ? 'human' : null;
}

export async function runGuardAction(plan, ctx = {}) {
  const state = ctx.state || {};
  const { check, freeze, capYocto = null, sendPay, sendConfirm, sendCancel } = ctx;
  if (!plan?.ok && !plan?.action) return { ok: false, propose: false, cinema: false, seal: false, live: LIVE_ENFORCEMENT, hint: plan?.hint || GUARD_MISS };

  if (plan.action === 'note') {
    state.invoice = plan.invoice || state.invoice || '';
    return { ok: true, propose: false, cinema: false, seal: false, live: LIVE_ENFORCEMENT, hint: plan.hint };
  }

  if (plan.action === 'loosen') {
    return { ok: false, propose: false, cinema: false, seal: false, live: LIVE_ENFORCEMENT, hint: 'Unfreeze would loosen the row. This shop cannot do that. Nothing was signed.' };
  }

  if (plan.action === 'check') {
    state.tab = 'check';
    state.acct = plan.account;
    if (typeof check !== 'function') return { ok: false, propose: false, cinema: false, seal: false, hint: 'The check is not wired.' };
    let read;
    try { read = await readCheck(check, plan.account); }
    catch (e) {
      const raw = { account: plan.account, verdict: 'warn', reasons: [{ code: 'account_missing', level: 'warn', text: e?.message || 'The check did not answer.' }], signals: {} };
      state.chk = raw;
      state.score = explainCheck(raw);
      state.bound = null;
      state.pending = null;
      return { ok: false, propose: false, cinema: false, seal: false, hint: state.score.summary, lamps: lampsFor(raw) };
    }
    applyRead(state, read);
    const blocked = read.explained.verdict === 'block' || read.explained.verdict === 'warn';
    return {
      ok: true, action: 'check', propose: false, cinema: false, lamps: read.lamps, live: LIVE_ENFORCEMENT,
      seal: blocked, verdict: read.explained.verdict, account: plan.account, hint: read.explained.summary,
    };
  }

  if (plan.action === 'pay') {
    state.tab = 'pay';
    if (plan.account) state.acct = plan.account;
    if (plan.amount) state.amount = plan.amount;
    if (plan.asset) state.asset = plan.asset;
    if (plan.chain) state.chain = plan.chain;
    if (plan.invoice) state.invoice = plan.invoice;
    if (!state.acct) return { ok: false, propose: false, cinema: false, seal: false, hint: 'Name a payee. Nothing was signed.' };
    if (!state.amount) return { ok: false, propose: false, cinema: false, seal: false, hint: 'Name an amount. Nothing was signed.' };
    const yocto = nearToYocto(state.amount);
    const cap = capHolds(capYocto, yocto == null ? null : yocto.toString());
    if (!cap.ok) return { ok: false, propose: false, cinema: false, seal: true, hint: 'That amount is over your max per payment. Nothing was signed.' };
    if (typeof check !== 'function') return { ok: false, propose: false, cinema: false, seal: false, hint: 'The check is not wired.' };
    const fields = fieldsOf(state);
    if (!state.bound || !contextMatches(state.bound, fields)) {
      let read;
      try { read = await readCheck(check, state.acct); }
      catch (e) { return { ok: false, propose: false, cinema: false, seal: false, hint: e?.message || 'The check did not answer.' }; }
      applyRead(state, read);
    }
    // A payment needs a verdict bound to exactly these fields. Pressing Pay before Check (or
    // after editing a field) is not a payment: say so instead of running the offline ledger.
    if (!state.bound?.bound) {
      return { ok: false, signed: false, propose: false, cinema: false, seal: false, action: 'pay',
        hint: 'Check this payee first. Pay signs only a payment the check has seen. Nothing was signed.' };
    }
    const result = bookOf(state).pay(state.bound);
    state.pending = result.needsHuman ? 'human' : null;
    state.holdId = result.hold?.id || state.holdId || null;
    // A held payment must survive a page reload. `state` lives in memory only, so a visitor
    // who refreshed lost the Cancel button and the refundable hold looked unreachable (and it
    // blocked close_charter with ERR_IN_FLIGHT). Keep it beside the session in localStorage.
    try {
      const k = 'nearcarta.guard.hold.' + (state.owner || state.row || '');
      if (state.holdId) localStorage.setItem(k, String(state.holdId));
      else localStorage.removeItem(k);
    } catch { /* private mode: the in-memory id still works for this page */ }
    const verdict = state.bound?.verdict === 'block' || result.status === 'refunded' ? 'block'
      : result.status === 'prepared' ? 'allow' : 'warn';
    // The live executor is the only thing that signs. It is shared with the gold CTA, so the
    // agent cannot take a different path to the chain. A block never reaches it.
    let live = null;
    if (verdict === 'block') {
      live = { ok: false, signed: false, tx: null, why: 'Blocked. No call was built and nothing was signed.' };
    } else if (typeof sendPay === 'function') {
      try {
        live = await sendPay({ payee: state.acct, amountYocto: yocto == null ? '' : yocto.toString(), invoice: state.invoice || '', verdict, chain: state.chain || 'near', asset: state.asset || 'NEAR' });
      } catch (e) { live = { ok: false, signed: false, tx: null, why: e?.message || 'The guard did not answer.' }; }
    }
    if (live?.tx) {
      state.notice = live.hold ? 'Held on the board. Only you can confirm it.' : `Paid through the guard. tx ${String(live.tx).slice(0, 10)}…`;
    } else if (live && !live.ok) {
      state.notice = live.why || live.reason || 'The guard refused. Nothing was forwarded.';
    } else if (result.status === 'held') state.notice = 'Held for confirm_hold. The agent cannot confirm.';
    else if (result.status === 'prepared') state.notice = 'Allow matched. Pay through guard signs it.';
    else if (verdict === 'block') state.notice = 'Blocked. No call was built.';
    // F27: the words a visitor sees are what the live send did (tx, hold, or the reason it did not
    // go), not the offline book's "Allow matches… Pay through guard sends it".
    return {
      ...result, action: 'pay', propose: false, lamps: lampsFor(state.chk), seal: result.status === 'refunded' || result.status === 'held',
      verdict: state.bound?.verdict, live: live || undefined, hint: (live ? state.notice : '') || result.hint, ok: live ? !!live.ok : result.ok,
    };
  }

  if (plan.action === 'confirm') {
    const id = state.holdId;
    // A WARN is released only by the visitor's own button. The agent has no confirm key, and
    // `sendConfirm` refuses without one, so an agent "confirm" cannot release a hold even if a
    // model is talked into saying it.
    if ((plan.actor || 'agent') !== 'human') {
      return { ok: false, signed: false, propose: false, cinema: false, seal: false, action: 'confirm',
        hint: 'The agent cannot confirm a warning. Press Confirm this payment yourself.' };
    }
    if (typeof sendConfirm !== 'function') return { ok: false, signed: false, propose: false, cinema: false, seal: false, hint: 'The confirm key is not loaded. Nothing was signed.' };
    let live;
    try { live = await sendConfirm({ holdId: id }); }
    catch (e) { live = { ok: false, signed: false, tx: null, why: e?.message || 'The confirm did not answer.' }; }
    if (live?.ok) state.pending = null;
    return { ...live, action: 'confirm', propose: false, cinema: !!live?.tx, seal: false, lamps: lampsFor(state.chk),
      hint: live?.tx ? 'You released the hold. The board called the guard.' : (live?.why || 'The confirm was refused. Nothing moved.') };
  }

  if (plan.action === 'cancel') {
    const id = state.holdId;
    if (typeof sendCancel !== 'function') return { ok: false, signed: false, propose: false, cinema: false, seal: false, hint: 'Cancel needs the row owner. Nothing was signed.' };
    let live;
    try { live = await sendCancel({ holdId: id }); }
    catch (e) { live = { ok: false, signed: false, tx: null, why: e?.message || 'Cancel did not answer.' }; }
    if (live?.ok) { state.pending = null; state.holdId = null; }
    return { ...live, action: 'cancel', propose: false, seal: false,
      hint: live?.tx ? 'Cancelled. The NEAR returned to your row.' : (live?.why || 'Cancel was refused. Nothing moved.') };
  }

  if (plan.action === 'freeze') {
    state.tab = 'blocks';
    state.pending = null;
    if (typeof freeze !== 'function') return { ok: false, propose: false, cinema: false, seal: false, hint: 'Open the town door to freeze the row. Nothing was signed.' };
    let out;
    try { out = await freeze({ frozen: true, approve: !!plan.approve }); }
    catch (e) { return { ok: false, propose: false, cinema: false, seal: false, hint: e?.message || 'Freeze did not sign.' }; }
    if (out?.ok && out.tx) {
      state.frozen = true;
      state.needsApproval = false;
      state.rowKnown = true;
      return { ok: true, action: 'freeze', propose: false, seal: false, tx: out.tx, frozen: true, cinema: 'freeze', hint: out.hint, live: LIVE_ENFORCEMENT };
    }
    state.needsApproval = !!out?.needsApproval;
    return {
      ok: !!out?.needsApproval, action: 'freeze', propose: false, cinema: false,
      seal: !out?.needsApproval && !out?.ok, needsApproval: !!out?.needsApproval,
      hint: out?.hint || 'Freeze did not sign.', live: LIVE_ENFORCEMENT,
    };
  }

  return { ok: false, propose: false, cinema: false, seal: false, hint: GUARD_MISS };
}

export async function runGuardAgent({ text, ...ctx } = {}) {
  const plan = parseGuardCommand(text);
  if (!plan.ok) return { ...plan, propose: false, cinema: false, seal: false };
  return runGuardAction(plan, ctx);
}

/**
 * The model first, the parser second.
 *
 * Every shop dock parsed its own phrasing, so "the agent" was a regex in five of nine shops and a
 * judge who typed a free sentence got a canned `Try: …`. /api/vault/ask/plan is the one path where
 * a model in a TEE reads the words and proposes a payment, and it was reachable from the Arena's
 * attack card only.
 *
 * This asks the model for the payee and the amount, and then hands the result to the SAME
 * runGuardAction the typed command uses, so the model proposes and the charter still decides.
 * If the model is off, over budget, or unreachable, the parser answers exactly as before and the
 * reply says which one spoke.
 */
export async function runGuardAgentWithModel({ text, api, charter, ...ctx } = {}) {
  const words = String(text || '').trim();
  const parsed = parseGuardCommand(words);
  // Only a sentence that reads like a payment is worth a model call. "Check cafe.near", "freeze
  // my row" and "cancel" are exact commands the parser already answers with no cost and no
  // latency, so they never reach the model.
  const wantsPay = /(?:^|[^a-z])(pay|send|transfer|spend|give)\b/i.test(words);
  const plan = wantsPay ? await askModelForPayment({ text: words, api, charter }).catch(() => null) : null;

  if (plan?.receiver && plan?.amount_units) {
    // The model's reading wins for payee and amount; everything else (chain, asset, invoice) is
    // taken from the words, because those are what the visitor can see they typed.
    const merged = {
      ok: true, action: 'pay', by: 'model', model: plan.model || null,
      amount: plan.amount_units || parsed.amount,
      asset: parsed.asset || 'NEAR',
      chain: parsed.chain || 'near',
      account: plan.receiver,
      invoice: parsed.invoice || '',
    };
    const out = await runGuardAction(merged, ctx);
    return { ...out, by: 'model', model: plan.model || null, parsed_from: 'model' };
  }

  if (!parsed.ok) {
    return { ...parsed, propose: false, cinema: false, seal: false, by: 'parser' };
  }
  const out = await runGuardAction(parsed, ctx);
  return { ...out, by: 'parser', parsed_from: 'parser', model_why: plan?.why || null };
}

/** Ask the model what the sentence asks for. No signature, no spend: this is a reading. */
async function askModelForPayment({ text, api, charter } = {}) {
  // An empty API base is correct, not missing: the city page talks to its own origin, so
  // `fetch('') + '/api/...'` is a same-origin request. Requiring a non-empty base here meant the
  // model was never asked from inside the city, even though /api/vault/ask/plan worked from curl.
  const base = String(api ?? globalThis.NEARCARTA_API ?? '').replace(/\/$/, '');
  let r;
  try {
    r = await fetch(base + apiPath() + '/vault/ask/plan', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, charter: charter || '', nickname: 'guard' }),
    });
  } catch { return null; }
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  const p = j?.parsed;
  if (!p?.receiver) return null;
  return { receiver: String(p.receiver).toLowerCase(), amount_units: p.amount != null ? String(p.amount) : '', model: j.model || null };
}
