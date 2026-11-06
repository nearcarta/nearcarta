// Sign step for a row that is already on the board.
// Saved rules (cap, daily budget, payments per day, receiver set) are compared
// with get_charter. A difference is what Update my rules writes:
// set_rules (0.001 NEAR deposit) and set_calls (CALLS_DEPOSIT_YOCTO).
// set_agent is included only when the row's key is not the key in this browser.
// Unused deposit is refunded by charge / charge_calls_and_reserve.
// Source: contracts/charter_board/src/lib.rs set_rules, set_calls, set_agent, charge.
import { CALLS_DEPOSIT_YOCTO, sessionExpiresAt } from '../board/session.js';

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

/** Calendar day for a chain expires_at (nanoseconds). With time, the UTC clock is included. */
export function formatExpiry(ns, withTime = false) {
  if (ns == null || ns === '' || ns === '0') return 'none';
  try {
    const ms = Number(BigInt(ns) / 1_000_000n);
    if (!Number.isFinite(ms)) return 'none';
    const date = new Date(ms).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
    if (!withTime) return date;
    const time = new Date(ms).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' });
    return `${date} ${time} UTC`;
  } catch { return 'none'; }
}

/** Visible expiry change. Same calendar text is hidden. Same day with a different clock shows the time. */
export function expiryChange(onChainNs, nextNs) {
  if (nextNs == null || nextNs === '') return null;
  if (String(onChainNs ?? '') === String(nextNs)) return null;
  const dayOn = formatExpiry(onChainNs);
  const dayNext = formatExpiry(nextNs);
  if (dayOn === dayNext) {
    return { id: 'expires', label: 'Expires', onChain: formatExpiry(onChainNs, true), next: formatExpiry(nextNs, true) };
  }
  return { id: 'expires', label: 'Expires', onChain: dayOn, next: dayNext };
}

/**
 * Expiry written by Update my rules.
 * The chain date stays unless the visitor changed the session control.
 * A fresh row (no chain date) uses now plus the chosen hours.
 */
export function expiresToWrite({ hoursEdited, hours, chainExpiresAt, nowMs = Date.now() }) {
  if (!hoursEdited && chainExpiresAt != null && String(chainExpiresAt) !== '' && String(chainExpiresAt) !== '0') return String(chainExpiresAt);
  return sessionExpiresAt(hours, nowMs);
}

/**
 * Fields that differ between the saved form and a get_charter row.
 * Receivers are a set: order does not count.
 * Expiry is compared only when local.expiresAt is set (the value we will write).
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
  const exp = expiryChange(row.expires_at, local.expiresAt);
  if (exp) out.push(exp);
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

/** Shown when set_rules landed and set_calls did not, so the diff is empty but the allowlist is stale. */
export function callsFailedPanel() {
  return `<p class="small" data-testid="sign-calls-failed">set_rules is on chain. set_calls was refused, so the shop allowlist is unchanged. Update my rules tries again.</p>`
    + `<p class="small muted" data-testid="sign-update-cost">${esc(updateCostLine())}</p>`
    + `<button type="button" class="btn gold big" data-testid="setup-update-rules">Update my rules</button>`;
}

/**
 * Words for a partial Update my rules. The raw panic names no method.
 * ERR_RECEIVERS is set_calls (duplicate pair, or more than 24).
 * ERR_ROW_TOO_BIG is also set_calls: the row holds 0.02 NEAR of storage and a long
 * shop list can exceed it.
 * ERR_DEPOSIT is set_calls with a deposit under the trie bytes it writes.
 */
export function plainRulesError(error, { rulesSaved = false } = {}) {
  const t = String(error?.message || error || '');
  let why = '';
  if (/ERR_RECEIVERS/.test(t)) why = 'set_calls was refused: the shop list repeats an account and a method, or it names more than 24.';
  else if (/ERR_ROW_TOO_BIG/.test(t)) why = 'set_calls was refused: this shop list does not fit a row that holds 0.02 NEAR. Remove a shop or use a shorter account id.';
  else if (/ERR_DEPOSIT/.test(t)) why = 'set_calls was refused: the deposit did not cover the storage this list writes. Reload the page and try again.';
  if (!why) return t.replace(/^Smart contract panicked:\s*/i, '');
  return rulesSaved ? `set_rules was saved. ${why}` : why;
}

const TX_HASH = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;

/** Hashes a wallet error may carry. The panic text itself has none. */
export function hashesFromError(error) {
  const out = [];
  const push = h => { if (typeof h === 'string' && TX_HASH.test(h) && !out.includes(h)) out.push(h); };
  const walk = (v, d) => {
    if (v == null || d > 5) return;
    if (typeof v === 'string') {
      const found = v.match(/[1-9A-HJ-NP-Za-km-z]{43,44}/g) || [];
      found.forEach(push);
      return;
    }
    if (Array.isArray(v)) { v.forEach(x => walk(x, d + 1)); return; }
    if (typeof v !== 'object') return;
    push(v.txHash);
    push(v.hash);
    push(v.transaction?.hash);
    push(v.transaction_outcome?.id);
    for (const k of ['transactions', 'outcomes', 'results', 'response']) if (v[k] != null) walk(v[k], d + 1);
  };
  walk(error, 0);
  if (typeof error?.message === 'string') walk(error.message, 0);
  return out;
}

/**
 * Newest matching outgoing tx. rows are the nearblocks txns-only shape.
 * ok true keeps a success, ok false keeps a failure, ok omitted keeps either.
 */
export function txHashForMethod(rows, { contract, method, ok } = {}) {
  for (const t of rows || []) {
    const recv = t?.receiver_account_id || t?.receiver;
    if (contract && recv !== contract) continue;
    if (!(t?.actions || []).some(a => (a.method || a.method_name) === method)) continue;
    const success = t.outcomes?.status !== false && t.status !== false;
    if (ok === true && !success) continue;
    if (ok === false && success) continue;
    const hash = t.transaction_hash || t.hash;
    if (typeof hash === 'string' && hash) return hash;
  }
  return null;
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
