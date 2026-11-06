// Sealed rule text for board.nearcarta.near set_seal / propose reveal.
// The contract hashes this exact string and does not store it.
// contracts/charter_board/src/lib.rs seal_text.

const SALT = /^[A-Za-z0-9]{8,64}$/;

export function sealText({ contract, maxYocto = null, deny = [], salt }) {
  if (!contract) throw new Error('contract required');
  if (!SALT.test(String(salt || ''))) throw new Error('salt must be 8 to 64 letters or digits');
  const max = maxYocto == null || maxYocto === '' ? 'none' : String(maxYocto);
  const list = (deny || []).map(String).join(',');
  return `oath-hidden-v1|${contract}|pay|${max}|${list}|${salt}`;
}

/** Args for propose.reveal. The commitment is not included. */
export function revealArgs({ maxYocto = null, deny = [], salt }) {
  return {
    max_amount: maxYocto == null || maxYocto === '' ? null : String(maxYocto),
    deny: (deny || []).map(String),
    salt: String(salt),
  };
}
