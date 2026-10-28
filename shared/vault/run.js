// One arena attack against one charter, step by step, until the charter refuses.
// Shared by the backend runner (shared arena charter) and the browser (the visitor's own charter).
import { ATTACK_IDS, TAG_RE, pickClause, plan, proposal } from './attacks.js';
import { TASK_IDS, planTask, taskProposal } from './tasks.js';

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

export async function runSteps({ charter, key, attackId, tag, viewF, send, rpcCall, onStep = () => {} }) {
  if (!ATTACK_IDS.includes(attackId)) throw bad('unknown attack');
  if (!TAG_RE.test(tag)) throw bad('nickname: 1-20 of a-z 0-9 -');
  const clauses = await viewF(charter, 'get_clauses');
  const { id: clauseId, clause } = pickClause(clauses);
  const u = await viewF(charter, 'get_usage', { clause_id: clauseId });
  const steps = plan(attackId, clause, { spent: (BigInt(u.spent) + BigInt(u.reserved || 0)).toString(), count: u.count });
  const out = [];
  for (const step of steps) {
    const st = await viewF(charter, 'get_state');
    const p = proposal({ clauseId, step, nonce: st.next_nonce, policyVersion: st.policy_version, tag, attackId });
    const r = await send(rpcCall, { key, charter, p });
    const v = r.value || {};
    const s = { tx: r.hash, receiver: step.receiver, amount: step.amount,
      decision: r.ok ? v.decision : 'failed', reason: r.ok ? (v.reason ?? null) : r.error };
    out.push(s); onStep(s, out.length, steps.length);
    if (!r.ok || v.decision === 'denied') break;
  }
  const last = out[out.length - 1];
  return { charter, attack: attackId, tag, clause_id: clauseId, planned: steps.length, steps: out,
    refused: last?.decision === 'denied', reason: last?.reason ?? null };
}

/** One honest agent task on a charter: a single `propose` that a well-set charter should allow. */
export async function runTask({ charter, key, taskId, tag, viewF, send, rpcCall }) {
  if (!TASK_IDS.includes(taskId)) throw bad('unknown task');
  if (!TAG_RE.test(tag)) throw bad('nickname: 1-20 of a-z 0-9 -');
  const clauses = await viewF(charter, 'get_clauses');
  const { id: clauseId, clause } = pickClause(clauses);
  const u = await viewF(charter, 'get_usage', { clause_id: clauseId });
  const step = planTask(taskId, clause, { spent: (BigInt(u.spent) + BigInt(u.reserved || 0)).toString(), count: u.count });
  const st = await viewF(charter, 'get_state');
  const p = taskProposal({ clauseId, step, nonce: st.next_nonce, policyVersion: st.policy_version, tag, taskId });
  const r = await send(rpcCall, { key, charter, p });
  const v = r.value || {};
  const decision = r.ok ? v.decision : 'failed';
  return { charter, task: taskId, tag, clause_id: clauseId, tx: r.hash, receiver: step.receiver, amount: step.amount,
    decision, reason: r.ok ? (v.reason ?? null) : r.error, passed: decision === 'allowed' };
}
