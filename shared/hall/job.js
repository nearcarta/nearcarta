// Budget ledger for a Town Hall job. No network and no signing.
// Escrow identity: budget = paid + remaining + refunded.
// A pass is held, not paid on chain, until a migrated contract can release to the named worker.
// townhall.nearcarta.near is not a payee. Source: docs/internal/source-pack.md §12.4 and §12.5.
import { nearOf, yoctoOf } from './plan.js';

export const CHAIN_RELEASE = Object.freeze({
  live: false,
  blocked: 'chain_release_blocked',
  tx: null,
  label: 'simulation',
});

export const MARKET_HIRE_GAP = Object.freeze({
  live: false,
  blocked: 'market_hire_unavailable',
  hint: 'Market hire is not available. The jobs board is not public, and a worker token cannot hire. Nothing was listed or paid.',
});

const OWN = new Set(['townhall.nearcarta.near', 'board.nearcarta.near']);
const ACCOUNT = /^[a-z0-9]([a-z0-9_-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9_-]*[a-z0-9])?)*$/;

const add = (a, b) => (BigInt(a) + BigInt(b)).toString();
const sub = (a, b) => (BigInt(a) - BigInt(b)).toString();

export function createLedger() {
  return { jobs: [], keys: {} };
}

export function conserved(job) {
  if (!job) return false;
  return BigInt(job.paidY) + BigInt(job.remainingY) + BigInt(job.refundedY) === BigInt(job.budgetY);
}

function refuse(hint, reason) {
  return { ok: false, live: false, tx: null, seal: false, cinema: false, hint, reason: reason || 'ask' };
}

function done(job, hint, extra = {}) {
  if (!conserved(job)) return refuse('The escrow no longer adds up. Nothing was signed.', 'escrow');
  return { ok: true, live: false, tx: null, seal: false, cinema: false, job, hint, ...extra };
}

function accountOk(id) {
  const s = String(id || '').trim().toLowerCase();
  if (!ACCOUNT.test(s) || s.length > 64) return '';
  if (OWN.has(s)) return '';
  return s;
}

function find(ledger, jobId) {
  return ledger.jobs.find(j => j.id === jobId) || null;
}

export function postJob(ledger, input = {}) {
  const task = String(input.task || '').replace(/\s+/g, ' ').trim().slice(0, 180);
  if (!task) return refuse('Name the task. Nothing was signed.', 'ask');
  const asset = input.asset || 'NEAR';
  if (asset !== 'NEAR') return refuse('NEAR escrow is the first asset. Nothing was signed.', 'asset');
  let budgetY;
  try { budgetY = yoctoOf(input.budgetNear); }
  catch { return refuse('The budget has to be a number above zero. Nothing was signed.', 'ask'); }
  const partsN = Math.floor(Number(input.maxParts ?? 2));
  if (!Number.isFinite(partsN) || partsN < 1 || partsN > 8) return refuse('Use 1 to 8 parts. Nothing was signed.', 'ask');
  const hours = Number(input.deadlineHours ?? 24);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24 * 30) return refuse('Set a deadline in hours. Nothing was signed.', 'ask');
  const workers = [];
  for (const raw of input.workers || []) {
    const id = accountOk(raw);
    if (!id) return refuse('Name two worker accounts. This tray does not pay townhall.nearcarta.near. Nothing was signed.', 'ask');
    if (workers.includes(id)) return refuse('Each worker account is named once. Nothing was signed.', 'ask');
    workers.push(id);
  }
  if (workers.length < 2) return refuse('Name two worker accounts. Nothing was signed.', 'ask');
  const key = String(input.idempotency || [task, budgetY, partsN, hours, workers.join(',')].join('|'));
  if (ledger.keys[key]) return done(find(ledger, ledger.keys[key]), 'That job is already posted. Nothing was signed again.', { duplicate: true });
  const total = BigInt(budgetY);
  const each = total / BigInt(partsN);
  const parts = [];
  let used = 0n;
  for (let i = 0; i < partsN; i++) {
    const slice = i === partsN - 1 ? total - used : each;
    used += slice;
    parts.push({
      id: i + 1,
      budgetY: slice.toString(),
      quoteY: null,
      worker: null,
      phase: 'open',
      counters: 0,
      counter: null,
      awarded: null,
      review: null,
      settlement: 'open',
      chain: null,
      stake: 'not seized',
    });
  }
  const now = Number(input.nowMs ?? Date.now());
  const job = {
    id: `job-${ledger.jobs.length + 1}`,
    task,
    asset: 'NEAR',
    budgetY,
    budgetNear: nearOf(budgetY),
    deadlineMs: now + Math.round(hours * 3600_000),
    maxParts: partsN,
    workers,
    parts,
    paidY: '0',
    remainingY: budgetY,
    refundedY: '0',
    status: 'open',
    live: false,
    stake: 'not seized',
  };
  ledger.jobs.push(job);
  ledger.keys[key] = job.id;
  return done(job, `Posted. ${nearOf(budgetY)} NEAR is escrow, not paid. Chain release is blocked.`);
}

function partOf(job, partId) {
  return job?.parts?.find(p => p.id === Number(partId)) || null;
}

function closed(job, nowMs) {
  return job.status === 'closed' || (nowMs != null && nowMs > job.deadlineMs);
}

function refundSlice(job, part) {
  if (part.settlement === 'refunded' || part.settlement === 'held') return false;
  job.refundedY = add(job.refundedY, part.budgetY);
  job.remainingY = sub(job.remainingY, part.budgetY);
  part.settlement = 'refunded';
  part.phase = 'refunded';
  part.stake = 'not seized';
  return true;
}

export function quotePart(ledger, input = {}) {
  const job = find(ledger, input.jobId);
  if (!job) return refuse('No job is posted. Nothing was signed.', 'ask');
  if (closed(job, input.nowMs)) return refundJob(ledger, { jobId: job.id, reason: 'timeout', nowMs: input.nowMs });
  const part = partOf(job, input.partId);
  if (!part || part.settlement !== 'open') return refuse('That part is not open. Nothing was signed.', 'part');
  const worker = accountOk(input.worker);
  if (!worker || !job.workers.includes(worker)) return refuse('That account is not a named worker. Nothing was signed.', 'worker');
  let quoteY;
  try { quoteY = yoctoOf(input.quoteNear); }
  catch { return refuse('The quote has to be a number above zero. Nothing was signed.', 'ask'); }
  if (BigInt(quoteY) <= BigInt(part.budgetY)) {
    part.quoteY = quoteY;
    part.worker = worker;
    part.phase = 'bid';
    part.counter = null;
    return done(job, `Bid ${nearOf(quoteY)} NEAR from ${worker} on part ${part.id}.`);
  }
  if (part.counters >= 1) return refuse('One counter already. Accept it or walk. Nothing was signed.', 'counter_once');
  part.counters = 1;
  part.worker = worker;
  part.phase = 'counter';
  part.counter = { worker, askY: quoteY, offerY: part.budgetY };
  return done(job, `Counter once: ${nearOf(part.budgetY)} NEAR, not ${nearOf(quoteY)}. Accept or walk.`);
}

export function acceptPart(ledger, input = {}) {
  const job = find(ledger, input.jobId);
  if (!job) return refuse('No job is posted. Nothing was signed.', 'ask');
  if (closed(job, input.nowMs)) return refundJob(ledger, { jobId: job.id, reason: 'timeout', nowMs: input.nowMs });
  const part = partOf(job, input.partId);
  if (!part) return refuse('There is no counter to accept. Nothing was signed.', 'counter');
  if (part.phase === 'bid' && part.worker && part.quoteY) {
    part.awarded = { worker: part.worker, priceY: part.quoteY };
  } else if (part.phase === 'counter' && part.counter) {
    part.awarded = { worker: part.counter.worker, priceY: part.counter.offerY };
  } else {
    return refuse('There is no counter to accept. Nothing was signed.', 'counter');
  }
  part.phase = 'awarded';
  part.settlement = 'awarded';
  part.counter = null;
  return done(job, `Awarded part ${part.id} to ${part.awarded.worker} at ${nearOf(part.awarded.priceY)} NEAR. Still in escrow.`);
}

export function walkPart(ledger, input = {}) {
  const job = find(ledger, input.jobId);
  if (!job) return refuse('No job is posted. Nothing was signed.', 'ask');
  const part = partOf(job, input.partId);
  if (!part || (part.settlement !== 'open' && part.settlement !== 'awarded')) return refuse('That part cannot be walked. Nothing was signed.', 'part');
  refundSlice(job, part);
  part.phase = 'walked';
  return done(job, `Walked part ${part.id}. ${nearOf(part.budgetY)} NEAR moved to refunded. Nothing was signed.`);
}

export function reviewPart(ledger, input = {}) {
  const job = find(ledger, input.jobId);
  if (!job) return refuse('No job is posted. Nothing was signed.', 'ask');
  if (input.nowMs != null && input.nowMs > job.deadlineMs && job.status !== 'closed') {
    return refundJob(ledger, { jobId: job.id, reason: 'timeout', nowMs: input.nowMs });
  }
  const part = partOf(job, input.partId);
  if (!part) return refuse('Award the part before review. Nothing was signed.', 'part');
  if (part.review || part.settlement === 'held' || part.settlement === 'refunded') {
    return refuse('That part was already reviewed. Nothing was signed again.', 'double');
  }
  if (part.settlement !== 'awarded' || !part.awarded) return refuse('Award the part before review. Nothing was signed.', 'part');
  if (part.phase !== 'delivered') return refuse('The worker has not delivered this part yet. Nothing was signed.', 'deliver');
  const worker = accountOk(input.worker || part.awarded.worker);
  const priceY = String(input.priceY || part.awarded.priceY);
  if (worker !== part.awarded.worker || priceY !== part.awarded.priceY) {
    return refuse('The review does not match the awarded worker and price. Nothing was released.', 'swapped');
  }
  const guard = input.guard || 'ALLOW';
  if (guard === 'BLOCK') return refuse('Guard blocked the release. The escrow stays. Nothing was paid.', 'guard_block');
  if (guard === 'WARN') return refuse('A warning needs a person in setup. The agent cannot confirm it. Nothing was paid.', 'guard_warn');
  const deliverable = String(input.deliverable || '').trim();
  if (!deliverable) return refuse('Paste the deliverable. Nothing was signed.', 'ask');
  const verdict = input.verdict === 'pass' ? 'pass' : input.verdict === 'ai_fail' ? 'ai_fail' : 'fail';
  part.review = { jobId: job.id, partId: part.id, worker, priceY, deliverable, verdict, guard };
  const alloc = BigInt(part.budgetY);
  if (verdict === 'pass') {
    const price = BigInt(priceY);
    if (price > alloc || price <= 0n) return refuse('The awarded price does not fit the part. Nothing was paid.', 'price');
    job.paidY = add(job.paidY, price.toString());
    const spare = alloc - price;
    if (spare > 0n) job.refundedY = add(job.refundedY, spare.toString());
    job.remainingY = sub(job.remainingY, alloc.toString());
    part.settlement = 'held';
    part.chain = { ...CHAIN_RELEASE };
    part.phase = 'held';
    return done(job, `Part ${part.id} passed and is held. Chain release is blocked. Nothing was paid.`);
  }
  job.refundedY = add(job.refundedY, alloc.toString());
  job.remainingY = sub(job.remainingY, alloc.toString());
  part.settlement = 'refunded';
  part.phase = verdict === 'ai_fail' ? 'ai_fail' : 'failed';
  part.stake = 'not seized';
  job.stake = 'not seized';
  const contest = verdict === 'ai_fail'
    ? ' AI fail does not seize a registration stake. The worker can withdraw it.'
    : '';
  return done(job, `Part ${part.id} was not paid.${contest} Nothing was signed.`);
}

export function refundJob(ledger, input = {}) {
  const job = find(ledger, input.jobId);
  if (!job) return refuse('No job is posted. Nothing was signed.', 'ask');
  if (job.status === 'closed') return done(job, 'The refund was already recorded. Nothing was signed again.', { duplicate: true });
  for (const part of job.parts) {
    if (part.settlement === 'open' || part.settlement === 'awarded') refundSlice(job, part);
  }
  if (BigInt(job.remainingY) > 0n) {
    job.refundedY = add(job.refundedY, job.remainingY);
    job.remainingY = '0';
  }
  job.status = 'closed';
  job.closedReason = input.reason || 'cancel';
  return done(job, `Refunded ${nearOf(job.refundedY)} NEAR on the ledger. Chain release is blocked. Nothing was signed.`);
}

export function activeCta(job) {
  if (!job) return { label: 'Post job', action: 'post', tab: 'post' };
  const counter = job.parts.find(p => p.phase === 'counter');
  if (counter) return { label: 'Accept counter', action: 'accept', partId: counter.id, tab: 'agents' };
  const awarded = job.parts.find(p => p.settlement === 'awarded');
  if (awarded) return { label: 'Record pass', action: 'pass', partId: awarded.id, tab: 'agents' };
  const bid = job.parts.find(p => p.phase === 'bid' && p.settlement === 'open');
  if (bid) return { label: 'Accept bid', action: 'accept', partId: bid.id, tab: 'agents' };
  const open = job.parts.find(p => p.settlement === 'open' && p.phase !== 'bid');
  if (open) return { label: 'Send quote', action: 'quote', partId: open.id, tab: 'agents' };
  if (job.status !== 'closed' && BigInt(job.remainingY) > 0n) return { label: 'Refund remaining', action: 'refund', tab: 'receipts' };
  return null;
}

export function statusLines(job) {
  // With no job yet this used to print "Name the task, the budget, and two workers." — which reads
  // as a validation error on the fields. A visitor who had just filled all six fields was told to
  // fill them, which is the worst possible moment for that sentence. It is not a validation
  // message at all: it is the empty-state line, so it now says what the empty state is.
  if (!job) return ['No job yet. Fill the form and press Post job; nothing is signed until you do.'];
  const lines = [`Escrow ${job.budgetNear} NEAR. Paid ${nearOf(job.paidY)}. Remaining ${nearOf(job.remainingY)}. Refunded ${nearOf(job.refundedY)}.`];
  const held = job.parts.filter(p => p.settlement === 'held').length;
  if (held) lines.push(`${held} part${held === 1 ? '' : 's'} held. Chain release is blocked.`);
  else if (job.status === 'closed') lines.push('Closed on the ledger. Nothing was signed.');
  return lines.slice(0, 2);
}
