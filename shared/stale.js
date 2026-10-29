// Stale-record rule for records a NEAR contract marks "signed" (a foreign-chain tx signed by chain
// signatures but not yet seen settled). Pure: the caller reads the foreign chain and passes the facts.
//   facts: { known: tx hash seen on the foreign chain (mempool or mined), mined: receipt exists,
//            sender_nonce: the foreign signer's next nonce, balance_wei: its balance }
// A signed tx that the foreign chain never saw is expired when it can no longer land: its nonce was
// used by another tx, or the signer holds no gas to pay for it. Otherwise it stays pending.
export function signedState(rec, facts) {
  if (!rec || rec.status !== 'signed') return { state: rec?.status || 'unknown' };
  if (!facts) return { state: 'pending', reason: 'foreign chain not read' };
  if (facts.mined) return { state: 'settling', reason: 'mined on the foreign chain; settle on NEAR is next' };
  if (facts.known) return { state: 'pending', reason: 'in the foreign mempool' };
  if (facts.sender_nonce != null && Number(facts.sender_nonce) > Number(rec.nonce)) return { state: 'expired', reason: 'signed, never broadcast: its nonce was used by another tx' };
  if (facts.balance_wei != null && BigInt(facts.balance_wei) === 0n) return { state: 'expired', reason: 'signed, never broadcast: the foreign signer has no gas' };
  return { state: 'pending', reason: 'signed, not yet broadcast' };
}
