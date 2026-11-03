// Town Hall reputation: a small score read only from the DAO's own on-chain history.
// +2 for each proposal the account filed that the DAO approved, +1 for each vote it cast,
// +2 if the charter's reward list names it. Tiers are shown next to votes; they do not change Sputnik's count.
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

/** Yes/no tally for one motion, with each voter's tier. */
export function tally(p, repOf) {
  const out = { yes: 0, no: 0, voters: [] };
  for (const [who, v] of Object.entries(p.votes || {})) {
    if (v === 'Approve') out.yes++; else if (v === 'Reject') out.no++;
    out.voters.push({ who, vote: v, tier: repOf(who).tier });
  }
  return out;
}

/** Motions are Sputnik "Vote" proposals; anyone may vote on them while they are in progress and inside the window. */
export const votable = (p, periodNs, nowMs) => p.kind === 'Vote' && p.status === 'InProgress'
  && Number(BigInt(p.submission_time) + BigInt(periodNs)) / 1e6 > nowMs;
