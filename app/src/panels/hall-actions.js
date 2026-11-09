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
  // One sender for both the gold CTA and the AI dock. It builds the board call, signs
  // with the browser's agent key, and returns the real tx or a refusal. The local
  // ledger decides what move is legal; the chain decides whether it is allowed.
  const send = async (step) => {
    if (!step) return { tx: null, refusal: 'That move is not part of a job.', signer: null };
    if (typeof ctx.sendJob !== 'function') return { tx: null, refusal: 'The signer is not ready. Nothing was signed.', signer: null };
    const out = await ctx.sendJob(step);
    return { tx: out?.tx || null, refusal: out?.decision === 'denied' ? (out.reason || 'refused') : null, signer: out?.signer || null };
  };
  if (cmd.kind === 'post') {
    const posted = postJob(ledger, {
      task: cmd.task || form.task,
      budgetNear: cmd.near || form.budget,
      asset: 'NEAR',
      deadlineHours: form.deadline,
      maxParts: form.parts,
      workers: cmd.workers?.length ? cmd.workers : form.workers,
      nowMs: ctx.nowMs,
    });
    if (!posted.ok) return { ...posted, clearInput: false };
    // post_job carries the escrow. The board forwards it, so the deposit is the budget.
    const body = {
      task: posted.job.task, parts: (posted.job.parts || []).length,
      deadline: String((BigInt(posted.job.deadlineMs) * 1_000_000n)), workers: posted.job.workers,
      idempotency: null,
    };
    const sent = await send({ kind: 'post_job', method: 'post_job', receiver: ctx.shop, deposit: posted.job.budgetY, args: body });
    if (sent.refusal) return { ...posted, ok: false, live: false, tx: sent.tx, seal: true, hint: `The board refused the post: ${sent.refusal}. Nothing was paid.`, clearInput: false };
    posted.job.tx = sent.tx;
    posted.job.live = !!sent.tx;
    return { ...posted, tx: sent.tx, hint: `Posted. ${posted.job.budgetNear} NEAR is escrow. ${sent.tx ? 'Tx ' + sent.tx.slice(0, 10) + '.' : ''}`, clearInput: true };
  }
  if (!job) return { ok: false, hint: 'Post a job first. Nothing was signed.', seal: false, cinema: false, clearInput: false };
  const jobId = job.chainId ?? job.id.replace(/^job-/, '');
  if (cmd.kind === 'quote') {
    const quoted = quotePart(ledger, { jobId: job.id, partId: cmd.partId, worker: cmd.worker, quoteNear: cmd.near, nowMs: ctx.nowMs });
    if (!quoted.ok) return { ...quoted, clearInput: false };
    // A bid is the worker's move; a counter is the poster's. The local ledger says
    // which one this is, so the chain gets the same method the tray shows.
    const part = job.parts.find(p => p.id === cmd.partId);
    const isCounter = part?.counters === 1;
    const near = isCounter ? part.counter.offerY : part.quoteY;
    const sent = await send({ kind: isCounter ? 'counter' : 'bid', method: isCounter ? 'counter' : 'bid', receiver: ctx.shop, jobId, part: Number(cmd.partId), near });
    if (sent.refusal) return { ...quoted, ok: false, tx: sent.tx, seal: true, hint: `The board refused it: ${sent.refusal}. Nothing was paid.`, clearInput: false };
    quoted.job.tx = sent.tx;
    return { ...quoted, tx: sent.tx, hint: `${quoted.hint}${sent.tx ? ' Tx ' + sent.tx.slice(0, 10) + '.' : ''}`, clearInput: true };
  }
  if (cmd.kind === 'accept') {
    const accepted = acceptPart(ledger, { jobId: job.id, partId: cmd.partId, nowMs: ctx.nowMs });
    if (!accepted.ok) return { ...accepted, clearInput: false };
    const sent = await send({ kind: 'accept', method: 'accept', receiver: ctx.shop, jobId, part: Number(cmd.partId) });
    if (sent.refusal) return { ...accepted, ok: false, tx: sent.tx, seal: true, hint: `The board refused the award: ${sent.refusal}. Nothing was paid.`, clearInput: false };
    accepted.job.tx = sent.tx;
    return { ...accepted, tx: sent.tx, hint: `${accepted.hint}${sent.tx ? ' Tx ' + sent.tx.slice(0, 10) + '.' : ''}`, clearInput: true };
  }
  if (cmd.kind === 'deliver') {
    const part = job.parts.find(p => p.id === cmd.partId);
    if (!part || part.phase !== 'awarded') return { ok: false, hint: 'Award the part before it can be delivered.', seal: false, cinema: false, clearInput: false };
    const digest = String(cmd.deliverable || form.deliverable || '').trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(digest)) return { ok: false, hint: 'Paste the 32-byte sha256 of the deliverable. Nothing was signed.', seal: false, cinema: false, clearInput: false };
    // Delivered, not reviewed: settlement stays `awarded` so the review is still the
    // move that decides the money. Only the review can set `held`.
    part.deliverable = digest;
    part.phase = 'delivered';
    const sent = await send({ kind: 'deliver', method: 'deliver', receiver: ctx.shop, jobId, part: Number(cmd.partId), deliverable: digest });
    if (sent.refusal) return { ok: false, tx: sent.tx, seal: true, hint: `The board refused the delivery: ${sent.refusal}. Nothing was paid.`, cinema: false, clearInput: false, job };
    job.tx = sent.tx;
    return { ok: true, job, tx: sent.tx, hint: `Delivered part ${part.id}. Waiting for the guard to clear it.${sent.tx ? ' Tx ' + sent.tx.slice(0, 10) + '.' : ''}`, seal: false, cinema: false, clearInput: true };
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
      deliverable: part?.deliverable || form.deliverable,
      verdict: cmd.kind === 'pass' ? 'pass' : 'fail',
      guard: form.guard,
      nowMs: ctx.nowMs,
    });
    if (!reviewed.ok) return { ...reviewed, clearInput: false };
    // The review presents the delivered record. On chain the pass needs the guard's
    // clearance, so a Guard BLOCK refuses here and in the contract.
    const sent = await send({
      kind: 'review', method: 'review', receiver: ctx.shop, jobId, part: Number(cmd.partId),
      pass: cmd.kind === 'pass', deliverable: part?.deliverable || '',
    });
    if (sent.refusal) return { ...reviewed, ok: false, tx: sent.tx, seal: true, hint: `The chain refused the review: ${sent.refusal}. Nothing was released.`, clearInput: false };
    reviewed.job.tx = sent.tx;
    return { ...reviewed, tx: sent.tx, hint: `${reviewed.hint}${sent.tx ? ' Tx ' + sent.tx.slice(0, 10) + '.' : ''}`, clearInput: true };
  }
  if (cmd.kind === 'refund') {
    const refunded = refundJob(ledger, { jobId: job.id, reason: 'cancel', nowMs: ctx.nowMs });
    if (!refunded.ok) return { ...refunded, clearInput: false };
    const sent = await send({ kind: 'refund', method: 'refund', receiver: ctx.shop, jobId });
    if (sent.refusal) return { ...refunded, ok: false, tx: sent.tx, seal: true, hint: `The board refused the refund: ${sent.refusal}. Nothing was paid.`, clearInput: false };
    refunded.job.tx = sent.tx;
    return { ...refunded, tx: sent.tx, hint: `${refunded.hint}${sent.tx ? ' Tx ' + sent.tx.slice(0, 10) + '.' : ''}`, clearInput: true };
  }
  return { ok: false, kind: 'miss', hint: cmd.hint, seal: false, cinema: false, clearInput: false };
}

export function trayAction(ctx) {
  return activeCta(ctx.job?.() || null);
}
