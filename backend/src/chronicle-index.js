// Read-only chain rebuild for one account: the anchors it logged and the rule versions it wrote.
//
// The board stores neither. `anchor(kind, digest, salt)` logs one nearcarta-board v2 event and
// keeps nothing; the row-writing methods (`set_rules`, `set_calls`, ...) overwrite the row. So both
// are rebuilt from the account's own transactions, which is the durable index: the same inputs
// always produce the same list, and a reader can re-run this at any time.
//
// Nothing here signs, and nothing is cached as a claim: a page that failed to read says so.
import { txStatus, view } from './near.js';
import { MAINNET_DEP } from './config.js';
import { txResult } from './near.js';
import { parseAnchorEvents } from '../../app/src/chronicle-audit.js';
import { RULES_METHODS, rulesSnapshot } from '../../shared/chronicle/rules.js';

export const BOARD_EVENT_STANDARD = 'nearcarta-board';

/** Decode the function-call args a receipt carries, as an object or null. Never throws. */
export function argsOf(action) {
  const fc = action?.FunctionCall || action?.function_call;
  if (!fc) return null;
  let raw = fc.args;
  if (typeof raw === 'string') {
    try { raw = Buffer.from(raw, 'base64').toString('utf8'); } catch { return null; }
  }
  if (raw == null) return null;
  try { const v = JSON.parse(typeof raw === 'string' ? raw : Buffer.from(raw).toString('utf8')); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; }
  catch { return null; }
}

/** The row-writing calls a transaction made, in receipt order. */
export function rulesWritesIn(tx, { board = '' } = {}) {
  const out = [];
  for (const r of tx?.receipts || []) {
    for (const a of r?.receipt?.Action?.actions || []) {
      const fc = a?.FunctionCall || a?.function_call;
      if (!fc) continue;
      const method = String(fc.method_name || fc.methodName || '');
      if (!RULES_METHODS.includes(method)) continue;
      if (board && r.receiver_id && r.receiver_id !== board) continue;
      out.push({ method, args: argsOf(a) });
    }
  }
  return out;
}

/** The anchor events a transaction logged. A failed receipt's logs are dropped (phantom). */
export function anchorsIn(tx, { board = '', owner = '' } = {}) {
  const out = [];
  for (const o of tx?.receipts_outcome || []) {
    if (o?.outcome?.status?.Failure) continue;
    if (board && o?.outcome?.executor_id && o.outcome.executor_id !== board) continue;
    for (const e of parseAnchorEvents(o?.outcome?.logs || [])) {
      if (owner && e.owner !== owner) continue;
      out.push(e);
    }
  }
  return out;
}

/** Newest row-writing receipt first, so the live row is the first `rowAfter`. */
export function orderWrites(writes) {
  return [...(writes || [])].sort((a, b) => {
    const ta = Date.parse(a.at || ''), tb = Date.parse(b.at || '');
    if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
    return 0;
  });
}

/**
 * Rebuild anchors and rule versions for one account from a list of its transactions.
 * Pure: the caller supplies the tx objects, so the same test covers the live route.
 */
export function rebuildAccount({ account = '', board = '', txs = [], row = null, now = Date.now() } = {}) {
  const anchors = [];
  const writes = [];
  for (const tx of txs || []) {
    const hash = tx?.transaction?.hash || tx?.hash || '';
    const at = tx?.transaction_outcome?.block_timestamp
      ? new Date(Number(BigInt(tx.transaction_outcome.block_timestamp) / 1_000_000n)).toISOString()
      : '';
    for (const e of anchorsIn(tx, { board, owner: account })) {
      // The event's own `time` is a block timestamp in ns; prefer it so the row is chain-ordered.
      const t = Number(e.time);
      anchors.push({
        ...e,
        tx: hash,
        owner: e.owner || account,
        at: Number.isFinite(t) && t > 0 ? new Date(Math.floor(t / 1e6)).toISOString() : at,
      });
    }
    for (const w of rulesWritesIn(tx, { board })) writes.push({ hash, method: w.method, args: w.args, at });
  }
  anchors.sort((a, b) => (Date.parse(a.at || '') || 0) - (Date.parse(b.at || '') || 0));
  return {
    account: String(account || ''),
    board: String(board || ''),
    anchors,
    ruleWrites: orderWrites(writes),
    snapshot: row ? rulesSnapshot(row) : null,
    rebuiltAt: new Date(now).toISOString(),
    signed: false,
  };
}

/**
 * The route body. Reads the account's recent transactions (the caller already listed them for the
 * timeline) and the live row, then rebuilds. A missing read is named, never filled in.
 */
export async function anchorIndex({ account = '', txs = [], deps = {} } = {}) {
  const board = MAINNET_DEP?.board?.contract || '';
  const read = deps.view || view;
  let row = null, rowError = '';
  try { row = board ? await read(board, 'get_charter', { owner: account }) : null; }
  catch (e) { rowError = String(e.message || e).slice(0, 160); }
  const body = rebuildAccount({ account, board, txs, row, now: deps.now || Date.now() });
  const gaps = [];
  if (!board) gaps.push('The deployment record names no board contract.');
  if (rowError) gaps.push(`The live row was not read: ${rowError}`);
  if (!row && !rowError) gaps.push('This account has no board row, so it has no rules to rebuild.');
  return { ...body, live: !!row, gaps };
}

/** Status of one hash, for a caller that wants to confirm an anchor tx. Read-only. */
export async function txFor(hash, sender, deps = {}) {
  const status = deps.txStatus || txStatus;
  const tx = await status(hash, sender);
  return { ok: true, tx, result: txResult(tx) };
}

export { txResult, RULES_METHODS };
