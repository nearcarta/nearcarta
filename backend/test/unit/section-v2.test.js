import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBoardKeyPlugin } from '../../../app/house/board-key.js';
import { callMessage } from '../../../shared/board/message.js';
import { AGENT_METHODS, SESSION_HOURS, callPolicy, sessionExpiresAt, sessionLabel } from '../../../shared/board/session.js';

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
  assert.deepEqual(AGENT_METHODS, ['propose', 'propose_call']);
});

test('the session script prints the plan and does not sign without --live', () => {
  const script = fileURLToPath(new URL('../../scripts/board-session-mainnet.js', import.meta.url));
  const dry = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.equal(dry.status, 0);
  const plan = JSON.parse(dry.stdout);
  assert.deepEqual(plan.plan.expect, ['allowed', 'over_per_action_cap', 'frozen', 'clause_expired']);
  assert.equal(plan.plan.allowedNear, '0.001');
  assert.deepEqual(plan.methods, ['propose', 'propose_call']);
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

test('setup asks for a 1 hour session and a key that can propose and propose_call', () => {
  const src = readFileSync(new URL('../../../app/house/setup.js', import.meta.url), 'utf8');
  assert.match(src, /rule-hours/);
  assert.match(src, /propose_call/);
  assert.match(src, /set_calls/);
  assert.match(src, /try-frozen/);
  assert.match(src, /try-expired/);
  assert.doesNotMatch(src, /365/);
});
