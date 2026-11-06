import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from '../../src/app.js';
import { receiptsBody, RECEIPT_KEYS } from '../../../shared/rails/receipts.js';
import { readFileSync } from 'node:fs';
import {
  charterGate, checkoutInput, checkoutUsdOk, settlementYocto, openCheckout, checkLiveQuote, resetCheckouts,
  rememberCheckout, startCheckout, checkoutDeps, oneClickStatus, listCheckoutReceipts,
  boardRowAsGate, readCharterRules, rulesFor,
} from '../../src/ferry-checkout.js';

const clause = {
  receivers: ['payee.near'], per_action_cap: '2000000000000000000000', daily_budget: '5000000000000000000000',
  min_amount: '1', max_actions_per_day: 50, window_start_min: 0, window_end_min: 0,
};
const usage = { spent: '0', reserved: '0', count: 0 };
const state = { frozen: false };
const yocto = '1000000000000000000000';
const VISITOR = '8e20273edb5dd279e4414cd962f023daa15c8b04450d4a4905f6aae074e661c8';
const input = {
  from: { symbol: 'USDC', chain: 'base' }, to: { symbol: 'USDC', chain: 'near' }, amount: '0.2',
  recipient: 'payee.near', swapRecipient: VISITOR, refundTo: '0x552ad18e18a49ddad1e7d96b7ddf813b04a9cfb5',
  charter: VISITOR, clauseId: 'pay', amountYocto: yocto, privacy: 'public',
};
const tokens = [
  { assetId: 'nep141:base-usdc', symbol: 'USDC', blockchain: 'base', decimals: 6, price: 1 },
  { assetId: 'nep141:usdc.near', symbol: 'USDC', blockchain: 'near', decimals: 6, price: 1 },
];
const allow = (over = {}) => ({ state, clause: { ...clause, ...over }, usage, sealed: false });

function liveDeps(extra = {}) {
  const calls = [];
  const deps = {
    readCharter: async () => allow(),
    tokens: async () => tokens,
    quote: async () => ({ ok: true, from: { usd: '0.2' } }),
    postQuote: async body => {
      calls.push(body);
      return { http: 201, body: { quoteRequest: body, correlationId: 'cid', quote: { depositAddress: 'ab'.repeat(32), amountInUsd: '0.2', depositMemo: null, deadline: body.deadline } } };
    },
    verify: () => true,
    calls,
  };
  return Object.assign(deps, extra);
}

test('the charter gate matches the oath rules', () => {
  assert.equal(charterGate({ state, clause, usage, receiver: 'payee.near', amount: yocto, nowMin: 0 }).ok, true);
  assert.equal(charterGate({ state, clause, usage, receiver: 'other.near', amount: yocto, nowMin: 0 }).reason, 'receiver_not_allowlisted');
  assert.equal(charterGate({ state, clause, usage, receiver: 'payee.near', amount: '3000000000000000000000', nowMin: 0 }).reason, 'over_per_action_cap');
  assert.equal(charterGate({ state, clause, usage: { spent: '4500000000000000000000', reserved: '0', count: 0 }, receiver: 'payee.near', amount: yocto, nowMin: 0 }).reason, 'over_daily_budget');
  assert.equal(charterGate({ state, clause, usage: { ...usage, count: 50 }, receiver: 'payee.near', amount: yocto, nowMin: 0 }).reason, 'over_daily_action_count');
  assert.equal(charterGate({ state: { frozen: true }, clause, usage, receiver: 'payee.near', amount: yocto, nowMin: 0 }).reason, 'frozen');
  assert.equal(charterGate({ state, clause: { ...clause, window_start_min: 0, window_end_min: 60 }, usage, receiver: 'payee.near', amount: yocto, nowMin: 120 }).reason, 'outside_time_window');
  assert.equal(charterGate({ state, clause, usage, receiver: 'payee.near', amount: yocto, nowMin: 0, sealed: true }).reason, 'hidden_rule');
  assert.equal(checkoutUsdOk('0.2').ok, true);
  // A USD number alone is not a limit; only a non-positive one is refused here.
  assert.equal(checkoutUsdOk('0.21').ok, true);
  assert.equal(checkoutUsdOk('5').ok, true);
  assert.equal(checkoutUsdOk('0').reason, 'bad_usd');
  assert.equal(settlementYocto(clause, usage), yocto);
});

test('no product USD cap: only the row decides, and the amount must be positive', () => {
  // A USD number on its own is not a limit. 5, 0.21 and 0.2 all pass this check; the
  // row gate is what refuses a spend, and it compares NEAR, not dollars.
  for (const v of ['0.2', '0.21', '5']) assert.equal(checkoutUsdOk(v).ok, true, v);
  assert.equal(checkoutUsdOk('0').reason, 'bad_usd');
  assert.equal(checkoutUsdOk('-1').reason, 'bad_usd');
  assert.equal(checkoutUsdOk('abc').reason, 'bad_usd');
  // And the source has no product constant left to drift.
  const src = readFileSync(new URL('../../src/ferry-checkout.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /MAX_CHECKOUT_USD/);
  assert.doesNotMatch(src, /over_checkout_cap/);
});

test('a refused recipient never asks 1Click, and an allowed one returns a deposit address', async () => {
  resetCheckouts();
  const blocked = liveDeps({ readCharter: async () => allow() });
  const no = await openCheckout({ ...input, recipient: 'other.near' }, blocked);
  assert.equal(no.ok, false);
  assert.equal(no.reason, 'receiver_not_allowlisted');
  assert.equal(no.depositAddress, null);
  assert.equal(blocked.calls.length, 0);
  assert.equal(no.receipt.rail, 'intents');
  assert.equal(no.receipt.decision, 'refused');
  assert.equal(no.receipt.tx, null);

  const okd = liveDeps();
  const yes = await openCheckout(input, okd);
  assert.equal(yes.ok, true);
  assert.equal(yes.depositAddress, 'ab'.repeat(32));
  assert.equal(okd.calls.length, 1);
  assert.equal(okd.calls[0].dry, false);
  assert.equal(okd.calls[0].recipient, VISITOR);
  assert.equal(yes.receipt.rail, 'intents');
  assert.equal(yes.receipt.decision, 'allowed');
  assert.equal(yes.receipt.tx, yes.depositAddress);
  assert.deepEqual(Object.keys(yes.receipt), RECEIPT_KEYS);
  const listed = listCheckoutReceipts();
  assert.equal(listed[0].tx, yes.depositAddress);
  resetCheckouts();
});

test('an amount the row refuses never asks for a deposit address', async () => {
  // The row allows 0.005 NEAR per payment. A 1 NEAR checkout is over that, so the row
  // gate refuses it before any 1Click call. The amount is the NEAR the row spends.
  const deps = liveDeps({ tokens: async () => tokens.map(t => ({ ...t, price: 3 })) });
  const over = await openCheckout({ ...input, amount: '1', amountYocto: '1000000000000000000000000' }, deps);
  assert.equal(over.ok, false);
  assert.equal(over.reason, 'over_per_action_cap');
  assert.equal(over.depositAddress, null);
  assert.equal(deps.calls.length, 0);

  // Inside the row it is allowed, and a wider row allows more with no code change.
  const fits = liveDeps({ quote: async () => ({ ok: true, from: { usd: '0.01' } }) });
  assert.equal((await openCheckout({ ...input, amount: '0.004' }, fits)).ok, true);
  const wide = liveDeps({ quote: async () => ({ ok: true, from: { usd: '0.5' } }), readCharter: async () => allow({ per_action_cap: '1000000000000000000000000', daily_budget: '2000000000000000000000000' }) });
  assert.equal((await openCheckout({ ...input, amount: '0.4', amountYocto: '400000000000000000000000' }, wide)).ok, true);
});

test('USDC on NEAR is quoted to the visitor while the charter gate still checks the shop', async () => {
  resetCheckouts();
  const scholar = '8e20273edb5dd279e4414cd962f023daa15c8b04450d4a4905f6aae074e661c8';
  const deps = liveDeps();
  deps.quote = async (q) => { deps.dryTo = q.recipient; return { ok: true, from: { usd: '0.05' } }; };
  const out = await openCheckout({ ...input, amount: '0.05', swapRecipient: scholar }, deps);
  assert.equal(out.ok, true);
  assert.equal(deps.dryTo, scholar);
  assert.equal(deps.calls[0].recipient, scholar);
  assert.equal(deps.calls[0].recipientType, 'DESTINATION_CHAIN');
  assert.equal(deps.calls[0].refundType, 'ORIGIN_CHAIN');
  assert.equal(deps.calls[0].dry, false);
  const refused = await openCheckout({ ...input, recipient: 'other.near', swapRecipient: scholar }, liveDeps());
  assert.equal(refused.reason, 'receiver_not_allowlisted');
  assert.equal(refused.depositAddress, null);
  const noVisitor = await openCheckout({ ...input, amount: '0.05', swapRecipient: null }, liveDeps());
  assert.equal(noVisitor.ok, false);
  assert.match(noVisitor.error || '', /NEAR destination needs a NEAR account/);
  assert.equal(noVisitor.depositAddress, null);
});

test('USDC on Base is quoted to the typed address and a missing address never asks 1Click', async () => {
  resetCheckouts();
  const addr = '0xf76e6b0920e9332ff4410f6dd53f01722abc71a3';
  const deps = liveDeps({
    tokens: async () => [
      { assetId: 'nep141:wrap.near', symbol: 'wNEAR', blockchain: 'near', decimals: 24, price: 1 },
      { assetId: 'nep141:base-usdc', symbol: 'USDC', blockchain: 'base', decimals: 6, price: 1 },
    ],
  });
  deps.quote = async (q) => { deps.dryTo = q.recipient; return { ok: true, from: { usd: '0.181' } }; };
  const body = {
    from: { symbol: 'wNEAR', chain: 'near' }, to: { symbol: 'USDC', chain: 'base' }, amount: '0.05',
    recipient: 'payee.near', swapRecipient: addr, refundTo: VISITOR,
    charter: 'charter.nearcarta.near', clauseId: 'pay', amountYocto: yocto, privacy: 'public',
  };
  const out = await openCheckout(body, deps);
  assert.equal(out.ok, true);
  assert.equal(deps.dryTo, addr);
  assert.equal(deps.calls[0].recipient, addr);
  assert.equal(deps.calls[0].recipientType, 'DESTINATION_CHAIN');
  assert.equal(deps.calls[0].refundTo, VISITOR);
  assert.equal(deps.calls[0].refundType, 'ORIGIN_CHAIN');
  const missing = await openCheckout({ ...body, swapRecipient: null }, liveDeps());
  assert.equal(missing.ok, false);
  assert.equal(missing.depositAddress, null);
  assert.match(missing.error || '', /address on the destination chain/);
  const parsed = checkoutInput({
    from: 'wNEAR@near', to: 'USDC@base', amount: '0.05', recipient: 'payee.near',
    swap_recipient: addr, refundTo: VISITOR, charter: 'charter.nearcarta.near', amount_yocto: '1',
  });
  assert.equal(parsed.value.swapRecipient, addr);
  assert.equal(parsed.value.recipient, 'payee.near');
  const bad = checkoutInput({
    from: 'wNEAR@near', to: 'USDC@base', amount: '0.05', recipient: 'payee.near',
    swap_recipient: 'not-an-address', refundTo: VISITOR, charter: 'charter.nearcarta.near', amount_yocto: '1',
  });
  assert.equal(bad.error, 'bad recipient');
});

test('an unsigned live quote does not hand out its deposit address', () => {
  const sent = { dry: false, recipient: 'payee.near' };
  const resp = { quoteRequest: { ...sent }, quote: { depositAddress: 'ab'.repeat(32), amountInUsd: '0.2' } };
  const bad = checkLiveQuote(sent, resp, () => false);
  assert.equal(bad.accepted, false);
  assert.equal(bad.depositAddress, null);
  const good = checkLiveQuote(sent, resp, () => true);
  assert.equal(good.depositAddress, 'ab'.repeat(32));
});

test('POST /api/ferry/checkout refuses a bad body and a payee the charter does not list', async () => {
  resetCheckouts();
  const saved = { ...checkoutDeps };
  const calls = [];
  checkoutDeps.readCharter = async () => allow();
  checkoutDeps.tokens = async () => tokens;
  checkoutDeps.quote = async () => ({ ok: true, from: { usd: '0.2' } });
  checkoutDeps.postQuote = async body => {
    calls.push(body);
    return { http: 201, body: { quoteRequest: body, correlationId: 'cid', quote: { depositAddress: 'ab'.repeat(32), amountInUsd: '0.2', deadline: body.deadline } } };
  };
  checkoutDeps.verify = () => true;
  try {
    const app = makeApp();
    const post = body => app.request('/api/ferry/checkout', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '192.0.2.77' }, body: JSON.stringify(body) });
    const bad = await post({ from: 'nope' });
    assert.equal(bad.status, 400);
    const refused = await post({
      from: 'USDC@base', to: 'USDC@near', amount: '0.2', recipient: 'other.near', refundTo: '0x552ad18e18a49ddad1e7d96b7ddf813b04a9cfb5',
      charter: 'charter.nearcarta.near', clause_id: 'pay', amount_yocto: yocto,
    });
    const j = await refused.json();
    assert.equal(refused.status, 200);
    assert.equal(j.ok, false);
    assert.equal(j.reason, 'receiver_not_allowlisted');
    assert.equal(j.depositAddress, null);
    assert.equal(calls.length, 0);
    const allowed = await post({
      from: 'USDC@base', to: 'USDC@near', amount: '0.2', recipient: 'payee.near',
      swap_recipient: VISITOR, refundTo: '0x552ad18e18a49ddad1e7d96b7ddf813b04a9cfb5',
      charter: 'charter.nearcarta.near', clause_id: 'pay', amount_yocto: yocto,
    });
    const a = await allowed.json();
    assert.equal(a.depositAddress, 'ab'.repeat(32));
    assert.equal(calls[0].dry, false);
    assert.equal(a.receipt.decision, 'allowed');
  } finally {
    Object.assign(checkoutDeps, saved);
    resetCheckouts();
  }
});

test('ONECLICK status is only for a checkout this process issued', async () => {
  resetCheckouts();
  const app = makeApp();
  const missing = await app.request('/api/ferry/status?env=ONECLICK&depositAddress=' + 'cd'.repeat(32), { headers: { 'cf-connecting-ip': '192.0.2.78' } });
  assert.equal(missing.status, 404);
  rememberCheckout({ depositAddress: 'ab'.repeat(32), recipient: 'payee.near', usd: '0.2', status: 'PENDING_DEPOSIT', tx: null });
  const real = globalThis.fetch;
  globalThis.fetch = async url => {
    assert.match(String(url), /\/v0\/status\?depositAddress=ab/);
    return new Response(JSON.stringify({ status: 'SUCCESS', swapDetails: { destinationChainTxHashes: ['5'.repeat(44)] } }), { status: 200 });
  };
  try {
    const r = await app.request('/api/ferry/status?env=ONECLICK&depositAddress=' + 'ab'.repeat(32), { headers: { 'cf-connecting-ip': '192.0.2.79' } });
    const j = await r.json();
    assert.equal(j.status, 'SUCCESS');
    assert.equal(j.tx, '5'.repeat(44));
    assert.match(j.help, /Done/);
    const body = receiptsBody(JSON.parse(readFileSync(new URL('../../../shared/deployments/mainnet.json', import.meta.url), 'utf8')), {}, { checkouts: listCheckoutReceipts() });
    const row = body.receipts.find(x => x.tx === '5'.repeat(44));
    assert.equal(row.rail, 'intents');
    assert.equal(row.decision, 'allowed');
    assert.equal(row.url, 'https://nearblocks.io/txns/' + '5'.repeat(44));
    const dry = body.receipts.find(x => x.decision === 'dry');
    assert.equal(dry.tx, null);
  } finally {
    globalThis.fetch = real;
    resetCheckouts();
  }
});

test('a shop on another site can call Pay', async () => {
  const app = makeApp();
  const r = await app.request('/api/ferry/rules?charter=nope', { method: 'OPTIONS', headers: { origin: 'https://shop.example', 'access-control-request-method': 'GET' } });
  assert.equal(r.status, 204);
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
});

test('a visitor board row is the checkout gate when the account has no oath', async () => {
  const row = {
    frozen: false, receivers: ['payee.near'], per_action_cap: '5000000000000000000000000',
    daily_budget: '10000000000000000000000000', max_actions_per_day: 3,
    min_amount: '100000000000000000000', spent_today: '0', actions_today: 0,
  };
  const gate = boardRowAsGate(row);
  assert.equal(charterGate({ ...gate, receiver: 'payee.near', amount: row.min_amount, nowMin: 0 }).ok, true);
  const calls = [];
  const viewFn = async (account, method) => {
    calls.push([account, method]);
    if (method === 'get_state' || method === 'get_rules') throw new Error('MethodNotFound');
    if (method === 'get_charter') return row;
    throw new Error(method);
  };
  const owner = '8e20273edb5dd279e4414cd962f023daa15c8b04450d4a4905f6aae074e661c8';
  const got = await readCharterRules(owner, 'pay', viewFn);
  assert.equal(got.clause.receivers[0], 'payee.near');
  assert.equal(got.clause.per_action_cap, row.per_action_cap);
  assert.equal(calls.some(([, method]) => method === 'get_rules' || method === 'get_state'), false);
  assert.equal(calls.some(([, method]) => method === 'get_charter'), true);
  assert.equal(calls.find(([, method]) => method === 'get_charter')[0], 'board.nearcarta.near');
});

test('an implicit row skips get_rules, a named miss falls through, and a factory charter still uses get_rules', async () => {
  const owner = '8e20273edb5dd279e4414cd962f023daa15c8b04450d4a4905f6aae074e661c8';
  const miss = `view ${owner}.get_rules: wasm execution failed with error: CompilationError(CodeDoesNotExist { account_id: "${owner}" })`;
  const row = {
    frozen: false, receivers: ['charter.nearcarta.near', 'toll.nearcarta.near', 'wrap.near'],
    per_action_cap: '60000000000000000000000', daily_budget: '70000000000000000000000',
    max_actions_per_day: 5, min_amount: '100000000000000000000', spent_today: '0', actions_today: 0,
  };
  const calls = [];
  const viewFn = async (account, method, args) => {
    calls.push({ account, method, args });
    if (method === 'get_state' || method === 'get_rules') throw new Error(miss);
    if (method === 'get_charter') return row;
    throw new Error(method);
  };
  const got = await readCharterRules(owner, 'pay', viewFn);
  assert.equal(calls.some(c => c.method === 'get_rules' || c.method === 'get_state'), false);
  assert.deepEqual(calls[0], { account: 'board.nearcarta.near', method: 'get_charter', args: { owner } });
  assert.equal(got.clause.per_action_cap, '60000000000000000000000');
  assert.equal(got.clause.receivers[2], 'wrap.near');

  calls.length = 0;
  const named = 'visitor.near';
  const namedView = async (account, method) => {
    calls.push({ account, method });
    if (account === named) throw new Error(`view ${named}.${method}: wasm execution failed with error: CompilationError(CodeDoesNotExist { account_id: "${named}" })`);
    if (method === 'get_charter') return row;
    throw new Error(method);
  };
  const namedGot = await readCharterRules(named, 'pay', namedView);
  assert.equal(namedGot.clause.receivers[0], 'charter.nearcarta.near');
  assert.equal(calls.filter(c => c.account === 'board.nearcarta.near' && c.method === 'get_charter').length, 1);

  calls.length = 0;
  const oath = async (account, method) => {
    calls.push({ account, method });
    if (method === 'get_state') return { frozen: false, next_nonce: '1', policy_version: 1 };
    if (method === 'get_rules') return { clause: { receivers: ['payee.near'], per_action_cap: '1' }, usage: { spent: '0' } };
    throw new Error('board read on a factory charter');
  };
  const oathGot = await readCharterRules('mine.factory.near', 'pay', oath);
  assert.equal(oathGot.clause.receivers[0], 'payee.near');
  assert.equal(calls.some(c => c.method === 'get_charter'), false);
  assert.equal(calls.some(c => c.method === 'get_rules' && c.account === 'mine.factory.near'), true);

  calls.length = 0;
  const flagged = await readCharterRules('visitor.near', 'pay', namedView, { board: true });
  assert.equal(flagged.clause.receivers[2], 'wrap.near');
  assert.equal(calls.some(c => c.method === 'get_rules' || c.method === 'get_state'), false);
});

test('checkout with board:true asks the gate for the row and does not quote a missing charter', async () => {
  const saved = { ...checkoutDeps };
  const seen = [];
  checkoutDeps.readCharter = async (account, clause, opts) => { seen.push({ account, clause, opts }); return allow(); };
  checkoutDeps.tokens = async () => tokens;
  checkoutDeps.quote = async () => ({ ok: false, error: 'stop before 1Click' });
  checkoutDeps.postQuote = async () => { throw new Error('live quote should not run'); };
  const scholar = '8e20273edb5dd279e4414cd962f023daa15c8b04450d4a4905f6aae074e661c8';
  const body = (extra) => ({
    from: 'wNEAR@near', to: 'USDC@near', amount: '0.05', recipient: 'payee.near',
    refundTo: 'nearcarta.near', clause_id: 'pay', amount_yocto: '1', swap_recipient: scholar, ...extra,
  });
  try {
    const board = await startCheckout(body({ charter: scholar, board: true }));
    assert.equal(board.depositAddress, null);
    assert.equal(board.reason, 'quote_refused');
    assert.equal(seen[0].opts.board, true);
    assert.equal(seen[0].account, scholar);
    const factory = await startCheckout(body({ charter: 'charter.nearcarta.near' }));
    assert.equal(factory.reason, 'quote_refused');
    assert.equal(seen[1].opts.board, false);
    assert.equal(seen[1].account, 'charter.nearcarta.near');
  } finally {
    Object.assign(checkoutDeps, saved);
  }
});

test('startCheckout does not call the network when the body is empty', async () => {
  const out = await startCheckout(null);
  assert.equal(out.httpStatus, 400);
});

test('a visitor with no row gets a clean no-row state that points at /setup', async () => {
  const saved = { ...checkoutDeps };
  checkoutDeps.readCharter = async () => { throw new Error('no charter row'); };
  try {
    const out = await rulesFor(VISITOR, 'pay');
    // No row is a state, not a broken read: 200, a reason the UI can show, and a link.
    assert.equal(out.httpStatus, 200);
    assert.equal(out.ok, false);
    assert.equal(out.reason, 'no_row');
    assert.equal(out.next.href, '/setup/#sign');
    assert.match(out.error, /No row on the board/);
    assert.equal(out.settlement_yocto, null);
  } finally {
    Object.assign(checkoutDeps, saved);
  }
  // A real RPC failure is still an error, so a broken node is not hidden as "no row".
  checkoutDeps.readCharter = async () => { throw new Error('rpc timeout'); };
  try {
    const bad = await rulesFor(VISITOR, 'pay');
    assert.equal(bad.httpStatus, 502);
    assert.equal(bad.reason, 'charter_unread');
  } finally {
    Object.assign(checkoutDeps, saved);
  }
});

test('a row that exists still answers /api/ferry/rules with its caps', async () => {
  const saved = { ...checkoutDeps };
  checkoutDeps.readCharter = async () => allow();
  try {
    const out = await rulesFor(VISITOR, 'pay');
    assert.equal(out.httpStatus, 200);
    assert.equal(out.charter, VISITOR);
    assert.deepEqual(out.receivers, ['payee.near']);
    assert.equal(out.ok, true);
  } finally {
    Object.assign(checkoutDeps, saved);
  }
});
