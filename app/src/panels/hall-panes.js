// Jobs and Hire panes. Icons are drawn marks, not placeholders.
import { LAMPLIGHTER_REGISTER, nearOf } from '../../../shared/hall/plan.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function lampIcon() {
  return `<svg class="hall-ico" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="#f5d08a" d="M9 2.5h6l.8 3.2H8.2L9 2.5z"/><path fill="#e2b35b" d="M7 6.2h10l1.6 5.2H5.4L7 6.2z"/><rect x="11" y="11.6" width="2" height="6.2" fill="#d6b46a"/><rect x="8" y="18.2" width="8" height="2" rx="1" fill="#f3ead8"/></svg>`;
}
export function scrollIcon() {
  return `<svg class="hall-ico" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="#f3ead8" d="M6 4h9a3 3 0 0 1 3 3v12H8a2 2 0 0 1-2-2V4z"/><path fill="none" stroke="#6b4a33" stroke-width="1.4" d="M9 8h6M9 11.5h6M9 15h4"/><path fill="#d6b46a" d="M6 4c0 1.2-.8 2-2 2v12c1.2 0 2 .8 2 2V4z"/></svg>`;
}
export function capIcon() {
  return `<svg class="hall-ico" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="#f5d08a" d="M3 10 12 5l9 5-9 5-9-5z"/><path fill="none" stroke="#2a1608" stroke-width="1.4" d="M7 12.2V16c1.6 1.4 3.2 2 5 2s3.4-.6 5-2v-3.8"/></svg>`;
}

function agentMark(url) {
  const u = String(url || '');
  if (/^https:\/\//.test(u)) return `<img class="hall-ico" src="${esc(u)}" width="22" height="22" alt="">`;
  return lampIcon();
}

export function jobsPane({ bounties = [], error = '', contract = 'townhall.nearcarta.near' } = {}) {
  const rows = (bounties || []).map(b => {
    const who = b.claimedBy ? `claimed by ${esc(b.claimedBy)}` : 'open';
    return `<li class="hall-job" data-testid="hall-job"><span class="hall-job-ico">${scrollIcon()}</span><span><b>${esc(nearOf(b.amount))} NEAR</b><small>${who}</small></span></li>`;
  }).join('');
  const empty = error
    ? `<p data-testid="hall-jobs-error">${esc(error)}</p>`
    : `<p data-testid="hall-jobs-empty">No open bounty on ${esc(contract)} yet.</p>`;
  return `<section class="hall-pane" data-testid="hall-jobs">
    <p class="hall-lead">${scrollIcon()} <span>Live bounties on ${esc(contract)}</span></p>
    ${rows ? `<ul class="hall-jobs">${rows}</ul>` : empty}
    <button type="button" class="hall-cta" data-testid="hall-post" data-cmd="post a bounty 0.001">Post 0.001</button>
  </section>`;
}

export function hirePane(status) {
  const draft = status?.draft || LAMPLIGHTER_REGISTER;
  const blocked = status?.blocked;
  const agent = status?.agent;
  const jobs = Array.isArray(status?.assignments) ? status.assignments : [];
  const lines = jobs.map(j => `<li class="hall-job" data-testid="hall-assignment"><span class="hall-job-ico">${agentMark(agent?.avatarUrl)}</span><span><b>${esc(j.title || 'Assignment')}</b><small>${esc(j.status || '')} ${j.escrowAmount ? esc(String(j.escrowAmount)) + ' ' + esc(j.escrowToken || '') : ''}</small></span></li>`).join('');
  const listNote = blocked === 'no_token'
    ? `<p data-testid="hall-list-blocked">Listing is blocked until an Agent Market token is set. Ready: ${esc(draft.name)} · ${esc(draft.handle)} · ${esc(draft.category)}.</p>`
    : blocked
      ? `<p data-testid="hall-list-blocked">${esc(blocked === 'bad_token' ? 'The market refused the token.' : 'The market did not answer.')}</p>`
      : `<p data-testid="hall-listed">${agent?.listed ? esc(agent.name || draft.name) + ' is listed.' : esc(draft.name) + ' is not listed yet.'}</p>`;
  return `<section class="hall-pane" data-testid="hall-hire">
    <p class="hall-lead">${lampIcon()} <span>Lamplighter</span></p>
    ${listNote}
    ${lines ? `<ul class="hall-jobs">${lines}</ul>` : ''}
    <button type="button" class="hall-cta" data-testid="hall-list" data-cmd="list the lamplighter">List Lamplighter</button>
    <label class="hall-field">Task <input id="hall-brief" data-testid="hall-brief" value="a lamp check"></label>
    <label class="hall-field">NEAR <input id="hall-offer" data-testid="hall-offer" inputmode="decimal" value="0.001"></label>
    <button type="button" class="hall-cta" data-testid="hall-hire-go">Hire</button>
    <div id="hall-counter" data-testid="hall-counter" hidden></div>
    <div id="hall-receipt" data-testid="hall-receipt"></div>
  </section>`;
}

export function counterMarkup(speech) {
  if (!speech) return '';
  return `<p class="hall-speech" data-testid="hall-speech">${esc(speech)}</p>
    <div class="hall-cta-row">
      <button type="button" class="hall-cta" data-testid="hall-accept" data-cmd="accept">Accept</button>
      <button type="button" class="hall-cta hall-cta-ghost" data-testid="hall-walk" data-cmd="walk">Walk</button>
    </div>`;
}

export function receiptMarkup(row) {
  if (!row) return '';
  const tx = row.tx ? `<a href="${esc(row.url || '#')}">${esc(String(row.tx).slice(0, 10))}</a>` : 'no tx';
  return `<p data-testid="hall-receipt-line">${esc(row.what || '')} · ${esc(row.amount || '')} ${esc(row.asset || '')} · ${esc(row.decision || '')} · ${tx}</p>`;
}

export function noteMarkup(text) {
  if (!text) return '';
  return `<p class="hall-note" data-testid="hall-note">${esc(text)}</p>`;
}

export function sealMarkup(text) {
  if (!text) return `<p class="hall-seal" data-testid="hall-refused" hidden></p>`;
  return `<p class="hall-seal" data-testid="hall-refused" role="status">${capIcon()} <span>${esc(text)}</span></p>`;
}
