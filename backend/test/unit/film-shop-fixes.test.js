// Film take fixes: Arena shows the market crate it really runs, Rent picks a free stall, the Ferry
// default fits the default cap, and Market Day's order/write steps go through the visitor's own row.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { arenaMarket } from '../../src/shops.js';
import { readGuardians, isMarket } from '../../src/arena-economy.js';
import { marketHtml, arenaHtml } from '../../../app/src/panels/arena/tray.js';
const read = p => readFileSync(new URL('../../../' + p, import.meta.url), 'utf8');

const CONFIG = { version: 2, caps: { gathers_per_day: 200 } };
const future = String((BigInt(Date.now()) + 86_400_000n) * 1_000_000n);
const SQUARE = { rules: { floor_bps: 9000, stall_rent: '1000000000000000000000', stall_days: 7 }, council: { members: ['a', 'b'], quorum: 5 },
  stalls: [{ id: 1, holder: 'x.near', until: future }, { id: 2, holder: 'y.near', until: '1' }] };
const fakeView = async (c, m, a) => {
  if (m === 'get_config') return CONFIG;
  if (m === 'square') return SQUARE;
  if (m === 'mt_tokens') return [{ token_id: 'good:salt' }, { token_id: 'share:ferry' }];
  if (m === 'quote') return { buy: '631560000000000000000', sell: '492288000000000000000', reasons: [{ why: '38 on the shelf' }] };
  throw new Error('MethodNotFound');
};

test('the arena read is the market crate, not guardian views it lacks', async () => {
  const r = await arenaMarket('arena.nearcarta.near', CONFIG, fakeView, async () => ({ amount: '4300000000000000000000000' }));
  assert.equal(r.kind, 'market');
  assert.deepEqual(r.quotes.map(q => q.good), ['good:salt']);
  assert.equal(r.stalls.length, 4);
  assert.equal(r.stalls[0].held, true);
  assert.equal(r.stalls[1].held, false, 'an expired stall is free');
  assert.equal(r.free_stall, 2);
  assert.equal(r.balance_near, 4.3);
  assert.equal(await isMarket(fakeView), true);
  const g = await readGuardians(fakeView);
  assert.equal(g.market, true);
  assert.deepEqual(g.guardians, []);
});

test('the Arena tray on the market shows prices and stalls and no guardian buttons', () => {
  const html = arenaHtml({ market: true, mkt: { contract: 'arena.nearcarta.near', quotes: [{ good: 'good:salt', buy: '631560000000000000000', sell: '492288000000000000000' }], stalls: [{ id: 1, held: false }], rules: SQUARE.rules, council: SQUARE.council } });
  assert.equal(html, marketHtml({ market: true, mkt: { contract: 'arena.nearcarta.near', quotes: [{ good: 'good:salt', buy: '631560000000000000000', sell: '492288000000000000000' }], stalls: [{ id: 1, held: false }], rules: SQUARE.rules, council: SQUARE.council } }));
  assert.match(html, /data-kind="market"/);
  assert.match(html, /salt<\/b> · buy 6\.32 coins · sell 4\.92 coins/);
  assert.match(html, /Stall 1 · <b>free<\/b>/);
  assert.doesNotMatch(html, /Feed guardian|Mint guardian|Attack guardian|data-act="guardian"/);
  assert.match(html, /data-testid="arena-trade" href="\/\?play"/);
});

test('Rent picks the first free stall instead of stall 1', () => {
  const city = read('app/src/market/city.js');
  assert.doesNotMatch(city, /rentStall\(1\)/);
  assert.match(city, /const id = await R\.freeStall\(\)/);
  assert.match(read('app/src/market/live-play.js'), /export async function freeStall/);
});

test('order and write go through the visitor row on mainnet, else practice', () => {
  const live = read('app/src/market/live-play.js');
  assert.match(live, /if \(id === 'order' \|\| id === 'write'\) return rowStep\(id, ctx\);/);
  const rs = live.slice(live.indexOf('async function rowStep'));
  assert.match(rs, /A\.hallJob\(\{ receiver: HALL, method: 'post_job', deposit: String\(MILLI\)/);
  assert.match(rs, /A\.anchorStatement\(\{ kind: 'statement', digest, salt: saltText\(\) \}\)/);
  assert.match(rs, /catch \{ return null; \}/, 'any miss falls back to practice');
  assert.match(live, /A\.S\.agentLive \? A : null/);
});
