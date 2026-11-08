// A page that only the current holder of a deed can open.
//
// The NFT track asks for exactly this: "A gated page that only current holders can open."
//
// The gate is the chain, not the URL. `nft_token(id)` returns `owner_id`, and the page compares
// that with the account signed in on this browser. A visitor who is not the holder gets a
// refusal, not a blurred screenshot. Because the owner is re-read on every load, a deed that
// changed hands after the link was shared stops opening for the seller immediately.
//
// This module is imported raw by the browser (no bundler), so it takes its RPC and its view
// helper as arguments rather than importing a shared path that is not in the deploy root.
export const GATED_TESTID = 'deed-gated';

/** Read the token's owner straight from the chain. Returns null when the deed does not exist. */
export async function deedOwner(tokenId, { view, contract }) {
  const t = await view(contract, 'nft_token', { token_id: String(tokenId) }).catch(() => null);
  if (!t || !t.owner_id) return null;
  return String(t.owner_id);
}

/**
 * Decide whether this visitor may open `tokenId`'s page.
 *
 * @returns {{open: boolean, reason: string, owner: string|null, token: string}}
 *   `open` is true only when the chain says this account holds the deed.
 */
export async function gateDeed(tokenId, account, deps) {
  const token = String(tokenId || '').trim();
  const me = String(account || '').trim().toLowerCase();
  if (!token) return { open: false, reason: 'No deed named in the link.', owner: null, token };
  if (!me) return { open: false, reason: 'Sign in first. This page opens for the deed holder.', owner: null, token };
  let owner = null;
  try {
    owner = await deedOwner(token, deps);
  } catch {
    return { open: false, reason: 'The deed did not answer. Nothing was signed.', owner: null, token };
  }
  if (!owner) return { open: false, reason: 'There is no such deed on this contract.', owner: null, token };
  // An unanswered ownership read is never treated as permission.
  if (owner.toLowerCase() !== me) {
    return { open: false, reason: `This deed belongs to ${owner.slice(0, 10)}…, so this page does not open for you. Nothing was signed.`, owner, token };
  }
  return { open: true, reason: '', owner, token };
}

/** The markup for a refusal. It says who holds it and offers the way in, and shows nothing. */
export function gatedHtml(result, esc = (s) => String(s ?? '')) {
  if (result.open) return '';
  return `<div class="deed-gated" data-testid="${GATED_TESTID}" role="status">`
    + `<h2>This page is for the deed holder</h2>`
    + `<p>${esc(result.reason)}</p>`
    + `<p class="small muted">The deed is an NFT on <code>house.nearcarta.near</code>. Holding it opens this page; selling it moves the page with it.</p>`
    + `<p><a class="btn" href="/?shop=house">Go to the House</a> <a class="btn" href="/setup/">Sign in or open a row</a></p>`
    + `</div>`;
}
