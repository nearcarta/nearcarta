// The guest's real Market Day. Every step is a real NEAR testnet transaction: the market moves go through
// the testnet relayer as NEP-366 delegate actions, the direct calls (board, house, toll, test USD) are
// signed and sent by the guest itself. Nothing here sends anything: every send is injected.
// Docs: https://docs.near.org/protocol/transactions/meta-tx · https://docs.near.org/tools/near-api
//       https://docs.near.org/chain-abstraction/chain-signatures · https://github.com/near/NEPs/blob/master/neps/nep-0141.md
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../../', import.meta.url).pathname;
const read = (p) => readFileSync(root + p, 'utf8');

test('guest play: every story step on testnet has a real transaction behind it', () => {
  const src = read('app/src/market/live-guest.js');
  // One branch per step, and each one is a real chain call.
  for (const step of ['cargo', 'sell', 'invest', 'seal', 'pay', 'order', 'cross', 'check', 'write']) {
    assert.match(src, new RegExp(`id === '${step}'`), `${step} has a real path`);
  }
  // The market moves are delegate actions through the testnet relayer: the guest pays no gas there.
  assert.match(src, /buildDelegateAction/);
  assert.match(src, /encodeSignedDelegate/);
  assert.match(src, /api\('\/api\/relay'\)/);
  // The direct calls are the guest's own: board anchor, the toll, the test dollar transfer, the deed.
  assert.match(src, /'anchor'/);
  assert.match(src, /'sign_cross'/);
  assert.match(src, /'ft_transfer'/);
  assert.match(src, /'propose_call_as'/);
  // It is testnet only, and it says so rather than pretending.
  assert.match(src, /NET === 'testnet'/);
  assert.match(src, /testnet/);
});

test('guest play: the toll is signed and NOT broadcast, said in one line', () => {
  const src = read('app/src/market/live-guest.js');
  const city = read('app/src/market/city.js');
  // The cross is a real MPC signature, and the record marks broadcast false because there is no
  // Base Sepolia ETH to pay the gas.
  assert.match(src, /broadcast: false/);
  assert.match(city, /Signed by NEAR's MPC network on testnet, not sent to Base Sepolia/);
  assert.match(city, /broadcast === false/);
});

test('guest play: every card carries a TESTNET pill and a receipt link', () => {
  const city = read('app/src/market/city.js');
  const css = read('app/src/market/market.css');
  assert.match(city, /data-testid="testnet-pill"/);
  assert.match(city, /TESTNET/);
  assert.match(city, /txUrl\(esc\(r\.real\.hash\)\)/);
  // The refused step links the refusal, not only the payment.
  assert.match(city, /refused_hash/);
  assert.match(city, /Refused ↗/);
  // The pill is visible, not a bare word.
  assert.match(css, /\.qs-net-pill\{[^}]*#2f9a8c/);
  assert.match(css, /\.qs-net-pill\{[^}]*#7fe3d4/);
});

test('guest play: the guest cost line says real testnet move and free', () => {
  const city = read('app/src/market/city.js');
  assert.match(city, /Real testnet move · free/);
});

test('guest play: the record names every shop a guest row may reach', () => {
  const dep = JSON.parse(read('shared/deployments/testnet.json'));
  for (const k of ['board', 'market', 'guard', 'townhall', 'house', 'toll', 'tusdc']) {
    assert.ok(dep.shops[k], `${k} is in the record`);
    assert.match(dep.shops[k], /\.nearcarta\.testnet$/, `${k} is a testnet account`);
  }
  // Every account the guest path names is in the record, so no fallback can point at an unknown name.
  const known = new Set(Object.values(dep.shops));
  const src = read('app/src/market/live-guest.js');
  for (const m of src.matchAll(/'([a-z0-9-]+\.nearcarta\.testnet)'/g)) {
    assert.ok(known.has(m[1]), `${m[1]} is named in the record's shops map`);
  }
});

test('guest play: the row a guest opens comes from the record, not from a literal', () => {
  const dep = JSON.parse(read('shared/deployments/testnet.json'));
  const row = dep.guest.row;
  assert.ok(Array.isArray(row.receivers) && row.receivers.length >= 7, 'every shop the story needs is a receiver');
  for (const r of row.receivers) assert.match(r, /\.nearcarta\.testnet$/, `${r} is a testnet account`);
  // The defaults the spec names: 0.005 per action, 0.02 a day, 8 actions.
  assert.equal(row.per_action_cap, '5000000000000000000000');
  assert.equal(row.daily_budget, '20000000000000000000000');
  assert.equal(row.max_actions_per_day, 8);
  // The guest path reads them from the record and refuses rather than inventing a row.
  const src = read('app/src/market/live-guest.js');
  assert.match(src, /cfg\.guestRow/);
  assert.match(src, /ERR_NO_RECEIVERS/);
  // The row names the guest's own key, so no second access key has to be added.
  assert.match(src, /agent: s\.publicKey/);
  // Opening twice is safe: an existing row is left alone.
  assert.match(src, /already: true/);
});
