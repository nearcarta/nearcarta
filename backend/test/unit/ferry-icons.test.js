import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { corridorCards, DEFAULT_ROUTES, ferryMarkup } from '../../../app/src/panels/deep.js';
import { tokenStack, tokenBadge, parseRouteFrom, chainKey } from '../../../app/src/panels/token-badge.js';

const read = p => readFileSync(new URL('../../../' + p, import.meta.url), 'utf8');

test('ferry routes carry ETH/USDC icons and chain badges from /tokens', () => {
  const html = ferryMarkup({ ri: 0 }, DEFAULT_ROUTES);
  assert.match(html, /src="\/tokens\/eth\.svg"/);
  assert.match(html, /src="\/tokens\/usdc\.svg"/);
  assert.match(html, /src="\/tokens\/zec\.svg"/);
  assert.match(html, /src="\/tokens\/chains\/eth\.svg"/);
  assert.match(html, /src="\/tokens\/chains\/base\.svg"/);
  assert.match(html, /src="\/tokens\/chains\/arb\.svg"/);
  assert.match(html, /data-testid="ferry-dest"/);
  assert.match(html, /Shielded ZEC/);
  assert.equal((html.match(/data-testid="ferry-route"/g) || []).length, 3);
  assert.match(html, /class="route-chip"[^>]*aria-pressed="true"/);
});

test('corridor cards stack token and destination ZEC icons', () => {
  const cards = corridorCards(DEFAULT_ROUTES, [{ id: DEFAULT_ROUTES[0].id, usdText: 'about $1.2', text: 'ETH', best: true }]);
  assert.match(cards, /src="\/tokens\/eth\.svg"/);
  assert.match(cards, /src="\/tokens\/zec\.svg"/);
  assert.match(cards, /about \$1\.2/);
  assert.match(cards, /Best rate/);
  assert.match(cards, /class="corridor best"/);
});

test('token badge helper resolves chain keys and assets exist', () => {
  assert.equal(chainKey('Arbitrum'), 'arb');
  assert.equal(parseRouteFrom('USDC@base').sym, 'USDC');
  assert.match(tokenStack('ETH', 'eth'), /\/tokens\/eth\.svg/);
  assert.match(tokenBadge('USDC', 'base'), /\/tokens\/usdc\.svg/);
  assert.match(tokenBadge('USDC', 'base'), /\/tokens\/chains\/base\.svg/);
  for (const f of ['eth.svg', 'usdc.svg', 'zec.svg', 'chains/eth.svg', 'chains/base.svg', 'chains/arb.svg', 'chains/zec.svg']) {
    assert.match(read('app/src/tokens/' + f), /<svg/);
  }
  assert.match(read('app/src/panels/panels.css'), /Ferry token \+ chain badges/);
  assert.match(read('app/src/tokens/LICENSES.md'), /chains\/arb\.svg/);
});
