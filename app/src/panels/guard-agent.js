// Guardhouse commands. A check is a view. A trick asks the charter only after the
// gate below. Freeze is set_frozen on the visitor's row (gas only, deposit 0).
// Function-call keys name one receiver. method_names omitted means every method
// on that receiver. They cannot attach NEAR.
// https://docs.near.org/protocol/accounts-contracts/access-keys
// https://docs.near.org/web3-apps/tutorials/wallet-login
// set_frozen: contracts/charter_board/src/lib.rs (predecessor, refunds deposit).

import { explainCheck } from '../guard-score.js';

export const POISON_PAYEE = 'shop-moved-pay-here.near';
export const TRICK_NEAR = '0.001';
/** 0.001 NEAR in yocto. Same scale as apps.js toY. */
export const TRICK_YOCTO = '1000000000000000000000';
export const GUARD_MISS = 'Try: Check shop-moved-pay-here.near · Try poisoned invoice · Freeze my row · Unfreeze';

const ACCOUNT = /(?:^|[^a-z0-9._-])([a-z0-9](?:[a-z0-9._-]{0,61}[a-z0-9])?\.near|[a-f0-9]{64})(?![a-z0-9._-])/i;

export function parseGuardCommand(text) {
  const raw = String(text || '').trim();
  const s = raw.toLowerCase().replace(/[.!?]+$/g, '').replace(/\s+/g, ' ').trim();
  if (!s) return { ok: false, hint: GUARD_MISS };
  if (/\bi checked\b/.test(s) || /^(confirm|ask the charter)$/.test(s)) return { ok: true, action: 'confirm' };
  if (/let it knock|knock anyway/.test(s)) return { ok: true, action: 'knock' };
  if (/\bunfreeze\b|\bthaw\b/.test(s)) return { ok: true, action: 'freeze', frozen: false };
  if (/\bfreeze\b/.test(s)) return { ok: true, action: 'freeze', frozen: true };
  if (/poison|trick/.test(s) || /\binvoice\b/.test(s)) return { ok: true, action: 'trick', id: 'poisoned-invoice' };
  const m = raw.match(ACCOUNT);
  if (/^check\b/.test(s) || m) {
    if (!m) return { ok: false, hint: 'Name an account. Try: Check shop-moved-pay-here.near' };
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
export function capHolds(capYocto, amountYocto = TRICK_YOCTO) {
  if (capYocto == null || capYocto === '') return { ok: true, unknown: true };
  try {
    return { ok: BigInt(capYocto) >= BigInt(amountYocto), unknown: false };
  } catch {
    return { ok: false, unknown: false };
  }
}

export function trickAmountYocto(minYocto, capYocto) {
  let amt = BigInt(TRICK_YOCTO);
  try { if (minYocto && BigInt(minYocto) > amt) amt = BigInt(minYocto); } catch { /* keep 0.001 */ }
  const hold = capHolds(capYocto, amt.toString());
  return { amount: amt.toString(), ok: hold.unknown || hold.ok, unknown: !!hold.unknown };
}

/** Warn never proposes until confirmed. Block never proposes until the visitor says knock. */
export function trickGate(verdict, { confirmed = false, knock = false } = {}) {
  if (verdict === 'allow') return { propose: true, seal: false, hint: 'Allow. Asking the charter for 0.001 NEAR. No wallet.' };
  if (verdict === 'warn') {
    if (!confirmed) return { propose: false, seal: true, needs: 'confirm', hint: 'Warn. Nothing was signed. Say I checked, or press the button, before the charter is asked.' };
    return { propose: true, seal: false, hint: 'You confirmed the warning. Asking the charter. No wallet.' };
  }
  if (verdict === 'block') {
    if (!knock) return { propose: false, seal: true, needs: 'knock', hint: 'Blocked before signing. Nothing was signed. Say Let it knock to ask the charter anyway.' };
    return { propose: true, seal: false, hint: 'Asking the charter. The check is advice. The charter still decides. No wallet.' };
  }
  return { propose: false, seal: false, hint: 'The check did not return a verdict. Nothing was signed.' };
}

/**
 * methodNames null: the key was not read, so do not sign silently.
 * methodNames []: omitted list, every method on the receiver.
 * Otherwise set_frozen must be named. approve opens one wallet approval.
 */
export function freezePlan({ methodNames, hasRow = true, approve = false, frozen = true } = {}) {
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
      ok: true, sign: true, wallet: true, deposit: '0', method: 'set_frozen', frozen: !!frozen,
      hint: frozen ? 'One approval freezes the row. Deposit 0.' : 'One approval unfreezes the row. Deposit 0.',
    };
  }
  return {
    ok: true, sign: true, wallet: false, deposit: '0', method: 'set_frozen', frozen: !!frozen,
    hint: frozen ? 'Freezing the row. Gas only. No wallet.' : 'Unfreezing the row. Gas only. No wallet.',
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

function sentResult(sent) {
  if (!sent) return { ok: false, propose: false, cinema: false, seal: false, hint: 'The charter did not answer. Nothing was signed.' };
  const tx = sent.tx || null;
  const reason = sent.reason || '';
  if (sent.fromRule || (sent.refused && !tx)) {
    return { ok: true, propose: false, cinema: false, seal: true, reason, hint: `Refused before signing: ${reason || 'your rules'}. Nothing was signed.` };
  }
  if (sent.refused && tx) {
    return { ok: true, propose: true, refused: true, cinema: 'refuse', seal: true, tx, reason, hint: `Refused on chain: ${reason}.` };
  }
  if ((sent.decision === 'allowed' || sent.ok) && tx && !sent.refused) {
    return { ok: true, propose: true, refused: false, cinema: 'pass', seal: false, tx, hint: 'The charter allowed 0.001 NEAR.' };
  }
  return { ok: false, propose: false, cinema: false, seal: false, hint: reason || 'The charter did not answer. Nothing was signed.' };
}

async function readCheck(check, account) {
  const raw = await check(account);
  return { raw, explained: explainCheck(raw), lamps: lampsFor(raw) };
}

export async function runGuardAction(plan, ctx = {}) {
  const state = ctx.state || {};
  const { check, trickPlan, trickSend, freeze, capYocto = null, minYocto = null } = ctx;
  if (!plan?.ok && !plan?.action) return { ok: false, propose: false, cinema: false, seal: false, hint: plan?.hint || GUARD_MISS };

  if (plan.action === 'check') {
    state.tab = 'check';
    state.pending = null;
    state.acct = plan.account;
    if (typeof check !== 'function') return { ok: false, propose: false, cinema: false, seal: false, hint: 'The check is not wired.' };
    let read;
    try { read = await readCheck(check, plan.account); }
    catch (e) { return { ok: false, propose: false, cinema: false, seal: false, hint: e?.message || 'The check did not answer.' }; }
    state.chk = read.raw;
    state.score = read.explained;
    const blocked = read.explained.verdict === 'block' || read.explained.verdict === 'warn';
    return {
      ok: true, action: 'check', propose: false, cinema: false, lamps: read.lamps,
      seal: blocked, verdict: read.explained.verdict, account: plan.account,
      hint: read.explained.summary,
    };
  }

  if (plan.action === 'trick' || plan.action === 'confirm' || plan.action === 'knock') {
    state.tab = 'trick';
    if (typeof check !== 'function') return { ok: false, propose: false, cinema: false, seal: false, hint: 'The check is not wired.' };
    if (plan.action === 'trick') {
      state.atk = plan.id || 'poisoned-invoice';
      state.pending = null;
      state.chk = null;
    } else if (state.pending !== plan.action) {
      return { ok: false, propose: false, cinema: false, seal: false, hint: 'Nothing is waiting. Try the poisoned invoice first.' };
    }
    let receiver = state.receiver || POISON_PAYEE;
    if (plan.action === 'trick' && typeof trickPlan === 'function') {
      try {
        const p = await trickPlan(state.atk);
        if (p?.receiver) receiver = p.receiver;
      } catch (e) {
        return { ok: false, propose: false, cinema: false, seal: false, hint: e?.message || 'The trick could not be planned.' };
      }
    }
    state.receiver = receiver;
    state.acct = receiver;
    let read;
    try {
      read = (plan.action !== 'trick' && state.chk)
        ? { raw: state.chk, explained: explainCheck(state.chk), lamps: lampsFor(state.chk) }
        : await readCheck(check, receiver);
    } catch (e) {
      return { ok: false, propose: false, cinema: false, seal: false, hint: e?.message || 'The check did not answer.' };
    }
    state.chk = read.raw;
    state.score = read.explained;
    const sized = trickAmountYocto(minYocto, capYocto);
    if (!sized.ok) {
      state.pending = null;
      return {
        ok: false, propose: false, cinema: false, seal: true, lamps: read.lamps,
        hint: 'Your max per payment is under 0.001 NEAR. Nothing was signed.',
        verdict: read.explained.verdict,
      };
    }
    const gate = trickGate(read.raw?.verdict, { confirmed: plan.action === 'confirm', knock: plan.action === 'knock' });
    state.pending = gate.needs || null;
    if (!gate.propose) {
      return {
        ok: true, action: plan.action, propose: false, cinema: false, seal: !!gate.seal,
        lamps: read.lamps, verdict: read.raw?.verdict, pending: state.pending,
        hint: `${read.explained.summary}. ${gate.hint}`,
      };
    }
    if (typeof trickSend !== 'function') {
      return { ok: false, propose: false, cinema: false, seal: false, lamps: read.lamps, hint: 'Open the town door to ask the charter. This page did not sign.' };
    }
    let sent;
    try { sent = await trickSend(state.atk || 'poisoned-invoice'); }
    catch (e) { return { ok: false, propose: false, cinema: false, seal: false, hint: e?.message || 'The charter did not answer.' }; }
    state.pending = null;
    state.chk = null;
    return { ...sentResult(sent), action: plan.action, lamps: read.lamps, verdict: read.raw?.verdict };
  }

  if (plan.action === 'freeze') {
    state.tab = 'freeze';
    state.pending = null;
    if (typeof freeze !== 'function') return { ok: false, propose: false, cinema: false, seal: false, hint: 'Open the town door to freeze the row. Nothing was signed.' };
    let out;
    try { out = await freeze({ frozen: !!plan.frozen, approve: !!plan.approve }); }
    catch (e) { return { ok: false, propose: false, cinema: false, seal: false, hint: e?.message || 'Freeze did not sign.' }; }
    if (out?.ok && out.tx) {
      state.frozen = !!plan.frozen;
      state.needsApproval = false;
      state.rowKnown = true;
      return {
        ok: true, action: 'freeze', propose: false, seal: false, tx: out.tx, frozen: !!plan.frozen,
        cinema: plan.frozen ? 'freeze' : 'unfreeze', hint: out.hint,
      };
    }
    state.needsApproval = !!out?.needsApproval;
    return {
      ok: !!out?.needsApproval, action: 'freeze', propose: false, cinema: false,
      seal: !out?.needsApproval && !out?.ok, needsApproval: !!out?.needsApproval,
      hint: out?.hint || 'Freeze did not sign.',
    };
  }

  return { ok: false, propose: false, cinema: false, seal: false, hint: GUARD_MISS };
}

export async function runGuardAgent({ text, ...ctx } = {}) {
  const plan = parseGuardCommand(text);
  if (!plan.ok) return { ...plan, propose: false, cinema: false, seal: false };
  return runGuardAction(plan, ctx);
}
