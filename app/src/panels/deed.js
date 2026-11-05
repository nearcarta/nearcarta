// The house deed block. The city tray, the house page and the console share this markup.

import { DEED, controlAfterMove, metadataView, txUrl } from '../deed-control.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function deedMarkup() {
  const m = metadataView();
  const held = controlAfterMove({ holder: 'holder.near', payer: 'holder.near' });
  const moved = controlAfterMove({ holder: 'holder.near', payer: 'previous.near' });
  return `<div data-testid="deed-meta"><p>${esc(m.name)} · ${esc(m.standard)}</p><p>${esc(m.contract)}</p><p>${esc(m.description)}</p><p class="deed-mint"><a data-testid="deed-mint" href="${esc(txUrl(DEED.mint))}">Mint record</a></p></div><p data-testid="deed-held">${esc(held.reason)}</p><p data-testid="deed-moved">${esc(moved.reason)}</p><a data-testid="deed-allow" href="${esc(txUrl(DEED.allow))}">Allowed payment</a> <a data-testid="deed-refuse" href="${esc(txUrl(DEED.refuse))}">Refused payment</a>`;
}
