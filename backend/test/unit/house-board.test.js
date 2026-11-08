import { test } from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  injectRowOwner, proposeCallAs, callAsText, confirmText, cancelHoldArgs, expireSentArgs, effectTokenOk, CALL_AS_METHODS,
} from '../../../app/src/house-board.js';
import { sha256Hex } from '../../../app/src/sha256.js';
import { planHouseLine } from '../../../app/src/panels/house-agent.js';
import { planSuccessor, MAX_STAKE_YOCTO } from '../../../scripts/house-deploy.js';
import { recoveryPlan, sourceMethods, wasmExports } from '../../../scripts/house-recover.js';
import { HOUSE_CALLS, HOUSE_FALLBACK, HOUSE_LEGACY, HOUSE_SHOP, HOUSE_WASM_SHA256 } from '../../../shared/house/shop.js';
import { FERRY_CALL_TARGETS, MAX_CALLS, callPolicy } from '../../../shared/board/session.js';
import { shopOf } from '../../../backend/src/board-tx.js';
import { isDenied } from '../../../backend/src/vault.js';
import MAIN from '../../../shared/deployments/mainnet.json' with { type: 'json' };

test('sha256 matches node', () => {
  assert.equal(sha256Hex('abc'), createHash('sha256').update('abc').digest('hex'));
});

test('the board replaces a top-level row_owner and leaves a nested one', () => {
  const args = '{"amount":"1","note":{"row_owner":"mallory.near"}}';
  const out = injectRowOwner(args, 'alice.near');
  assert.equal(out, '{"amount":"1","note":{"row_owner":"mallory.near"},"row_owner":"alice.near"}');
  const forged = injectRowOwner('{"token_id":"alice.near","row_owner":"mallory.near"}', 'alice.near');
  assert.equal(JSON.parse(forged).row_owner, 'alice.near');
  assert.equal(JSON.parse(forged).token_id, 'alice.near');
});

test('propose_call_as uses the v2 method, args, and hold flow', () => {
  const call = proposeCallAs({
    network: 'mainnet',
    board: 'board.nearcarta.near',
    owner: 'alice.near',
    receiver: 'house.nearcarta.near',
    method: 'house_session_check_in',
    args: { token_id: 'alice.near' },
    deposit: '1',
    expiry: '60',
    nonce: '4',
    epoch: '0',
    effects: [],
    hold: false,
  });
  assert.equal(call.method, 'propose_call_as');
  assert.deepEqual(Object.keys(call.args), ['owner', 'receiver', 'method', 'args', 'deposit', 'expiry', 'effects', 'hold', 'signature']);
  assert.equal(call.args.signature, '');
  assert.equal(call.args.hold, false);
  assert.equal(call.signed, false);
  assert.equal(call.argsOut, '{"token_id":"alice.near","row_owner":"alice.near"}');
  const text = callAsText({
    network: 'mainnet', board: 'board.nearcarta.near', owner: 'alice.near', receiver: 'house.nearcarta.near',
    method: 'house_session_check_in', argsOut: call.argsOut, deposit: '1', nonce: '4', expiry: '60', epoch: '0',
    effects: [], hold: false,
  });
  assert.equal(call.message, text);
  assert.match(text, /^board-call-as-v1\|mainnet\|board\.nearcarta\.near\|2\|alice\.near\|house\.nearcarta\.near\|house_session_check_in\|/);
  assert.match(text, /\|-\|exec$/);
  assert.match(text, /\|exec$/);
  const held = proposeCallAs({
    network: 'mainnet', board: 'board.nearcarta.near', owner: 'alice.near', receiver: 'house.nearcarta.near',
    method: 'house_session_prepare_send',
    args: { token_id: 'alice.near', chain: 'base', to: '0xabc', asset: 'ETH', value: '1', gas_limit: 21000, action_id: 'a' },
    deposit: '1', expiry: '60', nonce: '5', epoch: '1',
    effects: [{ chain: 'base', asset: 'ETH', to: '0xabc', value: '1', fee: '0' }],
    hold: true,
  });
  assert.equal(held.args.hold, true);
  assert.match(held.message, /\|base\|ETH\|0xabc\|1\|0\|hold$/);
  assert.deepEqual(CALL_AS_METHODS, ['propose_call_as', 'confirm_hold', 'cancel_hold', 'expire_sent']);
  assert.deepEqual(Object.keys(cancelHoldArgs('9').args), ['action_id']);
  assert.deepEqual(Object.keys(expireSentArgs('alice.near', '9').args), ['owner', 'action_id']);
  const confirm = confirmText({
    board: 'board.nearcarta.near', owner: 'alice.near', actionId: '9',
    method: 'house_session_check_in', args: call.argsOut, deposit: '1', effects: [],
  });
  assert.match(confirm, /^board-confirm-v1\|board\.nearcarta\.near\|alice\.near\|9\|[0-9a-f]{64}\|present$/);
  assert.equal(effectTokenOk('0xabc'), true);
  assert.equal(effectTokenOk('x'.repeat(65)), false);
  assert.throws(() => proposeCallAs({
    network: 'mainnet', board: 'board.nearcarta.near', owner: 'alice.near', receiver: 'house.nearcarta.near',
    method: 'house_session_prepare_send', args: {}, deposit: '1', expiry: '1', nonce: '1', epoch: '0',
    effects: [{ chain: 'base', asset: 'ETH', to: 'not a payee', value: '1', fee: '0' }], hold: true,
  }), /ERR_EFFECT/);
});

test('a visitor check-in builds propose_call_as from that visitor\'s row', () => {
  const visitor = 'bob.near';
  const house = 'house.nearcarta.near';
  const plan = planHouseLine("I'm alive", {
    account: visitor,
    house,
    tokenId: visitor,
    board: 'board.nearcarta.near',
    network: 'mainnet',
    nonce: '2',
    epoch: '0',
    row: {
      receivers: [house],
      per_action_cap: '1000',
      min_amount: '1',
      balance: '50',
      frozen: false,
    },
  });
  assert.equal(plan.action, 'checkin');
  assert.equal(plan.label, 'planned');
  assert.equal(plan.signed, false);
  assert.equal(plan.call.method, 'propose_call_as');
  assert.equal(plan.call.args.owner, visitor);
  assert.equal(plan.call.args.receiver, house);
  assert.equal(plan.call.args.method, 'house_session_check_in');
  assert.equal(plan.call.args.deposit, '1');
  assert.equal(plan.call.args.hold, false);
  assert.equal(JSON.parse(plan.call.args.args).row_owner, undefined);
  assert.equal(JSON.parse(plan.call.argsOut).row_owner, visitor);
  const missing = planHouseLine("I'm alive");
  assert.equal(missing.label, 'blocked');
  assert.equal(missing.signed, false);
});

test('the recreate uses the pinned wasm and the legacy balance', () => {
  const plan = planSuccessor({
    shop: HOUSE_SHOP,
    owner: 'nearcarta.near',
    legacy: HOUSE_LEGACY,
    fallback: HOUSE_FALLBACK,
    wasmBytes: 373051,
    wasmSha256: HOUSE_WASM_SHA256,
    pinnedSha256: HOUSE_WASM_SHA256,
    ownerBalanceYocto: '450990806577335499999999',
    legacyBalanceYocto: '2502774762262500000000000',
    shopExists: true,
  });
  assert.equal(plan.hashOk, true);
  assert.equal(plan.stakeOk, true);
  assert.equal(plan.stakeNear, '3.75199');
  assert.ok(BigInt(plan.stakeYocto) <= MAX_STAKE_YOCTO);
  assert.equal(plan.fundingSource, HOUSE_LEGACY);
  assert.equal(plan.transfer.from, 'nearcarta.near');
  assert.equal(plan.transfer.payee, 'house.nearcarta.near');
  assert.notEqual(plan.transfer.payee, HOUSE_FALLBACK);
  assert.equal(plan.liveReady, false);
  assert.equal(plan.steps[0].step, 'recover first');
  assert.equal(plan.steps[0].ok, false);
  const grown = planSuccessor({
    shop: HOUSE_SHOP, owner: 'nearcarta.near', legacy: HOUSE_LEGACY, fallback: HOUSE_FALLBACK,
    wasmBytes: 600400, wasmSha256: HOUSE_WASM_SHA256, pinnedSha256: HOUSE_WASM_SHA256,
    ownerBalanceYocto: '1', legacyBalanceYocto: '1', shopExists: true,
  });
  assert.equal(grown.stakeOk, false);
  assert.equal(grown.stakeNear, '6.02548');
  const wrong = planSuccessor({
    shop: HOUSE_SHOP, owner: 'nearcarta.near', legacy: HOUSE_LEGACY,
    wasmBytes: 373051, wasmSha256: 'abc', pinnedSha256: HOUSE_WASM_SHA256,
    ownerBalanceYocto: '1', legacyBalanceYocto: '1', shopExists: false,
  });
  assert.equal(wrong.hashOk, false);
  assert.equal(wrong.liveReady, false);
  const src = readFileSync(new URL('../../../contracts/house_nft/src/lib.rs', import.meta.url), 'utf8');
  assert.match(src, /fn migrate_from_v2/);
  assert.match(src, /only the contract may migrate/);
  assert.match(src, /top-level argument the board writes/);
});

test('the legacy wasm recovers by house_pay and then close', () => {
  const exports = wasmExports(Buffer.from('AGFzbQEAAAABBAFgAAADBAMAAAAHIQMFY2xvc2UAAAlob3VzZV9wYXkAAQluZnRfdG9rZW4AAgoNAwMAAQsDAAELAwABCw==', 'base64'));
  assert.deepEqual(exports, ['close', 'house_pay', 'nft_token']);
  const plan = recoveryPlan({
    exports: ['nft_token', 'house_pay', 'house_fund', 'close', 'house_held'],
    purseYocto: '1000000000000000000000',
    heldYocto: '1000000000000000000000',
    holder: 'nearcarta.near',
    owner: 'nearcarta.near',
    shop: HOUSE_LEGACY,
  });
  assert.equal(plan.locked, false);
  assert.equal(plan.steps[0].method, 'house_pay');
  assert.equal(plan.steps[0].signer, 'nearcarta.near');
  assert.equal(plan.steps[0].args.amount, '1000000000000000000000');
  assert.equal(plan.steps[0].args.receiver_id, 'nearcarta.near');
  assert.equal(plan.steps[1].method, 'close');
  assert.equal(plan.requiredBeforeCreate, true);
  assert.equal(plan.waitForCallback, true);
  assert.equal(plan.absent.includes('upgrade'), true);
  assert.equal(plan.absent.includes('migrate'), true);
  assert.equal(plan.absent.includes('house_withdraw'), true);
  const locked = recoveryPlan({
    exports: ['nft_token', 'house_fund'], purseYocto: '1', heldYocto: '1', holder: 'nearcarta.near', owner: 'nearcarta.near', shop: HOUSE_LEGACY,
  });
  assert.equal(locked.locked, true);
  assert.match(locked.why, /stays on the shop/);
  const src = sourceMethods('impl Contract { pub fn house_pay(&self) {} pub fn close(&mut self) {} }');
  assert.deepEqual(src, ['house_pay', 'close']);
});

test('the city, the allow list and the denylist use the one shop id', () => {
  assert.equal(HOUSE_LEGACY, 'house.nearcarta.near');
  assert.equal(HOUSE_SHOP, 'house.nearcarta.near');
  assert.equal(MAIN.extras.house.contract, HOUSE_SHOP);
  assert.equal(MAIN.extras.house.shop, HOUSE_SHOP);
  // The v3 recreate kept house.nearcarta.near, so the house3 fallback is unused.
  assert.equal(MAIN.extras.house.fallback.status, 'unused');
  assert.equal(HOUSE_FALLBACK, 'house3.nearcarta.near');
  assert.equal(MAIN.extras.house.next.sha256, HOUSE_WASM_SHA256);
  assert.equal(shopOf(HOUSE_SHOP), 'house');
  assert.equal(shopOf(HOUSE_LEGACY), 'house');
  assert.equal(isDenied(HOUSE_SHOP), true);
  assert.equal(isDenied(HOUSE_LEGACY), true);
  const policy = callPolicy(
    [MAIN.charter.contract, MAIN.toll.contract, HOUSE_SHOP],
    '1', '1', 'ft_transfer', [...FERRY_CALL_TARGETS, ...HOUSE_CALLS],
  );
  assert.ok(policy.calls.length <= MAX_CALLS);
  assert.equal(policy.calls.some(row => row.receiver === HOUSE_SHOP && row.method === 'house_session_check_in'), true);
  assert.equal(policy.calls.some(row => row.receiver === HOUSE_SHOP && row.method === 'house_session_prepare_send'), true);
  const setup = readFileSync(new URL('../../../app/house/setup.js', import.meta.url), 'utf8');
  assert.match(setup, /HOUSE_SHOP/);
  assert.doesNotMatch(setup, /house3\.nearcarta\.near/);
  const readme = readFileSync(new URL('../../../README.md', import.meta.url), 'utf8');
  assert.match(readme, /extras\.house\.shop/);
  assert.match(readme, /legacy shop/);
  assert.doesNotMatch(readme, /house3\.nearcarta\.near/);
});

test('a check-in on a deed with no inheritance line is refused before it is signed', () => {
  // Mainnet, 2026-11-07: `house_session_check_in` on a freshly minted deed panicked inside
  // the contract, because `line_of` has no line to read yet. The chain reported it as a bare
  // `WebAssembly trap: unreachable` after the NEAR had been reserved, so the visitor paid gas
  // for an error with no name. The same call succeeded once the holder set the line first
  // (mint AQv5jjgW…, set-line DYc1ggre…, check-in DY9rqZGN…).
  //
  // `/api/house/line/<id>` answers `line: null` in that state, so the plan must refuse.
  const row = {
    frozen: false,
    receivers: ['house.nearcarta.near'],
    min_amount: '100000000000000000000',   // 0.0001 NEAR, what a check-in attaches
    per_action_cap: '20000000000000000000000', // 0.02 NEAR
    balance: '8000000000000000000000',
  };
  const base = {
    row, account: '8ccd5d33d2e8eb2d27eef13a7a0c88ae2ea9209c002fa7f27ed6021592393bb9',
    house: 'house.nearcarta.near', tokenId: 'deed', board: 'board.nearcarta.near',
    nonce: '11', epoch: '0',
  };
  const noLine = planHouseLine("I'm alive", { ...base, line: { live: true, line: null } });
  assert.equal(noLine.action, 'refuse');
  assert.equal(noLine.signed, false);
  assert.match(noLine.hint, /no inheritance line/);

  // A line on the deed plans the real call.
  const withLine = planHouseLine("I'm alive", { ...base, line: { live: true, line: { heirs: ['nearcarta.near'] } } });
  assert.notEqual(withLine.action, 'refuse');
  assert.equal(withLine.method, 'house_session_check_in');

  // An unanswered read is not evidence of anything, so it must not be turned into a refusal.
  const unknown = planHouseLine("I'm alive", { ...base, line: null });
  assert.notEqual(unknown.action, 'refuse');
});

test('the House room hands its plan to a sender instead of stopping at a hint', () => {
  // Found on mainnet 2026-11-07 driving the real city: "I'm alive" built a correct
  // `propose_call_as` call and then only showed the plan's hint. `house-room.js` imported
  // `runHouseTurn`, which plans and never sends, and no executor existed anywhere, so the
  // House gold CTA could not produce a transaction at all.
  const room = readFileSync(new URL('../../../app/src/panels/house-room.js', import.meta.url), 'utf8');
  assert.match(room, /hooks\.houseSend/, 'the room calls a sender');
  assert.match(room, /result\.call && typeof hooks\.houseSend === 'function'/, 'and only when the page supplies one');

  // The city supplies it, and it resolves to the executor in apps.js.
  const ui = readFileSync(new URL('../../../app/design/D8_shops/js/shopui.js', import.meta.url), 'utf8');
  assert.match(ui, /houseSend: \(plan\) => A\.houseCall\(plan/, 'the city wires houseSend to houseCall');

  // The executor signs the BOARD's own text, the same rule as the toll: a locally built
  // message carries epoch 0 and the board answers ERR_BAD_SIG.
  const apps = readFileSync(new URL('../../../app/design/D8_shops/js/apps.js', import.meta.url), 'utf8');
  const fn = apps.slice(apps.indexOf('export async function houseCall'), apps.indexOf('// ---------- rules: the visitor writes them'));
  assert.match(fn, /call_as_message/, 'houseCall asks the board for its text');
  assert.doesNotMatch(fn, /callAsMessage\(/, 'and never builds one locally');
  assert.match(fn, /propose_call_as/, 'then sends propose_call_as');
  assert.match(fn, /W\.signMessage/, 'signed by the session key');
  // `plan.call.args` is the whole propose_call_as payload; the shop's arguments are its `args`
  // field. Passing the wrapper made the RPC answer "invalid type: null, expected a string".
  // The shop's arguments, the deposit and the expiry all live inside `plan.call.args`, and
  // reading them off `plan.call` gave undefined — which the RPC refused with
  // "invalid type: null, expected a string".
  assert.match(fn, /const payload = plan\.call\.args/, 'houseCall reads the payload once');
  assert.match(fn, /payload\.args/, 'the shop arguments come from the payload');
  assert.match(fn, /payload\.deposit/, 'so does the deposit');
  assert.doesNotMatch(fn, /String\(plan\.deposit/, 'and never off plan directly');
  // The house account comes from the record, and is not read through a later `const` arrow
  // (that is the temporal dead zone, which would throw on first use).
  assert.doesNotMatch(fn, /houseAccount\(\)/, 'houseCall must not call a later const arrow');
  assert.match(fn, /S\.mainnet\?\.house\?\.contract/);
});

test('the attack demo stops every attack and prints real reasons, not placeholders', () => {
  // Track 06 asks for "an attack demo: a script where a prompt-injected agent tries to pay a
  // known-bad address and gets stopped. Show the log." The first version of this script printed
  // `suspicious=undefined` and `[object Object]` because it read `parsed.by` (which lives on the
  // result) and joined reason objects raw. A demo whose own log looks broken is worse than none.
  const src = readFileSync(new URL('../../../backend/scripts/attack-demo.js', import.meta.url), 'utf8');
  // Every layer is exercised, and named in the log.
  for (const layer of ['model', 'check', 'charter']) assert.match(src, new RegExp(`\\b${layer}\\b`), `${layer} is reported`);
  // The three attacks the track names.
  assert.match(src, /invoice-swap/); assert.match(src, /over-cap/); assert.match(src, /denied-payee/);
  // It never signs and never sends, so a judge can run it with no key.
  assert.doesNotMatch(src, /signTx|send_tx|signAndSend/, 'the demo does not sign or send');
  // Reason objects are rendered by their text, not by object coercion.
  assert.match(src, /x\.text \|\| x\.code/, 'reasons are rendered as text');
  // The mapped array is what gets joined: `reasons.slice(0,3).join('; ')` where `reasons` is
  // already `.map(x => x.text || x.code)`. The presence of that map is the real check.
  assert.ok(src.includes('const reasons = (cp.reasons || []).map'), 'reasons are mapped to text');
  // `by` comes off the result, not off `parsed`.
  assert.match(src, /via \$\{p\.by\}/);
  // `parsed.by` must not be READ; the comment explaining why may name it.
  const codeOnly = src.replace(/\/\/[^\n]*/g, '');
  assert.doesNotMatch(codeOnly, /parsed\.by/, 'parsed has no `by` field');
});

test('the deed history lists only real transactions, named by the method that ran', () => {
  // The NFT track asks for "a history view per NFT: what it earned, what it paid out, who held
  // it". The deed contract emits events, but neither the public index nor
  // EXPERIMENTAL_tx_status returns their logs, so the honest view names the METHOD that ran and
  // links the transaction. A row exists only because that hash exists.
  const { deedHistory } = require('../../../backend/src/deed-history.js');
  const TOKEN = 'deed.near';
  const txns = [
    { transaction_hash: 'h1', signer_account_id: TOKEN, block_timestamp: 1000, actions: [{ method: 'mint_deed' }] },
    { transaction_hash: 'h2', signer_account_id: 'row.near', block_timestamp: 2000, actions: [{ method: 'house_session_check_in' }] },
    { transaction_hash: 'h3', signer_account_id: TOKEN, block_timestamp: 3000, actions: [{ method: 'house_pay' }] },
    { transaction_hash: 'h4', signer_account_id: 'someone.else', block_timestamp: 4000, actions: [{ method: 'something_else' }] },
    // A tx that mentions the same hash twice must not appear twice.
    { transaction_hash: 'h3', signer_account_id: TOKEN, block_timestamp: 3000, actions: [{ method: 'house_pay' }] },
  ];
  const h = deedHistory(txns, TOKEN, { balance: '5', cap: '10', paid: '2', pays: 1 });
  assert.equal(h.count, 3, 'three transactions touch this deed');
  assert.deepEqual(h.rows.map(r => r.method), ['house_pay', 'house_session_check_in', 'mint_deed'], 'newest first');
  assert.ok(h.rows.every(r => r.hash && r.hash.startsWith('h')), 'every row carries its hash');
  assert.equal(h.rows[0].what, 'Paid out');
  assert.ok(!h.rows.some(r => r.hash === 'h4'), 'an unrelated transaction is not this deed');
  // Totals come from the contract, never from summing the rows (the events are unreadable).
  assert.deepEqual(h.totals, { balance: '5', cap: '10', paid: '2', pays: 1 });
  assert.equal(deedHistory([], TOKEN).note, 'No transactions touch this deed yet.');
  // A FAILED read must never read as "this deed did nothing": the first live call answered 429
  // from the index and the panel said the deed had no transactions, which was false.
  const failed = deedHistory([], TOKEN, null, true);
  assert.equal(failed.read_failed, true);
  assert.match(failed.note, /did not answer/);
  assert.match(failed.note, /not a claim that the deed did nothing/);
  assert.equal(deedHistory([], TOKEN, null, false).read_failed, false);
});

test('the deed history survives a rate-limited index by falling back, not by going quiet', () => {
  // The first live call to the history route answered 429 from nearblocks and the panel said
  // the deed had no transactions, which was false. The route now tries the index, then
  // FastNEAR (which needs no key), and only reports a gap when BOTH fail.
  const src = readFileSync(new URL('../../../backend/src/app.js', import.meta.url), 'utf8');
  const route = src.slice(src.indexOf("app.get('/api/house/history/:account'"), src.indexOf("// Counterparty check before a payment"));
  assert.match(route, /api\.nearblocks\.io/, 'the index is tried first');
  assert.match(route, /tx\.main\.fastnear\.com|fastTx/, 'then FastNEAR');
  assert.match(route, /v0\/account/); assert.match(route, /v0\/transactions/);
  // Both must fail before a gap is reported.
  assert.match(route, /gap = gap \|\|/, 'a gap is only kept when the fallback also failed');
  // A board call wraps the shop method; the inner one is what happened on the deed.
  assert.match(route, /propose_call_as[\s\S]{0,200}inner\.method/, 'the inner method is unwrapped');
});

test('the deed history never takes the panel down over one bad timestamp', () => {
  // FastNEAR reports nanoseconds. Multiplying by 1e6 gave 1.79e24 ms, `new Date()` threw
  // RangeError: Invalid time value, and the whole history panel rendered as an error even
  // though the API had returned 12 correct rows. Units are fixed at the source, and the
  // renderer must survive anything it is handed anyway.
  const api = readFileSync(new URL('../../../backend/src/app.js', import.meta.url), 'utf8');
  const route = api.slice(api.indexOf("app.get('/api/house/history/:account'"), api.indexOf('// Counterparty check before a payment'));
  assert.match(route, /\/ 1e6/, 'nanoseconds are divided, not multiplied');
  assert.doesNotMatch(route, /tx_block_timestamp\) \* 1e6/, 'and never multiplied');

  const room = readFileSync(new URL('../../../app/src/panels/house-room.js', import.meta.url), 'utf8');
  assert.match(room, /Number\.isNaN\(d\.getTime\(\)\)/, 'the renderer rejects an invalid date instead of throwing');
});

test('the deed page opens only for the current holder, decided from the chain', () => {
  // The NFT brief asks for "a gated page that only current holders can open". The gate must be
  // `nft_token(id).owner_id`, read fresh, and an unanswered read must never be permission.
  const { gateDeed, gatedHtml, deedOwner } = require('../../../app/src/deed-gate.js');
  const DEEDS = 'house.nearcarta.near';
  const HOLDER = 'holder.near';
  const makeView = (owner) => async (contract, method) => {
    if (contract !== DEEDS || method !== 'nft_token') return null;
    return owner ? { token_id: 't1', owner_id: owner } : null;
  };

  return (async () => {
    // The holder opens it.
    const yes = await gateDeed('t1', HOLDER, { view: makeView(HOLDER), contract: DEEDS });
    assert.equal(yes.open, true);
    assert.equal(gatedHtml(yes), '', 'no refusal markup for the holder');

    // Anyone else is refused, and told who holds it.
    const no = await gateDeed('t1', 'stranger.near', { view: makeView(HOLDER), contract: DEEDS });
    assert.equal(no.open, false);
    // The refusal names the holder, truncated for display.
    assert.match(no.reason, /belongs to holder\.nea/);
    assert.equal(no.owner, 'holder.near', 'the full owner is returned for a caller that needs it');

    // A sold deed refuses the seller immediately, because the owner is re-read.
    const sold = await gateDeed('t1', HOLDER, { view: makeView('buyer.near'), contract: DEEDS });
    assert.equal(sold.open, false, 'the seller loses the page the moment the deed moves');

    // No deed, no account, and a failed read are all refusals, never permission.
    assert.equal((await gateDeed('missing', HOLDER, { view: makeView(null), contract: DEEDS })).open, false);
    assert.equal((await gateDeed('t1', '', { view: makeView(HOLDER), contract: DEEDS })).open, false);
    const broke = await gateDeed('t1', HOLDER, { view: async () => { throw new Error('rpc down'); }, contract: DEEDS });
    assert.equal(broke.open, false, 'a failed read is not permission');

    // The refusal markup holds no deed data: it names the holder and offers the way in.
    const html = gatedHtml(no);
    assert.match(html, /deed holder/);
    assert.match(html, /data-testid="deed-gated"/);
    assert.ok(!/purse/i.test(html), 'the refusal shows nothing about the deed');
    assert.equal(await deedOwner('t1', { view: makeView(HOLDER), contract: DEEDS }), HOLDER);
  })();
});

test('the deed page imports only modules published in the deploy root', () => {
  // The first version imported `/shared/vault/tx.js` and `/shared/deployments/mainnet.json`,
  // both 404 on the deployed site, so the page hung on "Reading the deed…" with no error the
  // user could act on. A page served raw can only import what the build actually publishes.
  const page = readFileSync(new URL('../../../app/src/deed-page.js', import.meta.url), 'utf8');
  const imports = [...page.matchAll(/^import .* from '([^']+)';$/gm)].map(m => m[1]);
  for (const spec of imports) {
    assert.ok(!spec.startsWith('/shared/'), `${spec} is not served`);
    assert.ok(!/deployments\/mainnet\.json/.test(spec), 'the deployment record is not in the deploy root');
  }
  // It reads ownership through the API instead, which is published.
  assert.match(page, /\/api\/house\/deed\//);
  assert.match(page, /\/api\/house\/history\//);
});
