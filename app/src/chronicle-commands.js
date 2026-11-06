// Plain-language commands for the Chronicle agent.
// The same actions the buttons run: filter, export, verify, and the 0.001 entry.
import { exportCsv, exportJson, queryFeed, verifyEntry } from './chronicle-feed.js';

export const MISS_HINT = 'Try “Show refused payments”, “Export today’s ledger”, or “Verify” plus a transaction hash.';

const HASH = /[1-9A-HJ-NP-Za-km-z]{43,44}/;

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
  if (/\b(add|record|write)\b/.test(line) && /\b(entry|ledger|payment)\b/.test(line)) {
    return { ok: true, action: 'entry', hint: '' };
  }
  const hash = raw.match(HASH);
  if (/\b(verify|check)\b/.test(line)) {
    if (!hash) return { ok: false, action: 'miss', hint: `Name the transaction hash to verify. ${MISS_HINT}` };
    return { ok: true, action: 'verify', hash: hash[0], hint: '' };
  }
  if (hash && raw.trim() === hash[0]) {
    return { ok: true, action: 'verify', hash: hash[0], hint: '' };
  }
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
  text, rows, state, now = new Date(), verify, downloadCsv: saveCsv, downloadJson: saveJson, onEntry,
} = {}) {
  const cmd = parseChronicleCommand(text);
  const bag = state || {};
  if (!cmd.ok) return { ...cmd, clearSeal: true, paint: false };
  if (cmd.action === 'entry') {
    if (typeof onEntry !== 'function') {
      return { ok: false, action: 'entry', hint: 'Open the city Chronicle after setup. Nothing was signed.', clearSeal: false, seal: 'Open the city Chronicle after setup. Nothing was signed.', paint: true };
    }
    try {
      const res = await onEntry();
      return { ok: !!res?.ok, action: 'entry', hint: res?.hint || res?.say || '', seal: res?.seal || '', clearSeal: !!res?.clearSeal, paint: true, successTx: res?.successTx || '' };
    } catch (e) {
      const hint = e?.message || 'The entry did not sign.';
      return { ok: false, action: 'entry', hint, seal: hint, paint: true };
    }
  }
  if (cmd.action === 'filter') {
    bag.cd = cmd.decision || '';
    bag.cq = cmd.q || '';
    bag.day = cmd.today ? isoDay(now) : '';
    bag.cp = 1;
    bag.tab = 'feed';
    const q = queryFeed(rows || [], { q: bag.cq, decision: bag.cd, day: bag.day, page: 1 });
    const hint = q.total
      ? `Showing ${q.total}.`
      : (cmd.today ? 'No rows are dated today.' : 'Nothing matches.');
    return { ok: true, action: 'filter', hint, clearSeal: true, paint: true };
  }
  if (cmd.action === 'export') {
    const day = cmd.today ? isoDay(now) : (bag.day || '');
    const q = queryFeed(rows || [], { q: bag.cq || '', decision: bag.cd || '', day, page: 1, pageSize: 500 });
    const body = cmd.json ? exportJson(q.rows) : exportCsv(q.rows);
    const name = cmd.today ? (cmd.json ? 'chronicle-today.json' : 'chronicle-today.csv') : (cmd.json ? 'chronicle.json' : 'chronicle.csv');
    if (cmd.json) saveJson?.(body, name);
    else saveCsv?.(body, name);
    bag.verify = body;
    bag.verifyUrl = '';
    bag.tab = 'export';
    bag.day = day;
    const hint = q.total ? `Exported ${q.total} rows.` : (cmd.today ? 'No rows are dated today.' : 'Nothing to export.');
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
