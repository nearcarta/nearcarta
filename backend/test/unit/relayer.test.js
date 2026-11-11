import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KeyPair, KeyPairSigner, buildDelegateAction, actions, encodeSignedDelegate } from 'near-api-js';
import { relay, decode, verifySig, session, ledger } from '../../src/relayer.js';
import { checkKey } from '../../../shared/relay/policy.js';

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

test('relayer: sponsored first session funds a new implicit account once, tops up low storage, else a no-op', async () => {
  const calls = [];
  const acc = () => ({ transfer: async (a) => { calls.push(['transfer', a.receiverId, a.amount]); return { transaction_outcome: { id: 'F1', outcome: { tokens_burnt: '0' } } }; },
    callFunction: async (a) => { calls.push(['call', a.methodName, a.args.account_id, a.deposit]); return { transaction_outcome: { id: 'S1', outcome: { tokens_burnt: '0' } } }; } });
  const id = 'a'.repeat(64);
  const r = await session(id, { acc, viewAcc: async () => { throw new Error('missing'); }, storageOf: async () => 0n });
  assert.equal(r.ok, true); assert.deepEqual(r.txs, ['F1', 'S1']); assert.equal(calls[0][0], 'transfer'); assert.equal(calls[1][1], 'storage_deposit');
  const again = await session(id, { acc, viewAcc: async () => ({}), storageOf: async () => 8n * 10n ** 21n });
  assert.equal(again.already, true);
  // Low after a day of play: topped back up to the session amount, no second transfer.
  const low = await session(id, { acc, viewAcc: async () => ({}), storageOf: async () => 7n * 10n ** 20n });
  assert.equal(low.ok, true); assert.equal(calls.length, 3); assert.equal(calls[2][1], 'storage_deposit'); assert.equal(calls[2][3], 12n * 10n ** 21n - 7n * 10n ** 20n);
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

test('relayer: an email-login wallet signs with its one full key, only for its own implicit account', async () => {
  const kp = KeyPair.fromRandom('ed25519');
  const hexId = Buffer.from(kp.getPublicKey().data).toString('hex');
  const full = { nonce: 1, permission: 'FullAccess' };
  const ok = await signed({ kp, senderId: hexId, acts: [actions.functionCall('stall', { stall: 1, action: 'rent' }, 30n * T, 0n)] });
  assert.equal((await relay(ok.b64, deps(full))).ok, true);
  // the same full key on a named account, or on another implicit id, is refused
  const named = await signed({ kp, senderId: 'player.near' });
  assert.equal((await relay(named.b64, deps(full))).why, 'ERR_FULL_ACCESS_KEY');
  const other = await signed({ kp, senderId: 'ab'.repeat(32) });
  assert.equal((await relay(other.b64, deps(full))).why, 'ERR_FULL_ACCESS_KEY');
  // and it still cannot move NEAR
  const pay = await signed({ kp, senderId: hexId, acts: [actions.transfer(1n)] });
  assert.equal((await relay(pay.b64, deps(full))).why, 'ERR_ACTION_KIND');
});

test('relayer: an invest the purse cannot cover is refused before sending (no gas burnt)', async () => {
  const before = sent.length;
  const { b64 } = await signed({ acts: [actions.functionCall('purse', { action: 'invest', amount: String(10n ** 21n), shop: 'ferry' }, 20n * T, 0n)] });
  const r = await relay(b64, { ...deps(), stateOf: async () => ({ purse: 960n * 10n ** 18n, bag: {}, rules: {}, stalls: [], now_ns: 0n, me: 'player.near' }) });
  assert.equal(r.ok, false); assert.equal(r.why, 'ERR_PRECHECK_PURSE'); assert.equal(sent.length, before);
  const ok = await relay((await signed({ acts: [actions.functionCall('purse', { action: 'invest', amount: String(10n ** 21n), shop: 'ferry' }, 20n * T, 0n)] })).b64, { ...deps(), stateOf: async () => ({ purse: 2n * 10n ** 21n, me: 'player.near' }) });
  assert.equal(ok.ok, true);
});

test('relayer: a guest account is already funded, so the session tops up only its market storage', async () => {
  // A guest holds 0.25 test NEAR from the funder. Sending it another NEAR from the relayer would
  // spend the float twice for one visitor and make the guest look like an implicit wallet.
  // Docs: https://docs.near.org/protocol/transactions/meta-tx
  const calls = [];
  const acc = () => ({
    transfer: async (a) => { calls.push(['transfer', a.receiverId, a.amount]); return { transaction_outcome: { id: 'F1', outcome: { tokens_burnt: '0' } } }; },
    callFunction: async (a) => { calls.push(['call', a.methodName, a.args.account_id, a.deposit]); return { transaction_outcome: { id: 'S1', outcome: { tokens_burnt: '0' } } }; },
  });
  const guestId = 'x7k2m9pqrs.play.nearcarta.testnet';
  const r = await session(guestId, {
    acc, guestOf: '.play.nearcarta.testnet',
    viewAcc: async () => { throw new Error('missing'); }, // never consulted: a guest is known to exist
    storageOf: async () => 0n,
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.txs, ['S1'], 'only the storage deposit is sent');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'call');
  assert.equal(calls[0][1], 'storage_deposit');
  assert.equal(r.funded, '0');
  // The same account on a service with no guest suffix is treated as an ordinary named account: it
  // does not exist, so it is refused rather than funded.
  const plain = await session(guestId, { acc, guestOf: '', viewAcc: async () => { throw new Error('missing'); }, storageOf: async () => 0n });
  assert.equal(plain.why, 'ERR_NO_ACCOUNT');
});

test('relayer: a guest key is full-access, and only a guest suffix makes that acceptable', async () => {
  // A guest's key is the account's only key and it is FullAccess, so there is no function-call key to
  // name instead. The relayer accepts it ONLY for an account whose name ends in the configured guest
  // suffix, and only because checkDelegate has already confined the actions to zero-deposit market moves.
  // Docs: https://docs.near.org/protocol/accounts-contracts/access-keys
  const guestId = 'x7k2m9pqrs.play.nearcarta.testnet';
  const { b64 } = await signed({ senderId: guestId });
  const full = { nonce: 1, permission: 'FullAccess' };
  // With the suffix configured, the guest's own full key is accepted.
  assert.equal(checkKey(full, { senderId: guestId, nonce: 2 }, '', { guestSuffix: '.play.nearcarta.testnet' }).ok, true);
  // Without it (a mainnet service), the same account is refused: the relayer will not act as a wallet.
  assert.equal(checkKey(full, { senderId: guestId, nonce: 2 }, '').why, 'ERR_FULL_ACCESS_KEY');
  // A named account that is NOT a guest is refused even when a suffix is configured.
  assert.equal(checkKey(full, { senderId: 'someone.near', nonce: 2 }, '', { guestSuffix: '.play.nearcarta.testnet' }).why, 'ERR_FULL_ACCESS_KEY');
  // The implicit-account case is unchanged.
  const hex = 'ab'.repeat(32);
  assert.equal(checkKey(full, { senderId: hex, nonce: 2 }, hex).implicit, true);
  void b64;
});
