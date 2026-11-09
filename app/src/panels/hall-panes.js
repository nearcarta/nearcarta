// Town Hall tray: Post job / Agents / Receipts. One gold button. Icons from @web3icons/core.
import { TOKEN_SVG } from '../../design/D6_dashboards/src/tokenIcons.js';
import { activeCta, MARKET_HIRE_GAP, statusLines } from '../../../shared/hall/job.js';
import { nearOf } from '../../../shared/hall/plan.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function nearIcon() {
  return String(TOKEN_SVG.NEAR || '')
    .replace(/NEAR__a/g, 'hall-near')
    .replace('width="24"', 'width="48"')
    .replace('height="24"', 'height="48"');
}

export function sealMarkup(text) {
  if (!text) return '';
  return `<p class="hall-seal" data-testid="hall-refused" role="status">${esc(text)}</p>`;
}

export function noteMarkup(text) {
  if (!text) return '';
  return `<p class="hall-note" data-testid="hall-note" role="status">${esc(text)}</p>`;
}

function field(label, id, value, extra = '') {
  return `<label class="hall-field" for="${id}"><span>${esc(label)}</span><input id="${id}" data-testid="${id}" value="${esc(value)}" ${extra}></label>`;
}

function flow() {
  return `<div class="hall-flow" data-testid="hall-flow" aria-hidden="true">
    <span class="hall-flow-ico">${nearIcon()}</span>
    <span class="hall-flow-arrow">→</span>
    <span class="hall-flow-step">Parts</span>
    <span class="hall-flow-arrow">→</span>
    <span class="hall-flow-step">Review</span>
  </div>`;
}

function tabs(tab) {
  const one = (id, label) => `<button type="button" class="hall-tab${tab === id ? ' on' : ''}" role="tab" data-tab="${id}" aria-selected="${tab === id ? 'true' : 'false'}" data-testid="hall-tab-${id}">${label}</button>`;
  return `<div class="hall-tabs" role="tablist">${one('post', 'Post job')}${one('agents', 'Agents')}${one('receipts', 'Receipts')}</div>`;
}

function postPane(form, tab) {
  return `<div class="hall-pane" data-pane="post" ${tab === 'post' ? '' : 'hidden'}>
    ${field('Task', 'hall-task', form.task, 'maxlength="180" autocomplete="off"')}
    <label class="hall-field" for="hall-budget"><span>Budget</span>
      <span class="hall-amt"><input id="hall-budget" data-testid="hall-budget" inputmode="decimal" value="${esc(form.budget)}" aria-label="Budget"><span>NEAR</span></span>
    </label>
    <div class="hall-split">
      ${field('Deadline in hours', 'hall-deadline', form.deadline, 'inputmode="numeric"')}
      ${field('Max parts', 'hall-parts', form.parts, 'inputmode="numeric"')}
    </div>
    <div class="hall-split">
      ${field('First worker', 'hall-worker-a', form.workerA, 'autocomplete="off" spellcheck="false"')}
      ${field('Second worker', 'hall-worker-b', form.workerB, 'autocomplete="off" spellcheck="false"')}
    </div>
  </div>`;
}

function agentsPane(job, form, market, tab) {
  const gap = `<p class="hall-gap" data-testid="hall-market-gap">${esc(MARKET_HIRE_GAP.hint)}</p>`;
  const listed = market?.agent?.handle
    ? `<p class="hall-line">Listed read: ${esc(market.agent.handle)}. Not hired.</p>`
    : '';
  const parts = (job?.parts || []).map(p => {
    const quote = p.settlement === 'held' && p.awarded
      ? `Held ${nearOf(p.awarded.priceY)} NEAR`
      : p.counter
      ? `Counter once ${nearOf(p.counter.offerY)} NEAR`
      : p.quoteY ? `Bid ${nearOf(p.quoteY)} NEAR` : 'No quote yet';
    const who = p.worker ? esc(p.worker) : 'no worker';
    return `<p class="hall-line" data-testid="hall-part">Part ${p.id} · ${who} · ${esc(quote)} · ${esc(p.settlement)}</p>`;
  }).join('');
  const walk = job?.parts?.find(p => p.phase === 'counter');
  const fail = job?.parts?.find(p => p.settlement === 'awarded');
  return `<div class="hall-pane" data-pane="agents" ${tab === 'agents' ? '' : 'hidden'}>
    ${gap}${listed}
    ${field('Quote part', 'hall-quote-part', form.quotePart, 'inputmode="numeric"')}
    ${field('Worker account', 'hall-quote-worker', form.quoteWorker, 'autocomplete="off" spellcheck="false"')}
    ${field('Quote', 'hall-quote-near', form.quoteNear, 'inputmode="decimal"')}
    ${field('Deliverable', 'hall-deliverable', form.deliverable, 'maxlength="240"')}
    ${parts || '<p class="hall-line">No parts yet.</p>'}
    ${walk ? `<button type="button" class="hall-text" data-cmd="walk part ${walk.id}">Walk part ${walk.id}</button>` : ''}
    ${fail ? `<button type="button" class="hall-text" data-cmd="fail part ${fail.id}">Record fail</button>` : ''}
  </div>`;
}

function receiptsPane(job, tab) {
  if (!job) {
    return `<div class="hall-pane" data-pane="receipts" ${tab === 'receipts' ? '' : 'hidden'}><p class="hall-line">No job yet. Nothing was signed.</p></div>`;
  }
  const rows = [
    ['Paid on the ledger', nearOf(job.paidY)],
    ['Remaining', nearOf(job.remainingY)],
    ['Refunded', nearOf(job.refundedY)],
  ].map(([k, v]) => `<p class="hall-line">${esc(k)} · ${esc(v)} NEAR · simulation</p>`).join('');
  const held = job.parts.filter(p => p.settlement === 'held').map(p =>
    `<p class="hall-line">Part ${p.id} held for ${esc(p.awarded?.worker || '')}. Chain release is blocked.</p>`).join('');
  return `<div class="hall-pane" data-pane="receipts" ${tab === 'receipts' ? '' : 'hidden'}>${rows}${held}</div>`;
}

export function jobTray({ tab = 'post', form = {}, job = null, market = null, seal = '', lines = [] }) {
  const cta = activeCta(job);
  const showCta = cta && (cta.tab === tab || !job);
  const status = (lines.length ? lines : statusLines(job)).slice(0, 2);
  const gold = showCta
    ? `<button type="button" class="hall-cta primary" data-testid="hall-cta" data-action="${esc(cta.action)}" data-part="${cta.partId || ''}">${esc(cta.label)}</button>`
    : '';
  return `<div class="hall-card" data-testid="hall-desk">
    ${tabs(tab)}
    ${flow()}
    ${postPane(form, tab)}
    ${agentsPane(job, form, market, tab)}
    ${receiptsPane(job, tab)}
    ${gold}
    ${status.map(line => `<p class="hall-status" data-testid="hall-status">${esc(line)}</p>`).join('')}
    ${sealMarkup(seal)}
  </div>`;
}
