import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { corridorCards, DEFAULT_ROUTES, ferryMarkup } from '../../../app/src/panels/deep.js';
import { tokenStack, tokenBadge, parseRouteFrom, chainKey, resolveIcons, pairHero, pickerListbox } from '../../../app/src/panels/token-badge.js';

const read = p => readFileSync(new URL('../../../' + p, import.meta.url), 'utf8');

test('ferry routes carry ETH/USDC icons and chain badges from /tokens', () => {
  const html = ferryMarkup({ ri: 0 }, DEFAULT_ROUTES);
  assert.match(html, /src="\/tokens\/eth\.svg"/);
  assert.match(html, /src="\/tokens\/usdc\.svg"/);
  assert.match(html, /src="\/tokens\/zec\.svg"/);
  assert.match(html, /src="\/tokens\/chains\/eth\.svg"/);
  assert.match(html, /src="\/tokens\/chains\/base\.svg"/);
  assert.match(html, /src="\/tokens\/chains\/arb\.svg"/);
  assert.match(html, /src="\/tokens\/chains\/zec\.svg"/);
  assert.match(html, /data-testid="ferry-dest"/);
  assert.match(html, /data-testid="ferry-flow"/);
  assert.match(html, /data-testid="ferry-tabs"/);
  assert.equal((html.match(/data-testid="ferry-route"/g) || []).length, 3);
  assert.match(html, /class="route-chip"[^>]*aria-pressed="true"/);
});

test('corridor cards stack token and destination ZEC icons', () => {
  const cards = corridorCards(DEFAULT_ROUTES, [{ id: DEFAULT_ROUTES[0].id, usdText: 'about $1.2', text: 'ETH', best: true }]);
  assert.match(cards, /src="\/tokens\/eth\.svg"/);
  assert.match(cards, /src="\/tokens\/zec\.svg"/);
  assert.match(cards, /src="\/tokens\/chains\/zec\.svg"/);
  assert.match(cards, /about \$1\.2/);
  assert.match(cards, /Best rate/);
  assert.match(cards, /class="corridor best"/);
});

test('quote rows always render token+chain badges for in and out', () => {
  const html = ferryMarkup({
    ri: 1,
    quotes: [{
      symbolIn: 'USDC', chainIn: 'base', amountIn: '3',
      symbolOut: 'ZEC', chainOut: 'zec', amountOut: '0.002',
      usd: 2.9, fee: 100, eta: 120, best: true, text: 'x',
    }, {
      symbolIn: 'USDC', chainIn: 'arb', amountIn: '3',
      symbolOut: 'ZEC', chainOut: 'zec', amountOut: '0.0019',
      usd: 2.8, fee: 110, eta: 130, text: 'y',
    }],
  }, DEFAULT_ROUTES);
  assert.match(html, /data-testid="ferry-row"/);
  assert.equal((html.match(/data-testid="ferry-row"/g) || []).length, 2);
  assert.match(html, /src="\/tokens\/usdc\.svg"/);
  assert.match(html, /src="\/tokens\/chains\/base\.svg"/);
  assert.match(html, /src="\/tokens\/chains\/arb\.svg"/);
  assert.match(html, /src="\/tokens\/zec\.svg"/);
  assert.match(html, /src="\/tokens\/chains\/zec\.svg"/);
  assert.match(html, /row-best/);
});

test('token badge helper resolves chain keys and ZEC assets are valid SVG', () => {
  assert.equal(chainKey('Arbitrum'), 'arb');
  assert.equal(parseRouteFrom('USDC@base').sym, 'USDC');
  assert.match(tokenStack('ETH', 'eth'), /\/tokens\/eth\.svg/);
  assert.match(tokenBadge('USDC', 'base'), /\/tokens\/usdc\.svg/);
  assert.match(tokenBadge('USDC', 'base'), /\/tokens\/chains\/base\.svg/);
  assert.match(tokenStack('ZEC', 'zec'), /\/tokens\/zec\.svg/);
  assert.match(tokenStack('ZEC', 'zec'), /\/tokens\/chains\/zec\.svg/);
  assert.match(tokenStack('NEAR', 'near'), /\/tokens\/chains\/near\.svg/);
  for (const f of ['eth.svg', 'usdc.svg', 'zec.svg', 'chains/eth.svg', 'chains/base.svg', 'chains/arb.svg', 'chains/zec.svg', 'chains/near.svg']) {
    assert.match(read('app/src/tokens/' + f), /<svg\b/);
  }
  // ZEC marks must carry an explicit viewBox so they paint at CSS sizes on the brown UI.
  assert.match(read('app/src/tokens/zec.svg'), /viewBox=/);
  assert.match(read('app/src/tokens/chains/zec.svg'), /viewBox=/);
  const zec = read('app/src/tokens/zec.svg');
  assert.match(zec, /#ECB244|#ecb244/i);
  assert.match(zec, /<circle\b/);
  assert.match(zec, /#FFF|#FFFFFF/i);
  const zchain = read('app/src/tokens/chains/zec.svg');
  assert.match(zchain, /viewBox="0 0 24 24"/);
  assert.match(zchain, /<circle\b/);
  assert.match(zchain, /#ECB244|#ecb244/i);
  assert.match(read('app/src/panels/panels.css'), /Ferry token \+ chain badges/);
  assert.match(read('app/src/tokens/LICENSES.md'), /chains\/zec\.svg/);
  assert.match(read('app/src/tokens/LICENSES.md'), /CC0/);
});

test('city Ferry markup exposes live token picker + quick corridors', () => {
  const html = ferryMarkup({
    choices: Array.from({ length: 60 }, (_, i) => ({ symbol: 'T' + i, chain: i % 2 ? 'near' : 'base', id: 'T' + i + '|' + (i % 2 ? 'near' : 'base'), label: 'T' + i })),
    fromId: 'T0|base',
    toId: 'ZEC|zec',
  }, DEFAULT_ROUTES);
  assert.match(html, /data-testid="ferry-picker"/);
  assert.match(html, /data-testid="ferry-chain-filter"/);
  assert.match(html, /data-testid="ferry-from"/);
  assert.match(html, /data-testid="ferry-to"/);
  assert.match(html, /60 live/);
  assert.match(html, /Quick ZEC corridors/);
  assert.equal((html.match(/data-testid="ferry-route"/g) || []).length, 3);
});

test('token badges never use inline onerror (CSP)', () => {
  const src = read('app/src/panels/token-badge.js');
  assert.doesNotMatch(src, /\bonerror=/);
  assert.match(src, /bindTokenFallbacks/);
  assert.match(tokenStack('ETH', 'eth'), /data-ti-fallback/);
});

test('Ferry tray matches the panel design system (one shell, one CTA, no 440px tray)', () => {
  // This used to pin the old 440px tray and 18px gaps. The owner's reference replaced that shell
  // with one system for all nine shops, so the assertions now guard the new contract: one shared
  // stylesheet owns the box, the panel is 320-380px, and the old widths cannot come back.
  const shell = read('app/src/panels/panel-ref.css');
  assert.match(shell, /clamp\(320px,\s*360px,\s*380px\)/);
  assert.match(shell, /--r-panel:\s*20px/);
  assert.match(shell, /--h-cta:\s*48px/);
  assert.match(shell, /--tap:\s*40px/);
  assert.doesNotMatch(shell, /width:\s*min\(480px/);
  // The world still carries the agent character the panel must not cover.
  const world = read('app/design/D9_world/world.css');
  assert.match(world, /#t-who/);
  assert.match(world, /#t-track/);
  assert.match(world, /\.ferry-agent-char/);
  assert.match(world, /\.ferry-agent-avatar/);
  assert.match(world, /\.ferry-agent-send/);
  // The old body's other assertions still guard real markup, so they stay:
  const panels = read('app/src/panels/panels.css');
  assert.match(panels, /width:auto/);
  const ui = read('app/design/D8_shops/js/shopui.js');
  assert.match(ui, /AI Agent/);
  assert.match(ui, /ferry-agent-char/);
  assert.match(ui, /robotexpressive\.webp/);
  assert.match(ui, /width="72"/);
  assert.match(ui, /ferry-agent-send/);
  assert.doesNotMatch(ui, /💬/);
  assert.doesNotMatch(ui, /ferry-dock-toggle/);
  const html = ferryMarkup({ fromId: 'USDC|base', toId: 'ZEC|zec' }, DEFAULT_ROUTES);
  assert.match(html, /You pay/);
  assert.match(html, /You get/);
  assert.doesNotMatch(html, /<span>Get<\/span>/);
  assert.doesNotMatch(html, /<span>Can<\/span>/);
  assert.match(html, /value="3"/);
});

test('USDC on Solana and USDC on Polygon resolve to library icons', () => {
  for (const chain of ['sol', 'solana', 'pol', 'polygon']) {
    const stack = tokenStack('USDC', chain);
    assert.match(stack, /src="\/tokens\/usdc\.svg"/);
    assert.match(stack, /\/tokens\/chains\/(sol|polygon)\.svg/);
    assert.doesNotMatch(stack, /class="ti coin"/);
    assert.doesNotMatch(stack, /\?/);
  }
  assert.match(tokenStack('USDC', 'sol'), /\/tokens\/chains\/sol\.svg/);
  assert.match(tokenStack('USDC', 'polygon'), /\/tokens\/chains\/polygon\.svg/);
  assert.match(tokenStack('USDC', 'pol'), /\/tokens\/chains\/polygon\.svg/);
  assert.equal(chainKey('pol'), 'polygon');
  assert.equal(chainKey('Polygon'), 'polygon');
  const icons = resolveIcons('USDC', 'sol');
  assert.equal(icons.tokenSrc, '/tokens/usdc.svg');
  assert.equal(icons.chainSrc, '/tokens/chains/sol.svg');
  const remote = tokenBadge('USDC', 'sol', { icon: 'https://cdn.example/usdc.svg' });
  assert.match(remote, /src="https:\/\/cdn\.example\/usdc\.svg"/);
  assert.doesNotMatch(remote, /src="\/tokens\/usdc\.svg"/);
  assert.match(remote, /\/tokens\/chains\/sol\.svg/);
  const hero = pairHero({ fromSym: 'USDC', fromChain: 'sol', toSym: 'USDC', toChain: 'polygon', amt: '3', outAmt: '2.9' });
  assert.match(hero, /\/tokens\/chains\/sol\.svg/);
  assert.match(hero, /\/tokens\/chains\/polygon\.svg/);
  assert.match(hero, />3</);
  assert.doesNotMatch(hero, /\?/);
  const miss = tokenStack('NOTREAL', 'nope');
  assert.match(miss, /class="ti coin"/);
  assert.match(miss, />N</);
  assert.doesNotMatch(miss, /\?/);
  assert.match(read('app/src/tokens/chains/sol.svg'), /<svg\b/);
  assert.match(read('app/src/tokens/chains/polygon.svg'), /<svg\b/);
  assert.match(read('app/src/tokens/LICENSES.md'), /chains\/polygon\.svg/);
  assert.match(read('app/src/tokens/LICENSES.md'), /MIT/);
  const box = pickerListbox({
    id: 'f-from',
    testid: 'ferry-from',
    selected: 'USDC|sol',
    options: [
      { value: 'USDC|sol', label: 'USDC on sol', symbol: 'USDC', chain: 'sol' },
      { value: 'USDC|pol', label: 'USDC on pol', symbol: 'USDC', chain: 'pol' },
    ],
  });
  assert.match(box, /role="listbox"/);
  assert.match(box, /role="option"/);
  assert.match(box, /data-value="USDC\|sol"/);
  assert.match(box, /\/tokens\/usdc\.svg/);
  assert.match(box, /\/tokens\/chains\/sol\.svg/);
  assert.match(box, /\/tokens\/chains\/polygon\.svg/);
  assert.doesNotMatch(box, /\?/);
  assert.doesNotMatch(box, /\bonerror=/);
});

test('USDC sol to USDC pol updates the flow and both menus', () => {
  const choices = [
    { symbol: 'USDC', chain: 'sol', id: 'USDC|sol', label: 'USDC on sol' },
    { symbol: 'USDC', chain: 'pol', id: 'USDC|pol', label: 'USDC on pol' },
    { symbol: 'ETH', chain: 'eth', id: 'ETH|eth', label: 'ETH on eth' },
    { symbol: 'USDC', chain: 'base', id: 'USDC|base', label: 'USDC on base' },
    { symbol: 'USDC', chain: 'arb', id: 'USDC|arb', label: 'USDC on arb' },
    { symbol: 'NEAR', chain: 'near', id: 'NEAR|near', label: 'NEAR on near' },
    { symbol: 'BTC', chain: 'btc', id: 'BTC|btc', label: 'BTC on btc' },
  ];
  const html = ferryMarkup({ choices, fromId: 'USDC|sol', toId: 'USDC|pol', amt: '3' }, DEFAULT_ROUTES);
  assert.equal((html.match(/role="listbox"/g) || []).length, 3);
  assert.match(html, /data-testid="ferry-from"/);
  assert.match(html, /data-testid="ferry-to"/);
  assert.match(html, /data-testid="ferry-chain-filter"/);
  assert.match(html, /data-value="USDC\|sol"/);
  assert.match(html, /data-value="USDC\|pol"/);
  const flow = html.slice(html.indexOf('data-testid="ferry-flow"'), html.indexOf('data-testid="ferry-token-search"'));
  assert.match(flow, /\/tokens\/usdc\.svg/);
  assert.match(flow, /\/tokens\/chains\/sol\.svg/);
  assert.match(flow, /\/tokens\/chains\/polygon\.svg/);
  assert.doesNotMatch(flow, /\?/);
  assert.doesNotMatch(flow, /class="ti coin"/);
  assert.doesNotMatch(html, /\bonerror=/);
  const swapped = ferryMarkup({ choices, fromId: 'USDC|pol', toId: 'USDC|sol', amt: '3' }, DEFAULT_ROUTES);
  const flow2 = swapped.slice(swapped.indexOf('data-testid="ferry-flow"'), swapped.indexOf('data-testid="ferry-token-search"'));
  const polAt = flow2.indexOf('/tokens/chains/polygon.svg');
  const solAt = flow2.indexOf('/tokens/chains/sol.svg');
  assert.ok(polAt >= 0 && solAt > polAt);
  for (const [sym, chain, file] of [['ETH', 'eth', 'eth'], ['USDC', 'base', 'base'], ['USDC', 'arb', 'arb'], ['NEAR', 'near', 'near'], ['BTC', 'btc', 'btc']]) {
    const stack = tokenStack(sym, chain);
    assert.match(stack, new RegExp('/tokens/chains/' + file + '\\.svg'));
    assert.doesNotMatch(stack, /\?/);
  }
});

test('defaultAmtFor prefers 3 for USDC and tiny for ETH', async () => {
  const { defaultAmtFor } = await import('../../../app/src/panels/deep.js');
  assert.equal(defaultAmtFor('USDC'), '3');
  assert.equal(defaultAmtFor('usdc.e'), '3');
  assert.equal(defaultAmtFor('ETH'), '0.002');
  assert.equal(defaultAmtFor('NEAR'), '0.05');
  assert.equal(defaultAmtFor('wNEAR'), '0.05');
});
