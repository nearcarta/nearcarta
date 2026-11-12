// F16-F18: the Try free take on prod (2026-11-12).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deedRecord } from '../../src/house-deed.js';
import { bestGood, NODES_BY_GOOD } from '../../../app/src/market/live-guest.js';

const read = (p) => readFileSync(new URL('../../../' + p, import.meta.url), 'utf8');
const city = read('app/src/market/city.js');
const play = read('app/src/market/live-play.js');

test('F16: a mainnet sign-in in the same browser is not the testnet round', () => {
  assert.match(play, /export const on = \(\) => !!live\.account && !onTestnet\(\);/);
});

test('F16: the testnet Receipt lists only this guest\'s testnet moves, in testnet words', () => {
  const g = city.slice(city.indexOf('function vGuestReceipt()'), city.indexOf('function mood('));
  assert.match(city, /if \(GT\.on\(\)\) return vGuestReceipt\(\);/);
  assert.match(g, /Your moves on the NEAR test network/);
  assert.doesNotMatch(g, /mainnet/i);
  assert.doesNotMatch(g, /x\.proof/);
  assert.match(city, /all\.filter\(\(t\) => t\.hash && t\.net === 'testnet' && t\.account === me\)/);
  assert.match(read('app/src/market/live-guest.js'), /net: 'testnet', account: account\(\), at: Date\.now\(\)/);
});

test('F17: the testnet deed routes read the testnet house, never the mainnet shop', () => {
  const T = JSON.parse(read('shared/deployments/testnet.json'));
  assert.deepEqual(deedRecord(T, 'testnet', 'house.nearcarta.near').contract, 'house.nearcarta.testnet');
  assert.equal(deedRecord({}, 'testnet', 'house.nearcarta.near'), null);
  assert.equal(deedRecord({}, 'mainnet', 'house.nearcarta.near').contract, 'house.nearcarta.near');
  assert.match(read('backend/src/app.js'), /error: 'deed read failed'/);
});

test('F17: the invest top-up sells the good the Arena pays most for', () => {
  const y = (c) => String(BigInt(Math.round(c * 1e4)) * 10n ** 16n);
  // Prod testnet quotes on 2026-11-12: salt had sunk to 1.2 coins, iron paid 15.2.
  assert.equal(bestGood({ 'good:salt': { sell: y(1.2) }, 'good:iron': { sell: y(15.2) }, 'good:herb': { sell: y(11.4) } }), 'good:iron');
  assert.equal(bestGood({}), 'good:salt');
  assert.deepEqual(NODES_BY_GOOD['good:iron'], ['guard-1', 'guard-2']);
});

test('F18: the price line shows enough decimals to see the move', async () => {
  const src = city.slice(city.indexOf('const coinsAt'), city.indexOf('\n}', city.indexOf('export function priceMove')) + 2);
  const COIN = 10n ** 20n;
  const coins = (y) => { const t = (BigInt(y) * 10n) / COIN; const w = t / 10n, f = t % 10n; return f ? `${w}.${f}` : `${w}`; };
  const { priceMove } = new Function('Q', 'coins', src.replace('export function', 'function') + '; return { priceMove };')({ COIN }, coins);
  const m = priceMove(120n * 10n ** 18n, 11964n * 10n ** 16n);
  assert.equal(m.text, '1.200 → 1.196');
  assert.equal(m.down, true);
  assert.equal(priceMove(COIN, COIN).same, true);
  // An unchanged price prints plainly, not as 1.320000 → 1.320000.
  assert.equal(priceMove(132n * 10n ** 18n, 132n * 10n ** 18n).text, '1.3 → 1.3');
  assert.match(city, /pm\.down \? 'Your sale pushed the price down/);
});

test('F19-F22: /judge header is solid, the column is wide and centred, no unfinished line, refusal says Failed on purpose', async () => {
  const html = read('app/src/judges.html');
  assert.match(html, /body > header \{ background: #120e0b !important;/);
  assert.match(html, /width: min\(1240px, 100%\); margin-left: auto; margin-right: auto;/);
  const data = read('app/src/judges-data.js');
  assert.doesNotMatch(data, /being confirmed/);
  const { renderGames, FAILED_NOTE } = await import('../../../app/src/judges-data.js');
  const g = renderGames();
  assert.match(g, /Open the refusal<\/a><span class="why-failed"/);
  assert.ok(g.includes(FAILED_NOTE));
  assert.match(FAILED_NOTE, /Failed on purpose/);
});

test('the scam errand opens the guest row before forcing the over-limit payment', () => {
  const g = read('app/src/market/live-guest.js');
  const f = g.slice(g.indexOf('export async function scamForce'), g.indexOf('async function sealProfit'));
  assert.ok(f.indexOf('openRow({ signer: s })') > 0 && f.indexOf('openRow({ signer: s })') < f.indexOf('callAs(s,'));
});
