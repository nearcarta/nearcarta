// House commands. The gold button and the AI Agent both call runHouseTurn.
// Neither one signs. A charter propose is not a spend from the deed.
// A check-in or a foreign prepare is a propose_call_as on the board. The board
// writes row_owner. This file only builds that call.
// https://docs.near.org/protocol/accounts-contracts/access-keys

import { effectTokenOk, proposeCallAs, cancelHoldArgs, expireSentArgs } from '../house-board.js';

const NAMED = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const IMPLICIT = /^[0-9a-f]{64}$/;
function nearAccountOk(id) {
  const s = String(id || '').trim();
  return IMPLICIT.test(s) || NAMED.test(s);
}

const YOCTO = 10n ** 24n;

export const HOUSE_MISS = 'Try: I\'m alive · Send 0.001 ETH on Base · Pay 0.001 NEAR is not a house spend';

export function yoctoFromNear(near) {
  const s = String(near ?? '').trim();
  if (!/^\d+(\.\d{1,6})?$/.test(s)) return null;
  const [w, f = ''] = s.split('.');
  if (w.length > 12) return null;
  const frac = (f + '000000').slice(0, 6);
  try {
    return (BigInt(w) * YOCTO + BigInt(frac) * 10n ** 18n).toString();
  } catch {
    return null;
  }
}

export function findAccount(line) {
  for (const raw of String(line).split(/[\s,]+/)) {
    const s = raw.replace(/^[("']+|[).,;:!?]+$/g, '');
    if (/^\d+(\.\d+)?$/.test(s)) continue;
    if (/^0x[0-9a-fA-F]{6,}$/.test(s)) return s;
    if (/^[0-9a-f]{64}$/.test(s) || (s.includes('.') && nearAccountOk(s))) return s;
  }
  return '';
}

function big(v) {
  try { return BigInt(v); } catch { return 0n; }
}

function num(s) {
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function refuse(hint, extra = {}) {
  return { ok: true, action: 'refuse', tab: extra.tab || 'vaults', seal: true, signed: false, live: false, label: 'refused', hint, ...extra };
}

function amountOf(line) {
  const m = String(line).match(/(\d+(?:\.\d+)?)/);
  return m ? m[1] : '';
}

/** Same fields, same id. A second click does not prepare a second send. */
export function houseActionId(plan) {
  return [plan.action, plan.chain || '', plan.asset || '', plan.value || '', plan.to || '', plan.receiver || '', plan.amountY || ''].join('|');
}

function planCheckIn(ctx) {
  if (!ctx.row || !ctx.account || !ctx.house || !ctx.tokenId || !ctx.board) {
    return {
      ok: true, action: 'checkin', tab: 'deed', seal: false, signed: false, live: false, label: 'blocked',
      hint: 'Blocked. Check-in needs 1 yocto from the holder, or the board acting as you. Nothing was signed.',
    };
  }
  const row = ctx.row;
  if (row.frozen) return refuse('Your row is frozen. Nothing was signed.', { tab: 'deed', action: 'checkin' });
  const receivers = (row.receivers || []).map(String);
  if (!receivers.some(r => r.toLowerCase() === String(ctx.house).toLowerCase())) {
    return refuse('This house is not on your row. Nothing was signed.', { tab: 'deed', action: 'checkin' });
  }
  const deposit = big(row.min_amount) > 0n ? String(big(row.min_amount)) : '1';
  if (big(deposit) > big(row.per_action_cap)) return refuse('That is over your cap. Nothing was signed.', { tab: 'deed' });
  if (row.balance != null && row.balance !== '' && big(deposit) > big(row.balance)) {
    return refuse('Your row does not hold that much. Nothing was signed.', { tab: 'deed' });
  }
  // A deed with no inheritance line makes `house_session_check_in` panic inside the contract
  // (`line_of` has no line to read). The chain reports that as a bare wasm trap after the NEAR
  // has already been reserved, so the visitor pays gas for an error nobody can read. Name the
  // real cause before anything is signed: the holder sets the line first with their own key.
  // Verified on mainnet 2026-11-07 against a deed whose `house_line` returns null.
  // `ctx.line` is the /api/house/line payload. It is `null` when the request failed, and
  // `{line: null}` when the deed answered with no line. Only the second case is proof that the
  // deed has no line; a failed read must not be turned into a claim about the chain.
  const lineKnown = ctx.line && typeof ctx.line === 'object';
  const hasLine = ctx.hasLine != null ? ctx.hasLine : (lineKnown ? !!(ctx.line.line || ctx.line.heirs) : null);
  if (hasLine === false) {
    return refuse('This deed has no inheritance line yet, so a check-in would fail on chain. Set the heirs and guardians first, with your own wallet. Nothing was signed.', { tab: 'deed' });
  }
  // Only the nonce has to be known in advance. The board fills the epoch itself inside
  // `call_as_message`, and `get_charter` does not return one at all, so requiring an epoch
  // here made every check-in stop at "planned" with nothing signed. Measured on mainnet
  // 2026-11-08: pressing I'm alive in the deployed city produced no transaction and no
  // message, because `state.row.epoch` was undefined and this returned early.
  if (ctx.nonce == null) {
    return {
      ok: true, action: 'checkin', tab: 'deed', seal: false, signed: false, live: false, label: 'planned',
      deposit, method: 'house_session_check_in',
      hint: 'The check-in is house_session_check_in. Read the row nonce, then sign propose_call_as. Nothing was signed.',
    };
  }
  let call;
  try {
    call = proposeCallAs({
      network: ctx.network || 'mainnet',
      board: ctx.board,
      owner: ctx.account,
      receiver: ctx.house,
      method: 'house_session_check_in',
      args: { token_id: ctx.tokenId },
      deposit,
      expiry: ctx.expiry || '60000000000',
      nonce: ctx.nonce,
      epoch: ctx.epoch,
      effects: [],
      hold: false,
    });
  } catch (e) {
    return refuse(`${e.message || 'The board call could not be built.'} Nothing was signed.`, { tab: 'deed' });
  }
  return {
    ok: true, action: 'checkin', tab: 'deed', seal: false, signed: false, live: false, label: 'planned',
    call, deposit, method: 'house_session_check_in',
    hint: 'Ready for propose_call_as. The board writes row_owner. hold is false, so check-in runs now. The agent key must include propose_call_as. Nothing was signed.',
  };
}

function planNear(line, ctx) {
  const amt = amountOf(line);
  if (!amt) return { ok: false, action: 'miss', hint: 'Name an amount in NEAR, for example 0.001. Nothing was signed.' };
  const amountY = yoctoFromNear(amt);
  if (!amountY || BigInt(amountY) === 0n) return { ok: false, action: 'miss', hint: 'Name an amount above 0. Nothing was signed.' };
  const row = ctx.row || null;
  if (!row || row.per_action_cap == null || row.per_action_cap === '') {
    return refuse('No charter row yet. Open /setup. Nothing was signed.', { amountY });
  }
  if (row.frozen) return refuse('Your row is frozen. Nothing was signed.', { amountY });
  const nowNs = BigInt(ctx.nowNs ?? (BigInt(Date.now()) * 1_000_000n));
  if (row.expires_at && row.expires_at !== '0' && nowNs > big(row.expires_at)) {
    return refuse('Your row has expired. Nothing was signed.', { amountY });
  }
  const amount = BigInt(amountY);
  if (amount > big(row.per_action_cap)) return refuse('That is over your cap. Nothing was signed.', { amountY });
  const min = big(row.min_amount);
  if (min > 0n && amount < min) return refuse('That is below the smallest payment on your row. Nothing was signed.', { amountY });
  const daily = big(row.daily_budget);
  if (daily > 0n && big(row.spent_today) + amount > daily) {
    return refuse('That would pass your daily budget. Nothing was signed.', { amountY });
  }
  if (row.balance != null && row.balance !== '' && amount > big(row.balance)) {
    return refuse('Your row does not hold that much. Nothing was signed.', { amountY });
  }
  const receivers = (row.receivers || []).map(String);
  let receiver = findAccount(line);
  if (!receiver && receivers.length === 1) receiver = receivers[0];
  if (!receiver) {
    const list = receivers.slice(0, 4).join(', ') || 'nobody yet';
    return { ok: false, action: 'miss', hint: `Name who to pay. Your row allows ${list}. Nothing was signed.` };
  }
  const canonical = receivers.find(r => r.toLowerCase() === receiver.toLowerCase());
  if (!canonical) return refuse('That account is not on your row. Nothing was signed.', { amountY, receiver });
  return {
    ok: true, action: 'blocked', tab: 'vaults', seal: false, signed: false, live: false, label: 'blocked',
    near: amt, amountY, receiver: canonical,
    hint: 'Blocked. A charter payment does not spend this house. Nothing was signed.',
  };
}

function planForeign(line, ctx) {
  const btc = /\b(btc|bitcoin)\b/i.test(line);
  const chain = btc ? 'btc' : 'base';
  const asset = btc ? 'BTC' : (/\busdc\b/i.test(line) ? 'USDC' : 'ETH');
  const amt = amountOf(line);
  const gasMatch = String(line).match(/\bgas\s+(\d+)/i);
  const gas = gasMatch ? Number(gasMatch[1]) : 21000;
  if (btc && amt && num(amt) > 0) {
    return refuse('Bitcoin is signing only. A value would be a spend, and this house does not broadcast one. Nothing was signed.', { tab: 'vaults', action: 'refuse', chain, asset });
  }
  if (!btc && (!amt || num(amt) <= 0)) {
    return { ok: false, action: 'miss', tab: 'vaults', hint: 'Name an amount above 0. Nothing was signed.' };
  }
  const vault = ctx.vault || null;
  const to = findAccount(line) || (vault?.receivers?.length === 1 ? vault.receivers[0] : '');
  if (vault) {
    if (chain !== String(vault.chain || '').toLowerCase()) return refuse('That chain is not this vault. Nothing was signed.', { chain, asset });
    if (asset !== String(vault.asset || '').toUpperCase()) return refuse('That asset is not this vault. Nothing was signed.', { chain, asset });
    if (!btc && num(amt) > num(vault.max_value)) return refuse('That is over the vault cap. Nothing was signed.', { chain, asset, value: amt });
    if (Number(vault.max_gas) > 0 && Number(gas) > Number(vault.max_gas)) return refuse('That gas is over the vault cap. Nothing was signed.', { chain, asset, value: amt });
    const receivers = (vault.receivers || []).map(String);
    if (!to) return { ok: false, action: 'miss', tab: 'vaults', hint: 'Name who receives it. Nothing was signed.' };
    if (!receivers.some(r => r.toLowerCase() === to.toLowerCase())) {
      return refuse('That payee is not on this vault. Nothing was signed.', { chain, asset, value: amt, to });
    }
  }
  const value = btc ? '0' : amt;
  const whole = /^\d+$/.test(String(value));
  let call = null;
  let hint = 'Prepared. Live broadcast is blocked. Nothing was signed.';
  if (whole && ctx.account && ctx.house && ctx.tokenId && ctx.board && ctx.row && ctx.nonce != null && ctx.epoch != null) {
    const receivers = (ctx.row.receivers || []).map(String);
    if (!receivers.some(r => r.toLowerCase() === String(ctx.house).toLowerCase())) {
      return refuse('This house is not on your row. Nothing was signed.', { chain, asset, value, to });
    }
    if (!effectTokenOk(chain) || !effectTokenOk(asset) || !effectTokenOk(to)) {
      return refuse('The board rejects that payee. Nothing was signed.', { chain, asset, value, to });
    }
    const deposit = big(ctx.row.min_amount) > 0n ? String(big(ctx.row.min_amount)) : '1';
    try {
      call = proposeCallAs({
        network: ctx.network || 'mainnet',
        board: ctx.board,
        owner: ctx.account,
        receiver: ctx.house,
        method: 'house_session_prepare_send',
        args: { token_id: ctx.tokenId, chain, to, asset, value, gas_limit: gas, action_id: houseActionId({ action: 'prepare', chain, asset, value, to }) },
        deposit,
        expiry: ctx.expiry || '60000000000',
        nonce: ctx.nonce,
        epoch: ctx.epoch,
        effects: [{ chain, asset, to, value, fee: '0' }],
        hold: true,
      });
      hint = 'Prepared. propose_call_as holds it until confirm_hold. Live broadcast is blocked. Nothing was signed.';
    } catch (e) {
      return refuse(`${e.message || 'The board call could not be built.'} Nothing was signed.`, { chain, asset, value, to });
    }
  }
  return {
    ok: true, action: 'prepare', tab: 'vaults', seal: false, signed: false, live: false, label: 'prepared',
    chain, asset, value, to, gas, call,
    hint,
  };
}

/** Decide what a house line means. It does not sign and it does not ask the charter to pay. */
export function planHouseLine(text, ctx = {}) {
  const line = String(text || '').replace(/\s+/g, ' ').trim();
  if (!line) return { ok: false, action: 'miss', hint: HOUSE_MISS };
  if (/\bcancel\b/i.test(line) && /\bhold\b/i.test(line)) {
    const id = String(ctx.actionId || '').trim();
    if (!/^\d+$/.test(id)) return { ok: false, action: 'miss', hint: 'Name the hold id. Nothing was signed.' };
    return {
      ok: true, action: 'cancel_hold', tab: 'deed', seal: false, signed: false, live: false, label: 'planned',
      call: cancelHoldArgs(id),
      hint: 'Ready for cancel_hold. The row owner drops a hold that was never sent. Nothing was signed.',
    };
  }
  if (/\bexpire\b/i.test(line) && /\bhold\b/i.test(line)) {
    const id = String(ctx.actionId || '').trim();
    if (!ctx.account || !/^\d+$/.test(id)) return { ok: false, action: 'miss', hint: 'Name the hold id. Nothing was signed.' };
    return {
      ok: true, action: 'expire_sent', tab: 'deed', seal: false, signed: false, live: false, label: 'planned',
      call: expireSentArgs(ctx.account, id),
      hint: 'Ready for expire_sent. After the hold was sent and its expiry passed, no NEAR comes back. Nothing was signed.',
    };
  }
  if (/\bcancel\b/i.test(line) && /\brelease\b/i.test(line)) {
    const waiting = !!ctx.line?.line?.pending_ns;
    return {
      ok: true, action: 'cancel', tab: 'heirs', seal: false, signed: false, live: false,
      label: waiting ? 'simulation' : 'blocked',
      hint: waiting
        ? 'Simulation. A release is waiting. Cancel needs the holder. Nothing was signed.'
        : 'Blocked. No release is waiting. Nothing was signed.',
    };
  }
  if (/\b(i'm alive|i’m alive|im alive|check[\s-]?in)\b/i.test(line)) {
    return planCheckIn(ctx);
  }
  if (/\b(heir|guardian|threshold)\b/i.test(line) && !/\b(pay|send)\b/i.test(line)) {
    return {
      ok: true, action: 'show', tab: 'heirs', seal: false, signed: false, live: false, label: 'read',
      hint: 'Heirs stay on the deed. Changing them needs the holder. Nothing was signed.',
    };
  }
  if (/\b(address|derived|ethereum|bitcoin)\b/i.test(line) && !/\b(pay|send)\b/i.test(line)) {
    return {
      ok: true, action: 'derive', tab: 'vaults', seal: false, signed: false, live: false, label: 'read',
      hint: 'This address follows the deed, not the current holder. The live contract does not call the signer. Nothing was signed.',
    };
  }
  if (/\b(purse|balance|deed)\b/i.test(line) && !/\b(pay|send)\b/i.test(line)) {
    return {
      ok: true, action: 'show', tab: /\bdeed\b/i.test(line) && !/\bpurse\b/i.test(line) ? 'deed' : 'vaults',
      seal: false, signed: false, live: false, label: 'read',
      hint: 'These figures are read from the chain. Nothing was signed.',
    };
  }
  if (/\bpurse\b/i.test(line) || /house_pay/i.test(line) || /\bfrom (my |the )?deed\b/i.test(line)) {
    return refuse('The session does not spend the deed purse. house_pay needs 1 yocto from the holder. Nothing was signed.', { action: 'purse-pay' });
  }
  const foreign = /\b(btc|bitcoin|eth|base)\b/i.test(line) || /\bfrom (the )?house\b/i.test(line) || /^\s*send\b/i.test(line);
  if (foreign) return planForeign(line, ctx);
  if (/\b(pay|send)\b/i.test(line)) return planNear(line, ctx);
  return { ok: false, action: 'miss', hint: HOUSE_MISS };
}

/** Run a line. The button and the agent share this. Cinema only after a live destination tx, which this path does not produce. */
export async function runHouseTurn(text, ctx = {}) {
  const plan = planHouseLine(text, ctx);
  ctx.hideRefuse?.();
  if (plan.tab) ctx.showTab?.(plan.tab);
  if (!plan.ok) return plan;
  const id = houseActionId(plan);
  if (!ctx.seen) ctx.seen = new Set();
  if (plan.action === 'prepare' && ctx.seen.has(id)) {
    return { ...plan, idempotent: true, hint: 'Already prepared. Nothing was signed again.' };
  }
  if (plan.seal) ctx.showSeal?.(plan.hint);
  if (plan.action === 'prepare') ctx.seen.add(id);
  if (plan.label === 'live' && plan.tx) ctx.onDelivered?.(plan);
  return plan;
}
