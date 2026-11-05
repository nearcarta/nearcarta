// Own-row changes on the mainnet board. Gas only, 0 deposit.
// This module builds the calls and the diff. It does not sign.

export const BOARD = 'board.nearcarta.near';
export const ROW_WAIT_MS = 5000;

export function rowWaitWhy(ms = ROW_WAIT_MS) {
  const sec = Math.max(1, Math.round(Number(ms) / 1000));
  return `The row read did not answer in ${sec} ${sec === 1 ? 'second' : 'seconds'}.`;
}

/** The row read has to settle, or the caller shows rowWaitWhy. A late answer is still the caller's to paint. */
export function withRowWait(work, ms = ROW_WAIT_MS) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(rowWaitWhy(ms));
      err.code = 'row-wait';
      reject(err);
    }, ms);
  });
  return Promise.race([
    Promise.resolve().then(() => (typeof work === 'function' ? work() : work)),
    timeout,
  ]).finally(() => clearTimeout(timer));
}

export const PREVIEW_ROW = {
  owner: 'preview.near',
  receivers: ['townhall.nearcarta.near'],
  per_action_cap: '2000000000000000000000000',
  daily_budget: '5000000000000000000000000',
  max_actions_per_day: 3,
  window_start_min: 0,
  window_end_min: 0,
  min_amount: '1000000000000000000000',
  expires_at: '0',
  frozen: false,
  sealed: false,
  agent: 'preview',
  nonce: '1',
  balance: '10000000000000000000000000',
  spent_today: '0',
  actions_today: 1,
};

const FIELDS = ['receivers', 'per_action_cap', 'daily_budget', 'max_actions_per_day', 'window_start_min', 'window_end_min', 'min_amount', 'expires_at', 'frozen', 'sealed'];

export function nearOf(yocto) {
  try { return Number(BigInt(yocto) / 10n ** 18n) / 1e6; } catch { return 0; }
}

export function yoctoOf(near) {
  const n = Number(near);
  if (!Number.isFinite(n) || n < 0) throw new Error('amount must be a number');
  return (BigInt(Math.round(n * 1e6)) * 10n ** 18n).toString();
}

/** A get_charter body, flat or nested under rules. */
export function normalizeRow(body) {
  const raw = body?.row && typeof body.row === 'object' ? body.row : (body && body.per_action_cap != null ? body : null);
  if (!raw || typeof raw !== 'object') return null;
  const rules = raw.rules && typeof raw.rules === 'object' ? raw.rules : raw;
  return {
    owner: raw.owner || body?.owner || '',
    receivers: [...(rules.receivers || raw.receivers || [])],
    per_action_cap: String(rules.per_action_cap ?? raw.per_action_cap ?? '0'),
    daily_budget: String(rules.daily_budget ?? raw.daily_budget ?? '0'),
    max_actions_per_day: Number(rules.max_actions_per_day ?? raw.max_actions_per_day ?? 0),
    window_start_min: Number(rules.window_start_min ?? raw.window_start_min ?? 0),
    window_end_min: Number(rules.window_end_min ?? raw.window_end_min ?? 0),
    min_amount: String(rules.min_amount ?? raw.min_amount ?? '0'),
    expires_at: String(rules.expires_at ?? raw.expires_at ?? '0'),
    frozen: !!(raw.frozen ?? rules.frozen),
    sealed: !!(raw.sealed ?? rules.sealed),
    agent: raw.agent || '',
    nonce: String(raw.nonce ?? '0'),
    balance: String(raw.balance ?? '0'),
    spent_today: String(raw.spent_today ?? '0'),
    actions_today: Number(raw.actions_today ?? 0),
  };
}

export function draftFrom(row, patch = {}) {
  const next = { ...row, receivers: [...(row.receivers || [])] };
  if (patch.capNear != null) next.per_action_cap = yoctoOf(patch.capNear);
  if (patch.frozen != null) next.frozen = !!patch.frozen;
  if (patch.sealed != null) next.sealed = !!patch.sealed;
  if (patch.commitment != null) next.sealCommitment = String(patch.commitment);
  return next;
}

export function diffCharter(before, after) {
  const out = [];
  for (const field of FIELDS) {
    const a = JSON.stringify(before?.[field] ?? null);
    const b = JSON.stringify(after?.[field] ?? null);
    if (a !== b) out.push({ field, from: before?.[field] ?? null, to: after?.[field] ?? null });
  }
  return out;
}

export function callsFor(before, draft) {
  const calls = [];
  const ruleKeys = ['receivers', 'per_action_cap', 'daily_budget', 'max_actions_per_day', 'window_start_min', 'window_end_min', 'min_amount', 'expires_at'];
  if (ruleKeys.some(k => JSON.stringify(before[k]) !== JSON.stringify(draft[k]))) {
    calls.push({
      method: 'set_rules',
      deposit: '0',
      args: {
        rules: {
          receivers: draft.receivers,
          per_action_cap: String(draft.per_action_cap),
          daily_budget: String(draft.daily_budget),
          max_actions_per_day: Number(draft.max_actions_per_day),
          window_start_min: Number(draft.window_start_min),
          window_end_min: Number(draft.window_end_min),
          min_amount: String(draft.min_amount),
          expires_at: String(draft.expires_at),
        },
      },
    });
  }
  if (!!before.frozen !== !!draft.frozen) calls.push({ method: 'set_frozen', deposit: '0', args: { frozen: !!draft.frozen } });
  if (!!before.sealed !== !!draft.sealed) calls.push({ method: 'set_seal', deposit: '0', args: { commitment: draft.sealed ? (draft.sealCommitment || '') : '' } });
  return calls;
}

/** A preview flag does not open the demo row. */
export function rowOwner({ owner = '', session = '' } = {}) {
  const id = String(owner || session || '').trim();
  if (!id || id === PREVIEW_ROW.owner) return { owner: null, demo: false };
  return { owner: id, demo: false };
}

/** Apply a draft the way a later get_charter read would look. Nothing is sent. */
export function readBack(draft) {
  return { ...draft, receivers: [...(draft.receivers || [])] };
}

/** True when every field the draft changed is already on the chain read. */
export function rowCaughtUp(before, draft, read) {
  if (!read) return false;
  const want = diffCharter(before, draft);
  if (!want.length) return true;
  return want.every(d => JSON.stringify(read[d.field]) === JSON.stringify(d.to));
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Poll until the status says the transaction is final, or the attempts run out. */
export async function waitForFinal(poll, { attempts = 6, pauseMs = 200, wait = sleep } = {}) {
  let last = null;
  for (let i = 0; i < attempts; i++) {
    last = await poll();
    if (last?.final === true || last?.pass === true) return { ready: true, ok: !!last?.pass, status: last, attempts: i + 1 };
    if (i + 1 < attempts) await wait(pauseMs);
  }
  return { ready: false, ok: false, status: last, attempts };
}

/** Re-read get_charter until the changed fields match the draft. A stale first read is not the answer. */
export async function readUntilChange({ before, draft, read, attempts = 6, pauseMs = 250, wait = sleep } = {}) {
  let last = null;
  for (let i = 0; i < attempts; i++) {
    last = await read();
    if (rowCaughtUp(before, draft, last)) return { row: last, changed: true, attempts: i + 1 };
    if (i + 1 < attempts) await wait(pauseMs);
  }
  return { row: last, changed: false, attempts };
}

/** No call when the form already matches the row. Names the cap instead of "0 calls". */
export function matchNote(before, draft) {
  const calls = callsFor(before, draft);
  if (calls.length) return { calls, text: '' };
  return { calls, text: `The form matches the row. Cap is ${nearOf(before.per_action_cap)} NEAR.` };
}
