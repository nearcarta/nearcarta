// nearblocks API v3 adapter. Testnet v1 answered 410 ("retired on 2026-11-05. Use /v3"), so the
// timeline and the market history read v3 and turn it into the shape the rest of the API already
// speaks. Mainnet v1 still answers, but both networks go through this one adapter so a v1 retirement
// cannot break one of them.
//
// The two shapes differ in three ways, and each is handled here rather than at the call sites:
//   * v1  { txns: [ { transaction_hash, block_timestamp, actions: [{ action, method }], … } ] }
//     v3  { data: [ { transaction_hash, block_timestamp, actions: [{ action, method }], outcomes: { status } } ], meta: { next_page } }
//   * v3 carries no predecessor_account_id; the signer is the only sender it names.
//   * v3 pages with an opaque `next_page` cursor in `meta`, not a `cursor` field.
//
// Docs: https://api-testnet.nearblocks.io/api-docs (the /v3 paths) · https://docs.fastnear.com/
//       https://docs.near.org/integrations/on-chain-data
const HASH = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;

/** The rows of a v1 or a v3 transaction response, always an array. */
export function rowsOf(json) {
  if (!json || typeof json !== 'object') return [];
  if (Array.isArray(json.data)) return json.data;
  if (Array.isArray(json.txns)) return json.txns;
  return [];
}

/** The page cursor of a v1 or a v3 response, always a string ('' when there is no next page). */
export function cursorOf(json) {
  if (!json || typeof json !== 'object') return '';
  const c = json.meta?.next_page ?? json.cursor ?? '';
  return typeof c === 'string' ? c : '';
}

/** One v3 row as the v1 row the existing mappers expect. Nothing is invented: a missing field stays empty. */
export function v3ToV1(row) {
  if (!row || typeof row !== 'object') return null;
  const hash = row.transaction_hash || row.hash || '';
  if (!hash) return null;
  const actions = Array.isArray(row.actions) ? row.actions : [];
  return {
    transaction_hash: hash,
    block_timestamp: row.block_timestamp || row.block?.block_timestamp || '',
    signer_account_id: row.signer_account_id || '',
    receiver_account_id: row.receiver_account_id || '',
    // v3 does not name a predecessor. The signer is the only sender it reports, and the timeline
    // only needs one name to decide whether it may skip a detail read.
    predecessor_account_id: row.predecessor_account_id || row.signer_account_id || '',
    actions: actions.map((a) => ({
      action: a?.action || '',
      method: a?.method ?? null,
      deposit: a?.deposit ?? row.actions_agg?.deposit ?? null,
      // A v1 row carries the call args; a v3 list row does not (the detail route does). Kept when present.
      args: a?.args ?? null,
    })),
    receipt_outcome: row.receipt_outcome || { status: row.outcomes?.status !== false },
    outcomes: row.outcomes || null,
  };
}

/** Every usable row of a v1 or v3 response, in the v1 shape. */
export function txRange(json) {
  return rowsOf(json).map(v3ToV1).filter(Boolean);
}

/** One v3 FT row as the v1 FT row `mapFt` in chronicle-live.js reads. */
export function ftRange(json) {
  const rows = rowsOf(json);
  return rows.map((t) => {
    if (!t || typeof t !== 'object') return null;
    if (t.ft) return t; // already the v1 shape
    const meta = t.meta || {};
    return {
      transaction_hash: t.transaction_hash || '',
      block_timestamp: t.block_timestamp || t.block?.block_timestamp || '',
      delta_amount: t.delta_amount ?? '',
      involved_account_id: t.involved_account_id || '',
      affected_account_id: t.affected_account_id || '',
      ft: {
        contract: t.contract_account_id || meta.contract || '',
        symbol: meta.symbol || '',
        decimals: meta.decimals,
      },
      outcomes: { status: t.outcomes?.status !== false },
    };
  }).filter(Boolean);
}

/** The path of the account transaction list for a base URL. v1 and v3 differ, so the caller says which. */
export function accountTxPath(base, account, { v3 = false, limit = 25, cursor = '' } = {}) {
  const b = String(base || '').replace(/\/$/, '');
  const id = encodeURIComponent(account);
  const q = new URLSearchParams();
  if (v3) q.set('limit', String(limit)); else q.set('per_page', String(limit));
  if (cursor) q.set(v3 ? 'next' : 'cursor', cursor);
  return `${b}/${v3 ? 'v3' : 'v1'}/account${v3 ? 's' : ''}/${id}/txns?${q.toString()}`;
}

/** The same for the FT list. */
export function accountFtPath(base, account, { v3 = false, limit = 25, cursor = '' } = {}) {
  const b = String(base || '').replace(/\/$/, '');
  const id = encodeURIComponent(account);
  const q = new URLSearchParams();
  if (v3) q.set('limit', String(limit)); else q.set('per_page', String(limit));
  if (cursor) q.set(v3 ? 'next' : 'cursor', cursor);
  return `${b}/${v3 ? 'v3' : 'v1'}/account${v3 ? 's' : ''}/${id}/ft-txns?${q.toString()}`;
}

/** True when this API base speaks v3 (testnet does; mainnet v1 does too, but v3 is offered there as well). */
export const isV3 = (base) => /\/v3$/.test(String(base || '').replace(/\/$/, ''));
