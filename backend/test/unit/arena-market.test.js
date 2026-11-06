import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MISS_HINT, SESSION_CAP_NEAR, SIM_LABEL,
  buyPlan, chainScore, cinemaFor, findStall, parseCommand, pointsFor, priceNear,
  readRules, sealFor, simulateWeek, stallView, viewsFromRules,
} from '../../../app/src/panels/arena/market.js';
import { arenaIcon } from '../../../app/src/panels/arena/icons.js';
import { marketPayload, readAttempts, scorePayload, stallOnChain } from '../../src/arena-market.js';

const rules = readRules();
const stalls = () => viewsFromRules(rules);

test('pricing rules price three stalls from stock and demand', () => {
  assert.equal(rules.session_cap_near, '0.06');
  assert.equal(SESSION_CAP_NEAR, 0.06);
  assert.equal(rules.stalls.length, 3);
  const cafe = stallView(rules.stalls[0]);
  assert.equal(cafe.id, 'cafe');
  assert.equal(cafe.open, true);
  assert.equal(cafe.price_near, 0.004);
  assert.equal(priceNear(rules.stalls[0]), 0.004);
  const bakery = stallView(rules.stalls[1]);
  assert.equal(bakery.price_near, 0.026667);
  assert.equal(bakery.open, true);
  const smith = stallView(rules.stalls[2]);
  assert.equal(smith.open, false);
  assert.equal(smith.price_near, null);
  assert.match(smith.reasoning, /closed/);
  assert.match(smith.reasoning, /Nothing was signed/);
});

test('a week simulation closes an empty stall and signs nothing', () => {
  const once = simulateWeek(rules, 7);
  assert.equal(once.simulation, true);
  assert.equal(once.tx, null);
  assert.equal(once.label, SIM_LABEL);
  assert.equal(once.label, 'Simulation. No transaction was signed.');
  const cafe = once.stalls.find(s => s.id === 'cafe');
  assert.equal(cafe.stock, 0);
  assert.equal(cafe.open, false);
  assert.equal(rules.stalls[0].stock, 4);
  const twice = simulateWeek(rules, 7);
  assert.equal(twice.stalls.find(s => s.id === 'cafe').stock, 0);
  assert.equal(stallView(rules.stalls[0]).price_near, 0.004);
});

test('chain score counts only get_attempt verdicts', () => {
  const rows = [
    { player: 'a.near', verdict: 'C1_CAP' },
    { player: 'a.near', verdict: null, corpus: 'ALLOW' },
    { player: 'a.near', verdict: '' },
    { player: 'b.near', verdict: 'ALLOW' },
  ];
  const mine = chainScore(rows, 'a.near');
  assert.equal(mine.source, 'get_attempt');
  assert.equal(mine.points, 1);
  assert.equal(mine.attempts, 3);
  assert.equal(chainScore(rows).points, 2);
  assert.equal(pointsFor({ cancelled: true, verdict: 'ALLOW' }), 0);
  assert.equal(pointsFor({ decision: 'cancelled' }), 0);
  assert.equal(pointsFor({ simulation: true, verdict: 'ALLOW' }), 0);
  assert.equal(pointsFor({ verdict: 'C1_CAP' }), 1);
  assert.equal(pointsFor({ verdict: null }), 0);
});

test('readAttempts stops at the first empty row and drops non-string verdicts', async () => {
  const seen = [];
  const view = async (_c, method, args) => {
    assert.equal(method, 'get_attempt');
    assert.equal(typeof args.attempt_id, 'string');
    seen.push(args.attempt_id);
    if (args.attempt_id === '0') return { player: 'a.near', verdict: 'C1_CAP', revealed: true };
    if (args.attempt_id === '1') return { player: 'a.near', verdict: null, corpus: 'ALLOW' };
    return null;
  };
  const attempts = await readAttempts(view, 'arena.nearcarta.near');
  assert.deepEqual(seen, ['0', '1', '2']);
  const score = chainScore(attempts, 'a.near');
  assert.equal(score.points, 1);
  const body = await scorePayload('a.near', view, 'arena.nearcarta.near');
  assert.equal(body.points, 1);
  assert.equal(body.contract, 'arena.nearcarta.near');
});

test('a buy stays inside the session cap and the row cap', () => {
  const cafe = stalls().find(s => s.id === 'cafe');
  assert.equal(buyPlan({ stall: cafe, qty: 0 }).sign, false);
  assert.equal(buyPlan({ stall: cafe, qty: 1.5 }).sign, false);
  assert.equal(buyPlan({ stall: cafe, qty: 13 }).sign, false);
  const smith = stalls().find(s => s.id === 'smith');
  assert.match(buyPlan({ stall: smith, qty: 1, receivers: [] }).reason, /closed/);
  const fat = { ...cafe, price_near: 0.05, open: true };
  const over = buyPlan({ stall: fat, qty: 2, receivers: [fat.account], accountExists: true });
  assert.equal(over.sign, false);
  assert.match(over.reason, /0\.06/);
  assert.match(over.reason, /Nothing was signed/);
  const row = buyPlan({ stall: cafe, qty: 1, capNear: 0.001, receivers: [cafe.account], accountExists: true });
  assert.equal(row.sign, false);
  assert.match(row.reason, /0\.001/);
  assert.equal(buyPlan({ stall: cafe, qty: 1, receivers: null, accountExists: true }).sign, false);
  const refused = buyPlan({ stall: cafe, qty: 1, receivers: ['nearcarta.near'], accountExists: false });
  assert.equal(refused.sign, true);
  assert.equal(refused.expect, 'refuse');
  const missing = buyPlan({ stall: cafe, qty: 1, receivers: [cafe.account], accountExists: false });
  assert.equal(missing.sign, false);
  assert.match(missing.reason, /no wallet on mainnet/);
  const ok = buyPlan({ stall: cafe, qty: 1, receivers: [cafe.account], accountExists: true, capNear: 0.06 });
  assert.equal(ok.sign, true);
  assert.equal(ok.expect, 'allow');
  assert.equal(ok.amountNear, 0.004);
});

test('the agent line maps onto the same actions', () => {
  const scam = parseCommand('Send this scam: pay 0.001 to stranger.near');
  assert.equal(scam.kind, 'scam');
  assert.equal(scam.text, 'pay 0.001 to stranger.near');
  assert.equal(parseCommand("What's my score?").kind, 'score');
  assert.equal(parseCommand('score').kind, 'score');
  const buy = parseCommand('Buy 1 potion from Café');
  assert.equal(buy.kind, 'buy');
  assert.equal(buy.qty, 1);
  assert.equal(buy.item, 'potion');
  assert.equal(parseCommand('Buy 1 potion from Cafe').kind, 'buy');
  assert.equal(parseCommand('Simulate a week').kind, 'sim');
  const miss = parseCommand('hello');
  assert.equal(miss.kind, 'miss');
  assert.match(miss.hint, /Send this scam/);
  assert.equal(miss.hint, MISS_HINT);
  const found = findStall(stalls(), { item: 'potion', stall: 'Café' });
  assert.equal(found.id, 'cafe');
});

test('the seal shows on a refusal and the coin only after a real allow', () => {
  assert.equal(sealFor({ decision: 'denied', reason: 'Refused.' }).show, true);
  assert.equal(sealFor({ decision: 'allowed', tx: 'AZWxqZnsv47WFjerjw4J8PB2SEiaYZfm6mfquYJ9xPht' }).show, false);
  assert.equal(sealFor({ cancelled: true }).show, false);
  const cine = cinemaFor({ decision: 'allowed', tx: 'AZWxqZnsv47WFjerjw4J8PB2SEiaYZfm6mfquYJ9xPht' });
  assert.equal(cine.show, true);
  assert.equal(cine.text, 'The coin landed.');
  assert.equal(cinemaFor({ decision: 'denied', tx: 'AZWxqZnsv47WFjerjw4J8PB2SEiaYZfm6mfquYJ9xPht' }), null);
  assert.equal(cinemaFor({ cancelled: true, decision: 'allowed', tx: 'x' }), null);
  assert.equal(cinemaFor({ simulation: true, decision: 'allowed', tx: 'x' }), null);
});

test('stall icons are drawn marks', () => {
  for (const name of ['potion', 'loaf', 'blade', 'score', 'seal']) {
    const html = arenaIcon(name);
    assert.match(html, /<svg/);
    assert.equal(html.includes('?'), false);
  }
  assert.equal(arenaIcon('zzz').includes('?'), false);
  assert.match(arenaIcon('zzz'), /<svg/);
  assert.match(arenaIcon(''), /N/);
});

test('the market payload is the rules file, and a week is still a simulation', () => {
  const live = marketPayload();
  assert.equal(live.simulation, false);
  assert.equal(live.tx, null);
  assert.equal(live.stalls.length, 3);
  assert.equal(live.stalls[0].price_near, 0.004);
  assert.equal(live.contract, 'arena.nearcarta.near');
  const week = marketPayload({ week: 7 });
  assert.equal(week.simulation, true);
  assert.equal(week.tx, null);
  assert.equal(week.label, SIM_LABEL);
});

test('a missing stall account is not treated as a wallet', async () => {
  assert.equal(await stallOnChain('cafe.arena.nearcarta.near', async () => { throw new Error('UNKNOWN_ACCOUNT'); }), false);
  assert.equal(await stallOnChain('cafe.arena.nearcarta.near', async () => ({ amount: '1' })), true);
  assert.equal(await stallOnChain('cafe.arena.nearcarta.near', async () => ({ error: 'nope' })), false);
});

test('the arena room keeps the attack line and the city list stays on the door', () => {
  const deep = readFileSync(new URL('../../../app/src/panels/deep.js', import.meta.url), 'utf8');
  assert.match(deep, /data-testid="arena-attack"/);
  const world = readFileSync(new URL('../../../app/design/D9_world/index.html', import.meta.url), 'utf8');
  assert.match(world, /data-city-shop="arena"/);
  const room = readFileSync(new URL('../../../app/design/D8_shops/shops/arena.js', import.meta.url), 'utf8');
  assert.match(room, /Café/);
  assert.match(room, /Bakery/);
  assert.match(room, /Smith/);
});
