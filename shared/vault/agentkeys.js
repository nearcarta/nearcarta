// A10: which agent key this browser holds for a charter, and what to do about keys nobody holds.
// All inputs are public keys ("ed25519:…") or null. The secret keys stay in the page's localStorage.
//   onChain: function-call keys on the charter account; current: get_state.agent_key;
//   held: the key this browser saved as live; pend: the key saved BEFORE the last wallet approval;
//   queued: keys whose SetAgentKey change waits in the timelock.
export function keyPlan({ onChain = [], current = null, held = null, pend = null, queued = [] } = {}) {
  const promote = onChain.includes(pend); // the approval landed: the pending key becomes the live one
  const mine = promote ? pend : held;
  const pendLeft = promote ? null : pend;
  const keyLive = !!mine && onChain.includes(mine);
  const pendWaiting = !!pendLeft && queued.includes(pendLeft);
  const pendLost = !!pendLeft && !pendWaiting; // never reached the chain (rejected, failed, or still in flight)
  const others = onChain.filter(pk => pk !== mine); // a pending key on chain was promoted to mine
  // revoke_agent deletes exactly get_state.agent_key, so only that key can be offered for revoking;
  // anything else (an older release's key) is reported, never "revoked" by deleting the wrong one.
  const revocable = others.filter(pk => pk === current);
  const stray = others.filter(pk => pk !== current);
  return { promote, mine, keyLive, pendWaiting, pendLost, revocable, stray };
}
/** The secret key for the next set_agent_key: reuse the saved pending one (its approval may still land), else a new one. */
export const keyToAdd = (pendSecret, make) => pendSecret || make();
