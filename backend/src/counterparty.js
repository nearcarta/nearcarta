// Counterparty check: before an agent pays an account, answer allow / warn / block with reasons.
// Signals (all read-only): the account exists; the shared deny list (shared/guard/denylist.json, every entry
// carries tx evidence); a look-alike of a payee the charter already allows; account age (first tx in the FastNEAR
// tx index); whether it is a contract whose code changed recently (DeployContract / UseGlobalContract receipts);
// and prior confirmed payments to it from the same charter (get_action records on chain).
// block = do not sign. warn = ask the human. allow = sign. The charter still decides on chain either way.
import { readFileSync } from 'node:fs';
import { view as nearView, viewAccount as nearViewAccount } from './near.js';
import { fpost as fastPost } from './shops.js';

export const DENY = JSON.parse(readFileSync(new URL('../../shared/guard/denylist.json', import.meta.url), 'utf8'));
export const MAINNET_REFUSALS = JSON.parse(readFileSync(new URL('../../shared/guard/mainnet-refusals.json', import.meta.url), 'utf8'));
export function recordedRefusal(account, list = MAINNET_REFUSALS) {
  return (list?.entries || []).find(e => e.account === account) || null;
}
export const NEW_ACCOUNT_MS = 24 * 3600_000;
export const CODE_CHANGE_MS = 24 * 3600_000;
const EMPTY_CODE = '11111111111111111111111111111111';
const CODE_ACTIONS = new Set(['DeployContract', 'UseGlobalContract', 'DeterministicStateInit']);
const UNDO = { 4: 'a', 3: 'e', 1: 'il', 0: 'o', 5: 's', 7: 't', 8: 'b' };
const SUFFIX = /-(billing|invoice|refund|refunds|payments?|support|desk|secure|verify)$/;

/** Variants of a name with digits turned back into letters and billing-style suffixes cut. */
export function skeletons(account) {
  const [head, ...rest] = String(account).split('.');
  const tail = rest.join('.');
  const out = new Set();
  const base = head.replace(SUFFIX, '');
  for (const h of [head, base]) {
    let forms = [''];
    for (const ch of h) forms = forms.flatMap(f => (UNDO[ch] ? [...UNDO[ch]].map(l => f + l).concat(f + ch) : [f + ch])).slice(0, 64);
    for (const f of forms) out.add(tail ? `${f}.${tail}` : f);
  }
  return out;
}
/** The allowed payee this account imitates, or null. Never matches the account itself. */
export function lookalikeOf(account, allowed) {
  if (allowed.includes(account)) return null;
  const sk = skeletons(account);
  return allowed.find(a => a !== account && sk.has(a)) || null;
}

export function decide(signals) {
  const r = [];
  const s = signals;
  if (!s.exists) r.push({ level: 'block', code: 'account_missing', text: 'the account does not exist on chain' });
  if (s.deny) r.push({ level: 'block', code: 'denylisted', text: s.deny.reason, evidence: s.deny.evidence });
  if (s.lookalike_of) r.push({ level: 'block', code: 'lookalike', text: `looks like ${s.lookalike_of}, which you allow` });
  const trusted = s.allowlisted && s.prior_payments > 0;
  if (s.exists && !trusted && s.age_ms != null && s.age_ms < NEW_ACCOUNT_MS) r.push({ level: 'warn', code: 'new_account', text: `first seen ${Math.max(1, Math.round(s.age_ms / 3600_000))} h ago` });
  if (s.exists && s.age_ms == null) r.push({ level: 'warn', code: 'age_unknown', text: 'account age was not returned' });
  if (s.exists && (s.code_hash == null || s.code_hash === '')) r.push({ level: 'warn', code: 'code_unknown', text: 'code hash was not returned' });
  if (s.exists && s.code_hash === EMPTY_CODE && s.age_ms == null) r.push({ level: 'warn', code: 'unconfirmed', text: 'empty code hash and no account age' });
  if (s.index && s.index !== 'ok') r.push({ level: 'warn', code: 'index_unknown', text: 'the index did not answer' });
  if (s.code_changed_ms != null && s.code_changed_ms < CODE_CHANGE_MS) r.push({ level: 'warn', code: 'code_changed', text: `contract code changed ${Math.max(1, Math.round(s.code_changed_ms / 3600_000))} h ago`, evidence: [s.code_change_tx] });
  if (s.exists && !s.allowlisted && !s.prior_payments) r.push({ level: 'warn', code: 'no_history', text: 'not on your list and never paid before' });
  const verdict = r.some(x => x.level === 'block') ? 'block' : r.some(x => x.level === 'warn') ? 'warn' : 'allow';
  return { verdict, reasons: r };
}

/** Read every signal. deps are injectable for tests. */
export async function check(account, { charter = null, row = null, now = Date.now(), view = nearView, viewAccount = nearViewAccount, fpost = fastPost } = {}) {
  const s = { account, charter, exists: true, is_contract: false, allowlisted: false, prior_payments: 0, age_ms: null, first_seen: null, code_changed_ms: null, code_change_tx: null, lookalike_of: null, deny: null, index: 'ok' };
  s.deny = DENY.entries.find(e => e.account === account) || recordedRefusal(account);
  let acct = null;
  try { acct = await viewAccount(account); } catch (e) { if (/UNKNOWN_ACCOUNT|does not exist/.test(e.message)) s.exists = false; else throw e; }
  if (acct) { s.is_contract = acct.code_hash !== EMPTY_CODE || !!(acct.global_contract_hash || acct.global_contract_account_id); s.code_hash = acct.global_contract_hash || acct.code_hash; }
  // The charter's own allowlist and its confirmed payments.
  // A board row is the visitor's account. Its rules are on the board, not get_clauses on that account.
  if (row) {
    const allowed = [...new Set(row.receivers || [])];
    s.allowlisted = allowed.includes(account);
    s.lookalike_of = lookalikeOf(account, allowed);
    s.actions_scanned = 0;
    s.board_row = true;
  } else if (charter) {
    const [clauses, st] = await Promise.all([view(charter, 'get_clauses'), view(charter, 'get_state')]);
    const allowed = [...new Set(Object.values(clauses || {}).flatMap(c => c.receivers || []))];
    s.allowlisted = allowed.includes(account);
    s.lookalike_of = lookalikeOf(account, allowed);
    const hi = Number(st.next_action || 0), lo = Math.max(Number(st.prune_cursor || 0), hi - 25);
    const recs = await Promise.all(Array.from({ length: hi - lo }, (_, i) => view(charter, 'get_action', { action_id: String(lo + i) }).catch(() => null)));
    s.prior_payments = recs.filter(a => a && a.receiver === account && a.status === 'confirmed').length;
    s.actions_scanned = recs.length;
  }
  if (s.exists) {
    try {
      const page = await fpost('/account', { account_id: account, max_block_height: null });
      const txs = page.account_txs || page.txs || [];
      const txs_count = page.txs_count;
      if (txs.length) {
        const first = Number(BigInt(txs.at(-1).tx_block_timestamp) / 1_000_000n);
        s.first_seen = new Date(first).toISOString(); s.age_ms = now - first;
        if (txs_count > txs.length) s.age_note = 'older txs exist beyond the index page; age is a lower bound';
      }
      if (s.is_contract) {
        const recent = txs.filter(t => now - Number(BigInt(t.tx_block_timestamp) / 1_000_000n) < CODE_CHANGE_MS).slice(0, 20);
        const { transactions = [] } = recent.length ? await fpost('/transactions', { tx_hashes: recent.map(t => t.transaction_hash) }) : {};
        for (const t of transactions) {
          const hit = (t.receipts || []).find(r => r.receipt?.receiver_id === account && (r.receipt?.receipt?.Action?.actions || []).some(a => CODE_ACTIONS.has(typeof a === 'string' ? a : Object.keys(a)[0])));
          if (hit) { const at = Number(BigInt(hit.execution_outcome?.block_timestamp || t.execution_outcome?.block_timestamp || 0) / 1_000_000n); s.code_changed_ms = now - at; s.code_change_tx = t.transaction.hash; break; }
        }
      }
    } catch (e) { s.index = 'unavailable: ' + String(e.message).slice(0, 80); }
  }
  const d = decide(s);
  return { account, charter, verdict: d.verdict, reasons: d.reasons, signals: s, rule: 'block = the agent does not sign; warn = ask the human; allow = sign. The charter decides on chain either way.', checked_at: new Date(now).toISOString() };
}
