// House commands. A session pay is board propose. house_pay needs 1 yocto from the deed holder.
// A function-call key cannot attach NEAR:
// https://docs.near.org/protocol/accounts-contracts/access-keys
// The charter checks the cap inside propose:
// contracts/charter_board/src/lib.rs

// Same named-account and implicit-account check as shared/net/accounts.js.
// This file is served from /panels/, so it cannot import a path outside the site.
const NAMED = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const IMPLICIT = /^[0-9a-f]{64}$/;
function nearAccountOk(id) {
  const s = String(id || '').trim();
  return IMPLICIT.test(s) || NAMED.test(s);
}

const YOCTO = 10n ** 24n;

export const HOUSE_MISS = 'Try: Pay 0.001 NEAR to toll.nearcarta.near · Show my ETH derived address · Check in';

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
    if (/^[0-9a-f]{64}$/.test(s) || (s.includes('.') && nearAccountOk(s))) return s;
  }
  return '';
}

function big(v) {
  try { return BigInt(v); } catch { return 0n; }
}

function refuse(hint, extra = {}) {
  return { ok: true, action: 'refuse', tab: 'purse', seal: true, signed: false, hint, ...extra };
}

/** Decide what a house line means. It does not sign. */
export function planHouseLine(text, ctx = {}) {
  const line = String(text || '').replace(/\s+/g, ' ').trim();
  if (!line) return { ok: false, action: 'miss', hint: HOUSE_MISS };
  if (/\bcheck[\s-]?in\b/i.test(line)) {
    return {
      ok: true, action: 'checkin', tab: 'guardians', seal: false, signed: false,
      hint: 'Check-in needs your full key on house_check_in (1 yocto). Your session key cannot attach NEAR, and this live deed has no check-in method yet. Nothing was signed.',
    };
  }
  if (/\b(address|derived|ethereum|bitcoin)\b/i.test(line) || /\b(eth|btc)\b/i.test(line)) {
    if (!/\b(pay|send)\b/i.test(line)) {
      return {
        ok: true, action: 'derive', tab: 'guardians', seal: false, signed: false,
        hint: 'Reading the signer for your paths. Nothing was signed.',
      };
    }
  }
  if (/\b(purse|balance|deed)\b/i.test(line) && !/\b(pay|send)\b/i.test(line)) {
    return {
      ok: true, action: 'show', tab: /\b(purse|balance)\b/i.test(line) ? 'purse' : 'deed',
      seal: false, signed: false,
      hint: 'These figures are read from the chain. Nothing was signed.',
    };
  }
  if (!/\b(pay|send)\b/i.test(line)) return { ok: false, action: 'miss', hint: HOUSE_MISS };
  if (/\bpurse\b/i.test(line) || /house_pay/i.test(line) || /\bfrom (my |the )?deed\b/i.test(line)) {
    return {
      ok: true, action: 'purse-pay', tab: 'purse', seal: true, signed: false,
      hint: 'house_pay needs 1 yocto from the deed holder. Your session key cannot attach NEAR, so it was not called. Nothing was signed.',
    };
  }
  const amtMatch = line.match(/(\d+(?:\.\d+)?)/);
  if (!amtMatch) return { ok: false, action: 'miss', hint: 'Name an amount in NEAR, for example 0.001. Nothing was signed.' };
  const amountY = yoctoFromNear(amtMatch[1]);
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
    ok: true, action: 'propose', tab: 'purse', seal: false, signed: false,
    near: amtMatch[1], amountY, receiver: canonical,
    hint: `Asking the charter to pay ${amtMatch[1]} NEAR to ${canonical}. The deed purse stays put.`,
  };
}

/** Run a line. Cinema (onDelivered) only after a real allowed tx. */
export async function runHouseTurn(text, ctx = {}) {
  const plan = planHouseLine(text, ctx);
  ctx.hideRefuse?.();
  if (plan.tab) ctx.showTab?.(plan.tab);
  if (!plan.ok) return plan;
  if (plan.seal) ctx.showSeal?.(plan.hint);
  if (plan.action !== 'propose') return plan;
  if (typeof ctx.ask !== 'function') {
    return { ...plan, hint: `${plan.hint} Nothing was signed.` };
  }
  try {
    const out = await ctx.ask(plan.receiver, plan.amountY);
    if (out?.decision === 'allowed' && out.tx) {
      ctx.hideRefuse?.();
      ctx.onDelivered?.(out);
      return {
        ok: true, success: true, signed: true, tx: out.tx, action: 'propose',
        hint: `Paid ${plan.near} NEAR from your charter row to ${plan.receiver}. The deed purse was not spent.`,
      };
    }
    const why = String(out?.reason || 'the charter refused');
    ctx.showSeal?.(why);
    return {
      ok: true, success: false, signed: !!out?.tx, tx: out?.tx || '', action: 'propose',
      hint: `Refused: ${why}. Nothing was paid.`,
    };
  } catch (e) {
    const why = e?.message || 'the ask stopped';
    ctx.showSeal?.(why);
    return { ok: false, action: 'propose', hint: why };
  }
}
