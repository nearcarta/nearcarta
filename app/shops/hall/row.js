// Own-row changes on the mainnet board. Gas only, 0 deposit.
// This module builds the calls and the diff. It does not sign.

export const BOARD = 'board.nearcarta.near';

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

/** preview opens the demo row. A real owner or the saved session never falls back to it. */
export function rowOwner({ preview = false, owner = '', session = '' } = {}) {
  if (preview) return { owner: PREVIEW_ROW.owner, demo: true };
  const id = String(owner || session || '').trim();
  if (!id || id === PREVIEW_ROW.owner) return { owner: null, demo: false };
  return { owner: id, demo: false };
}

/** Apply a draft the way a later get_charter read would look. Nothing is sent. */
export function readBack(draft) {
  return { ...draft, receivers: [...(draft.receivers || [])] };
}
