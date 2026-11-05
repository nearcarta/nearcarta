// The bytes the agent signs. The contract builds the same strings in `proposal_text` and `call_text`.
// amount, deposit and nonce are decimal integers with no leading zeros.
import { sha256 } from '@noble/hashes/sha2.js';

const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');

export function proposalMessage({ contract, owner, receiver, amount, nonce }) {
  return `board-v1|${contract}|${owner}|${receiver}|${amount}|${nonce}`;
}

// contracts/charter_board/src/lib.rs `call_text`. args is the UTF-8 string forwarded to the shop.
export function callMessage({ contract, owner, receiver, method, args, deposit, nonce }) {
  const bytes = typeof args === 'string' ? new TextEncoder().encode(args) : args;
  return `board-call-v1|${contract}|${owner}|${receiver}|${method}|${hex(sha256(bytes))}|${deposit}|${nonce}`;
}
