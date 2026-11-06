import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeApp } from '../../src/app.js';
import {
  LAMPLIGHTER_REGISTER, asRow, hirePlan, nearOf, parseHallCommand, payPlan, rulesPlan, yoctoOf,
} from '../../../shared/hall/plan.js';
import {
  assignmentRows, bountyRows, marketStatus, readBounties,
} from '../../src/hall-market.js';
import { armHallDock, dispatchHallDock, installHallDock, lastHallDockSend } from '../../../app/src/panels/hall-dock.js';
import { runHallCommand } from '../../../app/src/panels/hall-actions.js';
import { lampIcon, noteMarkup } from '../../../app/src/panels/hall-panes.js';

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

test('hall commands name list, hire, bounty, cap, and freeze', () => {
  assert.equal(parseHallCommand('list the lamplighter').kind, 'list');
  assert.equal(parseHallCommand('hire an agent for a lamp check 0.001 near').near, '0.001');
  assert.equal(parseHallCommand('post a bounty 0.001').kind, 'bounty');
  assert.equal(parseHallCommand('tighten my cap').tighter, true);
  assert.equal(parseHallCommand('freeze my row').frozen, true);
  assert.equal(parseHallCommand('accept').kind, 'accept');
  assert.equal(parseHallCommand('walk away').kind, 'walk');
  assert.equal(parseHallCommand('hello').ok, false);
});

test('a hire over the cap counters, and a fitting bounty does not sign by itself', () => {
  const live = row();
  const over = hirePlan({ brief: 'a lamp check', near: '0.05', row: live });
  assert.equal(over.phase, 'counter');
  assert.equal(over.pending.near, '0.002');
  assert.equal(over.seal, false);
  const fit = payPlan({ near: '0.001', row: live });
  assert.equal(fit.ok, true);
  assert.equal(fit.amountY, Y('0.001'));
  const blocked = payPlan({ near: '0.05', row: live });
  assert.equal(blocked.reason, 'over_per_action_cap');
  assert.equal(blocked.seal, true);
  const stranger = payPlan({ near: '0.001', row: row({ receivers: ['other.near'] }) });
  assert.equal(stranger.reason, 'receiver_not_allowlisted');
  assert.equal(payPlan({ near: '0.001', row: row({ frozen: true }) }).reason, 'frozen');
  assert.equal(payPlan({ near: '0.001', row: row({ expires_at: '1' }), nowMs: Date.now() }).reason, 'clause_expired');
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

test('accept pays through the same plan the button uses, and a miss keeps the line', async () => {
  const live = row();
  const pays = [];
  const ctx = {
    row: async () => live,
    pending: () => ctx._p,
    setPending: p => { ctx._p = p; },
    clearPending: () => { ctx._p = null; },
    pay: async (plan) => { pays.push(plan); return { decision: 'allowed', tx: 'abc', signer: 'agent' }; },
  };
  const bid = await runHallCommand('hire an agent for a lamp check 0.001 near', ctx);
  assert.equal(bid.ok, true);
  assert.equal(pays.length, 0);
  assert.match(bid.speech, /Accept pays/);
  const paid = await runHallCommand('accept', ctx);
  assert.equal(pays.length, 1);
  assert.equal(pays[0].amountY, Y('0.001'));
  assert.equal(paid.cinema, true);
  assert.equal(paid.tx, 'abc');
  const refused = await runHallCommand('post a bounty 0.05', { row: async () => live, pay: async () => { throw new Error('should not pay'); } });
  assert.equal(refused.seal, true);
  assert.equal(refused.cinema, false);
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
  assert.match(home, /href="\/shops\/hall\/"/);
  const main = read('app/design/D9_world/js/main.js');
  assert.match(main, /a\[href="\/shops\/hall\/"\]/);
  assert.match(main, /jump\('hall'\)/);
  const apps = read('app/design/D8_shops/js/apps.js');
  assert.doesNotMatch(apps.slice(apps.indexOf('export async function hallChange'), apps.indexOf('export async function hallPay')), /864e5/);
  const market = read('backend/src/hall-market.js');
  assert.doesNotMatch(market, /\/v1\/agents\/register/);
  assert.doesNotMatch(market, new RegExp(['sp' + 'utnik', 'social' + ' money'].join('|'), 'i'));
  const panes = read('app/src/panels/hall-panes.js');
  assert.doesNotMatch(panes, />\?</);
  assert.match(lampIcon(), /<svg/);
  assert.match(read('app/src/panels/hall.css'), /hall-agent-pop\[hidden\]/);
  assert.match(noteMarkup('Listing is blocked'), /data-testid="hall-note"/);
  assert.equal(noteMarkup(''), '');
  assert.doesNotMatch(read('app/src/panels/hall-ui.js'), new RegExp(['sp' + 'utnik', 'social' + ' money'].join('|'), 'i'));
});
