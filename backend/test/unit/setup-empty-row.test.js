// The /setup sign step when the board has no row for this account.
// Board v2 returns `null` from `get_charter` for an account with no row. That is an
// answer, not a failed read: the page must offer "Open your row" and must not call it
// a chain error. The Scholar row was force_closed on 2026-11-06 and the page said
// "The chain did not answer" instead.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AGENT_METHODS, SESSION_METHODS, CALLS_DEPOSIT_YOCTO, callPolicy, callsFitRow, stampCalls } from '../../../shared/board/session.js';
import { openRowTransactions } from '../../../shared/setup/open-row.js';
import MAIN from '../../../shared/deployments/mainnet.json' with { type: 'json' };

const src = readFileSync(new URL('../../../app/house/setup.js', import.meta.url), 'utf8');
const section = (from, to) => src.slice(src.indexOf(from), src.indexOf(to));

test('a missing row is its own state, not a read error', () => {
  const ensure = section('async function ensureChainRow', 'async function facts');
  // The read has to tell a thrown RPC error from a `null` answer.
  assert.match(ensure, /readError = false/);
  assert.match(ensure, /\.catch\(\(\) => \{ readError = true; return null; \}\)/);
  // The old code set the error text for any null, which is what the visitor saw.
  assert.doesNotMatch(ensure, /chainError = row \? '' : 'The chain did not answer/);
  assert.match(ensure, /chainError = row \? '' : \(readError \? 'The chain did not answer/);
});

test('the sign step reads the board even when this browser has no stored row key', () => {
  const wire = section('function wireSign()', '// ---------- 7. Try');
  // Requiring rowLive() skipped the read for exactly the case that needs it.
  assert.doesNotMatch(wire, /!st\.trial && rowLive\(\)\) \{\s*\n\s*ensureChainRow/);
  assert.match(wire, /if \(boardLive\(\) && !st\.trial\) \{\s*\n\s*ensureChainRow\(\)/);
});

test('the no-row state offers Open your row as the primary action', () => {
  const s = section('function sSign()', 'async function charterState');
  assert.match(s, /const closedRow = onBoard && !onChain && chainRead && !readError/);
  assert.match(s, /data-testid="setup-no-row"/);
  assert.match(s, /No row open on \$\{esc\(MAIN\.board\.contract\)\}/);
  assert.match(s, /There is no row on <code>/);
  // The primary button is "Open your row" whenever the row is missing.
  assert.match(s, /\$\{rowReady \? 'Open your row' : 'Reading the board'\}/);
  // It is enabled once the board answered, and immediately when there is no account to read for.
  assert.match(s, /const rowReady = noAccount \|\| \(chainRead && !readError\);/);
  // And the open path is the only primary action when there is no row.
  assert.match(s, /const L = signItems\(onBoard, onChain, update\.changed\)/);
  assert.match(s, /signRulesUpdate\(\{ live: !!\(onChain && onBoard\)/);
  // The key scope is spelled out on the empty-row panel, not only in the lede.
  assert.match(s, /data-testid="setup-key-scope"/);
});

test('open_charter targets the board and carries the current rules', () => {
  const YN = 10n ** 24n;
  const rules = {
    receivers: ['toll.nearcarta.near'],
    per_action_cap: (YN * 5n / 1000n).toString(),
    daily_budget: (YN * 10n / 1000n).toString(),
    max_actions_per_day: 3,
    window_start_min: 0,
    window_end_min: 0,
    min_amount: (YN / 10_000n).toString(),
    expires_at: '0',
  };
  const calls = callPolicy(rules.receivers, rules.per_action_cap, rules.daily_budget, 'ft_transfer', stampCalls('board.nearcarta.near', rules.per_action_cap)).calls;
  const { open, key } = openRowTransactions({
    accountId: 'visitor.near', contract: 'board.nearcarta.near', rules, agentPublicKey: 'ed25519:KEY',
    fundYocto: (YN / 100n).toString(), rowDepositYocto: '20000000000000000000000',
    callsDepositYocto: CALLS_DEPOSIT_YOCTO, calls,
    gasOpen: '30000000000000', gasAgent: '50000000000000', allowance: '250000000000000000000000',
  });
  // The board is the receiver, and the row deposit is the contract's own maximum.
  assert.equal(open.receiverId, 'board.nearcarta.near');
  assert.equal(open.actions.length, 2);
  assert.equal(open.actions[0].params.methodName, 'open_charter');
  assert.equal(open.actions[0].params.deposit, '20000000000000000000000');
  // The rules that were on the page are the rules written on chain.
  assert.deepEqual(open.actions[0].params.args.rules, rules);
  assert.equal(open.actions[0].params.args.agent, 'ed25519:KEY');
  assert.equal(open.actions[0].params.args.fund, (YN / 100n).toString());
  // And the allowlist is in the same transaction, at the deposit the contract needs.
  assert.equal(open.actions[1].params.methodName, 'set_calls');
  assert.equal(open.actions[1].params.deposit, CALLS_DEPOSIT_YOCTO);
  assert.deepEqual(open.actions[1].params.args.calls, calls);
  assert.equal(open.actions[1].params.args.session_cap, rules.daily_budget);
  // The key goes on the visitor's own account, limited to the board and the session scope.
  assert.equal(key.receiverId, 'visitor.near');
  assert.deepEqual(key.actions[0].params.accessKey.permission.methodNames, [...SESSION_METHODS]);
  assert.equal(key.actions[0].params.accessKey.permission.receiverId, 'board.nearcarta.near');
  assert.equal(key.actions[0].params.accessKey.permission.allowance, '250000000000000000000000');
  // It is a function-call key, so it can never move NEAR by itself.
  assert.equal(key.actions[0].type, 'AddKey');
  assert.equal(key.actions[0].params.accessKey.permission.FunctionCall, undefined);
  assert.equal(key.actions[0].params.accessKey.permission.methodNames.length, SESSION_METHODS.length);

  const s = section('async function signBoard()', 'function noteSign');
  assert.match(s, /openRowTransactions\(\{/);
  // A row read that throws must not be mistaken for "no row" and re-opened.
  assert.match(s, /if \(readFailed\) throw new Error\('The board did not answer\./);
});

test('openRowTransactions refuses an incomplete batch', () => {
  const base = { accountId: 'a.near', contract: 'b.near', agentPublicKey: 'ed25519:K', fundYocto: '1', rowDepositYocto: '2', callsDepositYocto: '3', calls: [{ receiver: 's.near', method: 'ft_transfer', cap: '1' }], gasOpen: '1', gasAgent: '1', allowance: '1', rules: { receivers: ['s.near'], daily_budget: '1' } };
  assert.throws(() => openRowTransactions({ ...base, accountId: '' }), /account/);
  assert.throws(() => openRowTransactions({ ...base, rules: { receivers: [], daily_budget: '1' } }), /receiver/);
  assert.throws(() => openRowTransactions({ ...base, calls: [] }), /allowlist/);
  assert.equal(openRowTransactions(base).open.actions.length, 2);
});

test('the new key allows the session scope on the board, including confirm_hold', () => {
  // `anchor` is an agent method (the Chronicle tray signs it), and the session adds the
  // hold and row paths. No method is listed twice.
  assert.deepEqual(AGENT_METHODS, ['propose', 'propose_call', 'propose_call_as', 'anchor']);
  assert.deepEqual(SESSION_METHODS, ['propose', 'propose_call', 'propose_call_as', 'anchor', 'confirm_hold', 'tighten_rules']);
  assert.equal(new Set(SESSION_METHODS).size, SESSION_METHODS.length, 'no duplicate method in the key list');
  assert.match(src, /receiverId: MAIN\.board\.contract, methodNames: \[\.\.\.SESSION_METHODS\]/);
  // The visible copy names every agent method, on both the sign step and the try step.
  const sign = section('function sSign()', 'async function charterState');
  assert.match(sign, /<code>propose<\/code>, <code>propose_call<\/code>, <code>propose_call_as<\/code> and <code>anchor<\/code>/);
  assert.match(src, /It calls <code>propose<\/code>, <code>propose_call<\/code>, <code>propose_call_as<\/code> and <code>anchor<\/code> on your row/);
  // No stale two-method sentence is left anywhere the visitor can see.
  assert.doesNotMatch(src, /has <code>propose<\/code> but not <code>propose_call<\/code>/);
  assert.doesNotMatch(src, /It calls <code>propose<\/code> and <code>propose_call<\/code> on your row/);
});

test('the sign step is reachable without a stored row key', () => {
  // The old render threw the visitor back to the rules step when no agent key was
  // stored, so "Open your row" could never be shown. Only the non-board path keeps
  // that guard now.
  const render = section('function render() {', 'function paintShell()');
  assert.match(render, /if \(!PREVIEW && !\(st\.trial \|\| boardLive\(\)\) && st\.step === 6 && !\(st\.charter && localStorage\.getItem\(agentLS\(st\.charter\)\)\)\) st\.step = 5;/);
  assert.doesNotMatch(render, /if \(!PREVIEW && \(st\.trial \|\| boardLive\(\)\) && st\.step === 6/);
});

test('the open batch fits the row for the default rules', () => {
  const YN = 10n ** 24n;
  const calls = callPolicy(['toll.nearcarta.near'], (YN * 5n / 1000n).toString(), (YN * 10n / 1000n).toString(), 'ft_transfer', stampCalls('board.nearcarta.near', (YN * 5n / 1000n).toString())).calls;
  assert.equal(callsFitRow(calls), true);
  assert.ok(BigInt(CALLS_DEPOSIT_YOCTO) > 12n * YN / 1000n);
});

test('set_effects rides with set_calls only when the board build pays it from the reserve', () => {
  // The older board charged `set_effects` against the row's own 2000 bytes, so sending it at
  // setup would make opening a row fail for every visitor. The setup therefore reads the
  // board's code hash and includes the action only when it is the build whose `charge_acts`
  // spends the SIDE RESERVE that `set_calls` just charged (proven in
  // contracts/charter_board_sandbox/tests/effects_on_a_full_row.rs).
  const base = {
    accountId: 'a.near', contract: 'board.nearcarta.near',
    rules: { receivers: ['toll.nearcarta.near'], per_action_cap: '1', daily_budget: '2', max_actions_per_day: 4, window_start_min: 0, window_end_min: 0, min_amount: '1', expires_at: '0' },
    agentPublicKey: 'ed25519:8StsEstNui7DqvkR8vPd63RmQDM6LXX7fDSegH4MyxdZ',
    fundYocto: '1', rowDepositYocto: '2', callsDepositYocto: '3',
    calls: [{ receiver: 'toll.nearcarta.near', method: 'cross', cap: '1' }],
    gasOpen: '1', gasAgent: '1', allowance: '1',
  };
  const none = openRowTransactions(base);
  assert.deepEqual(none.open.actions.map(a => a.params.methodName), ['open_charter', 'set_calls']);
  const withEffects = openRowTransactions({ ...base, effects: [{ chain: 'base', asset: 'usdc', to: '0xabc', value: '1', fee: '1' }] });
  // Order matters: set_calls is what charges the reserve the effect budget is spent from.
  assert.deepEqual(withEffects.open.actions.map(a => a.params.methodName), ['open_charter', 'set_calls', 'set_effects']);
  // No deposit: the board charges the row, and after the fix it charges the reserve.
  assert.equal(withEffects.open.actions[2].params.deposit, '0');
  // An empty list is the same as no list.
  assert.deepEqual(openRowTransactions({ ...base, effects: [] }).open.actions.map(a => a.params.methodName), ['open_charter', 'set_calls']);
});

test('the setup gates set_effects on the board build actually deployed', () => {
  const src = readFileSync(new URL('../../../app/house/setup.js', import.meta.url), 'utf8');
  // The hash is read from the chain, not assumed.
  assert.match(src, /view_account[\s\S]{0,160}code_hash/, 'the board code hash is read from the account');
  // And compared with the recorded build before the action is added.
  assert.match(src, /boardCode === EFFECTS_CODE_HASH \? effectsFor\(r\) : undefined/);
  // The record carries the hash, so flipping it is a data change, not a code change.
  assert.equal(MAIN.board.effects_code_hash, 'CM6WA2gZDN17TRXQzFsrstgKPzsmiVLuArK7V6UkXLAf');
  // The hold build is live and carries the effects fix, so setup sends set_effects now.
  assert.equal(MAIN.board.code_hash, MAIN.board.effects_code_hash);
});
