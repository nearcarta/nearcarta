// Town Hall plans. Pure: no network, no signing.
// Board propose checks: contracts/charter_board/src/lib.rs propose (frozen, expiry, allowlist, min, window, cap, day, balance).
// set_rules keeps expires_at unless the visitor names a new one: contracts/charter_board/src/lib.rs set_rules.
// Agent Market register body (not sent): POST /v1/agents/register on https://market.near.ai — docs.market.near.ai/list-your-agent.

export const HALL_PAYEE = 'townhall.nearcarta.near';
export const BOARD = 'board.nearcarta.near';
export const MARKET_BASE = 'https://market.near.ai';

export const LAMPLIGHTER_REGISTER = {
  handle: 'lamplighter',
  name: 'Lamplighter',
  category: 'operations',
};

export const HALL_HINT = 'Try: Post a readme pass for 0.002 near. Quote part 1 from worker.near at 0.001. Accept part 1. Walk part 1. Pass part 1. Fail part 2. Refund.';

const PLAIN = {
  over_per_action_cap: 'That is more than your max per payment.',
  receiver_not_allowlisted: 'townhall.nearcarta.near is not on this row.',
  below_min_amount: 'That is below the smallest payment on your row.',
  over_daily_budget: 'That is more than your daily cap.',
  over_daily_action_count: 'This row has no payments left today.',
  frozen: 'The row is frozen.',
  clause_expired: 'This row has expired.',
  outside_time_window: 'The row is closed at this hour.',
  ERR_BALANCE: 'The row does not hold that much NEAR.',
  zero_amount: 'The amount has to be above zero.',
  no_row: 'No row is loaded. Finish /setup. Nothing was signed.',
  no_session: 'Finish /setup first. Nothing was signed.',
  no_key: 'The agent key is not in this browser. Finish /setup. No wallet was opened.',
  key_cannot_propose: 'This key cannot call propose. No wallet was opened.',
};

export function plainReason(code) {
  return PLAIN[code] || 'The row did not allow that.';
}

export function yoctoOf(near) {
  const n = Number(near);
  if (!Number.isFinite(n) || n <= 0) throw new Error('amount must be a number above zero');
  return (BigInt(Math.round(n * 1e6)) * 10n ** 18n).toString();
}

export function nearOf(yocto) {
  try {
    const y = BigInt(yocto);
    const whole = y / 10n ** 24n;
    const micro = (y % 10n ** 24n) / 10n ** 18n;
    const frac = micro.toString().padStart(6, '0').replace(/0+$/, '');
    return frac ? `${whole}.${frac}` : whole.toString();
  } catch {
    return '0';
  }
}

export function asRow(row) {
  if (!row || typeof row !== 'object') return null;
  const rules = row.rules && typeof row.rules === 'object' ? row.rules : row;
  if (rules.per_action_cap == null && row.per_action_cap == null) return null;
  return {
    owner: row.owner || '',
    receivers: [...(rules.receivers || row.receivers || [])],
    per_action_cap: String(rules.per_action_cap ?? row.per_action_cap ?? '0'),
    daily_budget: String(rules.daily_budget ?? row.daily_budget ?? '0'),
    max_actions_per_day: Number(rules.max_actions_per_day ?? row.max_actions_per_day ?? 0),
    window_start_min: Number(rules.window_start_min ?? row.window_start_min ?? 0),
    window_end_min: Number(rules.window_end_min ?? row.window_end_min ?? 0),
    min_amount: String(rules.min_amount ?? row.min_amount ?? '0'),
    expires_at: String(rules.expires_at ?? row.expires_at ?? '0'),
    frozen: !!(row.frozen ?? rules.frozen),
    sealed: !!(row.sealed ?? rules.sealed),
    balance: String(row.balance ?? '0'),
    spent_today: String(row.spent_today ?? row.spent ?? '0'),
    actions_today: Number(row.actions_today ?? row.count ?? 0),
  };
}

function minuteUtc(nowMs) {
  const d = new Date(nowMs);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

function inWindow(start, end, nowMs) {
  if (start === end) return true;
  const minute = minuteUtc(nowMs);
  if (start < end) return minute >= start && minute < end;
  return minute >= start || minute < end;
}

/** Local propose check. A failure is a seal, not a transaction. */
export function payPlan({ near, row, payee = HALL_PAYEE, nowMs = Date.now() } = {}) {
  const live = asRow(row);
  if (!live) return { ok: false, seal: false, reason: 'no_row', hint: plainReason('no_row'), receiver: payee };
  let amountY;
  try { amountY = yoctoOf(near); }
  catch (e) { return { ok: false, seal: false, reason: 'zero_amount', hint: e.message, receiver: payee }; }
  const amount = BigInt(amountY);
  const cap = BigInt(live.per_action_cap || '0');
  const min = BigInt(live.min_amount || '0');
  const daily = BigInt(live.daily_budget || '0');
  const spent = BigInt(live.spent_today || '0');
  const balance = BigInt(live.balance || '0');
  const exp = BigInt(live.expires_at || '0');
  const nowNs = BigInt(nowMs) * 1_000_000n;
  let reason = null;
  if (live.frozen) reason = 'frozen';
  else if (exp !== 0n && nowNs > exp) reason = 'clause_expired';
  else if (!(live.receivers || []).includes(payee)) reason = 'receiver_not_allowlisted';
  else if (amount <= 0n) reason = 'zero_amount';
  else if (min > 0n && amount < min) reason = 'below_min_amount';
  else if (!inWindow(live.window_start_min, live.window_end_min, nowMs)) reason = 'outside_time_window';
  else if (amount > cap) reason = 'over_per_action_cap';
  else if (spent + amount > daily) reason = 'over_daily_budget';
  else if (live.actions_today >= live.max_actions_per_day) reason = 'over_daily_action_count';
  else if (balance < amount) reason = 'ERR_BALANCE';
  if (reason) {
    return {
      ok: false, seal: true, reason, hint: plainReason(reason), receiver: payee,
      amountY, near: nearOf(amountY), capNear: nearOf(cap),
    };
  }
  return { ok: true, seal: false, reason: null, hint: '', receiver: payee, amountY, near: nearOf(amountY), capNear: nearOf(cap) };
}

export function hirePlan() {
  return {
    ok: false, phase: 'refused', seal: false, cinema: false, tx: null, pending: null,
    hint: 'This tray does not pay townhall.nearcarta.near. Post a job and name two workers. Nothing was signed.',
    speech: 'This tray does not pay townhall.nearcarta.near. Post a job and name two workers. Nothing was signed.',
  };
}

function scaleCap(yocto, num, den) {
  const v = BigInt(yocto) * BigInt(num) / BigInt(den);
  const step = 10n ** 18n;
  return ((v / step) * step).toString();
}

/** Owner row edit. expires_at is copied from the live row. Deposit stays 0. */
export function rulesPlan(row, patch = {}) {
  const live = asRow(row);
  if (!live) return { ok: false, calls: [], hint: plainReason('no_row'), seal: false };
  const next = { ...live, receivers: [...live.receivers] };
  if (patch.tighter) {
    const lowered = scaleCap(live.per_action_cap, 6, 10);
    const min = BigInt(live.min_amount || '0');
    if (BigInt(lowered) < min || BigInt(lowered) <= 0n) {
      return { ok: false, calls: [], hint: 'The cap is already at the smallest payment.', seal: true, reason: 'below_min_amount' };
    }
    next.per_action_cap = lowered;
  }
  if (patch.looser) {
    let raised = scaleCap(live.per_action_cap, 16, 10);
    if (BigInt(raised) <= BigInt(live.per_action_cap)) raised = (BigInt(live.per_action_cap) + 10n ** 21n).toString();
    next.per_action_cap = raised;
    if (BigInt(next.daily_budget) < BigInt(next.per_action_cap)) next.daily_budget = next.per_action_cap;
  }
  if (patch.capNear != null) {
    try { next.per_action_cap = yoctoOf(patch.capNear); }
    catch (e) { return { ok: false, calls: [], hint: e.message, seal: false }; }
    if (BigInt(next.daily_budget) < BigInt(next.per_action_cap)) next.daily_budget = next.per_action_cap;
  }
  if (patch.frozen != null) next.frozen = !!patch.frozen;
  next.expires_at = live.expires_at;
  const calls = [];
  const ruleKeys = ['receivers', 'per_action_cap', 'daily_budget', 'max_actions_per_day', 'window_start_min', 'window_end_min', 'min_amount', 'expires_at'];
  if (ruleKeys.some(k => JSON.stringify(live[k]) !== JSON.stringify(next[k]))) {
    if (BigInt(next.per_action_cap) <= 0n) return { ok: false, calls: [], hint: 'The cap has to stay above zero.', seal: true, reason: 'zero_amount' };
    if (BigInt(next.min_amount) > BigInt(next.per_action_cap)) {
      return { ok: false, calls: [], hint: 'The cap would sit under the smallest payment.', seal: true, reason: 'below_min_amount' };
    }
    calls.push({
      method: 'set_rules',
      deposit: '0',
      args: {
        rules: {
          receivers: next.receivers,
          per_action_cap: String(next.per_action_cap),
          daily_budget: String(next.daily_budget),
          max_actions_per_day: Number(next.max_actions_per_day),
          window_start_min: Number(next.window_start_min),
          window_end_min: Number(next.window_end_min),
          min_amount: String(next.min_amount),
          expires_at: String(live.expires_at),
        },
      },
    });
  }
  if (!!live.frozen !== !!next.frozen) calls.push({ method: 'set_frozen', deposit: '0', args: { frozen: !!next.frozen } });
  const seen = new Set();
  for (const c of calls) {
    const k = c.method;
    if (seen.has(k)) return { ok: false, calls: [], hint: 'That edit repeated a call.', seal: false };
    seen.add(k);
  }
  if (!calls.length) {
    const cap = nearOf(live.per_action_cap);
    return { ok: true, calls, hint: `The form matches the row. Cap is ${cap} NEAR.`, seal: false, expires_at: live.expires_at };
  }
  return { ok: true, calls, hint: '', seal: false, expires_at: live.expires_at, capNear: nearOf(next.per_action_cap) };
}

export function parseHallCommand(text) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  const t = raw.toLowerCase();
  if (!t) return { ok: false, kind: 'miss', hint: HALL_HINT };
  const accept = raw.match(/\baccept\s+part\s+(\d+)\b/i);
  if (accept) return { ok: true, kind: 'accept', partId: Number(accept[1]) };
  const walk = raw.match(/\bwalk\s+part\s+(\d+)\b/i);
  if (walk) return { ok: true, kind: 'walk', partId: Number(walk[1]) };
  const quote = raw.match(/\bquote\s+part\s+(\d+)\s+from\s+(\S+)\s+at\s+(\d+(?:\.\d+)?)/i);
  if (quote) return { ok: true, kind: 'quote', partId: Number(quote[1]), worker: quote[2].toLowerCase(), near: quote[3] };
  const pass = raw.match(/\bpass\s+part\s+(\d+)\b/i);
  if (pass) return { ok: true, kind: 'pass', partId: Number(pass[1]) };
  const fail = raw.match(/\bfail\s+part\s+(\d+)\b/i);
  if (fail) return { ok: true, kind: 'fail', partId: Number(fail[1]) };
  if (/^refund\b/.test(t)) return { ok: true, kind: 'refund' };
  const rules = {};
  if (/\bfreeze\b/.test(t) && /\brow\b/.test(t)) rules.frozen = true;
  if (/\bunfreeze\b/.test(t)) rules.frozen = false;
  if (/\btighten\b/.test(t) && /\bcap\b/.test(t)) rules.tighter = true;
  if (/\bloosen\b/.test(t) && /\bcap\b/.test(t)) rules.looser = true;
  if (rules.tighter || rules.looser || rules.frozen != null) return { ok: true, kind: 'rules', ...rules };
  const post = raw.match(/\bpost\b(?:\s+a)?\s+(.+?)\s+for\s+(\d+(?:\.\d+)?)\s*near\b/i);
  if (post) return { ok: true, kind: 'post', task: post[1].trim(), near: post[2] };
  if (/\blist\b/.test(t) && /\b(lamplighter|agent|market)\b/.test(t)) return { ok: true, kind: 'list' };
  if (/\b(bounty|hire)\b/.test(t)) {
    return { ok: false, kind: 'miss', hint: 'This tray does not pay townhall.nearcarta.near. Post a job and name two workers. Nothing was signed.' };
  }
  return { ok: false, kind: 'miss', hint: HALL_HINT };
}

export function listingView(status) {
  if (!status || status.blocked === 'no_token') {
    return {
      ok: false,
      blocked: 'no_token',
      hint: 'Listing is blocked: no Agent Market token is set. The Lamplighter form is ready. Nothing was sent to the market.',
      draft: status?.draft || LAMPLIGHTER_REGISTER,
    };
  }
  if (status.blocked) {
    return {
      ok: false,
      blocked: status.blocked,
      hint: status.blocked === 'bad_token'
        ? 'The Agent Market token was refused. Nothing was listed.'
        : 'The market did not answer. Nothing was listed.',
      draft: status.draft || LAMPLIGHTER_REGISTER,
      agent: status.agent || null,
    };
  }
  const name = status.agent?.name || LAMPLIGHTER_REGISTER.name;
  const n = Array.isArray(status.assignments) ? status.assignments.length : 0;
  return {
    ok: true,
    blocked: null,
    hint: status.agent?.listed ? `${name} is on the market. ${n} open assignment${n === 1 ? '' : 's'}.` : `${name} is not listed yet. ${n} open assignment${n === 1 ? '' : 's'}.`,
    agent: status.agent || null,
    assignments: status.assignments || [],
    draft: status.draft || LAMPLIGHTER_REGISTER,
  };
}
