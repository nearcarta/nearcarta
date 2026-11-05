// A proposal stays "InProgress" on chain until someone calls act_proposal, even after its vote window
// closed. A proposal whose submission_time + proposal_period has passed can no longer be voted on, so every view
// shows it as Expired. Pure (no I/O), shared by the API, /shops/hall/ and the Town Hall room.

/** Vote window end in ms since epoch, or null when the inputs are missing. */
export function endsAtMs(p, periodNs) {
  if (p?.submission_time == null || periodNs == null) return null;
  return Number((BigInt(p.submission_time) + BigInt(periodNs)) / 1_000_000n);
}

/** { status, chain_status, expired, ends_at_ms }: status is 'Expired' for an InProgress proposal past its window. */
export function proposalState(p, periodNs, nowMs = Date.now()) {
  const chain = p?.status ?? null, end = endsAtMs(p, periodNs);
  const expired = chain === 'Expired' || (chain === 'InProgress' && end != null && nowMs >= end);
  return { status: expired ? 'Expired' : chain, chain_status: chain, expired, ends_at_ms: end };
}

/** Plain words for a state: "Expired 2 h ago", "Open, 35 min left", or the chain status. */
export function stateText(s, nowMs = Date.now()) {
  const span = ms => { const m = Math.round(Math.abs(ms) / 60000); return m < 60 ? `${m} min` : m < 2880 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`; };
  if (s.expired) return s.ends_at_ms != null ? `Expired ${span(nowMs - s.ends_at_ms)} ago` : 'Expired';
  if (s.status === 'InProgress') return s.ends_at_ms != null ? `Open, ${span(s.ends_at_ms - nowMs)} left` : 'Open';
  return String(s.status);
}
