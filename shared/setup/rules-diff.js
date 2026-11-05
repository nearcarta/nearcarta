// Sign step for a row that is already on the board.
// Saved rules (cap, daily budget, payments per day, receiver set) are compared
// with get_charter. A difference is what Update my rules writes:
// set_rules (0.001 NEAR deposit) and set_calls (CALLS_DEPOSIT_YOCTO).
// set_agent is included only when the row's key is not the key in this browser.
// Unused deposit is refunded by charge / charge_len.
// Source: contracts/charter_board/src/lib.rs set_rules, set_calls, set_agent, charge.
import { CALLS_DEPOSIT_YOCTO } from '../board/session.js';

const MICRO = 10n ** 18n;
// 0.001 NEAR. set_rules attaches this; charge refunds whatever storage does not use.
export const RULES_DEPOSIT_YOCTO = (10n ** 21n).toString();

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Yocto string at 6 decimal places, the same rounding setup.js uses for rule args. */
export function nearToYocto(n) {
  const micro = Math.round(Number(n) * 1e6);
  if (!Number.isFinite(micro)) return '';
  return (BigInt(micro) * MICRO).toString();
}

/** NEAR text from a yocto amount. Exact for whole microNEAR (the rule fields). */
export function formatNear(yocto) {
  const micro = BigInt(String(yocto)) / MICRO;
  const neg = micro < 0n;
  const v = neg ? -micro : micro;
  const whole = v / 1_000_000n;
  const frac = (v % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${frac ? `${whole}.${frac}` : String(whole)} NEAR`;
}

function showNear(yocto) {
  try { return formatNear(yocto); } catch { return String(yocto ?? ''); }
}

function receiverSet(list) {
  return [...new Set((list || []).map(s => String(s).trim().toLowerCase()).filter(Boolean))].sort();
}

function sameReceivers(a, b) {
  const A = receiverSet(a), B = receiverSet(b);
  return A.length === B.length && A.every((x, i) => x === B[i]);
}

function showReceivers(list) {
  const names = (list || []).map(s => String(s).trim().toLowerCase()).filter(Boolean);
  return names.length ? names.join(', ') : 'nobody';
}

/**
 * Fields that differ between the saved form and a get_charter row.
 * Receivers are a set: order does not count. Session expiry is not compared.
 * @returns {{id:string,label:string,onChain:string,next:string}[]}
 */
export function rulesDiff(local, row) {
  if (!local || !row) return [];
  const out = [];
  const capY = nearToYocto(local.cap);
  if (capY !== String(row.per_action_cap ?? '')) out.push({ id: 'cap', label: 'Max per payment', onChain: showNear(row.per_action_cap), next: showNear(capY) });
  const dailyY = nearToYocto(local.daily);
  if (dailyY !== String(row.daily_budget ?? '')) out.push({ id: 'daily', label: 'Daily budget', onChain: showNear(row.daily_budget), next: showNear(dailyY) });
  if (Number(local.per) !== Number(row.max_actions_per_day)) out.push({ id: 'per', label: 'Payments per day', onChain: String(row.max_actions_per_day ?? ''), next: String(local.per) });
  if (!sameReceivers(local.receivers, row.receivers)) out.push({ id: 'receivers', label: 'Allowed shops', onChain: showReceivers(row.receivers), next: showReceivers(local.receivers) });
  return out;
}

/** Deposit sentence for the update button. Amounts come from the contract deposits, not a guess. */
export function updateCostLine() {
  const rules = formatNear(RULES_DEPOSIT_YOCTO).replace(/ NEAR$/, '');
  const calls = formatNear(CALLS_DEPOSIT_YOCTO).replace(/ NEAR$/, '');
  return `Attaches ${rules} NEAR to set_rules and ${calls} NEAR to set_calls. Unused deposit is refunded.`;
}

/**
 * Sign-step panel. Empty when the row is not live, the chain row is not loaded,
 * or the four fields match. Otherwise the diff, the cost, and Update my rules.
 */
export function signRulesUpdate({ live, local, row }) {
  const fields = live && row ? rulesDiff(local, row) : [];
  if (!fields.length) return { changed: false, html: '' };
  const lines = fields.map(f => `<li data-testid="diff-${esc(f.id)}">${esc(f.label)}: ${esc(f.onChain)} → ${esc(f.next)}</li>`).join('');
  const html = `<div class="preview" data-testid="setup-rules-diff"><p><b>On chain → New</b></p><ul>${lines}</ul></div>`
    + `<p class="small muted" data-testid="sign-update-cost">${esc(updateCostLine())}</p>`
    + `<button type="button" class="btn gold big" data-testid="setup-update-rules">Update my rules</button>`;
  return { changed: true, html };
}

/** Rules-step note. Edits on a live row are written by the Sign step button. */
export function rulesLiveHint(live) {
  if (!live) return '';
  return '<p class="small" data-testid="rules-live-hint">Your row is already on chain. Edits on a live row apply when you press Update my rules on the Sign step.</p>';
}

/**
 * Transactions for an existing row. set_agent only when the key differs.
 * Deposits: 1 yocto for set_agent (storage charge), the given set_rules deposit, the set_calls deposit.
 */
export function updatePlan({ rowAgent, agentHex, rulesDepositYocto, callsDepositYocto }) {
  const txs = [];
  if (String(rowAgent || '') !== String(agentHex || '')) txs.push({ key: 'agent', method: 'set_agent', deposit: '1' });
  txs.push({ key: 'rules', method: 'set_rules', deposit: String(rulesDepositYocto) });
  txs.push({ key: 'calls', method: 'set_calls', deposit: String(callsDepositYocto) });
  return txs;
}
