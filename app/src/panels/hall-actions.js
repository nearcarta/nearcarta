// One runner for the tray buttons and the AI dock. Pay goes through ctx.pay (board propose). No wallet here.
import { hirePlan, listingView, parseHallCommand, payPlan, plainReason, rulesPlan } from '../../../shared/hall/plan.js';
import { receipt } from '../../../shared/rails/receipts.js';

function hireReceipt({ amount, tx, decision, reason, to }) {
  return receipt({
    rail: 'near',
    network: 'mainnet',
    what: decision === 'allowed' ? 'hire paid under the row cap' : 'hire refused',
    to: to ?? null,
    amount: amount == null ? null : String(amount),
    asset: 'NEAR',
    decision: decision === 'allowed' ? 'allowed' : 'refused',
    reason: reason ?? null,
    decided_by: 'charter',
    tx: tx ?? null,
    url: tx ? `https://nearblocks.io/txns/${tx}` : null,
    checks: { charter: true, within_allowance: decision === 'allowed', tee: null },
  });
}

async function payNow(pending, ctx) {
  const row = await ctx.row();
  const plan = payPlan({ near: pending.near, row, payee: pending.receiver });
  if (!plan.ok) {
    return { ok: false, hint: plan.hint, seal: plan.seal, cinema: false, clearInput: false };
  }
  if (typeof ctx.pay !== 'function') {
    return { ok: false, hint: 'Open the town door after /setup. This page does not hold the agent key. Nothing was signed.', seal: false, cinema: false };
  }
  const sent = await ctx.pay({ receiver: plan.receiver, amountY: plan.amountY, near: plan.near });
  const decision = sent?.decision;
  const tx = sent?.tx || null;
  if (decision === 'allowed' && tx) {
    ctx.clearPending?.();
    return {
      ok: true,
      hint: `Paid ${plan.near} NEAR to ${plan.receiver}.`,
      seal: false,
      cinema: true,
      tx,
      receipt: hireReceipt({ amount: plan.near, tx, decision: 'allowed', to: plan.receiver }),
    };
  }
  const code = sent?.reason || 'refused';
  const setupMiss = code === 'no_session' || code === 'no_key' || code === 'key_cannot_propose';
  return {
    ok: false,
    hint: plainReason(code) || String(code),
    seal: !setupMiss,
    cinema: false,
    tx,
    receipt: tx ? hireReceipt({ amount: plan.near, tx, decision: 'refused', reason: code, to: plan.receiver }) : null,
  };
}

export async function runHallCommand(text, ctx = {}) {
  ctx.clearSeal?.();
  const cmd = parseHallCommand(text);
  if (!cmd.ok) return { ok: false, hint: cmd.hint, seal: false, cinema: false };
  if (cmd.kind === 'walk') {
    ctx.clearPending?.();
    return { ok: true, hint: 'Walked away. Nothing was signed.', seal: false, cinema: false };
  }
  if (cmd.kind === 'list') {
    const status = typeof ctx.market === 'function' ? await ctx.market() : { blocked: 'no_token', draft: null };
    const view = listingView(status);
    return { ok: true, hint: view.hint, seal: false, cinema: false, listing: view };
  }
  if (cmd.kind === 'rules') {
    const row = await ctx.row();
    const plan = rulesPlan(row, cmd);
    if (!plan.ok) return { ok: false, hint: plan.hint, seal: !!plan.seal, cinema: false };
    if (!plan.calls.length) return { ok: true, hint: plan.hint, seal: false, cinema: false };
    if (typeof ctx.signRules !== 'function') {
      return { ok: false, hint: 'Sign is on My row. Deposit 0. Nothing was signed yet.', seal: false, cinema: false, calls: plan.calls };
    }
    const sent = await ctx.signRules(plan.calls);
    const tx = sent?.hash || sent?.tx || null;
    if (!tx) return { ok: false, hint: 'The row was not signed. Deposit stayed 0.', seal: false, cinema: false };
    return { ok: true, hint: `Signed. Cap is ${plan.capNear || 'updated'} NEAR. Deposit 0.`, seal: false, cinema: false, tx };
  }
  if (cmd.kind === 'hire') {
    const row = await ctx.row();
    const plan = hirePlan({ brief: cmd.brief, near: cmd.near, row });
    if (!plan.ok) return { ok: false, hint: plan.hint, seal: !!plan.seal, cinema: false, speech: plan.speech };
    ctx.setPending?.(plan.pending);
    return { ok: true, hint: plan.speech, seal: false, cinema: false, speech: plan.speech, pending: plan.pending };
  }
  if (cmd.kind === 'accept') {
    const pending = typeof ctx.pending === 'function' ? ctx.pending() : null;
    if (!pending) return { ok: false, hint: 'Nothing to accept. Hire an agent first. Nothing was signed.', seal: false, cinema: false };
    return payNow(pending, ctx);
  }
  if (cmd.kind === 'bounty') {
    const row = await ctx.row();
    const plan = payPlan({ near: cmd.near, row });
    if (!plan.ok) return { ok: false, hint: plan.hint, seal: !!plan.seal, cinema: false };
    return payNow({ near: plan.near, amountY: plan.amountY, receiver: plan.receiver, brief: 'bounty' }, ctx);
  }
  return { ok: false, hint: cmd.hint || 'That line did not run.', seal: false, cinema: false };
}
