// Town Hall reputation: a small score read only from the DAO's own on-chain history.
// +2 for each proposal the account filed that the DAO approved, +1 for each vote it cast,
// +2 if the charter's reward list names it. Tiers weight the town tally and cap how often an account may file;
// they do not change Sputnik's own count (the council's 2 votes still decide on chain).
export function reputation(account, proposals = [], rewardList = []) {
  let filed = 0, approved = 0, votes = 0;
  for (const p of proposals) {
    if (p.proposer === account) { filed++; if (p.status === 'Approved') approved++; }
    if (p.votes && account in p.votes) votes++;
  }
  const listed = rewardList.includes(account);
  const score = approved * 2 + votes + (listed ? 2 : 0);
  const tier = score >= 5 ? 'elder' : score >= 1 ? 'resident' : 'newcomer';
  return { account, filed, approved, votes, listed, score, tier };
}

/** What each tier may do: its vote weight in the town tally, and how many proposals it may file (anti-spam,
 * on top of Sputnik's 0.1 NEAR proposal bond). Enforced by this site and the API only, not on chain: Sputnik's
 * add_proposal takes anyone's bond, so a direct DAO call skips the tier cap; the bond and the council vote still apply. Newcomers (every fresh guest) get one proposal a day and one open. */
export const TIERS = {
  newcomer: { weight: 1, per_day: 1, open: 1 },
  resident: { weight: 2, per_day: 3, open: 3 },
  elder: { weight: 3, per_day: 10, open: 10 },
};
/** Town approval tiers for a motion, from the weighted tally: 'backed' once weighted yes reaches BACKED and beats no. */
export const BACKED = 4;
const DAY_NS = 86_400n * 10n ** 9n;

/** May `account` file another proposal now? Counts its proposals in the last 24 h and its open ones, by tier. */
export function canFile(account, proposals = [], rewardList = [], nowMs = Date.now()) {
  const r = reputation(account, proposals, rewardList), t = TIERS[r.tier], now = BigInt(Math.floor(nowMs)) * 10n ** 6n;
  const mine = proposals.filter(p => p.proposer === account);
  const today = mine.filter(p => p.submission_time != null && now - BigInt(p.submission_time) < DAY_NS).length;
  const open = mine.filter(p => p.status === 'InProgress').length;
  const base = { tier: r.tier, today, open, per_day: t.per_day, max_open: t.open };
  if (today >= t.per_day) return { ok: false, reason: `a ${r.tier} may file ${t.per_day} proposal${t.per_day > 1 ? 's' : ''} a day; try again tomorrow`, ...base };
  if (open >= t.open) return { ok: false, reason: `a ${r.tier} may have ${t.open} open proposal${t.open > 1 ? 's' : ''} at a time; wait for yours to close`, ...base };
  return { ok: true, reason: null, ...base };
}

/** Yes/no tally for one motion, with each voter's tier, the tier-weighted tally and the town approval tier. */
export function tally(p, repOf) {
  const out = { yes: 0, no: 0, yes_w: 0, no_w: 0, voters: [] };
  for (const [who, v] of Object.entries(p.votes || {})) {
    const tier = repOf(who).tier, w = TIERS[tier]?.weight ?? 1;
    if (v === 'Approve') { out.yes++; out.yes_w += w; } else if (v === 'Reject') { out.no++; out.no_w += w; }
    out.voters.push({ who, vote: v, tier, weight: w });
  }
  out.approval = out.yes_w >= BACKED && out.yes_w > out.no_w ? 'backed' : out.no_w >= BACKED && out.no_w > out.yes_w ? 'opposed' : 'open';
  return out;
}

/** Motions are Sputnik "Vote" proposals; anyone may vote on them while they are in progress and inside the window. */
export const votable = (p, periodNs, nowMs) => p.kind === 'Vote' && p.status === 'InProgress'
  && Number(BigInt(p.submission_time) + BigInt(periodNs)) / 1e6 > nowMs;

/** Server-side check of the same limits over the chain history: replays each proposal in id order against the
 * proposals filed before it (at its own submission time) and returns the ids filed past the proposer's limit.
 * Sputnik itself cannot refuse them, so the server marks them and the town board does not count them. */
export function overLimit(proposals = [], rewardList = []) {
  const sorted = [...proposals].sort((a, b) => a.id - b.id), out = new Set();
  sorted.forEach((p, i) => {
    if (p.submission_time == null) return;
    // Earlier proposals count with their current status (when one closed is not on chain); marked ones do not count.
    const before = sorted.slice(0, i).filter(q => !out.has(q.id));
    const g = canFile(p.proposer, before, rewardList, Number(BigInt(p.submission_time) / 10n ** 6n) + 1);
    if (!g.ok) out.add(p.id);
  });
  return out;
}
