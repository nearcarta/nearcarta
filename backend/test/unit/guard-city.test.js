import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  GUARD_MISS, POISON_PAYEE, TRICK_YOCTO, capHolds, checkUrl, freezePlan, lampsFor, parseGuardCommand,
  runGuardAction, runGuardAgent, trickAmountYocto, trickGate,
} from '../../../app/src/panels/guard-agent.js';
import {
  DOCK_NOT_READY, armGuardDock, dispatchGuardDock, installGuardDock, lastGuardDockSend,
} from '../../../app/src/panels/guard-dock.js';
import { guardMarkup } from '../../../app/src/panels/guard-tray.js';
import { GUARD_LIVE_STEPS } from '../../scripts/guard-live-plan.js';

const read = (p) => readFileSync(new URL('../../../' + p, import.meta.url), 'utf8');
const esc = (s) => String(s ?? '');
const HEX = 'ab'.repeat(32);

test('guard commands name a check, a trick, or a freeze and invent nothing', () => {
  assert.equal(parseGuardCommand('').hint, GUARD_MISS);
  assert.equal(parseGuardCommand('hello there').ok, false);
  const check = parseGuardCommand('Check shop-moved-pay-here.near');
  assert.equal(check.action, 'check');
  assert.equal(check.account, POISON_PAYEE);
  assert.equal(parseGuardCommand('check shop-moved-pay-here.near').account, POISON_PAYEE);
  assert.equal(parseGuardCommand('Check').ok, false);
  assert.match(parseGuardCommand('Check').hint, /account/i);
  assert.equal(parseGuardCommand('Try poisoned invoice').action, 'trick');
  assert.equal(parseGuardCommand('poison').id, 'poisoned-invoice');
  assert.equal(parseGuardCommand('trick').id, 'poisoned-invoice');
  assert.equal(parseGuardCommand('I checked').action, 'confirm');
  assert.equal(parseGuardCommand('confirm').action, 'confirm');
  assert.equal(parseGuardCommand('Let it knock').action, 'knock');
  assert.equal(parseGuardCommand('knock anyway').action, 'knock');
  assert.deepEqual(parseGuardCommand('Unfreeze').frozen, false);
  assert.equal(parseGuardCommand('Unfreeze').action, 'freeze');
  assert.equal(parseGuardCommand('Freeze my row').frozen, true);
  const both = parseGuardCommand('Freeze shop-moved-pay-here.near');
  assert.equal(both.action, 'freeze');
  assert.equal(both.account, undefined);
  assert.equal(parseGuardCommand('Check ' + HEX).account, HEX);
});

test('warn and block do not propose until the visitor says so', () => {
  assert.equal(trickGate('allow').propose, true);
  assert.equal(trickGate('allow').seal, false);
  assert.equal(trickGate('warn').propose, false);
  assert.equal(trickGate('warn').needs, 'confirm');
  assert.equal(trickGate('warn', { confirmed: true }).propose, true);
  assert.equal(trickGate('block').propose, false);
  assert.equal(trickGate('block').needs, 'knock');
  assert.equal(trickGate('block', { knock: true }).propose, true);
  assert.equal(trickGate('nope').propose, false);
});

test('a cap under 0.001 NEAR blocks the trick and an unknown cap does not', () => {
  assert.equal(capHolds(null).unknown, true);
  assert.equal(capHolds('').ok, true);
  assert.equal(capHolds(String(BigInt(TRICK_YOCTO) - 1n)).ok, false);
  assert.equal(capHolds(TRICK_YOCTO).ok, true);
  assert.equal(capHolds('nope').ok, false);
  const raised = trickAmountYocto(String(BigInt(TRICK_YOCTO) + 1n), TRICK_YOCTO);
  assert.equal(raised.ok, false);
  assert.equal(raised.amount, String(BigInt(TRICK_YOCTO) + 1n));
});

test('freeze signs with the session key only when set_frozen is allowed', () => {
  assert.equal(freezePlan({ hasRow: false }).sign, false);
  assert.equal(freezePlan({ hasRow: false }).wallet, false);
  const silent = freezePlan({ methodNames: null, approve: false });
  assert.equal(silent.needsApproval, true);
  assert.equal(silent.sign, false);
  assert.equal(silent.wallet, false);
  const limited = freezePlan({ methodNames: ['propose', 'propose_call'], approve: false });
  assert.equal(limited.needsApproval, true);
  assert.equal(limited.wallet, false);
  const approved = freezePlan({ methodNames: ['propose', 'propose_call'], approve: true });
  assert.equal(approved.sign, true);
  assert.equal(approved.wallet, true);
  assert.equal(approved.deposit, '0');
  const open = freezePlan({ methodNames: [] });
  assert.equal(open.sign, true);
  assert.equal(open.wallet, false);
  assert.equal(open.deposit, '0');
  const named = freezePlan({ methodNames: ['set_frozen'] });
  assert.equal(named.sign, true);
  assert.equal(named.wallet, false);
  assert.equal(named.deposit, '0');
});

test('lamps follow the check reason codes', () => {
  const lamps = lampsFor({ reasons: [
    { code: 'denylisted', level: 'block' },
    { code: 'lookalike', level: 'block' },
    { code: 'new_account', level: 'warn' },
    { code: 'code_changed', level: 'warn' },
    { code: 'no_history', level: 'warn' },
  ] });
  const by = Object.fromEntries(lamps.map(l => [l.id, l.level]));
  assert.deepEqual(by, { denylist: 'block', lookalike: 'block', age: 'warn', code: 'warn', list: 'warn' });
  const idle = Object.fromEntries(lampsFor({ reasons: [] }).map(l => [l.id, l.level]));
  assert.deepEqual(idle, { denylist: 'ok', lookalike: 'ok', age: 'ok', code: 'ok', list: 'ok' });
});

test('the check url carries the charter only when one is set', () => {
  assert.equal(checkUrl('a.near', ''), '/api/guardhouse/check/a.near');
  assert.equal(checkUrl('a.near', 'me.near'), '/api/guardhouse/check/a.near?charter=me.near');
});

function ctx(over = {}) {
  const calls = { check: [], send: [] };
  const state = over.state || {};
  const base = {
    state,
    capYocto: null,
    minYocto: null,
    check: async (account) => {
      calls.check.push(account);
      return over.raw || { account, verdict: 'allow', reasons: [], signals: {} };
    },
    trickSend: async (id) => { calls.send.push(id); return over.sent; },
    trickPlan: async () => ({ receiver: POISON_PAYEE }),
  };
  return { calls, state, run: (text) => runGuardAgent({ text, ...base, ...over.hooks }) };
}

test('a check never proposes, and warn or block waits before trickSend', async () => {
  const checked = ctx();
  const out = await checked.run('Check shop-moved-pay-here.near');
  assert.equal(out.ok, true);
  assert.equal(out.propose, false);
  assert.equal(out.cinema, false);
  assert.equal(checked.calls.send.length, 0);
  assert.deepEqual(checked.calls.check, [POISON_PAYEE]);

  const allow = ctx({ sent: { refused: false, decision: 'allowed', tx: 'def' } });
  const sent = await allow.run('Try poisoned invoice');
  assert.equal(allow.calls.send.length, 1);
  assert.equal(sent.cinema, 'pass');
  assert.equal(sent.tx, 'def');

  const warn = ctx({ raw: { verdict: 'warn', reasons: [{ code: 'new_account', level: 'warn', text: 'New account' }], signals: {} } });
  const held = await warn.run('Try poisoned invoice');
  assert.equal(warn.calls.send.length, 0);
  assert.equal(held.ok, true);
  assert.equal(held.seal, true);
  assert.equal(warn.state.pending, 'confirm');
  const go = await runGuardAction({ ok: true, action: 'confirm' }, {
    state: warn.state,
    check: warn.run && (async () => { throw new Error('should reuse the check'); }),
    trickSend: async () => { warn.calls.send.push('again'); return { refused: false, decision: 'allowed', tx: 'ok1' }; },
  });
  assert.equal(warn.calls.send.length, 1);
  assert.equal(go.cinema, 'pass');
  const late = await runGuardAction({ ok: true, action: 'confirm' }, { state: warn.state, check: async () => ({ verdict: 'warn', reasons: [], signals: {} }) });
  assert.equal(late.ok, false);

  const block = ctx({ raw: { verdict: 'block', reasons: [{ code: 'denylisted', level: 'block', text: 'On the deny list' }], signals: {} } });
  const stopped = await block.run('Try poisoned invoice');
  assert.equal(block.calls.send.length, 0);
  assert.equal(block.state.pending, 'knock');
  assert.equal(stopped.propose, false);
});

test('a small cap, a local rule, and a chain refusal each stay in their lane', async () => {
  const small = ctx({ capYocto: '1', sent: { refused: false, decision: 'allowed', tx: 'nope' } });
  const held = await runGuardAgent({
    text: 'Try poisoned invoice',
    state: small.state,
    capYocto: '1',
    check: async () => ({ verdict: 'allow', reasons: [], signals: {} }),
    trickSend: async () => { small.calls.send.push('x'); return small.sent; },
  });
  assert.equal(small.calls.send.length, 0);
  assert.equal(held.seal, true);
  assert.match(held.hint, /Nothing was signed/);

  const local = await runGuardAgent({
    text: 'Try poisoned invoice',
    state: {},
    check: async () => ({ verdict: 'allow', reasons: [], signals: {} }),
    trickSend: async () => ({ refused: true, fromRule: true, reason: 'over_per_action_cap', tx: null }),
  });
  assert.equal(local.cinema, false);
  assert.equal(local.seal, true);

  const chain = await runGuardAgent({
    text: 'Try poisoned invoice',
    state: {},
    check: async () => ({ verdict: 'allow', reasons: [], signals: {} }),
    trickSend: async () => ({ refused: true, reason: 'receiver_not_allowlisted', tx: 'abc', decision: 'denied' }),
  });
  assert.equal(chain.cinema, 'refuse');
  assert.equal(chain.tx, 'abc');
});

test('freeze without a key asks for one approval and a landed tx is the only cinema', async () => {
  const missing = await runGuardAgent({ text: 'Freeze my row', state: {} });
  assert.equal(missing.ok, false);
  assert.match(missing.hint, /Nothing was signed/);
  const state = {};
  const ask = await runGuardAgent({
    text: 'Freeze my row',
    state,
    freeze: async () => ({ needsApproval: true, ok: false, hint: 'needs one approval' }),
  });
  assert.equal(ask.ok, true);
  assert.equal(ask.cinema, false);
  assert.equal(ask.needsApproval, true);
  const froze = await runGuardAgent({
    text: 'Freeze my row',
    state: {},
    freeze: async () => ({ ok: true, tx: 'frz' }),
  });
  assert.equal(froze.cinema, 'freeze');
  assert.equal(froze.tx, 'frz');
  const thawed = await runGuardAction({ ok: true, action: 'freeze', frozen: false }, {
    state: {},
    freeze: async () => ({ ok: true, tx: 'thaw' }),
  });
  assert.equal(thawed.cinema, 'unfreeze');
});

test('dock send clears on success and typing does not send', async () => {
  const listeners = [];
  const mk = (id) => ({
    id, value: '', hidden: true, textContent: '',
    closest(sel) { return sel === '#' + id ? this : null; },
  });
  const input = mk('g-agent');
  const go = mk('g-agent-go');
  const log = mk('g-agent-log');
  const doc = {
    __nearcartaGuardDock: false,
    getElementById(id) { return { 'g-agent': input, 'g-agent-go': go, 'g-agent-log': log }[id] || null; },
    addEventListener(type, fn) { listeners.push({ type, fn }); },
  };
  installGuardDock(doc);
  const n = listeners.length;
  installGuardDock(doc);
  assert.equal(listeners.length, n);
  const fire = (type, target, extra = {}) => {
    const e = { type, target, key: extra.key || '', preventDefault() {} };
    for (const l of listeners) if (l.type === type) l.fn(e);
  };
  const calls = [];
  armGuardDock(async (text) => { calls.push(text); return { ok: true, hint: 'Checked.' }; });
  input.value = 'Check shop-moved-pay-here.near';
  fire('click', input);
  fire('keydown', input, { key: 'a' });
  assert.equal(calls.length, 0);
  fire('click', go);
  const first = await lastGuardDockSend();
  assert.equal(calls.length, 1);
  assert.equal(first.ok, true);
  assert.equal(input.value, '');
  assert.match(log.textContent, /Checked/);
  input.value = 'Freeze my row';
  fire('keydown', input, { key: 'Enter' });
  await lastGuardDockSend();
  assert.equal(calls.length, 2);
  assert.equal(input.value, '');
  armGuardDock(async () => ({ ok: false, hint: 'Name an account.' }));
  input.value = 'Check';
  fire('click', go);
  await dispatchGuardDock(doc);
  assert.equal(input.value, 'Check');
  assert.match(log.textContent, /account/i);
  armGuardDock(null);
  input.value = 'Check a.near';
  const bare = await dispatchGuardDock(doc);
  assert.equal(bare.ok, false);
  assert.equal(bare.hint, DOCK_NOT_READY);
  assert.match(log.textContent, /not ready/);
  assert.equal(input.value, 'Check a.near');
});

test('the tray markup is tabs, real icons, and an empty account field', () => {
  const html = guardMarkup({}, [{ id: 'poisoned-invoice', name: 'Poisoned invoice' }], esc);
  assert.match(html, /data-testid="guard-example">Example: shop-moved-pay-here\.near/);
  assert.match(html, /data-testid="guard-account"[^>]*value=""/);
  assert.doesNotMatch(html, /value="shop-moved-pay-here\.near"/);
  assert.match(html, /data-testid="guard-tab-check"/);
  assert.match(html, /data-testid="guard-tab-trick"/);
  assert.match(html, /data-testid="guard-tab-freeze"/);
  assert.doesNotMatch(html, /data-testid="guard-pane-check"[^>]*hidden/);
  assert.match(html, /data-testid="guard-pane-trick"[^>]*hidden/);
  assert.match(html, /data-testid="guard-pane-freeze"[^>]*hidden/);
  assert.match(html, /\/design\/D2_game\/d7\/assets\/3dicons\/192\/shield-premium\.webp/);
  assert.match(html, /file-text-premium\.webp/);
  assert.match(html, /lock-premium\.webp/);
  assert.match(html, /data-testid="guard-attested"/);
  const off = guardMarkup({ attested: { enabled: false } }, [], esc);
  assert.match(off, /Attested check is off/);
  const scored = guardMarkup({ score: { summary: 'Block because: on the deny list', verdict: 'block', lines: [{ id: 'denylist', title: 'Denylist', level: 'block', text: 'On the deny list', tx: 'E7KMexjSGrD81BQuxVHWinyzvur63m6TGiw7bWjs1ubZ' }] } }, [], esc);
  assert.match(scored, /data-testid="guard-verdict"/);
  assert.match(scored, /nearblocks\.io\/txns\/E7KMexjS/);
});

test('city wiring keeps the guard door in town and cinema on a real tx', () => {
  assert.match(read('app/src/panels/deep.js'), /mountGuardTray/);
  const ui = read('app/design/D8_shops/js/shopui.js');
  assert.match(ui, /wireGuardDock/);
  assert.match(ui, /installGuardDock/);
  assert.match(ui, /armGuardDock/);
  assert.match(ui, /result\.tx/);
  assert.match(ui, /s\.tx/);
  const apps = read('app/design/D8_shops/js/apps.js');
  assert.match(apps, /export async function guardFreeze/);
  assert.match(apps, /set_frozen/);
  assert.match(apps, /deposit/);
  const room = read('app/design/D8_shops/shops/guard.js');
  for (const name of ['hideRefuse', 'showSeal', 'lightLamps', 'setChains', 'Refused · not on the list']) assert.match(room, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const index = read('app/design/D9_world/index.html');
  assert.match(index, /href="\/shops\/guard\/"/);
  assert.match(index, /data-city-shop="guard"/);
  assert.match(index, /__openCityShop/);
  assert.match(read('app/design/D9_world/js/main.js'), /enterShop/);
  assert.match(read('app/src/panels/guard.css'), /button\.guard-cta\[disabled\]\{opacity:1/);
  const dock = read('app/src/panels/guard-dock.js');
  assert.match(dock, /robotexpressive\.webp/);
  assert.match(dock, /g-agent-go/);
});

test('the live plan names the 0.001 ask and does not sign', () => {
  assert.match(GUARD_LIVE_STEPS, /0\.001/);
  assert.match(GUARD_LIVE_STEPS, /0\.06/);
  assert.match(GUARD_LIVE_STEPS, /set_frozen/);
  assert.match(GUARD_LIVE_STEPS, /deposit 0/);
  const src = read('backend/scripts/guard-live-plan.js');
  assert.doesNotMatch(src, /signAndSendTransaction|ed25519:|private key/i);
});
