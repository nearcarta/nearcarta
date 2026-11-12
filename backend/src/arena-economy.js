// Arena guardians and chain score. Read-only. This process does not sign.
import { ARENA } from './arena.js';
import { chainScore, SIM_LABEL, simulateWeek } from '../../app/src/panels/arena/economy.js';

const NOTE = 'No guardian is invented. Arena v2 is not deployed, and the deployed contract is not a player-owned pot.';

export function guardiansPayload(rows = []) {
  const guardians = (Array.isArray(rows) ? rows : []).map(row => ({
    id: String(row.token_id ?? row.id ?? ''),
    title: row.metadata?.title || row.title || String(row.token_id ?? row.id ?? ''),
    creator: row.owner_id || row.creator || '',
    pot: row.pot ?? '—',
    fee: row.fee ?? '—',
    source: 'deployed-v1',
  })).filter(g => g.id);
  return {
    contract: ARENA,
    live: 'blocked',
    tx: null,
    simulation: false,
    inference_budget: null,
    verifier: 'unverified',
    guardians,
    note: guardians.length
      ? 'These names are tokens on the deployed contract. They are not arena v2 pots, and this API does not sign.'
      : NOTE,
  };
}

export function removedMarket(week = 0) {
  const n = Math.max(0, Math.min(7, Number(week) || 0));
  if (n > 0) {
    const sim = simulateWeek([], n);
    return { ...sim, label: SIM_LABEL, stalls: [], removed: true, contract: ARENA };
  }
  return {
    contract: ARENA,
    removed: true,
    simulation: false,
    tx: null,
    stalls: [],
    label: 'The stall market is gone. Nothing was signed.',
  };
}

/** The live arena account runs the market crate when `get_config` reports market caps. */
export async function isMarket(viewFn, contract = ARENA) {
  try { const c = await viewFn(contract, 'get_config', {}); return !!(c && c.caps && 'gathers_per_day' in c.caps); } catch { return false; }
}

export async function readGuardians(viewFn, contract = ARENA) {
  if (typeof viewFn !== 'function') return guardiansPayload([]);
  // On mainnet arena.nearcarta.near is the market: it has no guardians, `fund` or `attempt`.
  // Say so plainly, so the tray shows the market instead of buttons the contract cannot answer.
  if (await isMarket(viewFn, contract)) {
    return { ...guardiansPayload([]), market: true, live: 'market', note: `${contract} runs the city market (sell, buy, quote, stalls). It has no guardians.` };
  }
  try {
    const tokens = await viewFn(contract, 'nft_tokens', { from_index: '0', limit: 20 });
    return guardiansPayload(Array.isArray(tokens) ? tokens : []);
  } catch {
    return { ...guardiansPayload([]), note: 'The guardian list did not answer. Nothing was invented.' };
  }
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
  return { contract, tx: null, ...chainScore(attempts, player) };
}
