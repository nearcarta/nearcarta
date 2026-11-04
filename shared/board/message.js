// The bytes the agent signs. The contract builds the same string in `proposal_text`.
// amount and nonce are decimal integers with no leading zeros.
export function proposalMessage({ contract, owner, receiver, amount, nonce }) {
  return `board-v1|${contract}|${owner}|${receiver}|${amount}|${nonce}`;
}
