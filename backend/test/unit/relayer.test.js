import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KeyPair, KeyPairSigner, buildDelegateAction, actions, encodeSignedDelegate } from 'near-api-js';
import { relay, decode, verifySig, session, ledger } from '../../src/relayer.js';

const MARKET = 'arena.nearcarta.near', BOARD = 'board.nearcarta.near';
const T = 10n ** 12n;
async function signed({ receiverId = MARKET, acts, nonce = 9n, maxBlockHeight = 1100n, kp = KeyPair.fromRandom('ed25519'), senderId = 'player.near' } = {}) {
  const da = buildDelegateAction({ senderId, receiverId, actions: acts || [actions.functionCall('sell', { shop: 'arena', good: 'good:iron', qty: 1, min_total: '0' }, 30n * T, 0n)], nonce, maxBlockHeight, publicKey: kp.getPublicKey() });
  const { signedDelegate } = await new KeyPairSigner(kp).signDelegateAction(da);
  return { b64: Buffer.from(encodeSignedDelegate(signedDelegate)).toString('base64'), kp };
}
const fcKey = (receiver_id = MARKET, nonce = 1) => ({ nonce, permission: { FunctionCall: { receiver_id, method_names: [], allowance: null } } });
const sent = [];
const send = Object.assign(async (sd) => { sent.push(sd); return { transaction_outcome: { id: 'TX' + sent.length, outcome: { tokens_burnt: '300000000000000000000', status: { SuccessValue: '' } } }, receipts_outcome: [] }; }, { __test: true });
const deps = (key = fcKey()) => ({ send, keyOf: async () => key, heightOf: async () => 1000 });

test('relayer: a signed zero-deposit market move is relayed and its burnt gas counted', async () => {
  const { b64 } = await signed(); const sd = decode(b64);
  assert.ok(sd && verifySig(sd));
  const r = await relay(b64, deps());
  assert.equal(r.ok, true); assert.equal(r.methods[0], 'sell'); assert.ok(r.hash.startsWith('TX'));
  assert.ok(ledger.spent > 0n);
});

test('relayer: refuses deposits, other receivers, other methods, full-access keys, stale nonces and bad signatures', async () => {
  const cases = [
    [{ acts: [actions.functionCall('sell', {}, 30n * T, 1n)] }, fcKey(), 'ERR_DEPOSIT'],
    [{ receiverId: 'wrap.near' }, fcKey('wrap.near'), 'ERR_RECEIVER'],
    [{ acts: [actions.functionCall('set_paused', { paused: true }, 30n * T, 0n)] }, fcKey(), 'ERR_METHOD'],
    [{ acts: [actions.transfer(1n)] }, fcKey(), 'ERR_ACTION_KIND'],
    [{ acts: [actions.functionCall('sell', {}, 300n * T, 0n)] }, fcKey(), 'ERR_GAS'],
    [{}, { nonce: 1, permission: 'FullAccess' }, 'ERR_FULL_ACCESS_KEY'],
    [{}, fcKey(BOARD), 'ERR_KEY_RECEIVER'],
    [{ nonce: 1n }, fcKey(MARKET, 5), 'ERR_NONCE'],
    [{ maxBlockHeight: 900n }, fcKey(), 'ERR_EXPIRY'],
    [{ acts: [actions.functionCall('propose_call_as', { receiver: 'wrap.near', method: 'near_deposit' }, 30n * T, 0n)], receiverId: BOARD }, fcKey(BOARD), 'ERR_BOARD_TARGET'],
  ];
  for (const [o, key, why] of cases) { const { b64 } = await signed(o); const r = await relay(b64, deps(key)); assert.equal(r.ok, false, why); assert.equal(r.why, why); }
  // tampered: flip one byte in the args after signing
  const { b64 } = await signed(); const buf = Buffer.from(b64, 'base64'); buf[60] ^= 1;
  const r = await relay(buf.toString('base64'), deps()); assert.equal(r.ok, false); assert.ok(['ERR_SIGNATURE', 'ERR_DECODE', 'ERR_RECEIVER', 'ERR_METHOD'].includes(r.why));
});

test('relayer: a board row move aimed at the market is relayed', async () => {
  const { b64 } = await signed({ receiverId: BOARD, acts: [actions.functionCall('propose_call_as', { owner: 'player.near', receiver: MARKET, method: 'invest', args: '{}', deposit: '1', expiry: '1', effects: [], hold: false, signature: '' }, 60n * T, 0n)] });
  const r = await relay(b64, deps(fcKey(BOARD))); assert.equal(r.ok, true);
});

test('relayer: sponsored first session funds a new implicit account once, then is a no-op', async () => {
  const calls = [];
  const acc = () => ({ transfer: async (a) => { calls.push(['transfer', a.receiverId, a.amount]); return { transaction_outcome: { id: 'F1', outcome: { tokens_burnt: '0' } } }; },
    callFunction: async (a) => { calls.push(['call', a.methodName, a.args.account_id, a.deposit]); return { transaction_outcome: { id: 'S1', outcome: { tokens_burnt: '0' } } }; } });
  const id = 'a'.repeat(64);
  const r = await session(id, { acc, viewAcc: async () => { throw new Error('missing'); }, storageOf: async () => 0n });
  assert.equal(r.ok, true); assert.deepEqual(r.txs, ['F1', 'S1']); assert.equal(calls[0][0], 'transfer'); assert.equal(calls[1][1], 'storage_deposit');
  const again = await session(id, { acc, viewAcc: async () => ({}), storageOf: async () => 10n });
  assert.equal(again.already, true);
  const named = await session('nobody-here.near', { acc, viewAcc: async () => { throw new Error('missing'); }, storageOf: async () => 0n });
  assert.equal(named.why, 'ERR_NO_ACCOUNT');
});

test('relayer: one visitor stops at the per-visitor sponsored gas cap, others still go through', async () => {
  ledger.by.set('greedy.near', 3n * 10n ** 21n);
  const { b64 } = await signed({ senderId: 'greedy.near' });
  const r = await relay(b64, deps());
  assert.equal(r.ok, false); assert.equal(r.why, 'ERR_VISITOR_GAS_CAP');
  const other = await signed({ senderId: 'polite.near' });
  assert.equal((await relay(other.b64, deps())).ok, true);
  assert.equal(ledger.by.get('polite.near'), 300000000000000000000n);
});
