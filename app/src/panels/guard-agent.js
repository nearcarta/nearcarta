// Guardhouse commands. A check is a view. Pay uses the typed payee and amount.
// An invoice cannot replace that payee. Warn stays held until a person confirms.
// Block refunds once and does not forward. Freeze only tightens the row.
// https://docs.near.org/protocol/accounts-contracts/access-keys
// https://docs.near.ai/cloud/verification

import { explainCheck } from '../guard-score.js';
import { boardStep } from '../../../shared/guard/board-pay.js';
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

export function checkUrl(account, charter) {
  const path = '/api/guardhouse/check/' + encodeURIComponent(account);
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

function boardOf(state, ctx, kind) {
  const yocto = nearToYocto(state.amount);
  const nonce = state.nonce ?? ctx.nonce;
  return boardStep(kind, {
    board: state.board || ctx.board || '',
    owner: state.owner || ctx.owner || state.rowId || '',
    guard: state.guard || ctx.guard || '',
    nonce,
    expiry: state.expiry || ctx.expiry || String(BigInt(Date.now()) * 1000000n + 600000000000n),
    epoch: state.epoch ?? ctx.epoch ?? '0',
    payee: state.acct || '',
    chain: state.chain || 'near',
    asset: state.asset || 'NEAR',
    amount: yocto == null ? '' : yocto.toString(),
    invoice: state.invoice || '',
    actionId: state.actionId || nonce,
  });
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
  const { check, freeze, capYocto = null } = ctx;
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
    const result = bookOf(state).pay(state.bound);
    state.pending = result.needsHuman ? 'human' : null;
    state.holdId = result.hold?.id || state.holdId || null;
    const kind = result.verdict === 'block' || result.status === 'refunded' ? 'block' : result.status === 'held' ? 'hold' : result.status === 'prepared' ? 'allow' : null;
    const call = kind ? boardOf(state, ctx, kind) : null;
    if (call?.ready) state.actionId = String(state.nonce ?? ctx.nonce ?? '');
    if (result.status === 'held') state.notice = 'Held for confirm_hold. The agent cannot confirm. Nothing was signed.';
    if (result.status === 'prepared') state.notice = 'Allow prepares propose_call_as. Nothing was signed.';
    if (result.verdict === 'block') state.notice = 'Blocked. No propose_call_as. Nothing was signed.';
    return {
      ...result, action: 'pay', propose: false, lamps: lampsFor(state.chk), seal: result.status === 'refunded' || result.status === 'held',
      verdict: state.bound?.verdict, call,
    };
  }

  if (plan.action === 'confirm') {
    const id = state.holdId;
    const hold = id && state.book?.book.holds.get(id);
    const result = bookOf(state).confirm(id, { actor: plan.actor || 'agent', intentDigest: hold?.digest });
    if (result.ok) state.pending = null;
    const call = result.ok ? boardOf(state, ctx, 'confirm') : null;
    return { ...result, action: 'confirm', propose: false, seal: false, lamps: lampsFor(state.chk), call };
  }

  if (plan.action === 'cancel') {
    const call = boardOf(state, ctx, 'cancel');
    const result = bookOf(state).cancel(state.holdId);
    if (result.ok) { state.pending = null; state.holdId = null; }
    return { ...result, action: 'cancel', propose: false, seal: false, call: result.ok ? call : null };
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
