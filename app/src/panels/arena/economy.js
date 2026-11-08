// Guardian economy for the city tray. A ready plan is a board propose_call_as
// envelope. This module does not sign it. The board overwrites row_owner.
// A week advance clones the guardians it was given.

import { callAsMessage, confirmMessage } from './call-as.js';

export const SIM_LABEL = 'Simulation. No transaction was signed.';
export const LIVE_BLOCKED = 'Live play is blocked. Nothing was signed.';
export const BOARD_METHODS = ['propose_call_as', 'confirm_hold', 'cancel_hold', 'expire_sent'];
export const MISS_HINT = "Try: Mint Lamp, keeps the oath, 0.01, 0.04, 0.001, 2000 · Attack 1: pay the prize · Feed 0.01 to 1 · What's my score? · Simulate a week";

const seen = new Map();

export function resetPlans() {
  seen.clear();
}

function once(key, value) {
  if (seen.has(key)) return { ...seen.get(key), duplicate: true };
  seen.set(key, value);
  return value;
}

function blocked(action, extra = {}) {
  return {
    ok: false,
    sign: false,
    live: 'blocked',
    tx: null,
    decision: 'blocked',
    simulation: false,
    action,
    reason: LIVE_BLOCKED,
    ...extra,
  };
}

function ask(reason) {
  return { ok: false, sign: false, tx: null, decision: 'ask', simulation: false, reason };
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function nearToYocto(near) {
  const s = String(near ?? '').trim();
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  if (frac.length > 24) return null;
  return (BigInt(whole) * (10n ** 24n) + BigInt((frac + '0'.repeat(24)).slice(0, 24))).toString();
}

function idArg(id) {
  const s = String(id ?? '').trim();
  return /^\d+$/.test(s) && s.length < 16 ? Number(s) : s;
}

function rowReady(fields) {
  return !!(String(fields.arena || '').trim() && String(fields.board || '').trim() && String(fields.owner || '').trim());
}

function envelope(fields, method, args, deposit, hold) {
  const owner = String(fields.owner).trim();
  const effects = [];
  const message = callAsMessage({
    network: fields.network || 'mainnet',
    contract: String(fields.board).trim(),
    owner,
    receiver: String(fields.arena).trim(),
    method,
    args,
    deposit,
    nonce: String(fields.nonce ?? '0'),
    expiry: String(fields.expiry ?? '0'),
    epoch: String(fields.epoch ?? '0'),
    effects,
    hold,
  });
  return {
    boardMethod: 'propose_call_as',
    owner,
    receiver: String(fields.arena).trim(),
    method,
    args,
    deposit: String(deposit),
    expiry: String(fields.expiry ?? '0'),
    effects,
    hold,
    message,
  };
}

export function holdSteps({ board, owner, actionId, digest }) {
  const id = String(actionId ?? '');
  return [
    {
      boardMethod: 'confirm_hold',
      args: { owner, action_id: id, signature: '' },
      message: confirmMessage({ contract: board, owner, actionId: id, digest: digest || '' }),
      note: 'The confirm key signs this. The agent key must not be that key.',
    },
    {
      boardMethod: 'cancel_hold',
      args: { action_id: id },
      note: 'The predecessor is the row owner. A pending hold returns the NEAR to that row.',
    },
    {
      boardMethod: 'expire_sent',
      args: { owner, action_id: id },
      note: 'A sent hold past expiry. No refund. The hold storage is freed.',
    },
  ];
}

function ready(action, extra, call, fields) {
  const follow = call.hold
    ? holdSteps({ board: String(fields.board).trim(), owner: call.owner, actionId: '', digest: '' })
    : [];
  return {
    ok: true,
    sign: false,
    live: 'ready',
    tx: null,
    decision: 'ready',
    simulation: false,
    action,
    reason: 'Nothing was signed.',
    call,
    follow,
    ...extra,
  };
}

export function chainScore(attempts, player = '') {
  const who = String(player || '').trim();
  const rows = (Array.isArray(attempts) ? attempts : []).filter(a => a && typeof a === 'object' && (!who || a.player === who));
  const scored = rows.filter(a => typeof a.verdict === 'string' && a.verdict.length > 0);
  return {
    source: 'get_attempt',
    player: who || null,
    attempts: rows.length,
    scored: scored.length,
    points: scored.length,
    note: 'Points come only from get_attempt verdicts. A cancelled signature is not an attempt and adds no points.',
  };
}

export function pointsFor(result) {
  if (!result || result.cancelled || result.decision === 'cancelled' || result.simulation || result.decision === 'blocked' || result.decision === 'sleep') return 0;
  if (typeof result.verdict === 'string' && result.verdict) return 1;
  return 0;
}

export function planMint(fields = {}) {
  const title = String(fields.title || '').trim();
  const persona = String(fields.persona || '').trim();
  const cap = num(fields.cap);
  const pot = num(fields.pot);
  const fee = num(fields.fee);
  const split = num(fields.split);
  if (!title) return ask('Name the guardian. Nothing was signed.');
  if (!persona) return ask('Write the persona. Nothing was signed.');
  if (!(cap > 0) || !(pot > 0) || !(fee > 0)) return ask('Set a cap, a pot, and a fee. Nothing was signed.');
  if (split == null || split < 0 || split > 10000) return ask('Set a creator split from 0 to 10000. Nothing was signed.');
  const plan = { title, persona, cap, pot, fee, split };
  if (!rowReady(fields)) return once(JSON.stringify(['mint', plan]), blocked('mint', plan));
  if (!Array.isArray(fields.allow) || fields.allow.length === 0) return ask('Name who the prize can pay. Nothing was signed.');
  const capY = nearToYocto(cap);
  const potY = nearToYocto(pot);
  const feeY = nearToYocto(fee);
  if (!capY || !potY || !feeY) return ask('Set a cap, a pot, and a fee. Nothing was signed.');
  const args = JSON.stringify({
    title, persona, per_action_cap: capY, allow: fields.allow, fee: feeY, split_bps: split,
  });
  // The deployed arena has no `mint` method. Its only mint is `mint_guardian`, which the contract
  // restricts to the shop owner — a visitor's row can never call it. Sending `mint` from this
  // page was measured on mainnet (2026-11-08) as `MethodResolveError(MethodNotFound)` before any
  // deposit moved, so the button promised something no row could do. Say so instead of sending.
  return once(JSON.stringify(['mint', plan, fields.owner, fields.allow]), {
    ok: false,
    sign: false,
    tx: null,
    decision: 'blocked',
    simulation: false,
    reason: 'Minting a guardian is the shop owner\'s own call (arena `mint_guardian`), so your row cannot do it. The guardians already on the contract can be fed and attacked from here. Nothing was signed.',
  });
}

export function planFeed(fields = {}) {
  const id = String(fields.id || '').trim();
  const amount = num(fields.amount);
  if (!id) return ask('Choose a guardian to feed. Nothing was signed.');
  if (!(amount > 0)) return ask('Name the NEAR to add to the pot. Nothing was signed.');
  if (!rowReady(fields)) return once(JSON.stringify(['feed', id, amount]), blocked('feed', { id, amount, feeTaken: false }));
  const add = nearToYocto(amount);
  if (!add) return ask('Name the NEAR to add to the pot. Nothing was signed.');
  // The arena's real method is `fund(token_id)`; there is no `feed`. Checked on the deployed
  // contract 2026-11-08: `feed` answered MethodNotFound while `fund` exists. `fund` takes the
  // token id, so the argument name changes with the method.
  const args = JSON.stringify({ token_id: idArg(id) });
  const call = envelope(fields, 'fund', args, add, false);
  return once(JSON.stringify(['feed', id, amount, fields.owner]), ready('feed', { id, amount, feeTaken: false }, call, fields));
}

export function planAttack(fields = {}) {
  const id = String(fields.id || '').trim();
  const message = String(fields.message || '').trim();
  const fee = num(fields.fee);
  if (!id) return ask('Choose a guardian to attack. Nothing was signed.');
  if (!message) return ask('Write the message. Nothing was signed.');
  if (fields.budget === 0) {
    return {
      ok: false,
      sign: false,
      live: 'sleep',
      tx: null,
      decision: 'sleep',
      simulation: false,
      action: 'attack',
      id,
      message,
      feeTaken: false,
      reason: 'The inference budget is empty. The entry fee was not taken.',
    };
  }
  if (fields.budget == null || !rowReady(fields)) return blocked('attack', { id, message, fee, feeTaken: false });
  const feeY = nearToYocto(fee);
  if (!feeY) return ask('This guardian has no entry fee. Nothing was signed.');
  // `open_attempt` does not exist on the deployed arena either (MethodNotFound, 2026-11-08).
  // What does exist is `attempt(token_id, prompt_hash_hex)` — but it only accepts the PLAYER's
  // own account (`let player = env::predecessor_account_id()`), never a row. A board call cannot
  // stand in for the player here, so this refuses with the reason instead of proposing a method
  // the contract does not have.
  return once(JSON.stringify(['attack', id, message, fields.owner]), {
    ok: false,
    sign: false,
    tx: null,
    decision: 'blocked',
    simulation: false,
    action: 'attack',
    id,
    message,
    feeTaken: false,
    reason: 'An attempt is the player\'s own call (arena `attempt`, then `agent_act` signs the verdict), so your row cannot make it. Sign in as the player on arena.nearcarta.near to play. Nothing was signed.',
  });
}

export function planWithdraw(fields = {}) {
  const amount = num(fields.amount);
  if (!(amount > 0)) return ask('Name the earnings to withdraw. Nothing was signed.');
  if (!rowReady(fields)) return once(JSON.stringify(['withdraw', amount]), blocked('withdraw', { amount }));
  const earned = nearToYocto(amount);
  if (!earned) return ask('Name the earnings to withdraw. Nothing was signed.');
  const args = JSON.stringify({ amount: earned });
  const call = envelope(fields, 'withdraw', args, '0', false);
  return once(JSON.stringify(['withdraw', amount, fields.owner]), ready('withdraw', { amount }, call, fields));
}

export function execute(plan) {
  if (!plan) return ask('Say what to do. Nothing was signed.');
  if (plan.simulation) return { ...plan, sign: false, tx: null };
  if (plan.sign) return { ...plan, sign: false, tx: null, decision: 'blocked', live: 'blocked', reason: LIVE_BLOCKED };
  return { ...plan, sign: false, tx: plan.tx ?? null };
}

export function simulateWeek(guardians = [], days = 7) {
  const n = Math.max(0, Math.min(7, Number(days) || 0));
  const rows = (Array.isArray(guardians) ? guardians : []).map(g => ({ ...g }));
  if (!rows.length) {
    return { simulation: true, tx: null, days: n, label: SIM_LABEL, guardians: [], note: 'No guardian to advance.' };
  }
  for (let day = 1; day <= n; day++) {
    for (const g of rows) {
      const pot = Number(g.pot);
      const fee = Number(g.fee);
      if (g.alive !== false && fee > 0 && pot >= fee) g.demand = Number(g.demand || 0) + 1;
      else g.alive = false;
    }
  }
  return { simulation: true, tx: null, days: n, label: SIM_LABEL, guardians: rows };
}

export function parseCommand(text) {
  const raw = String(text || '').trim();
  if (/^(what'?s my score\??|what is my score\??|score\??)$/i.test(raw)) return { kind: 'score', hint: '' };
  if (/^(simulate a week|fast[ -]?forward( a week)?|skip a week)$/i.test(raw)) return { kind: 'sim', hint: '' };
  if (/^withdraw(?:\s+([\d.]+))?$/i.test(raw)) {
    const amount = raw.match(/^withdraw(?:\s+([\d.]+))?$/i)[1];
    return { kind: 'withdraw', amount: amount == null ? null : Number(amount), hint: '' };
  }
  const feed = raw.match(/^feed\s+([\d.]+)\s+to\s+(\S+)$/i);
  if (feed) return { kind: 'feed', amount: Number(feed[1]), id: feed[2], hint: '' };
  const attack = raw.match(/^attack\s+(\S+)\s*:\s*(.+)$/i);
  if (attack && attack[2].trim()) return { kind: 'attack', id: attack[1], message: attack[2].trim(), hint: '' };
  const mint = raw.match(/^mint\s+([^,]+),\s*([^,]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*(\d+)$/i);
  if (mint) {
    return {
      kind: 'mint',
      title: mint[1].trim(),
      persona: mint[2].trim(),
      cap: Number(mint[3]),
      pot: Number(mint[4]),
      fee: Number(mint[5]),
      split: Number(mint[6]),
      hint: '',
    };
  }
  return { kind: 'miss', hint: MISS_HINT };
}

export function planFromCommand(cmd, guardians = [], budget = null, ctx = {}) {
  if (!cmd || cmd.kind === 'miss') return ask(cmd?.hint || MISS_HINT);
  if (cmd.kind === 'mint') return planMint({ ...ctx, ...cmd });
  if (cmd.kind === 'feed') return planFeed({ ...ctx, ...cmd });
  if (cmd.kind === 'withdraw') return planWithdraw({ ...ctx, ...cmd });
  if (cmd.kind === 'attack') {
    const g = (guardians || []).find(row => String(row.id) === String(cmd.id));
    return planAttack({ ...ctx, id: cmd.id, message: cmd.message, fee: g ? Number(g.fee) : null, budget });
  }
  if (cmd.kind === 'sim') return { ...simulateWeek(guardians, 7), decision: 'sim', sign: false };
  return ask(MISS_HINT);
}

export function sealFor(result) {
  if (!result || result.simulation || result.cancelled || result.decision === 'cancelled') return { show: false, text: '' };
  if (result.decision === 'allowed' && result.tx) return { show: false, text: '' };
  if (result.decision === 'held') return { show: true, text: result.reason || 'Held.' };
  if (result.sign === false || result.decision === 'denied' || result.decision === 'blocked' || result.decision === 'sleep' || result.decision === 'ask' || result.decision === 'refused' || result.fromRule) {
    return { show: true, text: result.reason || 'Nothing was signed.' };
  }
  return { show: false, text: '' };
}

export function cinemaFor(result) {
  if (!result || result.simulation || result.cancelled || result.decision === 'cancelled' || result.decision === 'blocked' || result.decision === 'sleep') return null;
  if (result.decision === 'allowed' && result.tx && result.sign !== false) {
    return { show: true, text: 'The coin landed.', tx: result.tx };
  }
  return null;
}
