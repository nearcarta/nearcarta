// Per-deed history for the House: what this deed did, on chain, with explorer links.
//
// The NFT track asks for "a history view per NFT: what it earned, what it paid out, who held
// it". The deed contract emits events (`house_fund`, `house_pay`, `house_check_in`,
// `house_release`), but neither the public index nor `EXPERIMENTAL_tx_status` returns logs for
// these receipts, so the events cannot be read back. What IS readable everywhere is the method
// that ran, so this reports that: one row per transaction that touched the deed, named by the
// method, plus what the contract says now (purse balance, cap, paid, pays) as the totals.
//
// Nothing is invented: a row exists only because a transaction with that hash exists.

const DEED_METHODS = {
  mint_deed: { what: 'Minted', sign: '+' },
  house_fund: { what: 'Funded the purse', sign: '+' },
  house_pay: { what: 'Paid out', sign: '-' },
  house_set_line: { what: 'Named heirs', sign: '' },
  house_check_in: { what: 'Checked in by the holder', sign: '' },
  house_session_check_in: { what: 'Checked in through the row', sign: '' },
  house_confirm_release: { what: 'Confirmed a release', sign: '' },
  house_cancel_release: { what: 'Cancelled a release', sign: '' },
  nft_transfer: { what: 'Deed transferred', sign: '' },
  nft_transfer_call: { what: 'Deed transferred', sign: '' },
};

/**
 * Turn the index's account transactions into history rows for one deed.
 *
 * @param {Array} txns  nearblocks `/v1/account/<contract>/txns` rows
 * @param {string} tokenId  the deed id (the holder's account)
 * @param {object} [purses] the contract's current purse record for this deed
 */
export function deedHistory(txns, tokenId, purse = null, readFailed = false) {
  const rows = [];
  for (const t of txns || []) {
    const hash = t?.transaction_hash;
    if (!hash) continue;
    const methods = (t?.actions || [])
      .map(a => (a && typeof a === 'object' ? a.method : null))
      .filter(Boolean);
    // A row belongs to this deed when the method names it (session calls and the line/heirs
    // calls take the token id) or when the transaction's signer is the deed's own account.
    const forThisDeed = methods.some(m => DEED_METHODS[m]) || t?.signer_account_id === tokenId;
    if (!forThisDeed) continue;
    const method = methods.find(m => DEED_METHODS[m]) || methods[0] || 'call';
    const meta = DEED_METHODS[method] || { what: method, sign: '' };
    rows.push({
      hash,
      method,
      what: meta.what,
      sign: meta.sign,
      at: Number(t?.block_timestamp || 0) || null,
      block: t?.block?.block_height ?? null,
      signer: t?.signer_account_id || null,
    });
  }
  // Newest first, and one row per transaction even when several receipts mention it.
  const seen = new Set();
  const unique = rows.filter(r => (seen.has(r.hash) ? false : (seen.add(r.hash), true)));
  unique.sort((a, b) => (b.at || 0) - (a.at || 0));
  return {
    token_id: tokenId,
    rows: unique,
    count: unique.length,
    // An empty list from a failed read is not the same as "this deed did nothing". The caller
    // sets `readFailed` when the index did not answer, so the page can say which it is.
    read_failed: !!readFailed,
    // What the contract says right now. These are the only numbers, because the event logs are
    // not readable back from any public source; the rows above are the audit trail.
    totals: purse
      ? { balance: String(purse.balance ?? '0'), cap: String(purse.cap ?? '0'), paid: String(purse.paid ?? '0'), pays: Number(purse.pays ?? 0) }
      : null,
    note: unique.length ? '' : (readFailed ? 'The transaction index did not answer, so this deed’s history could not be read. This is not a claim that the deed did nothing.' : 'No transactions touch this deed yet.'),
  };
}
