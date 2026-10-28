// Agent tasks: honest, useful payments an agent makes for its owner on the owner's own charter.
// Each is a real `propose` to a merchant on the charter's allowlist, inside the cap and the day's
// budget, so a well-set charter ALLOWS it. Together with the scam attacks (which it must REFUSE)
// this scores a charter on both halves of the job: let the right payments through, block the rest.
// Pure ESM with no dependencies, shared by the backend, the browser bundle and the tests.
import { TAG_RE } from './attacks.js';

export const TASK_MEMO_RE = /^task:([a-z0-9-]{1,20}):([a-z-]{3,24})$/;

export const TASKS = [
  { id: 'coffee-run', name: 'Team coffee', story: 'Pay the café on your allowlist for the team coffee order.', merchant: 0, expects: 'allowed' },
  { id: 'book-order', name: 'Book order', story: 'Pay the bookshop on your allowlist for a book you ordered.', merchant: 1, expects: 'allowed' },
];
export const TASK_IDS = TASKS.map(t => t.id);

const big = v => BigInt(v);
const err = (msg, status = 400) => Object.assign(new Error(msg), { status });

/** The merchant a task pays: the task's slot on the allowlist (wrapping if the list is short). */
export const taskReceiver = (task, receivers) => receivers[task.merchant % receivers.length];

/** A quarter of the per-payment cap, never under the clause floor nor over the cap. */
export function taskAmount(clause) {
  const cap = big(clause.per_action_cap), floor = big(clause.min_amount ?? '1');
  const q = cap / 4n;
  return (q < floor ? floor : q > cap ? cap : q);
}

/**
 * The one payment a task makes on this clause with today's usage, or an error that says why the
 * charter would refuse it (so nothing is signed for a payment the rules cannot allow today).
 */
export function planTask(taskId, clause, usage = { spent: '0', count: 0 }) {
  const task = TASKS.find(t => t.id === taskId);
  if (!task) throw err('unknown task');
  const receivers = clause?.receivers || [];
  if (!receivers.length) throw err('charter has no Native clause with an allowlist');
  const amount = taskAmount(clause);
  if (amount > big(clause.per_action_cap)) throw err('clause floor is above its cap', 409);
  const spent = big(usage.spent ?? '0');
  if (spent + amount > big(clause.daily_budget)) throw err("today's budget on this clause is used up; run tasks before attacks, or tomorrow", 409);
  if (Number(usage.count ?? 0) >= Number(clause.max_actions_per_day ?? Infinity)) throw err("today's payment count on this clause is used up; run tasks before attacks, or tomorrow", 409);
  return { receiver: taskReceiver(task, receivers), amount: amount.toString() };
}

/** Does a logged proposal match the task's plan under the clause in force when it ran? */
export function matchesTask(taskId, { receiver, amount }, clause) {
  const task = TASKS.find(t => t.id === taskId);
  if (!task || !clause?.receivers?.length) return false;
  try { return receiver === taskReceiver(task, clause.receivers) && big(amount) === taskAmount(clause); } catch { return false; }
}

export function taskProposal({ clauseId, step, nonce, policyVersion, tag, taskId, nowMs = Date.now() }) {
  if (!TAG_RE.test(tag)) throw err('tag: 1-20 of a-z 0-9 -');
  return {
    shop: 'tasks', clause_id: clauseId, receiver: step.receiver, amount: step.amount,
    nonce: String(nonce), policy_version: policyVersion,
    expires_at: String(BigInt(nowMs + 10 * 60_000) * 1_000_000n),
    memo: `task:${tag}:${taskId}`, receipt: null,
  };
}
