// One runner for the gold button and the AI dock. Neither path signs.
// A pass stays held until a migrated contract can release to the named worker.
import { listingView, parseHallCommand, rulesPlan } from '../../../shared/hall/plan.js';
import { acceptPart, activeCta, MARKET_HIRE_GAP, postJob, quotePart, refundJob, reviewPart, walkPart } from '../../../shared/hall/job.js';

function formOf(ctx) {
  const f = ctx.form?.() || {};
  return {
    task: String(f.task || '').trim(),
    budget: String(f.budget || '').trim(),
    deadline: f.deadline || '24',
    parts: f.parts || '2',
    workers: [f.workerA, f.workerB].map(v => String(v || '').trim()).filter(Boolean),
    deliverable: String(f.deliverable || '').trim(),
    guard: f.guard || 'ALLOW',
  };
}

function current(ctx) {
  return ctx.job?.() || null;
}

export async function runHallCommand(text, ctx = {}) {
  const cmd = parseHallCommand(text);
  ctx.clearSeal?.();
  if (!cmd.ok && cmd.kind !== 'post') {
    if (cmd.kind === 'miss' && cmd.hint) return { ...cmd, clearInput: false };
  }
  const ledger = ctx.ledger;
  const form = formOf(ctx);
  const job = current(ctx);
  if (cmd.kind === 'rules') {
    const row = await ctx.row?.();
    const plan = rulesPlan(row, cmd);
    if (!plan.ok) return { ok: false, hint: plan.hint, seal: !!plan.seal, cinema: false, clearInput: false };
    if (!plan.calls.length) return { ok: true, hint: plan.hint, seal: false, cinema: false };
    if (typeof ctx.signRules !== 'function') {
      return { ok: false, hint: 'Personal rules open in /setup. Nothing was signed here.', seal: false, cinema: false };
    }
    const signed = await ctx.signRules(plan.calls);
    return { ok: !!signed?.tx, hint: signed?.hint || plan.hint || 'The row edit was signed.', seal: false, cinema: false, tx: signed?.tx || null };
  }
  if (cmd.kind === 'list') {
    const status = typeof ctx.market === 'function' ? await ctx.market() : { blocked: 'no_token', sent: false };
    const view = listingView(status);
    return { ok: true, hint: `${view.hint} ${MARKET_HIRE_GAP.hint}`, seal: false, cinema: false, listing: view, market: status, live: false };
  }
  if (!ledger) return { ok: false, hint: 'The job ledger is not ready. Nothing was signed.', seal: false, cinema: false };
  if (cmd.kind === 'post') {
    const posted = postJob(ledger, {
      task: cmd.task || form.task,
      budgetNear: cmd.near || form.budget,
      asset: 'NEAR',
      deadlineHours: form.deadline,
      maxParts: form.parts,
      workers: form.workers,
      nowMs: ctx.nowMs,
    });
    return { ...posted, clearInput: posted.ok };
  }
  if (!job) return { ok: false, hint: 'Post a job first. Nothing was signed.', seal: false, cinema: false, clearInput: false };
  if (cmd.kind === 'quote') {
    const quoted = quotePart(ledger, { jobId: job.id, partId: cmd.partId, worker: cmd.worker, quoteNear: cmd.near, nowMs: ctx.nowMs });
    return { ...quoted, clearInput: quoted.ok };
  }
  if (cmd.kind === 'accept') {
    const accepted = acceptPart(ledger, { jobId: job.id, partId: cmd.partId, nowMs: ctx.nowMs });
    return { ...accepted, clearInput: accepted.ok };
  }
  if (cmd.kind === 'walk') {
    const walked = walkPart(ledger, { jobId: job.id, partId: cmd.partId });
    return { ...walked, clearInput: walked.ok };
  }
  if (cmd.kind === 'pass' || cmd.kind === 'fail') {
    const part = job.parts.find(p => p.id === cmd.partId);
    const reviewed = reviewPart(ledger, {
      jobId: job.id,
      partId: cmd.partId,
      worker: part?.awarded?.worker,
      priceY: part?.awarded?.priceY,
      deliverable: form.deliverable,
      verdict: cmd.kind === 'pass' ? 'pass' : 'fail',
      guard: form.guard,
      nowMs: ctx.nowMs,
    });
    return { ...reviewed, clearInput: reviewed.ok };
  }
  if (cmd.kind === 'refund') {
    const refunded = refundJob(ledger, { jobId: job.id, reason: 'cancel', nowMs: ctx.nowMs });
    return { ...refunded, clearInput: refunded.ok };
  }
  return { ok: false, kind: 'miss', hint: cmd.hint, seal: false, cinema: false, clearInput: false };
}

export function trayAction(ctx) {
  return activeCta(ctx.job?.() || null);
}
