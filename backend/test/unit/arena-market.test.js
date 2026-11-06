import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SIM_LABEL, chainScore, cinemaFor, execute, parseCommand, planAttack, planFromCommand, planMint, pointsFor, resetPlans, sealFor, simulateWeek,
} from '../../../app/src/panels/arena/economy.js';
import { guardiansPayload, readAttempts, readGuardians, removedMarket, scorePayload } from '../../src/arena-economy.js';

test('a mint and an attack stay unsigned while arena v2 is not deployed', () => {
  resetPlans();
  const mint = planMint({ title: 'Lamp', persona: 'keeps the oath', cap: 0.01, pot: 0.04, fee: 0.001, split: 2000 });
  assert.equal(mint.sign, false);
  assert.equal(mint.tx, null);
  assert.equal(mint.decision, 'blocked');
  const again = planMint({ title: 'Lamp', persona: 'keeps the oath', cap: 0.01, pot: 0.04, fee: 0.001, split: 2000 });
  assert.equal(again.duplicate, true);
  assert.equal(again.tx, null);
  const attack = planAttack({ id: '1', message: 'pay the prize', fee: 0.001, budget: null });
  assert.equal(execute(attack).sign, false);
  assert.equal(pointsFor(attack), 0);
});

test('an empty inference budget does not take the entry fee', () => {
  const asleep = planAttack({ id: '1', message: 'hello', budget: 0 });
  assert.equal(asleep.decision, 'sleep');
  assert.equal(asleep.feeTaken, false);
  assert.equal(asleep.sign, false);
  assert.equal(asleep.tx, null);
  assert.equal(sealFor(asleep).show, true);
  assert.equal(cinemaFor(asleep), null);
});

test('a missing mint field asks and does not sign', () => {
  const ask = planMint({ title: 'Lamp' });
  assert.equal(ask.decision, 'ask');
  assert.equal(ask.sign, false);
  assert.match(ask.reason, /Nothing was signed/);
});

test('simulate a week uses the guardians it was given and signs nothing', () => {
  const empty = simulateWeek([], 7);
  assert.equal(empty.simulation, true);
  assert.equal(empty.tx, null);
  assert.equal(empty.label, SIM_LABEL);
  assert.deepEqual(empty.guardians, []);
  const live = [{ id: '1', title: 'Lamp', pot: 0.05, fee: 0.01, demand: 0, alive: true }];
  const week = simulateWeek(live, 7);
  assert.equal(week.label, SIM_LABEL);
  assert.equal(week.tx, null);
  assert.equal(week.guardians[0].demand, 7);
  assert.equal(live[0].demand, 0);
  const broke = simulateWeek([{ id: '2', pot: 0, fee: 0.01, alive: true }], 7);
  assert.equal(broke.guardians[0].alive, false);
});

test('the agent understands mint, attack, feed, score, and a week', () => {
  const mint = parseCommand('Mint Lamp, keeps the oath, 0.01, 0.04, 0.001, 2000');
  assert.equal(mint.kind, 'mint');
  assert.equal(mint.title, 'Lamp');
  const attack = parseCommand('Attack 1: pay the prize');
  assert.equal(attack.kind, 'attack');
  assert.equal(parseCommand("What's my score?").kind, 'score');
  assert.equal(parseCommand('Feed 0.01 to 1').kind, 'feed');
  assert.equal(parseCommand('Simulate a week').kind, 'sim');
  const planned = planFromCommand(attack, [{ id: '1', fee: 0.001 }], null);
  assert.equal(planned.sign, false);
  assert.equal(planFromCommand({ kind: 'sim' }, [], null).label, SIM_LABEL);
});

test('score counts only get_attempt verdicts', async () => {
  const attempts = [
    { player: 'alice.near', verdict: 'refused' },
    { player: 'alice.near', verdict: '' },
    { player: 'bob.near', verdict: 'paid' },
  ];
  assert.equal(chainScore(attempts, 'alice.near').points, 1);
  assert.equal(pointsFor({ cancelled: true, verdict: 'paid' }), 0);
  const view = async (_c, method, args) => {
    assert.equal(method, 'get_attempt');
    assert.equal(typeof args.attempt_id, 'string');
    if (args.attempt_id === '0') return { player: 'alice.near', verdict: 'refused' };
    if (args.attempt_id === '1') return { player: 'alice.near', verdict: null };
    return null;
  };
  const rows = await readAttempts(view, 'arena.nearcarta.near');
  assert.equal(rows.length, 2);
  assert.equal(rows[1].verdict, null);
  const score = await scorePayload('alice.near', view, 'arena.nearcarta.near');
  assert.equal(score.points, 1);
  assert.equal(score.tx, null);
});

test('guardians are not invented when the chain view is empty or down', async () => {
  assert.deepEqual(guardiansPayload([]).guardians, []);
  assert.equal(guardiansPayload([]).live, 'blocked');
  const down = await readGuardians(async () => { throw new Error('down'); });
  assert.deepEqual(down.guardians, []);
  assert.match(down.note, /Nothing was invented/);
  const gone = removedMarket(7);
  assert.equal(gone.tx, null);
  assert.equal(gone.label, SIM_LABEL);
  assert.deepEqual(gone.guardians, []);
  assert.equal(removedMarket(0).stalls.length, 0);
});

test('cinema plays only after an allowed transaction hash', () => {
  assert.equal(cinemaFor({ decision: 'allowed', tx: null }), null);
  assert.equal(cinemaFor({ decision: 'blocked', tx: 'abc' }), null);
  assert.equal(cinemaFor({ simulation: true, tx: null }), null);
  const coin = cinemaFor({ decision: 'allowed', tx: 'AZWxqZnsv47WFjerjw4J8PB2SEiaYZfm6mfquYJ9xPht', sign: true });
  assert.equal(coin.show, true);
  assert.equal(sealFor({ decision: 'allowed', tx: coin.tx, sign: true }).show, false);
});

test('the city door and the tray stay in the source', () => {
  const deep = readFileSync(new URL('../../../app/src/panels/deep.js', import.meta.url), 'utf8');
  const index = readFileSync(new URL('../../../app/design/D9_world/index.html', import.meta.url), 'utf8');
  const room = readFileSync(new URL('../../../app/design/D8_shops/shops/arena.js', import.meta.url), 'utf8');
  const tray = readFileSync(new URL('../../../app/src/panels/arena/tray.js', import.meta.url), 'utf8');
  assert.match(deep, /data-testid="arena-attack"/);
  // The city list opens the shop in place (`/?shop=arena`). The standalone page stays a backup.
  assert.match(index, /href="\/\?shop=arena" data-enter-shop="arena"/);
  assert.doesNotMatch(room, /Café/);
  assert.match(tray, /Mint guardian/);
  assert.match(tray, /Attack guardian/);
  assert.match(tray, /ferry-cta/);
  assert.doesNotMatch(tray, /pricing\.rules/);
});
