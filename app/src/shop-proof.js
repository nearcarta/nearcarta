// "What the chain saw": one card that shows the receipt behind whatever a shop just did, in the terms
// a judge checks: which contract, which method, who signed, how much gas, the transaction, and whether a
// TEE signature was checked.
//
// The card never invents a row. A field it does not have says "not in this step" rather than a plausible
// number, and a step with no transaction says so in words instead of drawing an empty card.
//
// Every shop mounts it with `installProofCard()`, and a shop that has a transaction calls
// `showProof({...})`. A recorded mainnet proof keeps its nearblocks.io link and is labelled; a live
// testnet one goes through txUrl().
//
// Docs: https://docs.near.org/protocol/transactions (actions, receipts, outcomes)
//       https://docs.near.org/api/rpc/transactions (gas burnt, status, failure)
//       https://docs.near.ai/cloud/verification/reference/response-signature-verification (the TEE check)
import { NET } from '../../shared/net/net.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** The fixed set of facts a card shows, in the order a judge reads them. */
export const FIELDS = [
  ['contract', 'Contract'],
  ['method', 'Method'],
  ['signer', 'Signed by'],
  ['gas', 'Gas burnt'],
  ['amount', 'Amount'],
  ['decision', 'The chain said'],
];

/**
 * One card. Every field is required to be either a real value or the word "not in this step"; nothing is
 * filled in by guesswork.
 * @param {{ contract?:string, method?:string, signer?:string, gas?:string, amount?:string, decision?:string,
 *   tx?:string, url?:string, recorded?:boolean, tee?:object|null, net?:string, title?:string }} p
 */
export function proofMarkup(p = {}) {
  // The caller says which network the receipt belongs to. A page passes its own; a test passes the one it
  // is asserting. Only when neither is given does this fall back to the module's own network.
  const net = p.net || NET;
  const recorded = p.recorded === true;
  // A recorded mainnet proof always links nearblocks.io; a live one links this network's explorer, and an
  // explicit `net` wins over the module's own so a test (and a page that switched) is exact.
  const explorerOf = (n) => (n === 'testnet' ? 'https://testnet.nearblocks.io' : 'https://nearblocks.io');
  const href = p.url || (p.tx ? (recorded ? `https://nearblocks.io/txns/${p.tx}` : `${explorerOf(net)}/txns/${p.tx}`) : '');
  const value = (v) => (v == null || v === '' ? '<span class="pc-none">not in this step</span>' : esc(v));
  const verdict = p.decision === 'refused'
    ? '<b class="pc-bad" data-testid="proof-verdict">refused</b>'
    : p.decision === 'allowed' ? '<b class="pc-ok" data-testid="proof-verdict">allowed</b>' : '<span class="pc-none">not in this step</span>';
  // `decision` has its own renderer, so it is not repeated as a plain row.
  const rows = FIELDS.filter(([k]) => k !== 'decision').map(([k, label]) => `<dt>${esc(label)}</dt><dd data-field="${k}">${value(p[k])}</dd>`).join('');
  const tee = p.tee && p.tee.verified
    ? `<p class="pc-tee" data-testid="proof-tee"><span class="pc-ok">TEE signature checked</span> · ${esc(p.tee.signing_algo || 'ed25519')} · <code>${esc(String(p.tee.signing_address || '').slice(0, 12))}…</code>${p.tee.verify_url ? ` · <a href="${esc(p.tee.verify_url)}" target="_blank" rel="noopener">re-check ↗</a>` : ''}</p>`
    : p.tee && p.tee.checked === false
      ? '<p class="pc-tee" data-testid="proof-tee"><span class="pc-bad">TEE signature not checked</span> · this step used no model</p>'
      : '';
  return `<section class="proof-card" data-testid="proof-card" data-net="${recorded ? 'mainnet' : esc(net)}" aria-label="What the chain saw">
    <h3>${esc(p.title || 'What the chain saw')}${recorded ? ' <span class="pc-recorded" data-testid="proof-recorded">Recorded on mainnet</span>' : ''}</h3>
    <dl>${rows}<dt>The chain said</dt><dd>${verdict}</dd></dl>
    ${tee}
    ${href
      ? `<p class="pc-tx"><a data-testid="proof-tx" href="${esc(href)}" target="_blank" rel="noopener">${esc(String(p.tx || '').slice(0, 10) || 'transaction')}… ↗</a>${p.decision === 'refused' ? ' <small>this one failed on chain, by design</small>' : ''}</p>`
      : '<p class="pc-tx pc-none" data-testid="proof-no-tx">No transaction in this step. Nothing was signed.</p>'}
  </section>`;
}

/**
 * Mount the card in a shop panel. It sits under the panel header so it is visible without a tab, and it
 * survives a panel re-render the same way the quest strip does.
 */
export function installProofCard({ doc = document, host = null } = {}) {
  const tray = host || doc.querySelector('#shopUI #tray') || doc.querySelector('#tray');
  if (!tray) return null;
  let el = tray.querySelector('[data-testid="proof-card"]');
  if (el) return el;
  el = doc.createElement('div');
  el.className = 'proof-slot';
  el.innerHTML = proofMarkup({});
  const slot = tray.querySelector('.shop-quest');
  if (slot && slot.parentElement) slot.parentElement.insertBefore(el, slot.nextSibling);
  else tray.prepend(el);
  return el;
}

/** Replace the mounted card with real facts. */
export function showProof(facts, { doc = document } = {}) {
  const el = doc.querySelector('[data-testid="proof-card"]');
  if (!el) return null;
  el.innerHTML = proofMarkup(facts);
  return el;
}

/** True when a field set has enough to draw a real card. */
export const hasProof = (p) => !!(p && (p.tx || p.method));
