import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBoardKeyPlugin } from '../../../app/house/board-key.js';
import { callMessage } from '../../../shared/board/message.js';
import { AGENT_METHODS, SESSION_METHODS, agentCanConfirmAlone, scopeHasOwnerOnly, BOARD_PROPOSE_TGAS, FERRY_PROPOSE_BYTES, GAS_ALLOWANCE_YOCTO, SESSION_HOURS, boardProposeAllowanceYocto, callPolicy, sessionExpiresAt, sessionLabel } from '../../../shared/board/session.js';
import { functionCallAllowanceCost } from '../../../shared/board/cost.js';

test('a session is 1, 2 or 24 hours and the expiry is that many nanoseconds ahead', () => {
  assert.deepEqual(SESSION_HOURS, [1, 2, 24]);
  assert.equal(sessionLabel(1), '1 hour');
  assert.equal(sessionLabel(24), '24 hours');
  const now = 1_700_000_000_000;
  assert.equal(sessionExpiresAt(2, now), String((BigInt(now) + 2n * 3_600_000n) * 1_000_000n));
  assert.equal(sessionExpiresAt(9, now), sessionExpiresAt(1, now));
});

test('propose_call signs the same message the board builds', () => {
  const args = '{}';
  const hex = createHash('sha256').update(args).digest('hex');
  assert.equal(
    callMessage({ contract: 'board.nearcarta.near', owner: 'alice.near', receiver: 'shop.near', method: 'ft_transfer', args, deposit: '1', nonce: '0' }),
    `board-call-v1|board.nearcarta.near|alice.near|shop.near|ft_transfer|${hex}|1|0`,
  );
});

test('set_calls names each shop, the method and the caps', () => {
  assert.deepEqual(callPolicy(['toll.nearcarta.near'], '2', '5', 'ft_transfer', []), {
    calls: [{ receiver: 'toll.nearcarta.near', method: 'ft_transfer', cap: '2' }],
    session_cap: '5',
  });
  const withFerry = callPolicy(['charter.nearcarta.near'], '2', '5');
  assert.equal(withFerry.calls[0].receiver, 'charter.nearcarta.near');
  assert.ok(withFerry.calls.some(c => c.receiver === 'wrap.near' && c.method === 'ft_transfer'));
  assert.ok(withFerry.calls.some(c => c.receiver === 'wrap.near' && c.method === 'near_deposit'));
  assert.deepEqual(AGENT_METHODS, ['propose', 'propose_call', 'propose_call_as', 'anchor']);
});

test('wrap.near uses the rule cap when that cap is at least 0.05 NEAR', () => {
  // propose_call: deposit <= rule.cap (lib.rs line 334) and deposit <= per_action_cap (line 337).
  // set_calls stores the cap (line 293). A lower wrap.near cap would refuse the ferry near_deposit.
  const Y = 10n ** 24n;
  const cap = (Y * 6n / 100n).toString();
  const daily = (Y * 12n / 100n).toString();
  const policy = callPolicy(['charter.nearcarta.near'], cap, daily);
  for (const method of ['near_deposit', 'storage_deposit', 'ft_transfer']) {
    const row = policy.calls.find(c => c.receiver === 'wrap.near' && c.method === method);
    assert.ok(row, method);
    assert.equal(row.cap, cap, method);
  }
  const low = (Y / 1000n).toString();
  const raised = callPolicy(['charter.nearcarta.near'], cap, daily, 'ft_transfer', [
    { receiver: 'wrap.near', method: 'near_deposit', cap: low },
    { receiver: 'other.near', method: 'ft_transfer', cap: low },
  ]);
  assert.equal(raised.calls.find(c => c.receiver === 'wrap.near' && c.method === 'near_deposit').cap, cap);
  assert.equal(raised.calls.find(c => c.receiver === 'other.near').cap, low);
  const edge = (Y / 20n).toString();
  assert.equal(callPolicy(['charter.nearcarta.near'], edge, edge).calls.find(c => c.method === 'near_deposit').cap, edge);
});

test('callPolicy dedupes the wrap.near shop and keeps the trio inside 24', () => {
  // The hand-tested list. The shop entry wrap.near + ft_transfer is the same pair
  // FERRY_CALL_TARGETS already adds, and set_calls panics ERR_RECEIVERS on a repeat.
  const receivers = ['charter.nearcarta.near', 'toll.nearcarta.near', 'wrap.near'];
  const policy = callPolicy(receivers, '1', '2');
  const pairs = policy.calls.map(c => `${c.receiver}:${c.method}`);
  assert.deepEqual(pairs, [
    'charter.nearcarta.near:ft_transfer',
    'toll.nearcarta.near:ft_transfer',
    'wrap.near:near_deposit',
    'wrap.near:ft_transfer',
    'wrap.near:storage_deposit',
  ]);
  assert.equal(new Set(pairs).size, pairs.length);
  assert.ok(pairs.length <= 24);
  const many = ['a.near', 'b.near', 'c.near', 'd.near', 'e.near', 'f.near', 'g.near', 'h.near', 'i.near'];
  const capped = callPolicy(many, '1', '2');
  assert.equal(capped.calls.length, 12);
  assert.deepEqual(capped.calls.slice(-3).map(c => [c.receiver, c.method]), [
    ['wrap.near', 'near_deposit'],
    ['wrap.near', 'ft_transfer'],
    ['wrap.near', 'storage_deposit'],
  ]);
});

test('the session script prints the plan and does not sign without --live', () => {
  const script = fileURLToPath(new URL('../../scripts/board-session-mainnet.js', import.meta.url));
  const dry = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.equal(dry.status, 0);
  const plan = JSON.parse(dry.stdout);
  assert.deepEqual(plan.plan.expect, ['allowed', 'over_per_action_cap', 'frozen', 'clause_expired']);
  assert.equal(plan.plan.allowedNear, '0.001');
  assert.deepEqual(plan.methods, SESSION_METHODS);
  // The scope carries confirm_hold, and that still cannot let the agent confirm alone.
  assert.ok(plan.methods.includes('confirm_hold'));
  assert.equal(agentCanConfirmAlone(plan.methods), false);
  assert.equal(scopeHasOwnerOnly(plan.methods), false);
  // The Chronicle anchor is in the same scope, so the tray never asks for a second approval.
  assert.ok(plan.methods.includes('anchor'));
  const live = spawnSync(process.execPath, [script, '--live'], { encoding: 'utf8', env: { ...process.env, NEAR_MAINNET_SIGNER_KEY: '' } });
  assert.equal(live.status, 1);
  assert.match(live.stderr, /NEAR_MAINNET_SIGNER_KEY/);
  assert.doesNotMatch(dry.stdout + dry.stderr + live.stdout + live.stderr, /ed25519:[1-9A-HJ-NP-Za-km-z]{20}/);
});

test('login asks for a function-call key and a deposit still goes to the wallet', async () => {
  const store = new Map();
  globalThis.localStorage = { setItem: (k, v) => store.set(k, v), getItem: k => store.get(k) ?? null, removeItem: k => store.delete(k) };
  const plugin = createBoardKeyPlugin({ contractId: 'board.nearcarta.near', methodNames: ['propose', 'propose_call'], allowance: '5' });
  const data = {};
  const accounts = await plugin.signIn(data, async () => [{ accountId: 'alice.near' }]);
  assert.equal(accounts[0].accountId, 'alice.near');
  assert.deepEqual(data.addFunctionCallKey.allowMethods.methodNames, ['propose', 'propose_call']);
  assert.equal(data.addFunctionCallKey.gasAllowance.amount, '5');
  assert.equal(data.addFunctionCallKey.contractId, 'board.nearcarta.near');
  let wallet = 0;
  const sent = await plugin.signAndSendTransaction({
    signerId: 'alice.near', receiverId: 'board.nearcarta.near',
    actions: [{ type: 'FunctionCall', params: { methodName: 'open_charter', args: {}, gas: '1', deposit: '1' } }],
  }, async () => { wallet++; return 'wallet'; });
  assert.equal(wallet, 1);
  assert.equal(sent, 'wallet');
});

test('a board propose at 40 Tgas fits the 0.05 session allowance, and 80 Tgas does not', () => {
  // The on_paid callback is 20 Tgas, so propose attaches 40. An 80 Tgas call
  // (the 2026-11-05 measurement, 310 bytes) still does not fit the 0.05 key.
  assert.equal(GAS_ALLOWANCE_YOCTO, '50000000000000000000000');
  assert.equal(BOARD_PROPOSE_TGAS, 40);
  const live = functionCallAllowanceCost({ tgas: 80, numBytes: FERRY_PROPOSE_BYTES });
  assert.equal(live.toString(), '80921036784705000000000');
  assert.ok(live > BigInt(GAS_ALLOWANCE_YOCTO));
  const fit = boardProposeAllowanceYocto();
  assert.ok(fit <= BigInt(GAS_ALLOWANCE_YOCTO), `40 Tgas costs ${fit}`);
  assert.equal(fit.toString(), '40921036784705000000000');
  // A long payee still fits, and so does buying every fee at the 0.001 NEAR/Tgas price.
  const long = boardProposeAllowanceYocto(BOARD_PROPOSE_TGAS, 400);
  assert.ok(long <= BigInt(GAS_ALLOWANCE_YOCTO));
  const busy = functionCallAllowanceCost({ tgas: BOARD_PROPOSE_TGAS, numBytes: FERRY_PROPOSE_BYTES, gasPrice: 1_000_000_000n });
  assert.ok(busy <= BigInt(GAS_ALLOWANCE_YOCTO));
  const apps = readFileSync(new URL('../../../app/design/D8_shops/js/apps.js', import.meta.url), 'utf8');
  assert.match(apps, /functionCall\('propose', args, 40n \* TG\)/);
  assert.match(apps, /fc\('propose', args, 40\)/);
  assert.doesNotMatch(apps, /propose', args, 80/);
  const setup = readFileSync(new URL('../../../app/house/setup.js', import.meta.url), 'utf8');
  assert.match(setup, /GAS_ALLOWANCE_YOCTO/);
  assert.match(setup, /BOARD_PROPOSE_TGAS/);
  assert.doesNotMatch(setup, /YN \/ 20n/);
  const script = readFileSync(new URL('../../scripts/board-session-mainnet.js', import.meta.url), 'utf8');
  assert.match(script, /BigInt\(BOARD_PROPOSE_TGAS\) \* TG/);
});

test('setup asks for a 1 hour session and a key that can propose and propose_call', () => {
  const src = readFileSync(new URL('../../../app/house/setup.js', import.meta.url), 'utf8');
  assert.match(src, /rule-hours/);
  assert.match(src, /propose_call/);
  assert.match(src, /set_calls/);
  assert.match(src, /try-frozen/);
  assert.match(src, /try-expired/);
  assert.doesNotMatch(src, /365/);
});
