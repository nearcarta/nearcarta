import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readLive } from '../../src/market-live.js';
import MAIN from '../../../shared/deployments/mainnet.json' with { type: 'json' };

test('market live: shops and prices come from the market contract, purses from each keeper wallet', async () => {
  const calls = [];
  const viewF = async (acct, method, args) => { calls.push([acct, method]);
    if (method === 'market_board') return [{ id: 'ferry', keeper: 'keeper-ferry.nearcarta.near', open: true, till: '10', floor: '3', trades: '2', shares: '0', owed: '0', goods: [{ good: 'good:salt', stock: '19', quote: { buy: '1200', sell: '900' } }] }];
    if (method === 'orders') return [];
    if (method === 'get_charter') return { balance: '5000', actions_today: 1, spent_today: '0' };
    return null; };
  const accountF = async () => ({ amount: String(15n * 10n ** 21n + 398n * 10n ** 19n), storage_usage: 398 });
  const r = await readLive({ viewF, accountF });
  assert.equal(r.market, MAIN.market.contract);
  assert.equal(r.shops[0].goods[0].buy, '1200');
  assert.equal(Object.keys(r.keepers).length, 9);
  assert.equal(r.keepers.ferry.purse, String(15n * 10n ** 21n));
  assert.equal(r.keepers.ferry.row.actions_today, 1);
  assert.ok(calls.some(([a, m]) => a === MAIN.market.contract && m === 'market_board'));
});
