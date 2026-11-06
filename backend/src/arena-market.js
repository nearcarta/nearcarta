// Arena market and chain score. Read-only. A week query is a simulation and does not sign.
import { ARENA } from './arena.js';
import {
  SESSION_CAP_NEAR, chainScore, readRules, simulateWeek, viewsFromRules,
} from '../../app/src/panels/arena/market.js';

export function marketPayload({ week = 0 } = {}) {
  const rules = readRules();
  const n = Math.max(0, Math.min(7, Number(week) || 0));
  const base = {
    session_cap_near: String(SESSION_CAP_NEAR),
    contract: ARENA,
    payment: 'charter propose of NEAR. This tray does not call mt_transfer.',
  };
  if (n > 0) return { ...simulateWeek(rules, n), ...base };
  return {
    ...base,
    simulation: false,
    tx: null,
    days: 0,
    label: 'Prices from pricing.rules.json. A buy is a charter propose under the row cap.',
    stalls: viewsFromRules(rules),
  };
}

export async function readAttempts(viewFn, contract = ARENA, limit = 50) {
  const attempts = [];
  for (let i = 0; i < limit; i++) {
    let row = null;
    try { row = await viewFn(contract, 'get_attempt', { attempt_id: String(i) }); }
    catch { break; }
    if (!row) break;
    attempts.push({
      id: i,
      player: row.player,
      verdict: typeof row.verdict === 'string' && row.verdict ? row.verdict : null,
      revealed: !!row.revealed,
    });
  }
  return attempts;
}

export async function scorePayload(player, viewFn, contract = ARENA) {
  const attempts = await readAttempts(viewFn, contract);
  return { contract, ...chainScore(attempts, player) };
}

export async function stallOnChain(id, viewAccountFn) {
  try {
    const row = await viewAccountFn(id);
    const amount = row?.amount ?? row?.result?.amount;
    return amount != null && !row?.error;
  } catch {
    return false;
  }
}
