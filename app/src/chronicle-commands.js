// Plain-language commands for the Chronicle agent.
// The same actions the tray runs. Read-only requests do not sign.
import { exportCsv, exportJson, queryFeed, verifyEntry } from './chronicle-feed.js';

export const MISS_HINT = 'Try “Show refused payments”, “Export today’s ledger”, “Write statement”, or “Verify” plus a transaction hash.';

const HASH = /[1-9A-HJ-NP-Za-km-z]{43,44}/;
const NAMED = /\b((?:[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?\.)+(?:near|tg))\b/i;
const IMPLICIT = /\b([0-9a-f]{64})\b/i;
const SHOPS = ['toll', 'ferry', 'guard', 'payouts', 'house', 'board', 'hall', 'arena', 'bank', 'chronicle', 'ledger'];

export function parseAccountId(text) {
  const raw = String(text || '');
  const hex = raw.match(IMPLICIT);
  if (hex) return hex[1].toLowerCase();
  const named = raw.match(NAMED);
  return named ? named[1].toLowerCase() : '';
}

function decisionOf(line) {
  const refused = /\b(refus\w*|denied|reject\w*)\b/.test(line);
  const spent = /\b(spent|spend\w*|paid|pay|sent|allow\w*)\b/.test(line);
  if (refused && spent) return '';
  if (refused) return 'denied';
  if (spent) return 'allowed';
  return '';
}

function spanOf(line) {
  if (/\b(today|todays)\b/.test(line)) return 'today';
  if (/\b(7\s*days|seven days|last week|this week|week)\b/.test(line)) return '7d';
  if (/\b(all time|everything|all history)\b/.test(line)) return 'all';
  return '';
}

export function isoDay(now = new Date()) {
  const d = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function norm(text) {
  return String(text || '').trim().toLowerCase().replace(/[’']/g, '');
}

export function parseChronicleCommand(text) {
  const raw = String(text || '').trim();
  const line = norm(raw);
  if (!line) return { ok: false, action: 'miss', hint: `Type a command. ${MISS_HINT}` };
  const today = /\btodays?\b/.test(line);
  const account = parseAccountId(raw);
  const span = spanOf(line);
  const shop = SHOPS.find(s => new RegExp(`\\b${s}\\b`).test(line)) || '';
  const decision = decisionOf(line);
  if (account) {
    return { ok: true, action: 'query', account, decision, today, span: span || (today ? 'today' : 'all'), shop, hint: '' };
  }
  if (/\b(add|record)\b/.test(line) && /\b(entry|ledger|payment)\b/.test(line)) {
    return { ok: true, action: 'nospend', hint: '' };
  }
  if (/\banchor\b/.test(line)) return { ok: true, action: 'anchor', hint: '' };
  if (/\b(statement|audit)\b/.test(line)) return { ok: true, action: 'statement', hint: '' };
  const hash = raw.match(HASH);
  if (/\b(verify|check)\b/.test(line)) {
    if (!hash) return { ok: false, action: 'miss', hint: `Name the transaction hash to verify. ${MISS_HINT}` };
    return { ok: true, action: 'verify', hash: hash[0], hint: '' };
  }
  if (hash && raw.trim() === hash[0]) return { ok: true, action: 'verify', hash: hash[0], hint: '' };
  if (/\b(export|csv|json|download)\b/.test(line)) {
    return { ok: true, action: 'export', today, json: /\bjson\b/.test(line), hint: '' };
  }
  if (/\b(refus\w*|denied|reject\w*)\b/.test(line)) {
    return { ok: true, action: 'filter', decision: 'denied', today, q: '', hint: '' };
  }
  if (/\b(allow\w*|paid)\b/.test(line) && /\b(show|list|filter|only)\b/.test(line)) {
    return { ok: true, action: 'filter', decision: 'allowed', today, q: '', hint: '' };
  }
  const shops = ['toll', 'ferry', 'guard', 'payouts', 'house', 'board', 'hall', 'arena', 'bank', 'chronicle'];
  if (/\b(show|list|find|search|feed)\b/.test(line)) {
    const shop = shops.find(s => line.includes(s)) || '';
    return { ok: true, action: 'filter', decision: '', today, q: shop, hint: '' };
  }
  return { ok: false, action: 'miss', hint: MISS_HINT };
}

export async function runChronicleCommand({
  text, rows, state, now = new Date(), verify, downloadCsv: saveCsv, downloadJson: saveJson, onStatement, onAnchor, onRead, rowsOf,
} = {}) {
  const cmd = parseChronicleCommand(text);
  const bag = state || {};
  if (!cmd.ok) return { ...cmd, clearSeal: true, paint: false };
  if (cmd.action === 'nospend') {
    return { ok: true, action: 'nospend', hint: 'Chronicle does not charge an entry. Nothing was signed.', clearSeal: true, paint: false };
  }
  if (cmd.action === 'statement') {
    const res = typeof onStatement === 'function' ? await onStatement() : null;
    return { ok: true, action: 'statement', hint: res?.status || 'Local summary. Nothing was signed.', clearSeal: true, paint: true };
  }
  if (cmd.action === 'anchor') {
    const res = typeof onAnchor === 'function' ? await onAnchor() : null;
    return { ok: true, action: 'anchor', hint: res?.status || 'Live anchor blocked. Nothing was signed.', clearSeal: true, paint: false };
  }
  if (cmd.action === 'query') {
    bag.account = cmd.account;
    bag.accountDraft = cmd.account;
    bag.cd = cmd.decision || '';
    bag.shop = cmd.shop || '';
    bag.span = cmd.span || 'all';
    bag.day = cmd.today ? isoDay(now) : '';
    bag.cq = '';
    bag.tab = 'timeline';
    if (typeof onRead === 'function') await onRead(cmd.account);
    const rowsNow = typeof rowsOf === 'function' ? rowsOf() : (bag.auditRows || rows || []);
    const q = queryFeed(rowsNow, { q: '', decision: bag.cd, day: bag.day, page: 1, pageSize: 500 });
    const shown = bag.shop ? q.rows.filter(r => r.shop === bag.shop) : q.rows;
    const allowed = shown.filter(r => r.decision === 'allowed').length;
    const denied = shown.filter(r => r.decision === 'denied').length;
    const hint = shown.length
      ? `${cmd.account} has ${shown.length} rows. ${allowed} allowed, ${denied} refused.`
      : `${cmd.account} has no rows in this view.`;
    bag.verify = hint;
    return { ok: true, action: 'query', hint, clearSeal: true, paint: true };
  }
  if (cmd.action === 'filter') {
    bag.cd = cmd.decision || '';
    bag.cq = cmd.q || '';
    bag.day = cmd.today ? isoDay(now) : '';
    bag.span = cmd.today ? 'today' : (bag.span || 'all');
    bag.cp = 1;
    bag.tab = 'timeline';
    const q = queryFeed(rows || [], { q: bag.cq, decision: bag.cd, day: bag.day, page: 1 });
    const hint = q.total ? `Showing ${q.total}.` : (cmd.today ? 'No rows are dated today.' : 'Nothing matches.');
    return { ok: true, action: 'filter', hint, clearSeal: true, paint: true };
  }
  if (cmd.action === 'export') {
    const day = cmd.today ? isoDay(now) : (bag.day || '');
    const q = queryFeed(rows || [], { q: bag.cq || '', decision: bag.cd || '', day, page: 1, pageSize: 500 });
    const body = cmd.json ? exportJson(q.rows) : exportCsv(q.rows);
    const name = cmd.today ? (cmd.json ? 'chronicle-today.json' : 'chronicle-today.csv') : (cmd.json ? 'chronicle.json' : 'chronicle.csv');
    if (q.total) {
      if (cmd.json) saveJson?.(body, name);
      else saveCsv?.(body, name);
    }
    bag.tab = 'timeline';
    bag.day = day;
    const hint = q.total ? `Exported ${q.total} rows.` : (cmd.today ? 'No rows are dated today.' : 'Nothing to export.');
    bag.verify = hint;
    bag.verifyUrl = '';
    return { ok: true, action: 'export', hint, clearSeal: true, paint: true };
  }
  if (cmd.action === 'verify') {
    const row = (rows || []).find(r => r.h === cmd.hash) || { h: cmd.hash, signer: '' };
    let chain = null;
    try { chain = typeof verify === 'function' ? await verify(row) : null; }
    catch { chain = null; }
    const v = verifyEntry(row, chain);
    bag.verify = chain ? v.text : (v.url ? v.text : 'The chain check did not answer.');
    bag.verifyUrl = v.url || '';
    bag.hash = cmd.hash;
    bag.tab = 'verify';
    if (chain && v.ok === false) {
      const seal = 'Chain refused. This transaction did not succeed.';
      bag.seal = seal;
      return { ok: true, action: 'verify', hint: bag.verify, seal, paint: true };
    }
    return { ok: true, action: 'verify', hint: bag.verify, clearSeal: true, paint: true };
  }
  return { ok: false, action: 'miss', hint: MISS_HINT, clearSeal: true };
}
