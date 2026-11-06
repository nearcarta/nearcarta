import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeApp } from '../../src/app.js';
import MAIN from '../../../shared/deployments/mainnet.json' with { type: 'json' };
import {
  LAMPLIGHTER_REGISTER, asRow, nearOf, parseHallCommand, payPlan, rulesPlan, yoctoOf,
} from '../../../shared/hall/plan.js';
import {
  acceptPart, conserved, createLedger, postJob, quotePart, refundJob, reviewPart,
} from '../../../shared/hall/job.js';
import {
  assignmentRows, bountyRows, marketStatus, marketWorkers, readBounties,
} from '../../src/hall-market.js';
import { armHallDock, dispatchHallDock, installHallDock, lastHallDockSend } from '../../../app/src/panels/hall-dock.js';
import { runHallCommand } from '../../../app/src/panels/hall-actions.js';
import { jobTray, noteMarkup } from '../../../app/src/panels/hall-panes.js';

const read = (p) => readFileSync(new URL('../../../' + p, import.meta.url), 'utf8');
const Y = n => yoctoOf(n);

function row(over = {}) {
  return asRow({
    owner: 'visitor.near',
    receivers: ['townhall.nearcarta.near'],
    per_action_cap: Y('0.002'),
    daily_budget: Y('0.01'),
    max_actions_per_day: 3,
    window_start_min: 0,
    window_end_min: 0,
    min_amount: Y('0.001'),
    expires_at: String((BigInt(Date.now()) + 86_400_000n) * 1_000_000n),
    frozen: false,
    balance: Y('0.05'),
    spent_today: '0',
    actions_today: 0,
    ...over,
  });
}

test('hall commands post a job and refuse a hire that would pay townhall', () => {
  const post = parseHallCommand('post a readme pass for 0.002 near');
  assert.equal(post.kind, 'post');
  assert.equal(post.near, '0.002');
  assert.equal(parseHallCommand('quote part 1 from worker-a.near at 0.003').kind, 'quote');
  assert.equal(parseHallCommand('accept part 1').partId, 1);
  assert.equal(parseHallCommand('walk part 2').kind, 'walk');
  assert.equal(parseHallCommand('pass part 1').kind, 'pass');
  assert.equal(parseHallCommand('fail part 2').kind, 'fail');
  assert.equal(parseHallCommand('refund').kind, 'refund');
  assert.equal(parseHallCommand('tighten my cap').tighter, true);
  assert.equal(parseHallCommand('freeze my row').frozen, true);
  assert.equal(parseHallCommand('list the lamplighter').kind, 'list');
  assert.equal(parseHallCommand('hire an agent for a lamp check 0.001 near').ok, false);
  assert.equal(parseHallCommand('post a bounty 0.001').ok, false);
  assert.equal(parseHallCommand('hello').ok, false);
});

test('a job conserves escrow, counters once, and does not pay on a swapped or blocked review', () => {
  const live = row();
  assert.equal(payPlan({ near: '0.05', row: live }).reason, 'over_per_action_cap');
  const ledger = createLedger();
  const workers = ['worker-a.near', 'worker-b.near'];
  const posted = postJob(ledger, { task: 'a readme pass', budgetNear: '0.002', workers, maxParts: 2, nowMs: 1_000 });
  assert.equal(posted.ok, true);
  assert.equal(posted.tx, null);
  assert.equal(posted.job.live, false);
  const again = postJob(ledger, { task: 'a readme pass', budgetNear: '0.002', workers, maxParts: 2, nowMs: 1_000 });
  assert.equal(again.duplicate, true);
  assert.equal(ledger.jobs.length, 1);
  const own = postJob(createLedger(), { task: 'a readme pass', budgetNear: '0.002', workers: ['worker-a.near', 'townhall.nearcarta.near'] });
  assert.equal(own.ok, false);
  const high = quotePart(ledger, { jobId: posted.job.id, partId: 1, worker: 'worker-a.near', quoteNear: '0.01', nowMs: 1_000 });
  assert.match(high.hint, /Counter once/);
  const second = quotePart(ledger, { jobId: posted.job.id, partId: 1, worker: 'worker-a.near', quoteNear: '0.02', nowMs: 1_000 });
  assert.equal(second.reason, 'counter_once');
  const awarded = acceptPart(ledger, { jobId: posted.job.id, partId: 1, nowMs: 1_000 });
  assert.equal(awarded.job.parts[0].settlement, 'awarded');
  // A review before delivery is refused: the chain binds the decision to the record.
  const early = reviewPart(ledger, { jobId: posted.job.id, partId: 1, deliverable: 'a paragraph', verdict: 'pass', nowMs: 1_000 });
  assert.equal(early.reason, 'deliver');
  const D = 'a'.repeat(64);
  awarded.job.parts[0].phase = 'delivered';
  awarded.job.parts[0].deliverable = D;
  const swapped = reviewPart(ledger, {
    jobId: posted.job.id, partId: 1, worker: 'worker-b.near', priceY: awarded.job.parts[0].awarded.priceY,
    deliverable: D, verdict: 'pass', nowMs: 1_000,
  });
  assert.equal(swapped.reason, 'swapped');
  const blocked = reviewPart(ledger, {
    jobId: posted.job.id, partId: 1, deliverable: D, verdict: 'pass', guard: 'BLOCK', nowMs: 1_000,
  });
  assert.equal(blocked.reason, 'guard_block');
  assert.equal(posted.job.paidY, '0');
  quotePart(ledger, { jobId: posted.job.id, partId: 2, worker: 'worker-b.near', quoteNear: '0.001', nowMs: 1_000 });
  const low = posted.job.parts[1];
  low.awarded = { worker: 'worker-b.near', priceY: low.quoteY };
  low.settlement = 'awarded';
  low.phase = 'delivered';
  low.deliverable = 'b'.repeat(64);
  const failed = reviewPart(ledger, {
    jobId: posted.job.id, partId: 2, deliverable: 'empty', verdict: 'ai_fail', nowMs: 1_000,
  });
  assert.equal(failed.job.parts[1].stake, 'not seized');
  assert.match(failed.hint, /does not seize/);
  const passed = reviewPart(ledger, {
    jobId: posted.job.id, partId: 1, deliverable: D, verdict: 'pass', nowMs: 1_000,
  });
  assert.equal(passed.job.parts[0].settlement, 'held');
  assert.equal(passed.job.parts[0].chain.tx, null);
  assert.equal(conserved(passed.job), true);
  const twice = reviewPart(ledger, {
    jobId: posted.job.id, partId: 1, deliverable: 'a paragraph', verdict: 'pass', nowMs: 1_000,
  });
  assert.equal(twice.reason, 'double');
  const book = createLedger();
  const open = postJob(book, { task: 'a second pass', budgetNear: '0.002', workers, deadlineHours: 1, nowMs: 1_000 });
  const back = refundJob(book, { jobId: open.job.id, reason: 'timeout', nowMs: open.job.deadlineMs + 1 });
  assert.equal(back.job.remainingY, '0');
  assert.equal(back.job.paidY, '0');
  assert.equal(conserved(back.job), true);
  assert.equal(nearOf(back.job.refundedY), '0.002');
});

test('tightening a cap keeps the live expiry and does not repeat a method', () => {
  const live = row();
  const plan = rulesPlan(live, { tighter: true, frozen: true });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.calls.map(c => c.method), ['set_rules', 'set_frozen']);
  assert.equal(plan.calls[0].args.rules.expires_at, live.expires_at);
  assert.equal(plan.calls[0].deposit, '0');
  assert.notEqual(plan.calls[0].args.rules.per_action_cap, live.per_action_cap);
  const same = rulesPlan(live, { frozen: false });
  assert.equal(same.calls.length, 0);
  assert.match(same.hint, /matches the row/);
});

test('market status does not register, and a missing token sends nothing', async () => {
  let called = 0;
  const status = await marketStatus({ token: null, fetchImpl: async () => { called += 1; throw new Error('fetch'); } });
  assert.equal(called, 0);
  assert.equal(status.blocked, 'no_token');
  assert.equal(status.sent, false);
  assert.equal(status.draft.handle, LAMPLIGHTER_REGISTER.handle);
  const token = 'aat_testtoken';
  const urls = [];
  const withToken = await marketStatus({
    token,
    fetchImpl: async (url, opts) => {
      urls.push({ url, authorization: opts.headers.authorization || '' });
      if (String(url).includes('/assignments')) return { status: 401, async text() { return '{"error":"unauthorized"}'; } };
      return { status: 200, async text() { return JSON.stringify({ handle: 'lamplighter', name: 'Lamplighter', listing_status: 'live' }); } };
    },
  });
  assert.equal(withToken.blocked, 'bad_token');
  assert.equal(withToken.sent, false);
  assert.equal(urls[0].authorization, '');
  assert.match(urls[1].authorization, /^Bearer /);
  assert.equal(JSON.stringify(withToken).includes(token), false);
  assert.equal(assignmentRows({ assignments: [{ assignment: { assignmentId: 'a', status: 'in_progress', escrowAmount: '1.00', escrowToken: 'USD' }, job: { title: 'Lamp', description: 'check' } }] })[0].title, 'Lamp');
});

test('bounty rows come from the view and an empty chain is empty', async () => {
  const rows = bountyRows([['ab'.repeat(32), { amount: '1000000000000000000000', claimed_by: null, policy_version: 1 }]]);
  assert.equal(rows[0].amount, '1000000000000000000000');
  assert.equal(nearOf(rows[0].amount), '0.001');
  const seen = [];
  const body = await readBounties({
    view: async (id, method) => { seen.push(method); return method === 'get_bounties' ? [] : { frozen: false }; },
  });
  assert.deepEqual(seen, ['get_state', 'get_bounties']);
  assert.deepEqual(body.bounties, []);
  assert.equal(body.contract, 'townhall.nearcarta.near');
});

test('GET /api/hall/market reports a missing token and does not echo one', async () => {
  const res = await makeApp().request('/api/hall/market');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.sent, false);
  assert.equal(JSON.stringify(body).includes('aat_'), false);
  if (!process.env.AGENT_API_TOKEN) assert.equal(body.blocked, 'no_token');
});

test('the gold button and the dock share one runner, and a move goes through one sender', async () => {
  const ledger = createLedger();
  let posted = null;
  const sent = [];
  const ctx = {
    ledger,
    shop: 'townhall.nearcarta.near',
    job: () => posted,
    form: () => ({
      task: 'a readme pass', budget: '0.002', deadline: '24', parts: '2',
      workerA: 'worker-a.near', workerB: 'worker-b.near', deliverable: 'a paragraph', guard: 'ALLOW',
    }),
    // One sender for both paths, exactly as the tray arms it.
    sendJob: async (step) => {
      sent.push(step);
      if (step.method === 'post_job') return { tx: 'TXPOST', decision: 'allowed', signer: 'agent' };
      if (step.method === 'review' && step.pass) return { tx: 'TXREV', decision: 'denied', reason: 'ERR_GUARD_BLOCK', signer: 'agent' };
      return { tx: 'TX' + step.method.toUpperCase(), decision: 'allowed', signer: 'agent' };
    },
    nowMs: 1_000,
  };
  const bid = await runHallCommand('post a readme pass for 0.002 near', ctx);
  posted = bid.job;
  assert.equal(bid.ok, true);
  assert.equal(bid.tx, 'TXPOST');
  assert.equal(sent[0].method, 'post_job');
  assert.equal(sent[0].deposit, posted.budgetY);
  assert.equal(sent[0].receiver, 'townhall.nearcarta.near');

  const quoted = await runHallCommand('quote part 1 from worker-a.near at 0.01', ctx);
  assert.match(quoted.hint, /Counter once/);
  assert.equal(sent[1].method, 'counter', 'a bid over the slice is the single counter');

  const accepted = await runHallCommand('accept part 1', ctx);
  assert.equal(accepted.tx, 'TXACCEPT');
  assert.equal(sent[2].method, 'accept');

  const delivered = await runHallCommand('deliver part 1 ' + 'a'.repeat(64), ctx);
  assert.equal(delivered.tx, 'TXDELIVER');
  assert.equal(sent[3].method, 'deliver');
  assert.equal(sent[3].deliverable, 'a'.repeat(64));

  // A pass is refused by the chain when the guard has not cleared the part, and the
  // tray reports that refusal instead of claiming a release.
  const passed = await runHallCommand('pass part 1', ctx);
  assert.equal(passed.ok, false);
  assert.equal(passed.tx, 'TXREV');
  assert.match(passed.hint, /ERR_GUARD_BLOCK/);
  assert.match(passed.hint, /Nothing was released/);

  // An invented hire still never reaches the sender.
  const before = sent.length;
  const hired = await runHallCommand('hire an agent for a lamp check 0.001 near', ctx);
  assert.equal(hired.ok, false);
  assert.equal(sent.length, before);
});

function fakeDock() {
  const listeners = [];
  const mk = (id) => ({
    id,
    value: '',
    hidden: true,
    textContent: '',
    closest(sel) { return sel === '#' + id ? this : null; },
  });
  const input = mk('h-agent');
  const go = mk('h-agent-go');
  const log = mk('h-agent-log');
  const doc = {
    getElementById(id) { return { 'h-agent': input, 'h-agent-go': go, 'h-agent-log': log }[id] || null; },
    addEventListener(type, fn) { listeners.push({ type, fn }); },
  };
  const fire = (type, target, extra = {}) => {
    const e = { type, target, key: extra.key || '', preventDefault() {} };
    for (const l of listeners) if (l.type === type) l.fn(e);
  };
  installHallDock(doc);
  return { doc, input, go, log, fire };
}

test('the hall arrow and Enter both send, and a miss leaves the input', async () => {
  const { doc, input, go, log, fire } = fakeDock();
  const seen = [];
  armHallDock(async (text) => {
    seen.push(text);
    if (text === 'nope') return { ok: false, hint: 'Try: Tighten my cap.' };
    return { ok: true, hint: 'Bid ready.' };
  });
  input.value = 'list the lamplighter';
  fire('input', input);
  assert.equal(seen.length, 0);
  fire('click', go);
  const first = await lastHallDockSend();
  assert.equal(first.ok, true);
  assert.equal(input.value, '');
  assert.match(log.textContent, /Bid ready/);
  input.value = 'hire an agent for a lamp check 0.001 near';
  fire('keydown', input, { key: 'Enter' });
  await lastHallDockSend();
  assert.equal(seen.length, 2);
  input.value = 'nope';
  fire('click', go);
  await dispatchHallDock(doc);
  assert.equal(input.value, 'nope');
  assert.match(log.textContent, /Tighten my cap/);
});

test('the city wires the hall dock and the all-shops link still enters the room', () => {
  const ui = read('app/design/D8_shops/js/shopui.js');
  assert.match(ui, /wireHallDock\(hooks\)/);
  assert.match(ui, /installHallDock\(document\)/);
  assert.match(ui, /armHallDock/);
  assert.match(ui, /#h-agent-go/);
  assert.match(ui, /e\.key === 'Enter'/);
  assert.match(read('app/src/panels/hall-dock.js'), /id="h-agent-go"/);
  assert.match(ui, /hallPay/);
  assert.match(ui, /onPaid/);
  const home = read('app/design/D9_world/index.html');
  assert.match(home, /href="\/\?shop=hall" data-enter-shop="hall"/);
  const main = read('app/design/D9_world/js/main.js');
  assert.match(main, /export|import \{ createRouter/);
  assert.match(main, /route\.open\(/);
  const apps = read('app/design/D8_shops/js/apps.js');
  assert.doesNotMatch(apps.slice(apps.indexOf('export async function hallChange'), apps.indexOf('export async function hallPay')), /864e5/);
  const market = read('backend/src/hall-market.js');
  assert.doesNotMatch(market, /\/v1\/agents\/register/);
  assert.doesNotMatch(market, new RegExp(['sp' + 'utnik', 'social' + ' money'].join('|'), 'i'));
  const panes = read('app/src/panels/hall-panes.js');
  assert.doesNotMatch(panes, />\?</);
  assert.match(panes, /web3icons/);
  const tray = jobTray({ form: { task: '', budget: '', deadline: '24', parts: '2', workerA: '', workerB: '', quotePart: '1', quoteWorker: '', quoteNear: '', deliverable: '' } });
  assert.equal(tray.match(/class="hall-cta primary"/g).length, 1);
  assert.match(tray, /class="web3icons"/);
  assert.match(read('app/src/panels/hall.css'), /hall-agent-pop\[hidden\]/);
  assert.doesNotMatch(read('app/src/panels/hall-actions.js'), /ctx\.pay/);
  assert.match(noteMarkup('Listing is blocked'), /data-testid="hall-note"/);
  assert.equal(noteMarkup(''), '');
  assert.doesNotMatch(read('app/src/panels/hall-ui.js'), new RegExp(['sp' + 'utnik', 'social' + ' money'].join('|'), 'i'));
});

test('public worker discovery needs no credential, and the buyer view names the one it needs', async () => {
  // A real GET /v1/agents row, shaped as the live API returns it.
  const live = { agents: [
    { agent_id: '30ba50df-5509-452f-b936-8211e516979f', handle: 'web-research', name: 'Web Research', description: 'Cited briefs' },
    { agent_id: null, handle: null, name: 'no handle' },
  ] };
  const seen = [];
  const workers = await marketWorkers({
    fetchImpl: async (url) => { seen.push(url); return { status: 200, async text() { return JSON.stringify(live); } }; },
  });
  assert.equal(seen.length, 1);
  assert.match(seen[0], /\/v1\/agents\?limit=24$/);
  assert.equal(workers.workers.length, 1);
  assert.equal(workers.workers[0].handle, 'web-research');
  assert.equal(workers.status, 200);

  // No token: the shop states the exact credential and makes no authenticated call.
  let calls = 0;
  const blocked = await marketStatus({ token: null, fetchImpl: async () => { calls += 1; throw new Error('no call'); } });
  assert.equal(calls, 0);
  assert.equal(blocked.blocked, 'no_token');
  assert.match(blocked.credential, /AGENT_API_TOKEN/);
  assert.match(blocked.credential, /v1\/jobs\/board/);
  assert.equal(blocked.sent, false);

  // A worker token that lands on the buyer endpoint is reported as such, not as a hire.
  const rejected = await marketStatus({
    token: 'worker-token',
    fetchImpl: async (url) => (String(url).includes('/assignments')
      ? { status: 403, async text() { return '{"error":"forbidden"}'; } }
      : { status: 200, async text() { return '{}'; } }),
  });
  assert.equal(rejected.blocked, 'bad_token');
  assert.match(rejected.credential, /worker token cannot read a buyer job/);
  assert.equal(rejected.sent, false);
});

test('the guardhouse answers the live board, not a 500 that takes the city tray down', async () => {
  // The Guardhouse oath used to be charter.nearcarta.near, which is retired: the read threw
  // and the whole shop mount failed with it. The board is the oath now, so the tray gets a
  // live state. A retired or missing contract still answers a readable `{retired:true}` from
  // `lastGood` instead of a 500; city-boot covers that 404 on the snapshot itself.
  const res = await makeApp().request('/api/guardhouse');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.retired, undefined, 'the live board is not a retired contract');
  assert.equal(body.source, 'board');
  assert.equal(body.oath, MAIN.board.contract);
  assert.equal(typeof body.state?.owner, 'string', 'the room can read an owner');
  assert.equal(body.state?.frozen, false);
  assert.doesNotMatch(JSON.stringify(body), /at .*\.js:/, 'no stack trace in the body');
});
