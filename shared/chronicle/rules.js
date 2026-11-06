// Rules versions, rebuilt from the account's own chain history.
//
// The board does not keep a rules version or a history of them: `get_charter` returns the
// current row only, and the row is written with `set_rules`, `set_calls`, `set_frozen`,
// `set_seal` and `open_charter` (contracts/charter_board/src/lib.rs). So the version a payment
// ran under has to be rebuilt from those transactions, which is what this module does:
// one version per row-writing receipt, taken from the row as it stood after that receipt.
//
// It never invents a version. When the history is not readable the caller gets
// `{ version: '', why: ... }` and the statement says "Historic rules: missing."
//
// Every field here is data that came from the chain (a live row, or the args a receipt carried).
// Nothing is hardcoded to one visitor.

/** Row-writing methods, in the order they change what a payment is compared against. */
export const RULES_METHODS = ['open_charter', 'set_rules', 'set_calls', 'set_frozen', 'set_seal', 'set_agent'];

const num = v => {
  const n = Number(String(v ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
};

/** The parts of a row that decide whether a payment is allowed. */
export function rulesSnapshot(row) {
  if (!row || typeof row !== 'object') return null;
  const receivers = Array.isArray(row.receivers) ? row.receivers.map(String) : [];
  return {
    receivers,
    per_action_cap: String(row.per_action_cap ?? ''),
    daily_budget: String(row.daily_budget ?? ''),
    max_actions_per_day: num(row.max_actions_per_day),
    min_amount: String(row.min_amount ?? ''),
    window_start_min: num(row.window_start_min),
    window_end_min: num(row.window_end_min),
    expires_at: String(row.expires_at ?? ''),
    frozen: row.frozen === true,
    sealed: row.sealed === true,
  };
}

/** Stable text for a snapshot, so two equal rule sets hash the same. Sorted, no whitespace. */
export function rulesCanon(snapshot) {
  const s = snapshot || {};
  return JSON.stringify({
    receivers: [...(s.receivers || [])].map(r => String(r)).sort(),
    per_action_cap: String(s.per_action_cap ?? ''),
    daily_budget: String(s.daily_budget ?? ''),
    max_actions_per_day: s.max_actions_per_day ?? null,
    min_amount: String(s.min_amount ?? ''),
    window_start_min: s.window_start_min ?? null,
    window_end_min: s.window_end_min ?? null,
    expires_at: String(s.expires_at ?? ''),
    frozen: s.frozen === true,
    sealed: s.sealed === true,
  });
}

/** A short, readable version id: the first 12 hex of the canonical snapshot hash. */
export function rulesVersion(snapshot, hashHex) {
  if (!snapshot || typeof hashHex !== 'function') return '';
  return String(hashHex(rulesCanon(snapshot)) || '').slice(0, 12);
}

/**
 * Build the version list for one account.
 *
 * @param {object} o
 * @param {object} o.row         the live `get_charter` row (or null when there is none)
 * @param {Array}  o.writes      row-writing receipts, oldest first:
 *                               [{ hash, method, at, args, rowAfter }]
 * @param {function} o.hashHex    sha256 hex of a string (injected: browser and node differ)
 * @returns {{ versions: Array, current: object|null, why: string }}
 */
export function reconstructRules({ row = null, writes = [], hashHex = null, owner = '' } = {}) {
  const versions = [];
  let index = 0;
  for (const w of writes || []) {
    if (!RULES_METHODS.includes(String(w?.method || ''))) continue;
    const snapshot = rulesSnapshot(w.rowAfter) || rulesSnapshot(row);
    if (!snapshot) continue;
    index += 1;
    versions.push({
      index,
      version: rulesVersion(snapshot, hashHex),
      method: String(w.method),
      tx: String(w.hash || ''),
      at: String(w.at || ''),
      owner: String(owner || row?.owner || ''),
      rules: snapshot,
    });
  }
  // No row-writing receipt was readable: the current row is still a real rule set, but it
  // cannot be tied to a date, so it is labelled that way instead of being given a fake history.
  if (!versions.length && row) {
    const snapshot = rulesSnapshot(row);
    if (snapshot) versions.push({
      index: 1, version: rulesVersion(snapshot, hashHex), method: 'current-row',
      tx: '', at: '', owner: String(owner || row.owner || ''), rules: snapshot,
    });
  }
  const current = versions.length ? versions[versions.length - 1] : null;
  const dated = versions.filter(v => v.tx);
  const why = !versions.length
    ? 'No rules were readable for this account.'
    : (dated.length ? '' : 'Only the current row was readable, so the rule history has no dates.');
  return { versions, current, why };
}

/** The version id a payment at `atIso` ran under: the newest version written at or before it. */
export function rulesVersionAt(versions, atIso) {
  const t = Date.parse(String(atIso || ''));
  const list = (versions || []).filter(v => v.version);
  if (!list.length) return '';
  const current = list[list.length - 1];
  if (!Number.isFinite(t)) return current.version;
  let picked = '';
  for (const v of list) {
    const tv = Date.parse(v.at || '');
    if (!Number.isFinite(tv)) { picked = v.version; continue; }
    if (tv <= t) picked = v.version;
  }
  return picked || list[0].version;
}

/** Which receipts predate every readable rule version, so their rule set is unknown. */
export function rowsWithoutRules(versions, rows) {
  const first = (versions || []).find(v => v.tx && Number.isFinite(Date.parse(v.at || '')));
  if (!first) return { missing: (rows || []).length, firstKnown: '' };
  const t0 = Date.parse(first.at);
  const missing = (rows || []).filter(r => {
    const t = Date.parse(String(r.at || ''));
    return Number.isFinite(t) && t < t0;
  }).length;
  return { missing, firstKnown: first.at };
}
